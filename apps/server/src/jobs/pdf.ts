/**
 * Enqueueing PDF renders (ARCHITECTURE section 14, story S10).
 *
 * `createReport` stores the report first and then asks a {@link PdfJobQueue} to render its PDF. The queue is a
 * port with two implementations:
 *
 * - {@link CloudTasksPdfJobQueue}: production. One Cloud Task per report, named after the report id so that a
 *   second enqueue of the same report is deduplicated by Cloud Tasks itself. The task POSTs to the PDF worker
 *   with an OIDC token for the worker's invoker service account. Retries and backoff are configured on the
 *   queue (see docs/SETUP.md), not in code.
 * - {@link InlinePdfJobQueue}: local development and tests. Runs a function in this process (normally the
 *   worker's render job), with the same one-job-per-report dedupe.
 *
 * Enqueueing is best effort from the caller's point of view: `createReport` catches a failure and leaves the
 * report's PDF "preparing" (see `mcp/create-report.ts`).
 */

export interface PdfJobQueue {
  /**
   * Asks for the PDF of `reportId` to be rendered. Resolves once the job is accepted (not when it finishes).
   * Enqueueing the same report twice is a no-op. Rejects if the job could not be accepted.
   */
  enqueue(reportId: string): Promise<void>;
}

/** Ids we issue are `rpt_` plus base64url. Anything else cannot be part of a Cloud Tasks task name. */
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,400}$/;

/** The one Cloud Tasks call we make. The real `CloudTasksClient` satisfies this; tests pass a fake. */
export interface CloudTasksLike {
  createTask(request: { parent: string; task: CloudTask }): Promise<unknown>;
}

export interface CloudTask {
  /** Full resource name: `projects/P/locations/L/queues/Q/tasks/T`. Setting it makes Cloud Tasks deduplicate. */
  name: string;
  dispatchDeadline: { seconds: number };
  httpRequest: {
    httpMethod: "POST";
    url: string;
    headers: Record<string, string>;
    /** Base64 of the JSON body (Cloud Tasks takes bytes). */
    body: string;
    oidcToken: { serviceAccountEmail: string; audience: string };
  };
}

export interface CloudTasksPdfJobQueueConfig {
  project: string;
  /** Default "us-central1". */
  location?: string;
  /** Queue id (not the full path). */
  queue: string;
  /** Base URL of the PDF worker, no trailing slash needed: the task posts to `${workerUrl}/internal/render`. */
  workerUrl: string;
  /** Service account the task authenticates as. It needs `roles/run.invoker` on the worker. */
  invokerServiceAccount: string;
  /** Cloud Tasks gives up on one attempt after this long. Default 180 s (the worker's render timeout is 30 s). */
  dispatchDeadlineSeconds?: number;
}

export const RENDER_PATH = "/internal/render";

export class CloudTasksPdfJobQueue implements PdfJobQueue {
  readonly #client: CloudTasksLike;
  readonly #cfg: Required<CloudTasksPdfJobQueueConfig>;
  readonly #parent: string;
  readonly #url: string;

  constructor(client: CloudTasksLike, config: CloudTasksPdfJobQueueConfig) {
    this.#client = client;
    this.#cfg = { location: "us-central1", dispatchDeadlineSeconds: 180, ...config };
    this.#parent = `projects/${this.#cfg.project}/locations/${this.#cfg.location}/queues/${this.#cfg.queue}`;
    const base = this.#cfg.workerUrl.replace(/\/+$/, "");
    this.#url = `${base}${RENDER_PATH}`;
  }

  async enqueue(reportId: string): Promise<void> {
    if (!TASK_ID_PATTERN.test(reportId)) throw new Error("report id cannot be used as a task name");
    try {
      await this.#client.createTask({
        parent: this.#parent,
        task: {
          name: `${this.#parent}/tasks/pdf-${reportId}`,
          dispatchDeadline: { seconds: this.#cfg.dispatchDeadlineSeconds },
          httpRequest: {
            httpMethod: "POST",
            url: this.#url,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(JSON.stringify({ reportId })).toString("base64"),
            // The audience is the worker's base URL, which is what Cloud Run checks for.
            oidcToken: { serviceAccountEmail: this.#cfg.invokerServiceAccount, audience: this.#cfg.workerUrl.replace(/\/+$/, "") },
          },
        },
      });
    } catch (err) {
      // gRPC ALREADY_EXISTS (6): a task with this name is queued, running, or finished within the last hour.
      // That is exactly the dedupe we asked for, not a failure.
      if ((err as { code?: unknown }).code === 6) return;
      throw err;
    }
  }
}

/** Environment variables read by {@link cloudTasksQueueFromEnv}. */
export interface PdfQueueEnv {
  GCP_PROJECT?: string | undefined;
  GOOGLE_CLOUD_PROJECT?: string | undefined;
  TASKS_LOCATION?: string | undefined;
  PDF_TASKS_QUEUE?: string | undefined;
  PDF_WORKER_URL?: string | undefined;
  PDF_WORKER_INVOKER_SA?: string | undefined;
}

/**
 * Builds the Cloud Tasks queue from the environment, or returns null when PDF export is not configured (local
 * development without a worker): `createReport` then simply returns no PDF link. Throws when it is partly
 * configured, so a typo in one variable fails at start-up rather than silently disabling PDFs.
 */
export async function cloudTasksQueueFromEnv(env: PdfQueueEnv = process.env, client?: CloudTasksLike): Promise<PdfJobQueue | null> {
  const project = env.GCP_PROJECT ?? env.GOOGLE_CLOUD_PROJECT;
  const { PDF_TASKS_QUEUE: queue, PDF_WORKER_URL: workerUrl, PDF_WORKER_INVOKER_SA: invoker } = env;
  if (!queue && !workerUrl && !invoker) return null;
  const missing = [
    ["GCP_PROJECT", project],
    ["PDF_TASKS_QUEUE", queue],
    ["PDF_WORKER_URL", workerUrl],
    ["PDF_WORKER_INVOKER_SA", invoker],
  ].filter(([, v]) => !v);
  if (missing.length > 0) throw new Error(`PDF queue is partly configured; missing ${missing.map(([k]) => k).join(", ")}`);
  const real =
    client ??
    new (await import("@google-cloud/tasks")).v2.CloudTasksClient();
  return new CloudTasksPdfJobQueue(real, {
    project: project!,
    queue: queue!,
    workerUrl: workerUrl!,
    invokerServiceAccount: invoker!,
    ...(env.TASKS_LOCATION ? { location: env.TASKS_LOCATION } : {}),
  });
}

/**
 * Runs the job in this process. For local development (`run` is the worker's render job) and for tests.
 * `enqueue` returns as soon as the job has started; `idle()` waits for every started job to finish.
 * A report id runs at most once while it is running or after it succeeded (the same dedupe Cloud Tasks gives);
 * a failed job is forgotten so it can be enqueued again. There is no retry loop: local runs fail loudly in the
 * log instead.
 */
export class InlinePdfJobQueue implements PdfJobQueue {
  readonly #run: (reportId: string) => Promise<unknown>;
  readonly #onError: (reportId: string, err: unknown) => void;
  readonly #seen = new Set<string>();
  readonly #inFlight = new Set<Promise<void>>();

  constructor(run: (reportId: string) => Promise<unknown>, onError?: (reportId: string, err: unknown) => void) {
    this.#run = run;
    this.#onError =
      onError ??
      ((reportId, err) => console.error(JSON.stringify({ severity: "ERROR", message: "inline pdf job failed", reportId, error: err instanceof Error ? err.name : "unknown" })));
  }

  async enqueue(reportId: string): Promise<void> {
    if (this.#seen.has(reportId)) return;
    this.#seen.add(reportId);
    const job: Promise<void> = (async () => {
      try {
        await this.#run(reportId);
      } catch (err) {
        this.#seen.delete(reportId);
        this.#onError(reportId, err);
      }
    })().finally(() => this.#inFlight.delete(job));
    this.#inFlight.add(job);
  }

  /** Resolves when no job is running. */
  async idle(): Promise<void> {
    while (this.#inFlight.size > 0) await Promise.all([...this.#inFlight]);
  }
}

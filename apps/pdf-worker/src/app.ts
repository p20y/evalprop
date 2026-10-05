import { Hono } from "hono";
import { z } from "zod";
import type { InternalAuthVerifier } from "./auth.ts";
import { describeError, silentLogger, type Logger } from "./logger.ts";
import type { RenderOutcome } from "./render-job.ts";

export interface WorkerAppDeps {
  verifier: InternalAuthVerifier;
  /** Renders one report (normally `renderReportPdf` with its dependencies bound). May throw. */
  render: (reportId: string) => Promise<RenderOutcome>;
  logger?: Logger;
}

const BodySchema = z.object({ reportId: z.string().regex(/^[A-Za-z0-9_-]{1,400}$/) });

/**
 * The worker's HTTP surface.
 *
 * `POST /internal/render` with `{ reportId }`, authenticated service to service. Status codes are chosen for
 * Cloud Tasks, which retries any non-2xx response with backoff and treats 2xx as done:
 *
 * | Status | Meaning | Retried? |
 * |---|---|---|
 * | 200 | rendered, or permanently nothing to do (report missing, revoked, expired, analysis gone, already done) | no |
 * | 400 | the body is not `{ reportId }`: a bug in the caller, retrying cannot help | until the queue's max attempts |
 * | 401 | no or invalid credential | until the queue's max attempts (fix the credential) |
 * | 500 | rendering or storage failed, or the render timed out: may work next time | yes |
 *
 * `GET /health` is unauthenticated and says nothing but `ok`.
 */
export function createWorkerApp(deps: WorkerAppDeps): Hono {
  const log = deps.logger ?? silentLogger;
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/internal/render", async (c) => {
    if (!(await deps.verifier.verify(c.req.header("authorization")))) {
      log.warn("rejected unauthenticated render request");
      return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
    }

    const body = BodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const { reportId } = body.data;

    try {
      const outcome = await deps.render(reportId);
      return c.json(outcome, 200);
    } catch (err) {
      log.error("pdf render failed", { reportId, ...describeError(err) });
      return c.json({ error: "render_failed" }, 500);
    }
  });

  return app;
}

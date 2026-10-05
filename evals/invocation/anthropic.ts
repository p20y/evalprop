import { TOOL_NAMES, type EvalPrompt, type Label } from "./schema.ts";
import type { EvalResult } from "./score.ts";
import { buildTools, type AnthropicTool } from "./tools.ts";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const API_URL = "https://api.anthropic.com/v1/messages";
export const API_VERSION = "2023-06-01";

const SYSTEM_BASE =
  "You are a helpful assistant in a chat app. The user has connected an app that provides the tools listed with this request. Use a tool when it is the right way to help; otherwise answer directly.";

export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system: string;
  tools: AnthropicTool[];
  tool_choice: { type: "auto" };
  messages: { role: "user"; content: string }[];
}

/**
 * The request for one prompt. A follow-up's `context` goes in the system prompt as a note about the state
 * of the conversation (the Messages API needs the first message to be the user's, so a prior assistant
 * turn cannot lead). Nothing about the expected label is sent.
 */
export function buildRequest(prompt: EvalPrompt, model: string, tools: AnthropicTool[] = buildTools()): MessagesRequest {
  const system = prompt.context === undefined ? SYSTEM_BASE : `${SYSTEM_BASE}\n\nConversation so far (already shown to the user): ${prompt.context}`;
  return { model, max_tokens: 1024, system, tools, tool_choice: { type: "auto" }, messages: [{ role: "user", content: prompt.prompt }] };
}

/** Thrown for errors that make the rest of the run pointless (bad key, no access). */
export class FatalApiError extends Error {}

export interface RunOptions {
  prompts: readonly EvalPrompt[];
  model: string;
  /** Required unless `dryRun`. Only ever sent as the `x-api-key` header; never logged or stored. */
  apiKey?: string;
  concurrency?: number;
  dryRun?: boolean;
  /** Injected in tests so no network is touched. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  url?: string;
  onProgress?: (done: number, total: number) => void;
}

export interface RunOutput {
  /** The requests that were (or, in a dry run, would be) sent, in prompt order. */
  requests: MessagesRequest[];
  /** Empty in a dry run. */
  results: EvalResult[];
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 60) * 1000;
  return Math.min(1000 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 250);
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { type?: string; message?: string } };
    const e = body.error;
    return `${res.status} ${e?.type ?? "error"}: ${(e?.message ?? "").slice(0, 200)}`.trim();
  } catch {
    return `${res.status} ${res.statusText}`.trim();
  }
}

/** One request with retries on 429, 5xx and network errors. Throws FatalApiError for 401/403. */
async function send(req: MessagesRequest, o: Required<Pick<RunOptions, "fetchImpl" | "sleep" | "maxRetries" | "url">> & { apiKey: string }): Promise<{ called: Label; calls: string[] }> {
  let lastError = "unknown error";
  for (let attempt = 0; attempt <= o.maxRetries; attempt++) {
    let res: Response;
    try {
      res = await o.fetchImpl(o.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": o.apiKey, "anthropic-version": API_VERSION },
        body: JSON.stringify(req),
      });
    } catch (err) {
      lastError = `network error: ${err instanceof Error ? err.message : "unknown"}`;
      if (attempt < o.maxRetries) await o.sleep(retryDelayMs(attempt, null));
      continue;
    }
    if (res.ok) {
      const body = (await res.json()) as { content?: { type: string; name?: string }[] };
      const calls = (body.content ?? []).filter((b) => b.type === "tool_use" && typeof b.name === "string").map((b) => b.name as string);
      const first = calls[0];
      const known = TOOL_NAMES.find((t) => t === first);
      if (first !== undefined && known === undefined) throw new Error(`model called unknown tool ${first}`);
      return { called: known ?? "none", calls };
    }
    lastError = await errorText(res);
    if (res.status === 401 || res.status === 403) throw new FatalApiError(lastError);
    if (!isRetryable(res.status)) throw new Error(lastError);
    if (attempt < o.maxRetries) await o.sleep(retryDelayMs(attempt, res.headers.get("retry-after")));
  }
  throw new Error(`gave up after ${o.maxRetries + 1} attempts: ${lastError}`);
}

/**
 * Sends every prompt to the Messages API (concurrency 4 by default) and records the first tool the model
 * chose, or "none". A per-prompt failure is recorded as `error` and the run continues; an authentication
 * failure stops the run. With `dryRun` nothing is sent and no key is needed.
 */
export async function runAnthropic(opts: RunOptions): Promise<RunOutput> {
  const tools = buildTools();
  const requests = opts.prompts.map((p) => buildRequest(p, opts.model, tools));
  if (opts.dryRun === true) return { requests, results: [] };
  if (opts.apiKey === undefined || opts.apiKey === "") throw new Error("ANTHROPIC_API_KEY is not set in the environment");

  const send_ = {
    apiKey: opts.apiKey,
    fetchImpl: opts.fetchImpl ?? fetch,
    sleep: opts.sleep ?? defaultSleep,
    maxRetries: opts.maxRetries ?? 5,
    url: opts.url ?? API_URL,
  };
  const results: EvalResult[] = new Array<EvalResult>(opts.prompts.length);
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  let next = 0;
  let done = 0;
  let fatal: FatalApiError | undefined;

  const worker = async (): Promise<void> => {
    while (fatal === undefined) {
      const i = next++;
      const prompt = opts.prompts[i];
      const req = requests[i];
      if (prompt === undefined || req === undefined) return;
      try {
        const { called, calls } = await send(req, send_);
        results[i] = { id: prompt.id, called, calls };
      } catch (err) {
        if (err instanceof FatalApiError) {
          fatal = err;
          return;
        }
        results[i] = { id: prompt.id, error: err instanceof Error ? err.message : "unknown error" };
      }
      done += 1;
      opts.onProgress?.(done, opts.prompts.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, opts.prompts.length) }, worker));
  if (fatal !== undefined) throw new Error(`stopped: ${fatal.message}`);
  return { requests, results };
}

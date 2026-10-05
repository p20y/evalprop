/**
 * Structured logging for the worker. Cloud Logging reads one JSON object per line from stdout/stderr and uses
 * `severity`. Callers pass the report id and short machine-readable fields only: never report contents, share
 * tokens, or raw error text from user data.
 */
export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const line = (severity: string, message: string, fields: Record<string, unknown> = {}) => JSON.stringify({ severity, message, ...fields });

export const consoleLogger: Logger = {
  info: (m, f) => console.log(line("INFO", m, f)),
  warn: (m, f) => console.warn(line("WARNING", m, f)),
  error: (m, f) => console.error(line("ERROR", m, f)),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** What is safe to log about an error: its class and a short message from our own code or the browser, capped. */
export function describeError(err: unknown): { errorName: string; errorMessage: string } {
  if (err instanceof Error) return { errorName: err.name, errorMessage: err.message.slice(0, 300) };
  return { errorName: "unknown", errorMessage: "" };
}

import { Hono } from "hono";
import { ENGINE_VERSION } from "@evalprop/engine";
import type { AnalysisReader, ReportStore } from "./reports/types.ts";
import { reportRoutes } from "./routes/report.ts";

/** Everything the app can be given. All optional: the app starts with none (only `/health`). */
export interface AppDeps {
  /** With `analyses`, mounts `GET /r/:token`. */
  reports?: ReportStore;
  analyses?: AnalysisReader;
  now?: () => Date;
}

export function createApp(deps: AppDeps = {}): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, engineVersion: ENGINE_VERSION }));
  if (deps.reports && deps.analyses) {
    app.route("/", reportRoutes({ reports: deps.reports, analyses: deps.analyses, ...(deps.now ? { now: deps.now } : {}) }));
  }
  return app;
}

import { Hono } from "hono";
import { ENGINE_VERSION } from "@evalprop/engine";
import { buildMcpHandler, type McpHandlerDeps } from "./mcp/index.ts";
import type { SignedUrlProvider } from "./reports/signed-url.ts";
import type { AnalysisReader, ReportStore } from "./reports/types.ts";
import { reportRoutes } from "./routes/report.ts";

/** Everything the app can be given. All optional: the app starts with none (only `/health`). */
export interface AppDeps {
  /** With `analyses`, mounts `GET /r/:token`. */
  reports?: ReportStore;
  analyses?: AnalysisReader;
  /** Signs links to stored PDFs for `GET /r/:token/pdf`. */
  signedUrls?: SignedUrlProvider;
  now?: () => Date;
  /** When given, mounts `POST /mcp` and `GET /.well-known/oauth-protected-resource`. Injected so tests and `index.ts` choose the auth, providers and repos. */
  mcp?: McpHandlerDeps;
}

export function createApp(deps: AppDeps = {}): Hono {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, engineVersion: ENGINE_VERSION }));
  if (deps.reports && deps.analyses) {
    app.route(
      "/",
      reportRoutes({
        reports: deps.reports,
        analyses: deps.analyses,
        ...(deps.signedUrls ? { signedUrls: deps.signedUrls } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      }),
    );
  }
  if (deps.mcp !== undefined) buildMcpHandler(deps.mcp).mount(app);
  return app;
}

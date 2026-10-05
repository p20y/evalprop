import { renderReport, REPORT_CONTENT_SECURITY_POLICY, REPORT_RENDERER_VERSION } from "@evalprop/report";
import type { ReportModel } from "@evalprop/shared";
import { Hono, type Context } from "hono";
import { hashToken, isWellFormedToken } from "../reports/token.ts";
import { DEFAULT_PDF_URL_TTL_SECONDS, type SignedUrlProvider } from "../reports/signed-url.ts";
import type { AnalysisReader, ReportRecord, ReportStore } from "../reports/types.ts";

export interface ReportRouteDeps {
  reports: ReportStore;
  analyses: AnalysisReader;
  /** The clock, injectable so tests can check expiry without waiting. */
  now?: () => Date;
  /** Replaceable renderer, mainly for tests. */
  render?: (model: ReportModel) => string;
  /** Signs links to stored PDFs for `GET /r/:token/pdf`. Without it the PDF route answers 404. */
  signedUrls?: SignedUrlProvider;
  /** Lifetime of a signed PDF link. Default 600 s. */
  pdfUrlTtlSeconds?: number;
}

/** How long a "PDF is being prepared" page asks the browser to wait before trying again. */
export const PDF_RETRY_AFTER_SECONDS = 15;

/**
 * How long a browser or proxy may reuse a report page without asking again. Short on purpose: a revoked or
 * expired link must stop working quickly. `private` keeps shared caches from storing a page that lives behind
 * a secret URL.
 */
export const REPORT_CACHE_CONTROL = "private, max-age=60";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": REPORT_CONTENT_SECURITY_POLICY,
  "Cross-Origin-Opener-Policy": "same-origin",
};

const errorPage = (title: string, message: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><title>${title}</title><style>body{margin:0;background:#f9f9f7;color:#0b0b0b;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}main{max-width:480px;margin:18vh auto;padding:0 16px;text-align:center}h1{font-size:22px}p{color:#52514e}</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

/** The etag changes whenever the stored report version or the renderer's markup version changes. */
const etagFor = (r: ReportRecord) => `"${r.id}.v${r.version}.r${REPORT_RENDERER_VERSION}"`;

/**
 * `GET /r/:token`: the hosted report (ARCHITECTURE section 5.7).
 *
 * - The token is hashed and looked up; the token itself is never stored or logged.
 * - 404 for a malformed token, an unknown token, or a report whose analysis is gone. The three look identical.
 * - 410 Gone for a revoked or expired link, so a recipient learns the link used to work. Only someone holding
 *   the unguessable token can see this, so it leaks nothing about other reports.
 * - Every response is `noindex` (meta tag, `X-Robots-Tag`) with a CSP that allows no external loads.
 * - 200 pages are `private, max-age=60` with an ETag so a revalidation costs a store read but no render.
 */
export function reportRoutes(deps: ReportRouteDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());
  const render = deps.render ?? renderReport;

  const fail = (c: Context, status: 404 | 410 | 500, title: string, message: string) => {
    c.header("Cache-Control", "no-store");
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
    return c.html(errorPage(title, message), status);
  };
  const notFound = (c: Context) => fail(c, 404, "Report not found", "This link is not valid. Ask the sender for a new one.");

  /**
   * The token checks shared by the page and its PDF: a record, or the 404/410 response to send instead.
   * Same hashing, same status codes, so the two routes can never disagree about whether a link works.
   */
  const liveRecord = async (c: Context): Promise<ReportRecord | Response> => {
    const token = c.req.param("token") ?? "";
    if (!isWellFormedToken(token)) return notFound(c);
    const record = await deps.reports.getByTokenHash(hashToken(token));
    if (!record) return notFound(c);
    if (record.revokedAt !== undefined) return fail(c, 410, "This report is no longer shared", "The sender has turned off this link.");
    if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= now().getTime()) {
      return fail(c, 410, "This link has expired", "Ask the sender for a new link.");
    }
    return record;
  };

  app.get("/r/:token", async (c) => {
    try {
      const record = await liveRecord(c);
      if (record instanceof Response) return record;

      const etag = etagFor(record);
      const headers = { ...SECURITY_HEADERS, "Cache-Control": REPORT_CACHE_CONTROL, ETag: etag };
      if (c.req.header("If-None-Match") === etag) return new Response(null, { status: 304, headers });

      // The report belongs to the same owner as the analysis it snapshots (checked when it was created).
      const analysis = await deps.analyses.get(record.analysisId, record.ownerUid);
      if (!analysis) return notFound(c);

      const html = render({ analysis, options: record.options, generatedAt: record.createdAt, version: record.version });
      return new Response(html, { status: 200, headers: { ...headers, "Content-Type": "text/html; charset=UTF-8" } });
    } catch {
      // Never include the token or the error text in the response or a log line.
      return fail(c, 500, "Something went wrong", "Please try again in a moment.");
    }
  });

  /**
   * `GET /r/:token/pdf` (ARCHITECTURE section 6.1). Checks the token exactly like the page, then:
   * - the PDF is stored: 302 to a signed URL that works for a few minutes. The bucket path never appears in a
   *   response body or log line.
   * - not rendered yet (or the worker failed and Cloud Tasks is retrying): 202 with a small "preparing" page.
   *   The web report is unaffected either way.
   */
  app.get("/r/:token/pdf", async (c) => {
    try {
      const record = await liveRecord(c);
      if (record instanceof Response) return record;
      if (!deps.signedUrls) return fail(c, 404, "PDF not available", "A PDF is not available for this report.");

      if (record.pdfPath === undefined) {
        const headers = { ...SECURITY_HEADERS, "Cache-Control": "no-store", "Retry-After": String(PDF_RETRY_AFTER_SECONDS), "Content-Type": "text/html; charset=UTF-8" };
        return new Response(preparingPage(), { status: 202, headers });
      }

      const url = await deps.signedUrls.sign(record.pdfPath, { expiresInSeconds: deps.pdfUrlTtlSeconds ?? DEFAULT_PDF_URL_TTL_SECONDS });
      return new Response(null, { status: 302, headers: { ...SECURITY_HEADERS, "Cache-Control": "no-store", Location: url } });
    } catch {
      return fail(c, 500, "Something went wrong", "Please try again in a moment.");
    }
  });

  return app;
}

const preparingPage = () =>
  errorPage("Your PDF is being prepared", "Refresh in a moment. This page checks again by itself.").replace(
    '<meta name="robots"',
    `<meta http-equiv="refresh" content="${PDF_RETRY_AFTER_SECONDS}"><meta name="robots"`,
  );

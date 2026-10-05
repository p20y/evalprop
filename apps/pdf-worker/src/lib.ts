/** Public surface of the PDF worker package (importing this starts nothing; `index.ts` is the service entry). */
export { createWorkerApp } from "./app.ts";
export type { WorkerAppDeps } from "./app.ts";
export { GoogleOidcVerifier, SharedSecretVerifier, verifierFromEnv } from "./auth.ts";
export type { InternalAuthVerifier } from "./auth.ts";
export { ChromiumPdfRenderer, COMMON_CHROME_PATHS, DEFAULT_RENDER_TIMEOUT_MS, FOOTER_TEMPLATE, findChrome, PdfRenderTimeoutError } from "./chromium.ts";
export { consoleLogger, silentLogger } from "./logger.ts";
export type { Logger } from "./logger.ts";
export { renderReportPdf, storeReportSource } from "./render-job.ts";
export type { PdfRenderer, RenderJobDeps, RenderOutcome, ReportSource, SkipReason } from "./render-job.ts";
export { FilePdfStorage, GcsPdfStorage, InMemoryPdfStorage, pdfPathFor } from "./storage.ts";
export type { PdfStorage } from "./storage.ts";

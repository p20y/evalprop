import { serve } from "@hono/node-server";
import { FirestoreAnalysisRepo } from "@evalprop/server/repos";
import { FirestoreReportStore } from "@evalprop/server/reports";
import { Storage } from "@google-cloud/storage";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createWorkerApp } from "./app.ts";
import { verifierFromEnv } from "./auth.ts";
import { ChromiumPdfRenderer, DEFAULT_RENDER_TIMEOUT_MS } from "./chromium.ts";
import { consoleLogger } from "./logger.ts";
import { renderReportPdf, storeReportSource } from "./render-job.ts";
import { GcsPdfStorage } from "./storage.ts";

/**
 * Service entry (Cloud Run). Configuration, all from the environment:
 *
 * - `PORT` (default 8080)
 * - `PDF_BUCKET`: the private Cloud Storage bucket for PDFs (required)
 * - `CHROME_PATH`: Chromium binary (auto-detected when unset); `CHROMIUM_NO_SANDBOX=1` only inside the container
 * - `RENDER_TIMEOUT_MS` (default 30000)
 * - authentication: `OIDC_AUDIENCE` + `OIDC_INVOKER_EMAILS` (cloud) or `INTERNAL_AUTH_TOKEN` (local); refuses to
 *   start with neither
 * - Firestore and Storage use Application Default Credentials; `FIRESTORE_EMULATOR_HOST` /
 *   `STORAGE_EMULATOR_HOST` point them at the emulators locally
 */
const bucketName = process.env.PDF_BUCKET;
if (!bucketName) throw new Error("PDF_BUCKET is not set");

const db = getFirestore(initializeApp());
const renderer = new ChromiumPdfRenderer({
  noSandbox: process.env.CHROMIUM_NO_SANDBOX === "1",
  timeoutMs: Number(process.env.RENDER_TIMEOUT_MS ?? DEFAULT_RENDER_TIMEOUT_MS),
});
const jobDeps = {
  source: storeReportSource(new FirestoreReportStore(db), new FirestoreAnalysisRepo(db)),
  renderer,
  storage: new GcsPdfStorage(new Storage().bucket(bucketName)),
  logger: consoleLogger,
};

const app = createWorkerApp({ verifier: verifierFromEnv(), render: (reportId) => renderReportPdf(jobDeps, reportId), logger: consoleLogger });
const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, (info) => {
  consoleLogger.info("evalprop pdf-worker listening", { port: info.port });
});

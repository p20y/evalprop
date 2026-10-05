import { renderReport } from "@evalprop/report";
import type { Analysis } from "@evalprop/shared";
import type { AnalysisReader, ReportRecord, ReportStore } from "@evalprop/server/reports";
import { silentLogger, type Logger } from "./logger.ts";
import { pdfPathFor, type PdfStorage } from "./storage.ts";

/** Turns report HTML into PDF bytes. The real one drives headless Chromium (`chromium.ts`); tests stub it. */
export interface PdfRenderer {
  render(html: string): Promise<Uint8Array>;
}

/** What the worker needs from the database, in two calls. */
export interface ReportSource {
  /** The report and the analysis it snapshots, or null when the report does not exist. `analysis` is null when it is gone. */
  load(reportId: string): Promise<{ record: ReportRecord; analysis: Analysis | null } | null>;
  /** Records where the PDF is stored. False when the report no longer exists. */
  markPdfReady(reportId: string, pdfPath: string): Promise<boolean>;
}

/**
 * The real source: the same `ReportStore` the server uses plus an analysis reader. Reports and analyses are
 * read and written by the code in `apps/server`, so the Firestore layout and its validation live in one place.
 */
export function storeReportSource(store: ReportStore, analyses: AnalysisReader): ReportSource {
  return {
    async load(reportId) {
      const record = await store.getById(reportId);
      if (!record) return null;
      // The worker is a trusted internal job, but it still reads the analysis through the owner check.
      return { record, analysis: await analyses.get(record.analysisId, record.ownerUid) };
    },
    markPdfReady: (reportId, pdfPath) => store.setPdfPath(reportId, pdfPath),
  };
}

/** Permanent reasons for doing nothing. The task is finished (2xx), so Cloud Tasks does not retry. */
export type SkipReason = "not_found" | "revoked" | "expired" | "analysis_missing" | "already_rendered";

export type RenderOutcome = { status: "rendered"; pdfPath: string; bytes: number } | { status: "skipped"; reason: SkipReason };

export interface RenderJobDeps {
  source: ReportSource;
  renderer: PdfRenderer;
  storage: PdfStorage;
  logger?: Logger;
  now?: () => Date;
}

/**
 * Renders one report's PDF: load, render the same HTML the web page serves, convert, store, record the path.
 *
 * Returns an outcome for everything that will never succeed however often it is retried (the report is gone,
 * revoked, expired, its analysis is gone, or it already has a PDF). It THROWS for everything that might work
 * next time (Chromium crashed or timed out, the bucket or database was unavailable); the HTTP layer turns a
 * throw into a 5xx so Cloud Tasks retries with backoff.
 *
 * The job is idempotent: a retry after a crash between "stored" and "recorded" simply renders again and
 * overwrites the same object.
 */
export async function renderReportPdf(deps: RenderJobDeps, reportId: string): Promise<RenderOutcome> {
  const log = deps.logger ?? silentLogger;
  const now = (deps.now ?? (() => new Date()))();
  const skip = (reason: SkipReason): RenderOutcome => {
    log.info("pdf render skipped", { reportId, reason });
    return { status: "skipped", reason };
  };

  const loaded = await deps.source.load(reportId);
  if (!loaded) return skip("not_found");
  const { record, analysis } = loaded;
  if (record.revokedAt !== undefined) return skip("revoked");
  if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= now.getTime()) return skip("expired");
  if (record.pdfPath !== undefined) return skip("already_rendered");
  if (!analysis) return skip("analysis_missing");

  const started = Date.now();
  // The model is built exactly as the web route builds it, so the PDF is the page.
  const html = renderReport({ analysis, options: record.options, generatedAt: record.createdAt, version: record.version });
  const bytes = await deps.renderer.render(html);
  const pdfPath = pdfPathFor(reportId);
  await deps.storage.put(pdfPath, bytes);
  if (!(await deps.source.markPdfReady(reportId, pdfPath))) {
    // Deleted while we were rendering. The orphan object is harmless (private bucket, unreachable); report it.
    log.warn("report disappeared before the pdf path could be recorded", { reportId });
    return { status: "skipped", reason: "not_found" };
  }
  log.info("pdf rendered", { reportId, bytes: bytes.byteLength, ms: Date.now() - started });
  return { status: "rendered", pdfPath, bytes: bytes.byteLength };
}

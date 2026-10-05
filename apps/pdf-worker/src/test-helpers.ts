import { InMemoryAnalysisReader, InMemoryReportStore } from "@evalprop/server/reports";
import { sampleAnalysis } from "@evalprop/shared";
import type { Logger } from "./logger.ts";
import { storeReportSource, type PdfRenderer, type RenderJobDeps } from "./render-job.ts";
import { InMemoryPdfStorage } from "./storage.ts";

export const NOW = new Date("2026-10-04T12:00:00.000Z");
export const PDF_BYTES = new TextEncoder().encode("%PDF-1.7 stub");

/** A renderer that records the HTML it was given and returns fixed bytes (or throws). */
export class StubRenderer implements PdfRenderer {
  readonly inputs: string[] = [];
  error: Error | null = null;

  async render(html: string): Promise<Uint8Array> {
    this.inputs.push(html);
    if (this.error) throw this.error;
    return PDF_BYTES;
  }
}

export interface LogLine {
  level: "info" | "warn" | "error";
  message: string;
  fields: Record<string, unknown> | undefined;
}

export function capturingLogger(): Logger & { lines: LogLine[] } {
  const lines: LogLine[] = [];
  const at = (level: LogLine["level"]) => (message: string, fields?: Record<string, unknown>) => void lines.push({ level, message, fields });
  return { lines, info: at("info"), warn: at("warn"), error: at("error") };
}

export async function setup(over: { options?: Partial<Parameters<InMemoryReportStore["create"]>[0]> } = {}) {
  const reports = new InMemoryReportStore();
  const analyses = new InMemoryAnalysisReader([sampleAnalysis]);
  const storage = new InMemoryPdfStorage();
  const renderer = new StubRenderer();
  const logger = capturingLogger();
  const record = await reports.create({
    analysisId: sampleAnalysis.id,
    ownerUid: sampleAnalysis.ownerUid,
    tokenHash: "a".repeat(64),
    options: { watermark: false },
    version: 1,
    createdAt: NOW.toISOString(),
    ...over.options,
  });
  const deps: RenderJobDeps = { source: storeReportSource(reports, analyses), renderer, storage, logger, now: () => NOW };
  return { reports, analyses, storage, renderer, logger, record, deps };
}

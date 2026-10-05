import { ReportOptionsSchema, type CreateReportInput, type CreateReportOutput, type ToolError, type ToolErrorCode } from "@evalprop/shared";
import type { PdfJobQueue } from "../jobs/pdf.ts";
import type { AnalysisReader, ReportStore } from "../reports/types.ts";
import { hashToken, newToken } from "../reports/token.ts";

/** An error with a stable `code` from the shared tool error codes; S07's MCP layer maps it to a tool error. */
export class ReportToolError extends Error {
  readonly code: ToolErrorCode;
  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ReportToolError";
    this.code = code;
  }
  toToolError(): ToolError {
    return { code: this.code, message: this.message };
  }
}

export interface CreateReportDeps {
  analyses: AnalysisReader;
  reports: ReportStore;
  /** Public origin of the server, e.g. "https://evalprop.example". Links are `${baseUrl}/r/${token}`. */
  baseUrl: string;
  /** Free-tier watermark. The plan decides this (S12); it is not a tool input. Default false. */
  watermark?: boolean;
  /** Days until the link expires. Default: never. */
  expiresInDays?: number | null;
  /**
   * Renders the report's PDF in the background (S10). Optional: without it, or when enqueueing fails, the report
   * is created anyway and `pdfUrl` is null.
   */
  pdfQueue?: PdfJobQueue;
  /** Where enqueue failures are reported. Default: a JSON line on stderr. Never gets a token or report content. */
  logWarning?: (message: string, fields: { reportId: string; error: string }) => void;
  /** Injectable for tests. */
  now?: () => Date;
  newToken?: () => string;
}

/** Same message whether the analysis does not exist or belongs to someone else, so existence never leaks. */
const NOT_FOUND = "No analysis with that id was found.";

/**
 * Core of the `create_report` tool (the MCP transport that calls it is S07's). Checks the analysis belongs to
 * `uid`, stores a report whose share token is 128 random bits (only the SHA-256 hash is saved), and returns the
 * `/r/:token` URL. The PDF is rendered in the background (S10): once the job is queued, `pdfUrl` is
 * `/r/:token/pdf`, which shows "preparing" until the file exists. If the job cannot be queued, the report is
 * still created and `pdfUrl` is null.
 */
export async function createReport(input: CreateReportInput, uid: string, deps: CreateReportDeps): Promise<CreateReportOutput> {
  const analysis = await deps.analyses.get(input.analysisId, uid);
  if (!analysis || analysis.ownerUid !== uid) throw new ReportToolError("NOT_FOUND", NOT_FOUND);

  const now = (deps.now ?? (() => new Date()))();
  const options = ReportOptionsSchema.parse({ ...input.options, watermark: deps.watermark ?? false });
  const expiresAt = deps.expiresInDays != null ? new Date(now.getTime() + deps.expiresInDays * 86_400_000).toISOString() : undefined;

  // Each new report of the same analysis is the next version.
  const existing = await deps.reports.list(uid, { analysisId: analysis.id });
  const version = existing.reduce((max, r) => Math.max(max, r.version), 0) + 1;

  const token = (deps.newToken ?? newToken)();
  const record = await deps.reports.create({
    analysisId: analysis.id,
    ownerUid: uid,
    tokenHash: hashToken(token),
    options,
    version,
    createdAt: now.toISOString(),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  });

  const reportUrl = `${deps.baseUrl.replace(/\/+$/, "")}/r/${token}`;
  let pdfUrl: string | null = null;
  if (deps.pdfQueue) {
    try {
      await deps.pdfQueue.enqueue(record.id);
      pdfUrl = `${reportUrl}/pdf`;
    } catch (err) {
      // The web report does not depend on the PDF. Log the report id and the error class, nothing else.
      const fields = { reportId: record.id, error: err instanceof Error ? err.name : "unknown" };
      (deps.logWarning ?? defaultLogWarning)("could not enqueue the PDF render", fields);
    }
  }

  return {
    reportId: record.id,
    reportUrl,
    pdfUrl,
    expiresAt: record.expiresAt ?? null,
  };
}

const defaultLogWarning = (message: string, fields: { reportId: string; error: string }) =>
  console.warn(JSON.stringify({ severity: "WARNING", message, ...fields }));

/** Turns a share link off. NOT_FOUND for an unknown report or one that is not the caller's. */
export async function revokeReport(reportId: string, uid: string, deps: Pick<CreateReportDeps, "reports" | "now">): Promise<void> {
  const at = (deps.now ?? (() => new Date()))().toISOString();
  if (!(await deps.reports.revoke(reportId, uid, at))) throw new ReportToolError("NOT_FOUND", "No report with that id was found.");
}

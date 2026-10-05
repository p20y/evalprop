import { ReportOptionsSchema, type CreateReportInput, type CreateReportOutput, type ToolError, type ToolErrorCode } from "@evalprop/shared";
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
  /** Injectable for tests. */
  now?: () => Date;
  newToken?: () => string;
}

/** Same message whether the analysis does not exist or belongs to someone else, so existence never leaks. */
const NOT_FOUND = "No analysis with that id was found.";

/**
 * Core of the `create_report` tool (the MCP transport that calls it is S07's). Checks the analysis belongs to
 * `uid`, stores a report whose share token is 128 random bits (only the SHA-256 hash is saved), and returns the
 * `/r/:token` URL. The PDF is S10's, so `pdfUrl` is null for now.
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

  return {
    reportId: record.id,
    reportUrl: `${deps.baseUrl.replace(/\/+$/, "")}/r/${token}`,
    pdfUrl: null,
    expiresAt: record.expiresAt ?? null,
  };
}

/** Turns a share link off. NOT_FOUND for an unknown report or one that is not the caller's. */
export async function revokeReport(reportId: string, uid: string, deps: Pick<CreateReportDeps, "reports" | "now">): Promise<void> {
  const at = (deps.now ?? (() => new Date()))().toISOString();
  if (!(await deps.reports.revoke(reportId, uid, at))) throw new ReportToolError("NOT_FOUND", "No report with that id was found.");
}

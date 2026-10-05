import { ReportOptionsSchema, type Analysis } from "@evalprop/shared";
import { z } from "zod";

/**
 * A hosted report (Firestore `reports/{reportId}`, ARCHITECTURE section 6.2). The share token itself is never
 * stored: only its SHA-256 hash, so a leaked database cannot be turned into working links.
 */
export const ReportRecordSchema = z.object({
  id: z.string().min(1),
  analysisId: z.string().min(1),
  ownerUid: z.string().min(1),
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  options: ReportOptionsSchema,
  /** A report is a snapshot of an analysis plus options; refreshing creates a new version. */
  version: z.number().int().positive(),
  pdfPath: z.string().optional(),
  /** ISO timestamps. */
  createdAt: z.string(),
  revokedAt: z.string().optional(),
  expiresAt: z.string().optional(),
});
export type ReportRecord = z.infer<typeof ReportRecordSchema>;

/** What the caller supplies; the store assigns `id` when it is omitted. */
export type NewReport = Omit<ReportRecord, "id"> & { id?: string };

/**
 * Persistence for hosted reports. Two implementations ship here: in-memory (tests, local) and Firestore.
 * Every method that takes an `ownerUid` enforces ownership; `getByTokenHash` does not, because the token
 * itself is the credential for a public share link.
 */
export interface ReportStore {
  /** Stores a new report and returns it with its id. Never overwrites an existing report. */
  create(report: NewReport): Promise<ReportRecord>;
  /** Looks a report up by the SHA-256 hash of its share token (revoked and expired ones included). */
  getByTokenHash(tokenHash: string): Promise<ReportRecord | null>;
  /**
   * Marks the report revoked (idempotent: the first revocation time is kept). Returns false when the report
   * does not exist or belongs to someone else, without saying which.
   */
  revoke(reportId: string, ownerUid: string, at: string): Promise<boolean>;
  /** The owner's reports, newest first, optionally only those for one analysis. */
  list(ownerUid: string, filter?: { analysisId?: string }): Promise<ReportRecord[]>;
}

/**
 * Read access to saved analyses. S06 owns the real repository; this is the slice the report needs.
 * Returns null when the analysis does not exist or is not owned by `ownerUid`, so callers cannot learn
 * whether someone else's analysis exists.
 */
export interface AnalysisReader {
  get(analysisId: string, ownerUid: string): Promise<Analysis | null>;
}

import type { Analysis } from "@evalprop/shared";
import type { UsageRecord } from "@evalprop/data";

/**
 * The ledger entry written in the same transaction as the analysis (`users/{uid}/usage/{eventId}`,
 * ARCHITECTURE §6.2). It makes the data cost of every report visible.
 */
export interface UsageEvent {
  id: string;
  /** Billable action: a fresh analysis or a what-if. */
  type: "analysis" | "what_if";
  analysisId: string;
  /** Exactly the provider calls this run made (cache hits included, with `cached: true` and 0 cost). Empty for a what-if. */
  providerCalls: UsageRecord[];
  /** Wall-clock milliseconds per pipeline stage (the persist stage itself is not included). */
  stageTimingsMs: Record<string, number>;
  /** Sum of `providerCalls[].costCents`. */
  costCents: number;
  engineVersion: string;
  pipelineVersion: string;
  /** ISO timestamp. */
  createdAt: string;
}

export type CreateResult =
  | { created: true; analysis: Analysis }
  /** A recent analysis with the same `(ownerUid, inputHash)` already existed: nothing was written. */
  | { created: false; analysis: Analysis };

/**
 * Persistence for analyses. Implemented in memory (unit tests) and on Firestore (Admin SDK).
 *
 * Every read takes the owner's uid and returns `null` for someone else's analysis, so a caller can
 * never tell "not yours" from "does not exist" (ARCHITECTURE §6.3). `get(id, ownerUid)` is shaped to
 * satisfy S08's `AnalysisReader` as well.
 */
export interface AnalysisRepo {
  /**
   * Atomically writes the analysis and its usage event, unless the owner already has an analysis with
   * the same `inputHash` created at or after `reuseSince` (an ISO timestamp), in which case it writes
   * nothing and returns that one. This is the idempotency rule of ARCHITECTURE §5.1 rule 2, and doing it
   * inside the transaction means two concurrent identical requests cannot both bill.
   */
  createIfNew(analysis: Analysis, usage: UsageEvent, options: { reuseSince: string }): Promise<CreateResult>;
  /** The owner's analysis, or `null` if it does not exist or belongs to someone else. */
  get(id: string, ownerUid: string): Promise<Analysis | null>;
  /** The owner's analysis with this `inputHash` created at or after `since`, if any (read-only check before quota is reserved). */
  findRecent(ownerUid: string, inputHash: string, since: string): Promise<Analysis | null>;
}

export interface UsageRepo {
  /** The owner's usage events, newest first. */
  listUsage(ownerUid: string, limit?: number): Promise<UsageEvent[]>;
}

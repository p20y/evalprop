/**
 * Quota hook (ARCHITECTURE §5.6, §7.3). The pipeline asks the gate BEFORE any provider call and gives
 * the reservation back if the run does not produce a saved analysis (a failure, an ambiguous address,
 * `NEEDS_RENT`, or an idempotent hit that made the reservation unnecessary).
 *
 * This story ships only the interface and a no-op default. S12 implements the real gate (plans, the
 * per-month counter on `users/{uid}`, incremented in a Firestore transaction) behind the same interface.
 */
export type QuotaKind = "analysis" | "what_if";

export type QuotaReservation =
  | { ok: true; /** Opaque; handed back to `release`. */ reservationId: string }
  | { ok: false; code: "QUOTA_EXCEEDED"; message?: string; used?: number; limit?: number; upgradeUrl?: string };

export interface QuotaGate {
  /** Reserves one unit of `kind` for `uid`, or reports that the allowance is used up. Must not call providers. */
  reserve(uid: string, kind: QuotaKind): Promise<QuotaReservation>;
  /** Gives a reservation back. Called at most once per successful `reserve`; must tolerate being called late. */
  release(uid: string, kind: QuotaKind, reservationId: string): Promise<void>;
}

/** Default gate: everything is allowed and nothing is counted. */
export const noopQuota: QuotaGate = {
  reserve: async () => ({ ok: true, reservationId: "noop" }),
  release: async () => {},
};

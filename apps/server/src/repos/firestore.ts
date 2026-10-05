import { AnalysisSchema, type Analysis } from "@evalprop/shared";
import type { Firestore } from "firebase-admin/firestore";
import type { AnalysisRepo, CreateResult, UsageEvent, UsageRepo } from "./types.ts";

/**
 * Firestore (Admin SDK) repo. Layout (ARCHITECTURE §6.2):
 * - `analyses/{analysisId}`: the immutable `Analysis`.
 * - `users/{uid}/usage/{eventId}`: the `UsageEvent`.
 * - `users/{uid}/idempotency/{inputHash}`: `{ analysisId, createdAt }`, the latest analysis for that
 *   input. Not in the §6.2 table: it makes the "same input within 10 minutes" check a single
 *   document read inside the transaction (race-safe, no composite index).
 *
 * The three writes of `createIfNew` commit in one transaction. Only the server touches these
 * collections; Firestore rules deny all client access.
 */
export class FirestoreAnalysisRepo implements AnalysisRepo, UsageRepo {
  private readonly db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async createIfNew(analysis: Analysis, usage: UsageEvent, options: { reuseSince: string }): Promise<CreateResult> {
    const analysisRef = this.db.collection("analyses").doc(analysis.id);
    const usageRef = this.db.collection("users").doc(analysis.ownerUid).collection("usage").doc(usage.id);
    const markerRef = this.markerRef(analysis.ownerUid, analysis.inputHash);

    return this.db.runTransaction(async (tx): Promise<CreateResult> => {
      // All reads first (Firestore requires it), then the writes.
      const marker = await tx.get(markerRef);
      if (marker.exists) {
        const m = marker.data() as { analysisId?: string; createdAt?: string };
        if (typeof m.analysisId === "string" && typeof m.createdAt === "string" && m.createdAt >= options.reuseSince) {
          const existing = await tx.get(this.db.collection("analyses").doc(m.analysisId));
          if (existing.exists) {
            const parsed = this.parse(existing.data());
            if (parsed.ownerUid === analysis.ownerUid) return { created: false, analysis: parsed };
          }
        }
      }
      tx.create(analysisRef, withoutUndefined(analysis));
      tx.create(usageRef, withoutUndefined(usage));
      tx.set(markerRef, { analysisId: analysis.id, createdAt: analysis.createdAt });
      return { created: true, analysis };
    });
  }

  async get(id: string, ownerUid: string): Promise<Analysis | null> {
    if (!isDocId(id)) return null;
    const snap = await this.db.collection("analyses").doc(id).get();
    if (!snap.exists) return null;
    const analysis = this.parse(snap.data());
    return analysis.ownerUid === ownerUid ? analysis : null;
  }

  async findRecent(ownerUid: string, inputHash: string, since: string): Promise<Analysis | null> {
    if (!isDocId(ownerUid) || !isDocId(inputHash)) return null;
    const marker = await this.markerRef(ownerUid, inputHash).get();
    if (!marker.exists) return null;
    const m = marker.data() as { analysisId?: string; createdAt?: string };
    if (typeof m.analysisId !== "string" || typeof m.createdAt !== "string" || m.createdAt < since) return null;
    return this.get(m.analysisId, ownerUid);
  }

  async listUsage(ownerUid: string, limit = 50): Promise<UsageEvent[]> {
    if (!isDocId(ownerUid)) return [];
    const snap = await this.db
      .collection("users")
      .doc(ownerUid)
      .collection("usage")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as UsageEvent);
  }

  private markerRef(ownerUid: string, inputHash: string) {
    return this.db.collection("users").doc(ownerUid).collection("idempotency").doc(inputHash);
  }

  /**
   * Data crossing the Firestore boundary is validated with the shared schema (AGENTS.md). The raw document
   * is returned, not the parsed copy: the schema would strip the extra sale-comp fields `packages/comps`
   * produces (`listPriceCheck`, `pricePerSqft`; follow-up F8), and a stored analysis must read back exactly
   * as it was saved, the same as the in-memory repo returns it.
   */
  private parse(data: unknown): Analysis {
    if (!AnalysisSchema.safeParse(data).success) throw new Error("stored analysis failed schema validation");
    return data as Analysis;
  }
}

/** Firestore document IDs cannot be empty or contain "/", and "." / ".." are reserved. Ids come from tool input, so check first. */
function isDocId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= 1500 && !id.includes("/") && id !== "." && id !== "..";
}

/** Firestore rejects `undefined` field values; drop them (JSON semantics) so optional fields can simply be absent. */
function withoutUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

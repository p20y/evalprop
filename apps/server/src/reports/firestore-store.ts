import type { Firestore } from "firebase-admin/firestore";
import { newId } from "./token.ts";
import { ReportRecordSchema, type NewReport, type ReportRecord, type ReportStore } from "./types.ts";

export const REPORTS_COLLECTION = "reports";

/** Firestore `reports/{reportId}` (Admin SDK only; Firestore rules deny every client). */
export class FirestoreReportStore implements ReportStore {
  readonly #db: Firestore;

  constructor(db: Firestore) {
    this.#db = db;
  }

  async create(report: NewReport): Promise<ReportRecord> {
    const id = report.id ?? newId("rpt");
    const record = ReportRecordSchema.parse({ ...report, id });
    // Firestore rejects `undefined`, and `create` refuses to overwrite an existing report.
    const { id: _id, ...data } = record;
    await this.#db.collection(REPORTS_COLLECTION).doc(id).create(stripUndefined(data));
    return record;
  }

  async getByTokenHash(tokenHash: string): Promise<ReportRecord | null> {
    const snap = await this.#db.collection(REPORTS_COLLECTION).where("tokenHash", "==", tokenHash).limit(1).get();
    const doc = snap.docs[0];
    return doc ? this.#parse(doc.id, doc.data()) : null;
  }

  async revoke(reportId: string, ownerUid: string, at: string): Promise<boolean> {
    const ref = this.#db.collection(REPORTS_COLLECTION).doc(reportId);
    return this.#db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      if (!snap.exists || !data || data.ownerUid !== ownerUid) return false;
      if (data.revokedAt === undefined) tx.update(ref, { revokedAt: at });
      return true;
    });
  }

  async list(ownerUid: string, filter?: { analysisId?: string }): Promise<ReportRecord[]> {
    let q = this.#db.collection(REPORTS_COLLECTION).where("ownerUid", "==", ownerUid);
    if (filter?.analysisId !== undefined) q = q.where("analysisId", "==", filter.analysisId);
    const snap = await q.get();
    // Sorted here, not by Firestore, so no composite index is needed.
    return snap.docs.map((d) => this.#parse(d.id, d.data())).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  #parse(id: string, data: Record<string, unknown>): ReportRecord {
    // Reads from Firestore are validated like any other boundary crossing.
    return ReportRecordSchema.parse({ ...data, id });
  }
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

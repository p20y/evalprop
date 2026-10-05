import type { Analysis } from "@evalprop/shared";
import { newId } from "./token.ts";
import type { AnalysisReader, NewReport, ReportRecord, ReportStore } from "./types.ts";

/** In-memory ReportStore for unit tests and local development. Behaves like the Firestore store. */
export class InMemoryReportStore implements ReportStore {
  readonly #byId = new Map<string, ReportRecord>();

  async create(report: NewReport): Promise<ReportRecord> {
    const id = report.id ?? newId("rpt");
    if (this.#byId.has(id)) throw new Error(`report ${id} already exists`);
    for (const r of this.#byId.values()) if (r.tokenHash === report.tokenHash) throw new Error("token hash already in use");
    const record: ReportRecord = structuredClone({ ...report, id });
    this.#byId.set(id, record);
    return structuredClone(record);
  }

  async getByTokenHash(tokenHash: string): Promise<ReportRecord | null> {
    for (const r of this.#byId.values()) if (r.tokenHash === tokenHash) return structuredClone(r);
    return null;
  }

  async revoke(reportId: string, ownerUid: string, at: string): Promise<boolean> {
    const r = this.#byId.get(reportId);
    if (!r || r.ownerUid !== ownerUid) return false;
    r.revokedAt ??= at;
    return true;
  }

  async list(ownerUid: string, filter?: { analysisId?: string }): Promise<ReportRecord[]> {
    return [...this.#byId.values()]
      .filter((r) => r.ownerUid === ownerUid && (filter?.analysisId === undefined || r.analysisId === filter.analysisId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map((r) => structuredClone(r));
  }
}

/** In-memory AnalysisReader for tests; S06's repository replaces it in the real app. */
export class InMemoryAnalysisReader implements AnalysisReader {
  readonly #byId = new Map<string, Analysis>();

  constructor(analyses: Analysis[] = []) {
    for (const a of analyses) this.add(a);
  }

  add(analysis: Analysis): void {
    this.#byId.set(analysis.id, structuredClone(analysis));
  }

  async get(analysisId: string, ownerUid: string): Promise<Analysis | null> {
    const a = this.#byId.get(analysisId);
    return a && a.ownerUid === ownerUid ? structuredClone(a) : null;
  }
}

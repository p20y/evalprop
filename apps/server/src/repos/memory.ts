import type { Analysis } from "@evalprop/shared";
import type { AnalysisRepo, CreateResult, UsageEvent, UsageRepo } from "./types.ts";

/** In-memory repo for unit tests. Same contract as the Firestore one (see `analysis-repo.contract.ts`). */
export class InMemoryAnalysisRepo implements AnalysisRepo, UsageRepo {
  private readonly analyses = new Map<string, Analysis>();
  private readonly usage = new Map<string, UsageEvent[]>();
  /** (uid, inputHash) -> analysis id and creation time: the idempotency index. */
  private readonly latestByHash = new Map<string, { analysisId: string; createdAt: string }>();

  async createIfNew(analysis: Analysis, usage: UsageEvent, options: { reuseSince: string }): Promise<CreateResult> {
    const key = `${analysis.ownerUid}\u0000${analysis.inputHash}`;
    const marker = this.latestByHash.get(key);
    if (marker !== undefined && marker.createdAt >= options.reuseSince) {
      const existing = this.analyses.get(marker.analysisId);
      if (existing !== undefined) return { created: false, analysis: structuredClone(existing) };
    }
    const events = this.usage.get(analysis.ownerUid) ?? [];
    // Check everything before writing anything: the create is all-or-nothing, like the Firestore transaction.
    if (this.analyses.has(analysis.id)) throw new Error(`analysis ${analysis.id} already exists`);
    if (events.some((e) => e.id === usage.id)) throw new Error(`usage event ${usage.id} already exists`);
    this.analyses.set(analysis.id, structuredClone(analysis));
    events.push(structuredClone(usage));
    this.usage.set(analysis.ownerUid, events);
    this.latestByHash.set(key, { analysisId: analysis.id, createdAt: analysis.createdAt });
    return { created: true, analysis: structuredClone(analysis) };
  }

  async get(id: string, ownerUid: string): Promise<Analysis | null> {
    const found = this.analyses.get(id);
    return found !== undefined && found.ownerUid === ownerUid ? structuredClone(found) : null;
  }

  async findRecent(ownerUid: string, inputHash: string, since: string): Promise<Analysis | null> {
    const marker = this.latestByHash.get(`${ownerUid}\u0000${inputHash}`);
    if (marker === undefined || marker.createdAt < since) return null;
    const found = this.analyses.get(marker.analysisId);
    return found === undefined ? null : structuredClone(found);
  }

  async listUsage(ownerUid: string, limit = 50): Promise<UsageEvent[]> {
    return structuredClone([...(this.usage.get(ownerUid) ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));
  }
}

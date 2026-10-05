import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AnalysisSchema, sampleAnalysis, type Analysis } from "@evalprop/shared";
import { newId } from "./ids.ts";
import type { AnalysisRepo, UsageEvent, UsageRepo } from "./types.ts";

/**
 * One behaviour contract, run against both repo implementations: the in-memory repo in the unit suite
 * and the Firestore repo on the emulator (`firestore.emulator.test.ts`). Each test uses fresh ids and
 * uids, so a shared emulator needs no cleanup between tests.
 */

const T0 = "2026-10-04T12:00:00.000Z";
const T1 = "2026-10-04T12:05:00.000Z";
const LONG_AGO = "2026-10-04T11:00:00.000Z";

export function makeAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  const base = structuredClone(sampleAnalysis);
  return { ...base, id: newId("an"), ownerUid: newId("u"), inputHash: newId("h"), createdAt: T0, ...overrides };
}

export function makeUsage(analysis: Analysis, overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: newId("ue"),
    type: "analysis",
    analysisId: analysis.id,
    providerCalls: [
      { provider: "fixture", endpoint: "property.resolve", ms: 12, cached: false, costCents: 2, outcome: "ok", attempts: 1, coalesced: false },
      { provider: "fixture", endpoint: "rent.candidates", ms: 0, cached: true, costCents: 0, outcome: "ok", attempts: 0, coalesced: false },
    ],
    stageTimingsMs: { normalize: 1, resolve: 12, gather: 40, engine: 3 },
    costCents: 2,
    engineVersion: analysis.engineVersion,
    pipelineVersion: analysis.pipelineVersion,
    createdAt: analysis.createdAt,
    ...overrides,
  };
}

export function defineAnalysisRepoContract(label: string, make: () => AnalysisRepo & UsageRepo): void {
  describe(`AnalysisRepo contract: ${label}`, () => {
    test("createIfNew writes the analysis and a usage event; get returns exactly what was saved", async () => {
      const repo = make();
      const a = makeAnalysis();
      const result = await repo.createIfNew(a, makeUsage(a), { reuseSince: LONG_AGO });
      assert.equal(result.created, true);
      assert.deepEqual(result.analysis, a);
      assert.deepEqual(await repo.get(a.id, a.ownerUid), a);
      const usage = await repo.listUsage(a.ownerUid);
      assert.equal(usage.length, 1);
      assert.equal(usage[0]?.analysisId, a.id);
      assert.equal(usage[0]?.providerCalls.length, 2);
      assert.equal(usage[0]?.costCents, 2);
      assert.ok(AnalysisSchema.safeParse(await repo.get(a.id, a.ownerUid)).success);
    });

    test("fields the shared schema does not know (the sale-comp extras) survive a round trip", async () => {
      const repo = make();
      const a = makeAnalysis();
      a.market.saleComps = {
        estimate: { low: 1, median: 2, high: 3 },
        comps: [],
        stepReached: "strict-1mi",
        radiusUsedMiles: 1,
        confidence: "medium",
        notes: [],
        ...({ medianPricePerSqft: 187.18, pricePerSqft: { c1: 186.2 }, listPriceCheck: { listPrice: 3, impliedValue: 2, differencePct: 50, flagged: true, direction: "above" } } as object),
      };
      await repo.createIfNew(a, makeUsage(a), { reuseSince: LONG_AGO });
      assert.deepEqual(await repo.get(a.id, a.ownerUid), a);
    });

    test("optional fields that are absent stay absent (no undefined leaks into storage)", async () => {
      const repo = make();
      const a = makeAnalysis();
      delete (a as { baseAnalysisId?: string }).baseAnalysisId;
      (a.property as { description?: string | undefined }).description = undefined;
      await repo.createIfNew(a, makeUsage(a), { reuseSince: LONG_AGO });
      const stored = await repo.get(a.id, a.ownerUid);
      assert.ok(stored);
      assert.equal("baseAnalysisId" in stored, false);
      assert.equal(stored.property.description, undefined);
    });

    test("owner isolation: get returns null for another user and for an unknown id", async () => {
      const repo = make();
      const a = makeAnalysis();
      await repo.createIfNew(a, makeUsage(a), { reuseSince: LONG_AGO });
      assert.equal(await repo.get(a.id, newId("u")), null);
      assert.equal(await repo.get(newId("an"), a.ownerUid), null);
      for (const bad of ["", "a/b", ".", "..", "../x"]) assert.equal(await repo.get(bad, a.ownerUid), null, bad);
    });

    test("findRecent: found within the window, not after it, not for another user or hash", async () => {
      const repo = make();
      const a = makeAnalysis();
      await repo.createIfNew(a, makeUsage(a), { reuseSince: LONG_AGO });
      assert.equal((await repo.findRecent(a.ownerUid, a.inputHash, LONG_AGO))?.id, a.id);
      assert.equal(await repo.findRecent(a.ownerUid, a.inputHash, T1), null, "window starts after it was created");
      assert.equal(await repo.findRecent(newId("u"), a.inputHash, LONG_AGO), null);
      assert.equal(await repo.findRecent(a.ownerUid, newId("h"), LONG_AGO), null);
    });

    test("createIfNew with the same (owner, inputHash) inside the window writes nothing and returns the original", async () => {
      const repo = make();
      const first = makeAnalysis();
      await repo.createIfNew(first, makeUsage(first), { reuseSince: LONG_AGO });
      const retry = makeAnalysis({ ownerUid: first.ownerUid, inputHash: first.inputHash, createdAt: T1 });
      const result = await repo.createIfNew(retry, makeUsage(retry), { reuseSince: LONG_AGO });
      assert.equal(result.created, false);
      assert.equal(result.analysis.id, first.id);
      assert.equal(await repo.get(retry.id, first.ownerUid), null, "the retry was not saved");
      assert.equal((await repo.listUsage(first.ownerUid)).length, 1, "and no second usage event was written");
    });

    test("outside the window the same input is saved again, with its own usage event", async () => {
      const repo = make();
      const first = makeAnalysis();
      await repo.createIfNew(first, makeUsage(first), { reuseSince: LONG_AGO });
      const later = makeAnalysis({ ownerUid: first.ownerUid, inputHash: first.inputHash, createdAt: T1 });
      const result = await repo.createIfNew(later, makeUsage(later), { reuseSince: T1 });
      assert.equal(result.created, true);
      assert.equal(result.analysis.id, later.id);
      assert.equal((await repo.listUsage(first.ownerUid)).length, 2);
      assert.equal((await repo.findRecent(first.ownerUid, first.inputHash, LONG_AGO))?.id, later.id, "the newest one is the idempotency target");
    });

    test("the same input hash from two different users is two analyses", async () => {
      const repo = make();
      const a = makeAnalysis();
      const b = makeAnalysis({ inputHash: a.inputHash });
      assert.equal((await repo.createIfNew(a, makeUsage(a), { reuseSince: LONG_AGO })).created, true);
      assert.equal((await repo.createIfNew(b, makeUsage(b), { reuseSince: LONG_AGO })).created, true);
      assert.equal((await repo.get(a.id, a.ownerUid))?.id, a.id);
      assert.equal((await repo.get(b.id, b.ownerUid))?.id, b.id);
    });

    test("concurrent identical creates: exactly one wins, one usage event", async () => {
      const repo = make();
      const owner = newId("u");
      const hash = newId("h");
      const attempts = Array.from({ length: 5 }, () => makeAnalysis({ ownerUid: owner, inputHash: hash }));
      const results = await Promise.all(attempts.map((a) => repo.createIfNew(a, makeUsage(a), { reuseSince: LONG_AGO })));
      assert.equal(results.filter((r) => r.created).length, 1);
      assert.equal(new Set(results.map((r) => r.analysis.id)).size, 1);
      assert.equal((await repo.listUsage(owner)).length, 1);
    });

    test("all or nothing: a clash on the usage event id saves no analysis", async () => {
      const repo = make();
      const first = makeAnalysis();
      const usage = makeUsage(first);
      await repo.createIfNew(first, usage, { reuseSince: LONG_AGO });
      const other = makeAnalysis({ ownerUid: first.ownerUid });
      await assert.rejects(repo.createIfNew(other, { ...usage, analysisId: other.id }, { reuseSince: LONG_AGO }));
      assert.equal(await repo.get(other.id, first.ownerUid), null);
      assert.equal((await repo.listUsage(first.ownerUid)).length, 1);
    });

    test("an analysis id can never be written twice (analyses are immutable)", async () => {
      const repo = make();
      const a = makeAnalysis();
      await repo.createIfNew(a, makeUsage(a), { reuseSince: LONG_AGO });
      const clash = makeAnalysis({ id: a.id, ownerUid: a.ownerUid, createdAt: T1 });
      await assert.rejects(repo.createIfNew(clash, makeUsage(clash), { reuseSince: LONG_AGO }));
      assert.deepEqual(await repo.get(a.id, a.ownerUid), a);
    });

    test("listUsage is newest first, per user, and honours the limit", async () => {
      const repo = make();
      const owner = newId("u");
      const times = ["2026-10-04T10:00:00.000Z", "2026-10-04T12:00:00.000Z", "2026-10-04T11:00:00.000Z"];
      for (const createdAt of times) {
        const a = makeAnalysis({ ownerUid: owner, createdAt });
        await repo.createIfNew(a, makeUsage(a, { createdAt }), { reuseSince: LONG_AGO });
      }
      const events = await repo.listUsage(owner);
      assert.deepEqual(events.map((e) => e.createdAt), [...times].sort().reverse());
      assert.equal((await repo.listUsage(owner, 2)).length, 2);
      assert.deepEqual(await repo.listUsage(newId("u")), []);
    });
  });
}

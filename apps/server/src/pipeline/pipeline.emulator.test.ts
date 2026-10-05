import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { FirestoreCacheStore } from "@evalprop/data";
import { AnalysisSchema } from "@evalprop/shared";
import { FirestoreAnalysisRepo } from "../repos/firestore.ts";
import { ADDR, assertOk, harness } from "./test-helpers.ts";

// Run via `pnpm test:emulator`: the whole pipeline with the recorded fixtures, the Firestore gateway cache
// and the Firestore repo. No network, no paid API.
let app: App;
let db: Firestore;

before(() => {
  assert.ok(process.env["FIRESTORE_EMULATOR_HOST"], "FIRESTORE_EMULATOR_HOST must point at the Firestore emulator");
  app = initializeApp({ projectId: "demo-evalprop" }, `pipeline-test-${Date.now()}`);
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const uid = () => `u_${Math.random().toString(36).slice(2)}`;
const fresh = () => {
  const repo = new FirestoreAnalysisRepo(db);
  // A fresh cache namespace per test so one test's cached provider data cannot satisfy another's.
  return harness({ repo, randomIds: true, gateway: { cache: new FirestoreCacheStore(db, { collection: `pipeline-cache-${Math.random().toString(36).slice(2)}` }) } });
};

describe("runAnalysis and runWhatIf on the Firestore emulator", () => {
  test("persists a schema-valid analysis, its usage event and the provider calls; reads it back as the owner only", async () => {
    const h = fresh();
    const owner = uid();
    const r = await h.analyze({ address: ADDR.condo }, owner);
    assertOk(r);
    const stored = await h.repo.get(r.analysis.id, owner);
    assert.ok(stored);
    assert.ok(AnalysisSchema.safeParse(stored).success);
    assert.deepEqual(stored, r.analysis);
    assert.equal(await h.repo.get(r.analysis.id, uid()), null);

    const [event] = await h.repo.listUsage(owner);
    assert.equal(event?.analysisId, r.analysis.id);
    assert.equal(event?.type, "analysis");
    assert.equal(event?.providerCalls.length, 6);
    assert.ok(event?.stageTimingsMs["gather"] !== undefined);
  });

  test("idempotent retry and what-if: one usage event per saved analysis, what-if makes no provider call", async () => {
    const h = fresh();
    const owner = uid();
    const first = await h.analyze({ address: ADDR.house, assumptions: { offerPrice: 330000 } }, owner);
    assertOk(first);
    const retry = await h.analyze({ address: ADDR.house, assumptions: { offerPrice: 330000 } }, owner);
    assertOk(retry);
    assert.equal(retry.reused, true);
    assert.equal(retry.analysis.id, first.analysis.id);

    const calls = h.provider.callCount;
    const next = await h.whatIf({ analysisId: first.analysis.id, overrides: { interestRatePct: 6.5 } }, owner);
    assertOk(next);
    assert.equal(h.provider.callCount, calls);
    assert.equal(next.analysis.baseAnalysisId, first.analysis.id);
    const events = await h.repo.listUsage(owner);
    assert.deepEqual(events.map((e) => e.type).sort(), ["analysis", "what_if"]);

    const stranger = await h.whatIf({ analysisId: first.analysis.id, overrides: { interestRatePct: 6.5 } }, uid());
    assert.ok(!stranger.ok);
    assert.equal(stranger.error.code, "NOT_FOUND");
  });

  test("two identical requests in flight at once save one analysis", async () => {
    const h = fresh();
    const owner = uid();
    const [a, b] = await Promise.all([h.analyze({ address: ADDR.house }, owner), h.analyze({ address: ADDR.house }, owner)]);
    assertOk(a);
    assertOk(b);
    assert.equal(a.analysis.id, b.analysis.id);
    assert.equal((await h.repo.listUsage(owner)).length, 1);
  });
});

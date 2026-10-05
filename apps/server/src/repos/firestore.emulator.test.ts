import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { defineAnalysisRepoContract, makeAnalysis, makeUsage } from "./analysis-repo.contract.ts";
import { FirestoreAnalysisRepo } from "./firestore.ts";

// Run via `pnpm test:emulator` (firebase emulators:exec sets FIRESTORE_EMULATOR_HOST).
let app: App;
let db: Firestore;

before(() => {
  assert.ok(process.env["FIRESTORE_EMULATOR_HOST"], "FIRESTORE_EMULATOR_HOST must point at the Firestore emulator");
  app = initializeApp({ projectId: "demo-evalprop" }, `repo-test-${Date.now()}`);
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

// The same behaviour contract as the in-memory repo, on the real Firestore transaction semantics.
defineAnalysisRepoContract("Firestore emulator", () => new FirestoreAnalysisRepo(db));

describe("Firestore layout (ARCHITECTURE §6.2)", () => {
  const since = "1970-01-01T00:00:00.000Z";

  test("analyses/{id}, users/{uid}/usage/{eventId} and the idempotency marker are written in one go", async () => {
    const repo = new FirestoreAnalysisRepo(db);
    const a = makeAnalysis();
    const usage = makeUsage(a);
    await repo.createIfNew(a, usage, { reuseSince: since });

    const analysisDoc = await db.collection("analyses").doc(a.id).get();
    assert.equal(analysisDoc.exists, true);
    assert.equal(analysisDoc.get("ownerUid"), a.ownerUid);
    assert.equal(analysisDoc.get("engineVersion"), a.engineVersion);
    assert.equal(analysisDoc.get("pipelineVersion"), a.pipelineVersion);

    const usageDoc = await db.collection("users").doc(a.ownerUid).collection("usage").doc(usage.id).get();
    assert.equal(usageDoc.exists, true);
    assert.equal(usageDoc.get("analysisId"), a.id);
    assert.equal(usageDoc.get("type"), "analysis");
    assert.equal(usageDoc.get("providerCalls").length, 2);

    const marker = await db.collection("users").doc(a.ownerUid).collection("idempotency").doc(a.inputHash).get();
    assert.equal(marker.get("analysisId"), a.id);
  });

  test("a transaction that fails midway leaves none of the three documents behind", async () => {
    const repo = new FirestoreAnalysisRepo(db);
    const first = makeAnalysis();
    const usage = makeUsage(first);
    await repo.createIfNew(first, usage, { reuseSince: since });

    const second = makeAnalysis({ ownerUid: first.ownerUid });
    await assert.rejects(repo.createIfNew(second, { ...usage, analysisId: second.id }, { reuseSince: since }));
    assert.equal((await db.collection("analyses").doc(second.id).get()).exists, false);
    assert.equal((await db.collection("users").doc(first.ownerUid).collection("idempotency").doc(second.inputHash).get()).exists, false);
  });

  test("a stored document that no longer matches the schema is an error, not silently returned", async () => {
    const repo = new FirestoreAnalysisRepo(db);
    const a = makeAnalysis();
    await db.collection("analyses").doc(a.id).set({ id: a.id, ownerUid: a.ownerUid, evaluation: "garbage" });
    await assert.rejects(repo.get(a.id, a.ownerUid), /schema validation/);
  });

  test("another user's document reads as missing even when the id is known", async () => {
    const repo = new FirestoreAnalysisRepo(db);
    const a = makeAnalysis();
    await repo.createIfNew(a, makeUsage(a), { reuseSince: since });
    assert.equal(await repo.get(a.id, "someone-else"), null);
  });
});

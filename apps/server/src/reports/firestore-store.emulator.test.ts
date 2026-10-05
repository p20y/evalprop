import assert from "node:assert/strict";
import { after, test } from "node:test";
import { getApps, initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { FirestoreReportStore, REPORTS_COLLECTION } from "./firestore-store.ts";
import { runReportStoreContract } from "./store-contract.ts";
import { hashToken, newToken } from "./token.ts";

// Runs under `pnpm test:emulator`, which starts the Firestore emulator and sets FIRESTORE_EMULATOR_HOST.
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "FIRESTORE_EMULATOR_HOST is not set; run this through `pnpm test:emulator`");

const app = initializeApp({ projectId: "demo-evalprop" }, "reports-emulator-test");
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: false });

after(async () => {
  await deleteApp(app);
  for (const a of getApps()) if (a.name === "reports-emulator-test") await deleteApp(a);
});

runReportStoreContract("FirestoreReportStore", () => new FirestoreReportStore(db));

test("FirestoreReportStore writes reports/{reportId} with the hash and no token, in the ARCHITECTURE 6.2 shape", async () => {
  const store = new FirestoreReportStore(db);
  const token = newToken();
  const r = await store.create({
    analysisId: "an_shape",
    ownerUid: "u_shape",
    tokenHash: hashToken(token),
    options: { watermark: false, recipientName: "Dana" },
    version: 3,
    createdAt: "2026-10-04T12:00:00.000Z",
    expiresAt: "2026-11-04T12:00:00.000Z",
  });
  const snap = await db.collection(REPORTS_COLLECTION).doc(r.id).get();
  assert.equal(snap.exists, true);
  const data = snap.data()!;
  assert.deepEqual(Object.keys(data).sort(), ["analysisId", "createdAt", "expiresAt", "options", "ownerUid", "tokenHash", "version"]);
  assert.equal(data.tokenHash, hashToken(token));
  assert.ok(!JSON.stringify(data).includes(token));
});

test("FirestoreReportStore rejects documents that do not match the contract when reading", async () => {
  const store = new FirestoreReportStore(db);
  const bad = hashToken(newToken());
  await db.collection(REPORTS_COLLECTION).doc("rpt_malformed").set({ tokenHash: bad, ownerUid: "u_bad" });
  await assert.rejects(store.getByTokenHash(bad));
});

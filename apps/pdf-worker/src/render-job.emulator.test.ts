import assert from "node:assert/strict";
import { after, test } from "node:test";
import { FirestoreAnalysisRepo } from "@evalprop/server/repos";
import { FirestoreReportStore, REPORTS_COLLECTION } from "@evalprop/server/reports";
import { sampleAnalysis } from "@evalprop/shared";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { renderReportPdf, storeReportSource } from "./render-job.ts";
import { InMemoryPdfStorage } from "./storage.ts";
import { capturingLogger, NOW, StubRenderer } from "./test-helpers.ts";

// Runs under `pnpm test:emulator` (Firestore emulator). The renderer is a stub: this covers the worker's real
// database path, the same FirestoreReportStore and FirestoreAnalysisRepo the server uses.
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "FIRESTORE_EMULATOR_HOST is not set; run this through `pnpm test:emulator`");

const app = initializeApp({ projectId: "demo-evalprop" }, "pdf-worker-emulator-test");
const db = getFirestore(app);
after(() => deleteApp(app));

test("the worker reads a report and its analysis from Firestore, and records pdfPath on reports/{id}", async () => {
  const store = new FirestoreReportStore(db);
  const analysisId = `an_pdf_${Date.now()}`;
  await db.collection("analyses").doc(analysisId).set(JSON.parse(JSON.stringify({ ...sampleAnalysis, id: analysisId })));
  const record = await store.create({ analysisId, ownerUid: sampleAnalysis.ownerUid, tokenHash: "b".repeat(64), options: { watermark: false }, version: 1, createdAt: NOW.toISOString() });

  const renderer = new StubRenderer();
  const storage = new InMemoryPdfStorage();
  const deps = { source: storeReportSource(store, new FirestoreAnalysisRepo(db)), renderer, storage, logger: capturingLogger(), now: () => NOW };

  const out = await renderReportPdf(deps, record.id);
  assert.equal(out.status, "rendered");
  assert.match(renderer.inputs[0]!, /4417 S Quincy Ave/);
  const doc = (await db.collection(REPORTS_COLLECTION).doc(record.id).get()).data()!;
  assert.equal(doc.pdfPath, `reports/${record.id}.pdf`);
  assert.equal((await store.getByTokenHash(record.tokenHash))?.pdfPath, `reports/${record.id}.pdf`);
  assert.equal((await renderReportPdf(deps, record.id)).status, "skipped");
});

test("a report in Firestore whose analysis was deleted is skipped, and a missing report is skipped", async () => {
  const store = new FirestoreReportStore(db);
  const record = await store.create({ analysisId: "an_gone", ownerUid: "u_x", tokenHash: "c".repeat(64), options: { watermark: false }, version: 1, createdAt: NOW.toISOString() });
  const deps = { source: storeReportSource(store, new FirestoreAnalysisRepo(db)), renderer: new StubRenderer(), storage: new InMemoryPdfStorage(), now: () => NOW };
  assert.deepEqual(await renderReportPdf(deps, record.id), { status: "skipped", reason: "analysis_missing" });
  assert.deepEqual(await renderReportPdf(deps, "rpt_does_not_exist"), { status: "skipped", reason: "not_found" });
});

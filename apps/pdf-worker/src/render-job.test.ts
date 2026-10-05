import assert from "node:assert/strict";
import { test } from "node:test";
import { renderReport } from "@evalprop/report";
import { sampleAnalysis } from "@evalprop/shared";
import { renderReportPdf } from "./render-job.ts";
import { pdfPathFor } from "./storage.ts";
import { NOW, PDF_BYTES, setup } from "./test-helpers.ts";

test("renders the same HTML the web page serves, stores the PDF at reports/{id}.pdf, and records the path", async () => {
  const { deps, record, renderer, storage, reports } = await setup();
  const out = await renderReportPdf(deps, record.id);
  assert.deepEqual(out, { status: "rendered", pdfPath: `reports/${record.id}.pdf`, bytes: PDF_BYTES.byteLength });
  assert.equal(pdfPathFor(record.id), `reports/${record.id}.pdf`);
  assert.deepEqual(storage.files.get(`reports/${record.id}.pdf`), PDF_BYTES);
  assert.equal((await reports.getById(record.id))?.pdfPath, `reports/${record.id}.pdf`);
  assert.equal(renderer.inputs.length, 1);
  assert.equal(renderer.inputs[0], renderReport({ analysis: sampleAnalysis, options: record.options, generatedAt: record.createdAt, version: record.version }));
});

test("the report's presentation options reach the rendered HTML (watermark, recipient)", async () => {
  const { deps, record, renderer } = await setup({ options: { options: { watermark: true, recipientName: "Dana" } } });
  await renderReportPdf(deps, record.id);
  assert.match(renderer.inputs[0]!, /class="watermark-banner"/);
  assert.match(renderer.inputs[0]!, /Prepared for Dana/);
});

test("an unknown report is a permanent no-op: nothing rendered or stored", async () => {
  const { deps, renderer, storage } = await setup();
  assert.deepEqual(await renderReportPdf(deps, "rpt_missing"), { status: "skipped", reason: "not_found" });
  assert.equal(renderer.inputs.length, 0);
  assert.equal(storage.files.size, 0);
});

test("a revoked report is a permanent no-op", async () => {
  const { deps, record, reports, renderer, storage } = await setup();
  await reports.revoke(record.id, record.ownerUid, NOW.toISOString());
  assert.deepEqual(await renderReportPdf(deps, record.id), { status: "skipped", reason: "revoked" });
  assert.equal(renderer.inputs.length, 0);
  assert.equal(storage.files.size, 0);
});

test("an expired report is a permanent no-op; one expiring later is rendered", async () => {
  const past = await setup({ options: { expiresAt: new Date(NOW.getTime() - 1000).toISOString() } });
  assert.deepEqual(await renderReportPdf(past.deps, past.record.id), { status: "skipped", reason: "expired" });
  const future = await setup({ options: { expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString() } });
  assert.equal((await renderReportPdf(future.deps, future.record.id)).status, "rendered");
});

test("a report whose analysis is gone is a permanent no-op", async () => {
  const { deps, record, renderer } = await setup({ options: { analysisId: "an_deleted" } });
  assert.deepEqual(await renderReportPdf(deps, record.id), { status: "skipped", reason: "analysis_missing" });
  assert.equal(renderer.inputs.length, 0);
});

test("a report that already has a PDF is not rendered again (a duplicate delivery is harmless)", async () => {
  const { deps, record, renderer } = await setup({ options: { pdfPath: "reports/existing.pdf" } });
  assert.deepEqual(await renderReportPdf(deps, record.id), { status: "skipped", reason: "already_rendered" });
  assert.equal(renderer.inputs.length, 0);
});

test("running the job twice renders once", async () => {
  const { deps, record, renderer } = await setup();
  await renderReportPdf(deps, record.id);
  assert.deepEqual(await renderReportPdf(deps, record.id), { status: "skipped", reason: "already_rendered" });
  assert.equal(renderer.inputs.length, 1);
});

test("a renderer failure throws (so the task is retried) and records no path", async () => {
  const { deps, record, renderer, storage, reports } = await setup();
  renderer.error = new Error("chromium crashed");
  await assert.rejects(renderReportPdf(deps, record.id), /chromium crashed/);
  assert.equal(storage.files.size, 0);
  assert.equal((await reports.getById(record.id))?.pdfPath, undefined, "the web report is untouched and the PDF stays 'preparing'");
});

test("a storage failure throws and records no path; a retry then succeeds", async () => {
  const { deps, record, reports, storage } = await setup();
  const real = storage.put.bind(storage);
  let fail = true;
  storage.put = async (p, b) => {
    if (fail) throw new Error("bucket unavailable");
    return real(p, b);
  };
  await assert.rejects(renderReportPdf(deps, record.id), /bucket unavailable/);
  assert.equal((await reports.getById(record.id))?.pdfPath, undefined);
  fail = false;
  assert.equal((await renderReportPdf(deps, record.id)).status, "rendered");
  assert.equal((await reports.getById(record.id))?.pdfPath, `reports/${record.id}.pdf`);
});

test("logs carry the report id and never the report contents or the token hash", async () => {
  const { deps, record, logger } = await setup();
  await renderReportPdf(deps, record.id);
  await renderReportPdf(deps, "rpt_missing");
  assert.ok(logger.lines.length >= 2);
  const text = JSON.stringify(logger.lines);
  assert.ok(text.includes(record.id));
  assert.ok(!text.includes(record.tokenHash));
  assert.ok(!text.includes(sampleAnalysis.property.line1));
});

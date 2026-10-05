import assert from "node:assert/strict";
import { test } from "node:test";
import { CreateReportOutputSchema, sampleAnalysis } from "@evalprop/shared";
import { InlinePdfJobQueue, type PdfJobQueue } from "../jobs/pdf.ts";
import { InMemoryAnalysisReader, InMemoryReportStore } from "../reports/memory-store.ts";
import { hashToken } from "../reports/token.ts";
import { createReport } from "./create-report.ts";

const OWNER = sampleAnalysis.ownerUid;
const BASE = "https://evalprop.example";

function setup(pdfQueue?: PdfJobQueue, extra: { logWarning?: (m: string, f: { reportId: string; error: string }) => void } = {}) {
  const analyses = new InMemoryAnalysisReader([sampleAnalysis]);
  const reports = new InMemoryReportStore();
  return { reports, deps: { analyses, reports, baseUrl: BASE, now: () => new Date("2026-10-04T12:00:00.000Z"), ...(pdfQueue ? { pdfQueue } : {}), ...extra } };
}

test("enqueues the PDF job for the new report after storing it, and returns the /r/:token/pdf URL", async () => {
  const seen: { id: string; storedAtEnqueue: boolean }[] = [];
  const { reports, deps } = setup(undefined);
  const queue: PdfJobQueue = {
    enqueue: async (id) => void seen.push({ id, storedAtEnqueue: (await reports.getById(id)) !== null }),
  };
  const out = await createReport({ analysisId: sampleAnalysis.id }, OWNER, { ...deps, pdfQueue: queue });
  CreateReportOutputSchema.parse(out);
  assert.deepEqual(seen, [{ id: out.reportId, storedAtEnqueue: true }]);
  assert.equal(out.pdfUrl, `${out.reportUrl}/pdf`);
  assert.match(out.pdfUrl!, /^https:\/\/evalprop\.example\/r\/[A-Za-z0-9_-]{22}\/pdf$/);
});

test("an enqueue failure does not fail report creation: the report exists, pdfUrl is null, and the failure is logged with the report id only", async () => {
  const warnings: { m: string; f: { reportId: string; error: string } }[] = [];
  const failing: PdfJobQueue = { enqueue: async () => { throw new Error("tasks unavailable: secret-detail"); } };
  const { reports, deps } = setup(failing, { logWarning: (m, f) => void warnings.push({ m, f }) });
  const out = await createReport({ analysisId: sampleAnalysis.id }, OWNER, deps);
  assert.equal(out.pdfUrl, null);
  assert.ok(out.reportUrl.startsWith(`${BASE}/r/`));
  const stored = await reports.getByTokenHash(hashToken(out.reportUrl.slice(`${BASE}/r/`.length)));
  assert.equal(stored?.id, out.reportId);
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0]!.f, { reportId: out.reportId, error: "Error" });
  const token = out.reportUrl.slice(`${BASE}/r/`.length);
  assert.ok(!JSON.stringify(warnings).includes(token) && !JSON.stringify(warnings).includes("secret-detail"));
});

test("with no queue configured the report is created and pdfUrl is null", async () => {
  const { deps } = setup();
  assert.equal((await createReport({ analysisId: sampleAnalysis.id }, OWNER, deps)).pdfUrl, null);
});

test("a report for someone else's analysis enqueues nothing", async () => {
  const calls: string[] = [];
  const { deps } = setup({ enqueue: async (id) => void calls.push(id) });
  await assert.rejects(createReport({ analysisId: sampleAnalysis.id }, "someone_else", deps));
  assert.deepEqual(calls, []);
});

test("end to end with the inline queue: create_report, then the job records the PDF path on the report", async () => {
  const { reports, deps } = setup();
  const queue = new InlinePdfJobQueue(async (id) => void (await reports.setPdfPath(id, `reports/${id}.pdf`)));
  const out = await createReport({ analysisId: sampleAnalysis.id }, OWNER, { ...deps, pdfQueue: queue });
  await queue.idle();
  assert.equal((await reports.getById(out.reportId))?.pdfPath, `reports/${out.reportId}.pdf`);
});

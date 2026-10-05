import assert from "node:assert/strict";
import { test } from "node:test";
import { CreateReportOutputSchema, sampleAnalysis, type Analysis } from "@evalprop/shared";
import { InMemoryAnalysisReader, InMemoryReportStore } from "../reports/memory-store.ts";
import { hashToken } from "../reports/token.ts";
import { createReport, ReportToolError, revokeReport } from "./create-report.ts";

const OWNER = sampleAnalysis.ownerUid;
const NOW = new Date("2026-10-04T12:00:00.000Z");
const BASE = "https://evalprop.example";

function setup(extra: Analysis[] = []) {
  const analyses = new InMemoryAnalysisReader([sampleAnalysis, ...extra]);
  const reports = new InMemoryReportStore();
  const deps = { analyses, reports, baseUrl: BASE, now: () => NOW };
  return { analyses, reports, deps };
}

const tokenOf = (url: string) => url.slice(`${BASE}/r/`.length);

test("creates a report and returns the /r/:token URL with a null pdfUrl", async () => {
  const { deps, reports } = setup();
  const out = await createReport({ analysisId: sampleAnalysis.id }, OWNER, deps);
  CreateReportOutputSchema.parse(out);
  assert.match(out.reportUrl, /^https:\/\/evalprop\.example\/r\/[A-Za-z0-9_-]{22}$/);
  assert.equal(out.pdfUrl, null);
  assert.equal(out.expiresAt, null);
  const stored = await reports.getByTokenHash(hashToken(tokenOf(out.reportUrl)));
  assert.equal(stored?.id, out.reportId);
  assert.equal(stored?.analysisId, sampleAnalysis.id);
  assert.equal(stored?.ownerUid, OWNER);
  assert.equal(stored?.createdAt, NOW.toISOString());
  assert.equal(stored?.version, 1);
});

test("stores only the token hash: the token appears in the URL and nowhere in the record", async () => {
  const { deps, reports } = setup();
  const out = await createReport({ analysisId: sampleAnalysis.id }, OWNER, deps);
  const token = tokenOf(out.reportUrl);
  const [record] = await reports.list(OWNER);
  assert.equal(record!.tokenHash, hashToken(token));
  assert.ok(!JSON.stringify(record).includes(token));
});

test("each call makes a fresh unguessable token and the next version", async () => {
  const { deps, reports } = setup();
  const a = await createReport({ analysisId: sampleAnalysis.id }, OWNER, deps);
  const b = await createReport({ analysisId: sampleAnalysis.id }, OWNER, deps);
  assert.notEqual(a.reportUrl, b.reportUrl);
  assert.notEqual(a.reportId, b.reportId);
  assert.deepEqual((await reports.list(OWNER)).map((r) => r.version).sort(), [1, 2]);
});

test("presentation options are stored; the watermark comes from the plan, not from the tool input", async () => {
  const { deps, reports } = setup();
  const out = await createReport({ analysisId: sampleAnalysis.id, options: { recipientName: "Dana", note: "Hi", sections: ["summary", "hold"], preparedBy: "Me" } }, OWNER, deps);
  const free = await createReport({ analysisId: sampleAnalysis.id }, OWNER, { ...deps, watermark: true });
  const stored = await reports.getByTokenHash(hashToken(tokenOf(out.reportUrl)));
  assert.deepEqual(stored?.options, { recipientName: "Dana", note: "Hi", sections: ["summary", "hold"], preparedBy: "Me", watermark: false });
  assert.equal((await reports.getByTokenHash(hashToken(tokenOf(free.reportUrl))))?.options.watermark, true);
  // An input that tries to smuggle in a watermark flag cannot turn it off for a free user.
  const smuggled = await createReport({ analysisId: sampleAnalysis.id, options: { watermark: false } as never }, OWNER, { ...deps, watermark: true });
  assert.equal((await reports.getByTokenHash(hashToken(tokenOf(smuggled.reportUrl))))?.options.watermark, true);
});

test("optional expiry: expiresAt is stored and returned", async () => {
  const { deps, reports } = setup();
  const out = await createReport({ analysisId: sampleAnalysis.id }, OWNER, { ...deps, expiresInDays: 30 });
  assert.equal(out.expiresAt, "2026-11-03T12:00:00.000Z");
  assert.equal((await reports.getByTokenHash(hashToken(tokenOf(out.reportUrl))))?.expiresAt, "2026-11-03T12:00:00.000Z");
});

test("a trailing slash on the base URL does not double up", async () => {
  const { deps } = setup();
  const out = await createReport({ analysisId: sampleAnalysis.id }, OWNER, { ...deps, baseUrl: `${BASE}//` });
  assert.match(out.reportUrl, /^https:\/\/evalprop\.example\/r\/[A-Za-z0-9_-]{22}$/);
});

test("owner isolation: someone else's analysis and a missing analysis fail identically with NOT_FOUND", async () => {
  const { deps, reports } = setup();
  const notMine = await createReport({ analysisId: sampleAnalysis.id }, "intruder", deps).catch((e: unknown) => e);
  const missing = await createReport({ analysisId: "an_does_not_exist" }, "intruder", deps).catch((e: unknown) => e);
  assert.ok(notMine instanceof ReportToolError);
  assert.ok(missing instanceof ReportToolError);
  assert.equal(notMine.code, "NOT_FOUND");
  assert.equal(missing.code, "NOT_FOUND");
  assert.equal(notMine.message, missing.message, "the message must not reveal whether the analysis exists");
  assert.deepEqual(notMine.toToolError(), { code: "NOT_FOUND", message: notMine.message });
  assert.deepEqual(await reports.list("intruder"), []);
  assert.deepEqual(await reports.list(OWNER), [], "nothing was created for the owner either");
});

test("revokeReport turns a link off for its owner only", async () => {
  const { deps, reports } = setup();
  const out = await createReport({ analysisId: sampleAnalysis.id }, OWNER, deps);
  await assert.rejects(revokeReport(out.reportId, "intruder", deps), (e: unknown) => e instanceof ReportToolError && e.code === "NOT_FOUND");
  assert.equal((await reports.getByTokenHash(hashToken(tokenOf(out.reportUrl))))?.revokedAt, undefined);
  await revokeReport(out.reportId, OWNER, deps);
  assert.equal((await reports.getByTokenHash(hashToken(tokenOf(out.reportUrl))))?.revokedAt, NOW.toISOString());
  await assert.rejects(revokeReport("rpt_missing", OWNER, deps), (e: unknown) => e instanceof ReportToolError && e.code === "NOT_FOUND");
});

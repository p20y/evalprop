import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleAnalysis } from "@evalprop/shared";
import { createApp } from "../app.ts";
import { createReport, revokeReport } from "../mcp/create-report.ts";
import { InMemoryAnalysisReader, InMemoryReportStore } from "../reports/memory-store.ts";
import { DEFAULT_PDF_URL_TTL_SECONDS, FakeSignedUrlProvider, GcsSignedUrlProvider, type SignableBucket, type SignedUrlProvider } from "../reports/signed-url.ts";
import { PDF_RETRY_AFTER_SECONDS } from "./report.ts";

const OWNER = sampleAnalysis.ownerUid;
const BASE = "https://evalprop.example";

function setup(opts: { now?: () => Date; signedUrls?: SignedUrlProvider | null } = {}) {
  const analyses = new InMemoryAnalysisReader([sampleAnalysis]);
  const reports = new InMemoryReportStore();
  const now = opts.now ?? (() => new Date("2026-10-04T12:00:00.000Z"));
  const signer = new FakeSignedUrlProvider(() => now().getTime());
  const signedUrls = opts.signedUrls === null ? undefined : (opts.signedUrls ?? signer);
  const app = createApp({ reports, analyses, now, ...(signedUrls ? { signedUrls } : {}) });
  const make = async (expiresInDays?: number) => {
    const out = await createReport({ analysisId: sampleAnalysis.id }, OWNER, { analyses, reports, baseUrl: BASE, now, ...(expiresInDays !== undefined ? { expiresInDays } : {}) });
    return { ...out, path: new URL(out.reportUrl).pathname };
  };
  return { app, reports, signer, make, analyses, now };
}

test("PDF ready: 302 to a short-lived signed URL (10 minutes by default), no body, never cached, noindex", async () => {
  const { app, reports, signer, make } = setup();
  const r = await make();
  await reports.setPdfPath(r.reportId, `reports/${r.reportId}.pdf`);
  const res = await app.request(`${r.path}/pdf`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `https://storage.example/signed/${encodeURIComponent(`reports/${r.reportId}.pdf`)}?expires=${new Date("2026-10-04T12:10:00.000Z").getTime()}`);
  assert.equal(signer.calls[0]!.expiresInSeconds, DEFAULT_PDF_URL_TTL_SECONDS);
  assert.equal(DEFAULT_PDF_URL_TTL_SECONDS, 600);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.equal(await res.text(), "", "the bucket path is only in the signed URL, never in a body");
});

test("the signed URL lifetime follows the injected clock: each request signs afresh", async () => {
  let t = new Date("2026-10-04T12:00:00.000Z");
  const { app, reports, signer, make } = setup({ now: () => t });
  const r = await make();
  await reports.setPdfPath(r.reportId, "reports/x.pdf");
  await app.request(`${r.path}/pdf`);
  t = new Date("2026-10-04T12:30:00.000Z");
  await app.request(`${r.path}/pdf`);
  assert.deepEqual(signer.calls.map((c) => c.expiresAtMs), [Date.parse("2026-10-04T12:10:00.000Z"), Date.parse("2026-10-04T12:40:00.000Z")]);
});

test("PDF not ready: 202 with a small noindex 'preparing' page and Retry-After; the web report still works", async () => {
  const { app, make, signer } = setup();
  const r = await make();
  const res = await app.request(`${r.path}/pdf`);
  assert.equal(res.status, 202);
  assert.equal(res.headers.get("retry-after"), String(PDF_RETRY_AFTER_SECONDS));
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
  const html = await res.text();
  assert.match(html, /Your PDF is being prepared/);
  assert.match(html, /Refresh in a moment/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive">/);
  assert.equal(signer.calls.length, 0);
  assert.equal((await app.request(r.path)).status, 200);
});

test("an unknown, malformed or truncated token is 404, exactly like the page", async () => {
  const { app } = setup();
  for (const path of ["/r/BBBBBBBBBBBBBBBBBBBBBB/pdf", "/r/short/pdf", "/r/!!!!!!!!!!!!!!!!!!!!!!/pdf"]) {
    const res = await app.request(path);
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
});

test("a revoked link is 410 for the PDF too, even when a PDF exists", async () => {
  const { app, reports, make } = setup();
  const r = await make();
  await reports.setPdfPath(r.reportId, "reports/x.pdf");
  await revokeReport(r.reportId, OWNER, { reports, now: () => new Date("2026-10-04T13:00:00.000Z") });
  const res = await app.request(`${r.path}/pdf`, { redirect: "manual" });
  assert.equal(res.status, 410);
  assert.equal(res.headers.get("location"), null);
  assert.equal((await app.request(r.path)).status, 410);
});

test("an expired link is 410 for the PDF too", async () => {
  let t = new Date("2026-10-04T12:00:00.000Z");
  const { app, reports, make } = setup({ now: () => t });
  const r = await make(1);
  await reports.setPdfPath(r.reportId, "reports/x.pdf");
  assert.equal((await app.request(`${r.path}/pdf`, { redirect: "manual" })).status, 302);
  t = new Date("2026-10-06T12:00:00.000Z");
  assert.equal((await app.request(`${r.path}/pdf`, { redirect: "manual" })).status, 410);
});

test("the token is hashed the same way: the stored hash of the page's token finds the PDF, a different token does not", async () => {
  const { app, reports, make } = setup();
  const a = await make();
  const b = await make();
  await reports.setPdfPath(a.reportId, "reports/a.pdf");
  assert.equal((await app.request(`${a.path}/pdf`, { redirect: "manual" })).status, 302);
  assert.equal((await app.request(`${b.path}/pdf`)).status, 202, "b has no PDF of its own");
});

test("without a signed-URL provider the PDF route is a 404", async () => {
  const { app, make, reports } = setup({ signedUrls: null });
  const r = await make();
  await reports.setPdfPath(r.reportId, "reports/x.pdf");
  assert.equal((await app.request(`${r.path}/pdf`)).status, 404);
});

test("a signing failure is a generic 500 that leaks neither the token nor the error nor the bucket path", async () => {
  const broken: SignedUrlProvider = { sign: async () => { throw new Error("iam: signBlob denied for gs://secret-bucket/reports/x.pdf"); } };
  const { app, make, reports } = setup({ signedUrls: broken });
  const r = await make();
  await reports.setPdfPath(r.reportId, "reports/x.pdf");
  const res = await app.request(`${r.path}/pdf`);
  assert.equal(res.status, 500);
  const body = await res.text();
  assert.ok(!body.includes("secret-bucket") && !body.includes(r.path.split("/")[2]!));
});

test("GcsSignedUrlProvider: V4 read URL that expires after the TTL, with an inline PDF disposition", async () => {
  const calls: { path: string; config: Record<string, unknown> }[] = [];
  const bucket: SignableBucket = { file: (path) => ({ getSignedUrl: async (config) => (calls.push({ path, config }), [`https://storage.googleapis.com/b/${path}?X-Goog-Signature=abc`]) }) };
  const now = Date.parse("2026-10-04T12:00:00.000Z");
  const url = await new GcsSignedUrlProvider(bucket, () => now).sign("reports/rpt_1.pdf", { expiresInSeconds: 600, downloadFilename: 'my "report".pdf' });
  assert.match(url, /X-Goog-Signature/);
  assert.equal(calls[0]!.path, "reports/rpt_1.pdf");
  assert.deepEqual(calls[0]!.config, {
    version: "v4",
    action: "read",
    expires: now + 600_000,
    responseType: "application/pdf",
    responseDisposition: 'inline; filename="my__report_.pdf"',
  });
});

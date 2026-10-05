import assert from "node:assert/strict";
import { test } from "node:test";
import { REPORT_SCRIPT_SHA256 } from "@evalprop/report";
import { sampleAnalysis } from "@evalprop/shared";
import { createApp } from "../app.ts";
import { createReport, revokeReport } from "../mcp/create-report.ts";
import { InMemoryAnalysisReader, InMemoryReportStore } from "../reports/memory-store.ts";
import type { ReportStore } from "../reports/types.ts";
import { REPORT_CACHE_CONTROL } from "./report.ts";

const OWNER = sampleAnalysis.ownerUid;
const BASE = "https://evalprop.example";

function setup(opts: { now?: () => Date; watermark?: boolean } = {}) {
  const analyses = new InMemoryAnalysisReader([sampleAnalysis]);
  const reports = new InMemoryReportStore();
  const now = opts.now ?? (() => new Date("2026-10-04T12:00:00.000Z"));
  const app = createApp({ reports, analyses, now });
  const make = async (extra: { expiresInDays?: number; options?: Parameters<typeof createReport>[0]["options"] } = {}) => {
    const out = await createReport({ analysisId: sampleAnalysis.id, ...(extra.options ? { options: extra.options } : {}) }, OWNER, {
      analyses,
      reports,
      baseUrl: BASE,
      now,
      ...(opts.watermark ? { watermark: true } : {}),
      ...(extra.expiresInDays !== undefined ? { expiresInDays: extra.expiresInDays } : {}),
    });
    return { ...out, path: new URL(out.reportUrl).pathname };
  };
  return { app, analyses, reports, make, now };
}

test("GET /r/:token serves the report with noindex, a CSP, and short private caching", async () => {
  const { app, make } = setup();
  const { path } = await make({ options: { recipientName: "Dana" } });
  const res = await app.request(path);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.equal(res.headers.get("cache-control"), REPORT_CACHE_CONTROL);
  assert.match(res.headers.get("cache-control") ?? "", /^private, max-age=\d{1,3}$/);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'none'/);
  assert.ok(csp.includes(`sha256-${REPORT_SCRIPT_SHA256}`));
  const html = await res.text();
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive">/);
  assert.ok(html.includes("4417 S Quincy Ave, Tulsa, OK 74105"));
  assert.match(html, /Prepared for Dana/);
  assert.match(html, /Disclaimer|not investment, tax, legal, or lending advice/);
});

test("the page shows exactly the stored analysis and options (the report is a snapshot)", async () => {
  const { app, make } = setup({ watermark: true });
  const { path } = await make({ options: { sections: ["summary"], note: "For you" } });
  const html = await (await app.request(path)).text();
  assert.match(html, /For you/);
  assert.match(html, /class="watermark-banner"/);
  assert.ok(html.includes('id="summary"'));
  assert.ok(!html.includes('id="schools"'));
});

test("an unknown token is 404, with the same page as a malformed one", async () => {
  const { app } = setup();
  const unknown = await app.request("/r/AAAAAAAAAAAAAAAAAAAAAA");
  const malformed = await app.request("/r/not-a-token");
  const traversal = await app.request("/r/..%2F..%2Fetc%2Fpasswd");
  for (const res of [unknown, malformed, traversal]) {
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  assert.equal(await unknown.text(), await malformed.text());
});

test("a revoked link is 410 Gone, immediately, and says nothing else about the report", async () => {
  const { app, make, reports, now } = setup();
  const { path, reportId } = await make();
  assert.equal((await app.request(path)).status, 200);
  await revokeReport(reportId, OWNER, { reports, now });
  const res = await app.request(path);
  assert.equal(res.status, 410);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  const body = await res.text();
  assert.match(body, /no longer shared/);
  assert.ok(!body.includes("Quincy"), "the revoked page contains no report content");
});

test("an expired link is 410; before expiry it is 200", async () => {
  let clock = new Date("2026-10-04T12:00:00.000Z");
  const { app, make } = setup({ now: () => clock });
  const { path, expiresAt } = await make({ expiresInDays: 7 });
  assert.equal(expiresAt, "2026-10-11T12:00:00.000Z");
  clock = new Date("2026-10-11T11:59:59.000Z");
  assert.equal((await app.request(path)).status, 200);
  clock = new Date("2026-10-11T12:00:00.000Z");
  const res = await app.request(path);
  assert.equal(res.status, 410);
  assert.match(await res.text(), /expired/);
});

test("a report whose analysis has been deleted is 404", async () => {
  const analyses = new InMemoryAnalysisReader([]);
  const reports = new InMemoryReportStore();
  const seed = new InMemoryAnalysisReader([sampleAnalysis]);
  const out = await createReport({ analysisId: sampleAnalysis.id }, OWNER, { analyses: seed, reports, baseUrl: BASE });
  const app = createApp({ reports, analyses });
  assert.equal((await app.request(new URL(out.reportUrl).pathname)).status, 404);
});

test("ETag revalidation: If-None-Match gets 304 without rendering; a revoked link stops revalidating", async () => {
  let renders = 0;
  const analyses = new InMemoryAnalysisReader([sampleAnalysis]);
  const reports = new InMemoryReportStore();
  const { reportRoutes } = await import("./report.ts");
  const app = reportRoutes({ analyses, reports, render: () => (renders++, "<!doctype html><title>x</title>") });
  const out = await createReport({ analysisId: sampleAnalysis.id }, OWNER, { analyses, reports, baseUrl: BASE });
  const path = new URL(out.reportUrl).pathname;
  const first = await app.request(path);
  const etag = first.headers.get("etag");
  assert.ok(etag);
  assert.equal(renders, 1);
  const again = await app.request(path, { headers: { "If-None-Match": etag } });
  assert.equal(again.status, 304);
  assert.equal(again.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.equal(renders, 1, "304 did not render");
  const stale = await app.request(path, { headers: { "If-None-Match": '"other"' } });
  assert.equal(stale.status, 200);
  await revokeReport(out.reportId, OWNER, { reports });
  assert.equal((await app.request(path, { headers: { "If-None-Match": etag } })).status, 410);
});

test("a different report version has a different ETag", async () => {
  const { app, make } = setup();
  const a = await make();
  const b = await make();
  const ea = (await app.request(a.path)).headers.get("etag");
  const eb = (await app.request(b.path)).headers.get("etag");
  assert.ok(ea && eb && ea !== eb);
});

test("store failures return a generic 500 that leaks neither the token nor the error", async () => {
  const analyses = new InMemoryAnalysisReader([sampleAnalysis]);
  const broken: ReportStore = {
    create: async () => { throw new Error("boom"); },
    getByTokenHash: async () => { throw new Error("connection string secret-xyz"); },
    getById: async () => null,
    setPdfPath: async () => false,
    revoke: async () => false,
    list: async () => [],
  };
  const app = createApp({ reports: broken, analyses });
  const token = "BBBBBBBBBBBBBBBBBBBBBB";
  const res = await app.request(`/r/${token}`);
  assert.equal(res.status, 500);
  const body = await res.text();
  assert.ok(!body.includes("secret-xyz") && !body.includes(token));
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("HEAD works and other methods are not allowed", async () => {
  const { app, make } = setup();
  const { path } = await make();
  const head = await app.request(path, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.equal((await app.request(path, { method: "POST" })).status, 404);
  assert.equal((await app.request(path, { method: "DELETE" })).status, 404);
});

test("the app still starts with no dependencies: /health works and /r/:token does not exist", async () => {
  const app = createApp();
  assert.equal((await app.request("/health")).status, 200);
  assert.equal((await app.request("/r/AAAAAAAAAAAAAAAAAAAAAA")).status, 404);
  const partial = createApp({ reports: new InMemoryReportStore() });
  assert.equal((await partial.request("/r/AAAAAAAAAAAAAAAAAAAAAA")).status, 404);
  assert.equal((await partial.request("/health")).status, 200);
});

test("one owner's link never shows another owner's analysis", async () => {
  const other = { ...sampleAnalysis, id: "an_other", ownerUid: "user_other" };
  other.property = { ...sampleAnalysis.property, formattedAddress: "999 Secret Rd, Nowhere, TX 75001" };
  const analyses = new InMemoryAnalysisReader([sampleAnalysis, other]);
  const reports = new InMemoryReportStore();
  const app = createApp({ reports, analyses });
  // Even if a report record somehow pointed at someone else's analysis, the owner check on read refuses it.
  const { hashToken, newToken } = await import("../reports/token.ts");
  const token = newToken();
  await reports.create({ analysisId: "an_other", ownerUid: OWNER, tokenHash: hashToken(token), options: { watermark: false }, version: 1, createdAt: "2026-10-04T12:00:00.000Z" });
  const res = await app.request(`/r/${token}`);
  assert.equal(res.status, 404);
  assert.ok(!(await res.text()).includes("Secret"));
});

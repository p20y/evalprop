import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AnalyzePropertyOutputSchema, WhatIfOutputSchema } from "@evalprop/shared";
import { createApp } from "../app.ts";
import { ADDR } from "../pipeline/test-helpers.ts";
import { call, connectClient, BASE_URL, testServer } from "./test-helpers.ts";
import { createLocalWiring } from "./local-runtime.ts";

/** The path of a share link, so it can be fetched from the in-process app. */
const pathOf = (url: string) => new URL(url).pathname;

describe("the card's report link is a real share link", () => {
  test("analyze_property returns a /r/:token link that serves the hosted report", async () => {
    const wiring = await createLocalWiring({ BASE_URL }, 8787);
    const app = createApp({ mcp: { ...wiring.mcp, authorizationServers: [] }, reports: wiring.reports, analyses: wiring.analyses });
    const client = await connectClient(app, "link_user");
    const result = await call(client, "analyze_property", { address: ADDR.house, listing: { price: 340000 } });
    assert.notEqual(result.isError, true);
    const out = AnalyzePropertyOutputSchema.parse(result.structuredContent);

    assert.match(out.card.reportUrl, new RegExp(`^${BASE_URL}/r/[A-Za-z0-9_-]{20,}$`));
    const page = await app.request(pathOf(out.card.reportUrl));
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Rental investment report|<title>/i);
    assert.ok(html.includes("2415 Maple Test Dr"), "the report shows the analyzed property");
    assert.match(page.headers.get("x-robots-tag") ?? "", /noindex/);
  });

  test("what_if returns its own share link for the new analysis", async () => {
    const wiring = await createLocalWiring({ BASE_URL }, 8787);
    const app = createApp({ mcp: { ...wiring.mcp, authorizationServers: [] }, reports: wiring.reports, analyses: wiring.analyses });
    const client = await connectClient(app, "link_user");
    const first = AnalyzePropertyOutputSchema.parse((await call(client, "analyze_property", { address: ADDR.house, listing: { price: 340000 } })).structuredContent);
    const second = WhatIfOutputSchema.parse(
      (await call(client, "what_if", { analysisId: first.card.analysisId, overrides: { offerPrice: 310000, interestRatePct: 6.5 } })).structuredContent,
    );
    assert.notEqual(second.card.reportUrl, first.card.reportUrl);
    assert.equal((await app.request(pathOf(second.card.reportUrl))).status, 200);
  });

  test("a link from one user's analysis is not created for another user's analysis id", async () => {
    const wiring = await createLocalWiring({ BASE_URL }, 8787);
    const app = createApp({ mcp: { ...wiring.mcp, authorizationServers: [] }, reports: wiring.reports, analyses: wiring.analyses });
    const owner = await connectClient(app, "owner_a");
    const out = AnalyzePropertyOutputSchema.parse((await call(owner, "analyze_property", { address: ADDR.house, listing: { price: 340000 } })).structuredContent);
    // another caller cannot even run a what-if on it (NOT_FOUND), so no link is ever minted for it
    const other = await connectClient(app, "owner_b");
    const result = await call(other, "what_if", { analysisId: out.card.analysisId, overrides: { offerPrice: 300000 } });
    assert.equal(result.isError, true);
  });

  test("if minting the link fails, the analysis still returns with the placeholder link and the failure is logged", async () => {
    const { app, logs } = testServer({
      createReportLink: async () => {
        throw new Error("store unavailable");
      },
    });
    const client = await connectClient(app, "link_user");
    const result = await call(client, "analyze_property", { address: ADDR.house, listing: { price: 340000 } });
    assert.notEqual(result.isError, true);
    const out = AnalyzePropertyOutputSchema.parse(result.structuredContent);
    assert.match(out.card.reportUrl, /\/r\//);
    assert.ok(logs.some((l) => l.event === "mcp.report_link_failed"));
    assert.ok(!JSON.stringify(logs).includes("store unavailable"), "error messages are not logged, only the class");
  });

  test("without createReportLink the tools behave as before", async () => {
    const { app } = testServer();
    const client = await connectClient(app);
    const out = AnalyzePropertyOutputSchema.parse((await call(client, "analyze_property", { address: ADDR.house, listing: { price: 340000 } })).structuredContent);
    assert.ok(out.card.reportUrl.length > 0);
  });
});


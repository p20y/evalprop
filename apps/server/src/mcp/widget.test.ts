import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AnalyzePropertyOutputSchema, WhatIfOutputSchema } from "@evalprop/shared";
import { WIDGET_HTML, renderCard } from "@evalprop/widget";
import { ADDR } from "../pipeline/test-helpers.ts";
import { TOOLS } from "./tools.ts";
import { WIDGET_MIME_TYPE, WIDGET_RESOURCE_URI, widgetResourceMeta, widgetToolMeta } from "./widget-registration.ts";
import { BASE_URL, call, connectClient, testServer } from "./test-helpers.ts";

describe("widget resource", () => {
  test("initialize advertises the resources capability next to tools", async () => {
    const client = await connectClient(testServer().app);
    const caps = client.getServerCapabilities();
    assert.ok(caps?.tools !== undefined);
    assert.ok(caps?.resources !== undefined);
    await client.close();
  });

  test("resources/list includes the widget with the MCP Apps MIME type and a ui:// URI", async () => {
    const client = await connectClient(testServer().app);
    const { resources } = await client.listResources();
    assert.equal(resources.length, 1);
    const widget = resources[0];
    assert.equal(widget?.uri, WIDGET_RESOURCE_URI);
    assert.match(widget?.uri ?? "", /^ui:\/\//);
    assert.equal(widget?.mimeType, "text/html;profile=mcp-app");
    assert.equal(WIDGET_MIME_TYPE, "text/html;profile=mcp-app");
    assert.ok((widget?.title ?? "").length > 0);
    await client.close();
  });

  test("resources/read returns the self-contained HTML with the documented MIME type and CSP metadata", async () => {
    const client = await connectClient(testServer().app);
    const result = await client.readResource({ uri: WIDGET_RESOURCE_URI });
    assert.equal(result.contents.length, 1);
    const content = result.contents[0] as { uri: string; mimeType?: string; text?: string; _meta?: Record<string, unknown> };
    assert.equal(content.uri, WIDGET_RESOURCE_URI);
    assert.equal(content.mimeType, "text/html;profile=mcp-app");
    assert.equal(content.text, WIDGET_HTML);
    assert.match(content.text ?? "", /^<!doctype html>/);

    const meta = content._meta as { ui: { prefersBorder: boolean; csp: Record<string, string[]>; domain?: string }; [k: string]: unknown };
    assert.equal(meta.ui.prefersBorder, true);
    // Nothing is fetched or loaded, so nothing is allowed.
    assert.deepEqual(meta.ui.csp, { connectDomains: [], resourceDomains: [] });
    assert.equal(meta.ui.domain, undefined, "no widget domain until one is configured");
    // The legacy mirror, with the report origin so openExternal can follow the link.
    assert.deepEqual(meta["openai/widgetCSP"], { connect_domains: [], resource_domains: [], redirect_domains: [BASE_URL] });
    assert.equal(meta["openai/widgetPrefersBorder"], true);
    assert.equal(typeof meta["openai/widgetDescription"], "string");
    await client.close();
  });

  test("a configured widget domain is published under both the standard and the legacy key", async () => {
    const client = await connectClient(testServer({ widgetDomain: "https://widget.evalprop.example/some/path" }).app);
    const result = await client.readResource({ uri: WIDGET_RESOURCE_URI });
    const meta = (result.contents[0] as { _meta: Record<string, unknown> })._meta as { ui: { domain: string } };
    assert.equal(meta.ui.domain, "https://widget.evalprop.example");
    assert.equal((result.contents[0] as { _meta: Record<string, unknown> })._meta["openai/widgetDomain"], "https://widget.evalprop.example");
    await client.close();
  });

  test("an unknown resource URI is a JSON-RPC error", async () => {
    const client = await connectClient(testServer().app);
    await assert.rejects(() => client.readResource({ uri: "ui://widget/missing.html" }), /Resource not found/);
    await assert.rejects(() => client.readResource({ uri: "file:///etc/passwd" }), /Resource not found/);
    await client.close();
  });

  test("resources need the same authentication as tools", async () => {
    const { app } = testServer();
    const response = await app.request(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: WIDGET_RESOURCE_URI } }),
    });
    assert.equal(response.status, 401);
  });

  test("metadata helpers: no redirect_domains without a base URL, an invalid base URL is ignored", () => {
    const meta = widgetResourceMeta() as { "openai/widgetCSP": Record<string, unknown> };
    assert.equal(meta["openai/widgetCSP"]["redirect_domains"], undefined);
    const invalid = widgetResourceMeta({ baseUrl: "not a url" }) as { "openai/widgetCSP": Record<string, unknown> };
    assert.equal(invalid["openai/widgetCSP"]["redirect_domains"], undefined);
  });
});

describe("tools link to the widget", () => {
  test("tools/list entries for analyze_property and what_if carry the template link under both keys", async () => {
    const client = await connectClient(testServer().app);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["analyze_property", "what_if"]);
    for (const tool of tools) {
      const meta = tool._meta as Record<string, unknown> | undefined;
      assert.deepEqual((meta?.["ui"] as { resourceUri: string }).resourceUri, WIDGET_RESOURCE_URI, `${tool.name} ui.resourceUri`);
      assert.equal(meta?.["openai/outputTemplate"], WIDGET_RESOURCE_URI, `${tool.name} openai/outputTemplate`);
      for (const key of ["openai/toolInvocation/invoking", "openai/toolInvocation/invoked"]) {
        const status: unknown = meta?.[key];
        assert.ok(typeof status === "string" && status.length > 0 && status.length <= 64, `${key} is a string of at most 64 characters`);
      }
    }
    await client.close();
  });

  test("the linked URI is one the server actually serves", async () => {
    const client = await connectClient(testServer().app);
    const { tools } = await client.listTools();
    const uri = ((tools[0]?._meta as { ui: { resourceUri: string } }).ui).resourceUri;
    const { resources } = await client.listResources();
    assert.ok(resources.some((r) => r.uri === uri));
    await client.close();
  });

  test("the registry has no tool the card cannot render yet (create_report and compare_properties are not registered)", () => {
    assert.deepEqual(TOOLS.map((t) => t.name), ["analyze_property", "what_if"]);
    assert.ok(TOOLS.every((t) => t.meta !== undefined));
    assert.deepEqual(widgetToolMeta({ invoking: "a", invoked: "b" })["ui"], { resourceUri: WIDGET_RESOURCE_URI });
  });

  test("tool results are unchanged by the widget: text, structuredContent and _meta still work for a client that ignores the template", async () => {
    const client = await connectClient(testServer().app);
    const result = await call(client, "analyze_property", { address: ADDR.house, assumptions: { offerPrice: 330000 } });
    assert.notEqual(result.isError, true);
    const out = AnalyzePropertyOutputSchema.parse(result.structuredContent);
    assert.equal(result.content[0]?.type, "text");
    assert.ok((result._meta as { analysis: unknown }).analysis !== undefined);

    // The card renders from exactly that structuredContent, with the numbers the pipeline produced.
    const html = renderCard(out);
    assert.ok(html.includes(out.card.verdictLabel));
    assert.ok(html.includes(out.card.address.replace(/&/g, "&amp;")));
    assert.ok(html.includes(`href="${out.card.reportUrl}"`));

    const changed = await call(client, "what_if", { analysisId: out.card.analysisId, overrides: { interestRatePct: 5.5 } });
    const whatIf = WhatIfOutputSchema.parse(changed.structuredContent);
    const whatIfHtml = renderCard(whatIf);
    assert.ok(whatIfHtml.includes("Before and after"));
    for (const row of whatIf.rows) assert.ok(whatIfHtml.includes(row.label.replace(/&/g, "&amp;")));
    await client.close();
  });
});

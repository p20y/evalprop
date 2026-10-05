import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  AnalyzePropertyOutputSchema,
  CardModelSchema,
  TOOL_DESCRIPTIONS,
  ToolErrorSchema,
  WhatIfOutputSchema,
  type Analysis,
} from "@evalprop/shared";
import { ADDR } from "../pipeline/test-helpers.ts";
import type { QuotaGate } from "../pipeline/index.ts";
import { TOOLS, type ToolDefinition } from "./tools.ts";
import { BASE_URL, call, connectClient, errorOf, testServer, textOf } from "./test-helpers.ts";

const analysisOf = (r: CallToolResult): Analysis => (r._meta as { analysis: Analysis }).analysis;

describe("tools/list", () => {
  test("lists exactly analyze_property and what_if with the shared descriptions and valid JSON schemas", async () => {
    const client = await connectClient(testServer().app);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["analyze_property", "what_if"]);

    const analyze = tools.find((t) => t.name === "analyze_property");
    const whatIf = tools.find((t) => t.name === "what_if");
    assert.equal(analyze?.description, TOOL_DESCRIPTIONS.analyze_property);
    assert.equal(whatIf?.description, TOOL_DESCRIPTIONS.what_if);

    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(tool.outputSchema?.type, "object");
      assert.equal(tool.inputSchema["$schema"], undefined);
      assert.equal(tool.annotations?.readOnlyHint, false);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.equal(tool.annotations?.idempotentHint, true);
    }
    const props = analyze?.inputSchema.properties as Record<string, unknown>;
    assert.deepEqual(Object.keys(props).sort(), ["address", "advisoryFlags", "assumptions", "listing", "targetCashOnCashPct"]);
    // `targetCashOnCashPct` has a default, so it is optional for the caller.
    assert.ok(!(analyze?.inputSchema.required ?? []).includes("targetCashOnCashPct"));
    assert.deepEqual([...(whatIf?.inputSchema.required ?? [])].sort(), ["analysisId", "overrides"]);
    assert.equal(analyze?.annotations?.openWorldHint, true);
    assert.equal(whatIf?.annotations?.openWorldHint, false);
    await client.close();
  });

  test("the registry is the single place a tool is added", () => {
    assert.deepEqual(TOOLS.map((t) => t.name), ["analyze_property", "what_if"]);
  });

  test("unknown tool is a JSON-RPC error, not a tool result", async () => {
    const client = await connectClient(testServer().app);
    await assert.rejects(() => client.callTool({ name: "compare_properties", arguments: {} }), /Unknown tool/);
    await client.close();
  });
});

describe("analyze_property", () => {
  for (const [name, address] of [
    ["multi-unit condo", ADDR.condo],
    ["suburban house", ADDR.house],
  ] as const) {
    test(`${name}: structuredContent matches the shared output schema, text is the pipeline summary, _meta has the evaluation`, async () => {
      const { app } = testServer();
      const client = await connectClient(app);
      const result = await call(client, "analyze_property", { address });
      assert.notEqual(result.isError, true);

      const out = AnalyzePropertyOutputSchema.parse(result.structuredContent);
      assert.ok(CardModelSchema.safeParse(out.card).success);
      assert.equal(textOf(result), out.summary);
      assert.equal(result.content.length, 1);
      assert.match(out.card.reportUrl, new RegExp(`^${BASE_URL}/r/`));
      assert.ok(out.card.reportUrl.endsWith(out.card.analysisId));

      const analysis = analysisOf(result);
      assert.equal(analysis.id, out.card.analysisId);
      assert.ok(analysis.evaluation.yearOne.monthlyCashFlow !== undefined);
      const meta = result._meta as { provenance: Record<string, unknown>; reused: boolean };
      assert.ok(Object.keys(meta.provenance).includes("property"));
      assert.equal(meta.reused, false);
      assert.ok(analysis.assumptions.every((a) => ["provided", "listing", "lookup", "assumed"].includes(a.source)));
      await client.close();
    });
  }

  test("rural: no comps and no rent is NEEDS_RENT, and supplying the rent succeeds as provided", async () => {
    const client = await connectClient(testServer().app);
    const needs = await call(client, "analyze_property", { address: ADDR.rural });
    const error = errorOf(needs);
    assert.equal(error.code, "NEEDS_RENT");
    assert.equal(error.field, "monthlyRent");
    assert.equal(needs.structuredContent, undefined);
    // What the pipeline learned travels in _meta, not in the user-visible error.
    assert.equal((needs._meta as { property: { city: string } }).property.city, "Quietfield");

    const ok = await call(client, "analyze_property", { address: ADDR.rural, assumptions: { monthlyRent: 1400, offerPrice: 210000 } });
    assert.notEqual(ok.isError, true);
    const out = AnalyzePropertyOutputSchema.parse(ok.structuredContent);
    assert.equal(out.card.rentSource, "provided");
    await client.close();
  });

  test("an idempotent retry returns the same analysis id, flagged as reused", async () => {
    const { app, repo } = testServer();
    const client = await connectClient(app);
    const args = { address: ADDR.house, assumptions: { offerPrice: 330000 } };
    const first = await call(client, "analyze_property", args);
    const retry = await call(client, "analyze_property", args);
    assert.equal(AnalyzePropertyOutputSchema.parse(retry.structuredContent).card.analysisId, AnalyzePropertyOutputSchema.parse(first.structuredContent).card.analysisId);
    assert.equal((first._meta as { reused: boolean }).reused, false);
    assert.equal((retry._meta as { reused: boolean }).reused, true);
    assert.equal((await repo.listUsage("user_a")).length, 1, "billed once");
    await client.close();
  });

  test("handlers resolve the uid from the token: two users do not share analyses", async () => {
    const { app } = testServer();
    const a = await connectClient(app, "alice");
    const b = await connectClient(app, "bob");
    const ra = await call(a, "analyze_property", { address: ADDR.house });
    const rb = await call(b, "analyze_property", { address: ADDR.house });
    assert.equal(analysisOf(ra).ownerUid, "alice");
    assert.equal(analysisOf(rb).ownerUid, "bob");
    assert.notEqual(analysisOf(ra).id, analysisOf(rb).id);
    await a.close();
    await b.close();
  });
});

describe("what_if", () => {
  test("returns before/after rows, the base id and a new analysis with its own report URL", async () => {
    const client = await connectClient(testServer().app);
    const base = await call(client, "analyze_property", { address: ADDR.house, assumptions: { offerPrice: 330000 } });
    const baseOut = AnalyzePropertyOutputSchema.parse(base.structuredContent);

    const next = await call(client, "what_if", { analysisId: baseOut.card.analysisId, overrides: { offerPrice: 300000, interestRatePct: 6.5 } });
    assert.notEqual(next.isError, true);
    const out = WhatIfOutputSchema.parse(next.structuredContent);
    assert.equal(out.baseAnalysisId, baseOut.card.analysisId);
    assert.notEqual(out.card.analysisId, baseOut.card.analysisId);
    assert.ok(out.card.reportUrl.endsWith(out.card.analysisId));
    assert.notEqual(out.card.reportUrl, baseOut.card.reportUrl);
    assert.ok(out.rows.length >= 4);
    const cashFlow = out.rows.find((r) => r.metric === "monthlyCashFlow");
    assert.equal(cashFlow?.before, baseOut.card.metrics.monthlyCashFlow);
    assert.equal(cashFlow?.after, out.card.metrics.monthlyCashFlow);
    assert.equal(textOf(next), out.summary);
    assert.equal(out.card.analyzedPrice, 300000);
    assert.equal(analysisOf(next).baseAnalysisId, baseOut.card.analysisId);
    await client.close();
  });
});

describe("tool errors: stable codes in a ToolError-shaped JSON, isError true", () => {
  test("NEEDS_ADDRESS: no address, and a listing link alone", async () => {
    const client = await connectClient(testServer().app);
    const none = await call(client, "analyze_property", {});
    assert.equal(errorOf(none).code, "NEEDS_ADDRESS");
    assert.equal(none.isError, true);
    const link = await call(client, "analyze_property", { listing: { url: "https://www.example.test/home/1" } });
    assert.equal(errorOf(link).code, "NEEDS_ADDRESS");
    assert.match(errorOf(link).message, /street address/);
    await client.close();
  });

  test("AMBIGUOUS_ADDRESS carries the candidates", async () => {
    const client = await connectClient(testServer().app);
    const error = errorOf(await call(client, "analyze_property", { address: ADDR.ambiguous }));
    assert.equal(error.code, "AMBIGUOUS_ADDRESS");
    assert.ok((error.candidates?.length ?? 0) >= 2);
    await client.close();
  });

  test("INVALID_ASSUMPTION names the offending assumption field", async () => {
    const client = await connectClient(testServer().app);
    const error = errorOf(await call(client, "analyze_property", { address: ADDR.house, assumptions: { interestRatePct: 55 } }));
    assert.equal(error.code, "INVALID_ASSUMPTION");
    assert.equal(error.field, "interestRatePct");
    await client.close();
  });

  test("INVALID_ASSUMPTION for a wrongly typed value, and for a what_if with no overrides", async () => {
    const client = await connectClient(testServer().app);
    const typed = errorOf(await call(client, "analyze_property", { address: ADDR.house, assumptions: { offerPrice: "cheap" } }));
    assert.equal(typed.code, "INVALID_ASSUMPTION");
    assert.equal(typed.field, "offerPrice");

    const base = AnalyzePropertyOutputSchema.parse((await call(client, "analyze_property", { address: ADDR.house })).structuredContent);
    const empty = errorOf(await call(client, "what_if", { analysisId: base.card.analysisId, overrides: {} }));
    assert.equal(empty.code, "INVALID_ASSUMPTION");

    const bad = errorOf(await call(client, "what_if", { analysisId: base.card.analysisId, overrides: { downPaymentPct: 400 } }));
    assert.equal(bad.code, "INVALID_ASSUMPTION");
    assert.equal(bad.field, "downPaymentPct");
    await client.close();
  });

  test("NOT_FOUND: an unknown address, a missing analysis, and another user's analysis (indistinguishable)", async () => {
    const { app } = testServer();
    const alice = await connectClient(app, "alice");
    const bob = await connectClient(app, "bob");
    assert.equal(errorOf(await call(alice, "analyze_property", { address: ADDR.unknown })).code, "NOT_FOUND");

    const mine = AnalyzePropertyOutputSchema.parse((await call(alice, "analyze_property", { address: ADDR.house })).structuredContent);
    const theirs = errorOf(await call(bob, "what_if", { analysisId: mine.card.analysisId, overrides: { offerPrice: 250000 } }));
    const missing = errorOf(await call(bob, "what_if", { analysisId: "an_does_not_exist", overrides: { offerPrice: 250000 } }));
    assert.equal(theirs.code, "NOT_FOUND");
    assert.deepEqual(theirs, missing);
    await alice.close();
    await bob.close();
  });

  test("QUOTA_EXCEEDED carries upgradeUrl, used and limit, and runs no provider", async () => {
    const quota: QuotaGate = {
      reserve: async () => ({ ok: false, code: "QUOTA_EXCEEDED", message: "Monthly analyses used.", used: 3, limit: 3, upgradeUrl: "https://example.test/upgrade" }),
      release: async () => {},
    };
    const { app, repo } = testServer({ quota });
    const client = await connectClient(app);
    const error = errorOf(await call(client, "analyze_property", { address: ADDR.house }));
    assert.deepEqual(ToolErrorSchema.parse(error), {
      code: "QUOTA_EXCEEDED",
      message: "Monthly analyses used.",
      upgradeUrl: "https://example.test/upgrade",
      used: 3,
      limit: 3,
    });
    assert.equal((await repo.listUsage("user_a")).length, 0);
    await client.close();
  });

  test("INTERNAL: a persistence failure is generic, leaks nothing, and is not saved", async () => {
    const server = testServer();
    server.repo.createIfNew = async () => {
      throw new Error("firestore down: projects/secret-project/databases/(default)");
    };
    const client = await connectClient(server.app);
    const result = await call(client, "analyze_property", { address: ADDR.house });
    const error = errorOf(result);
    assert.equal(error.code, "INTERNAL");
    assert.ok(!JSON.stringify(result).includes("secret-project"));
    assert.ok(!JSON.stringify(result).includes("firestore"));
    await client.close();
  });

  test("INTERNAL: an exception escaping a handler is caught, logged, and sanitized (no stack, no message)", async () => {
    const boom: ToolDefinition = {
      ...(TOOLS[0] as ToolDefinition),
      handler: async () => {
        throw new Error("secret provider key sk-123 rejected");
      },
    };
    const server = testServer({ tools: [boom] });
    const client = await connectClient(server.app);
    const result = await call(client, "analyze_property", { address: ADDR.house });
    assert.equal(errorOf(result).code, "INTERNAL");
    assert.ok(!JSON.stringify(result).includes("sk-123"));
    assert.ok(!JSON.stringify(result).includes("at "), "no stack trace");
    assert.equal(server.logs[0]?.event, "mcp.tool_exception");
    await client.close();
  });

  test("every error code the pipeline can return maps to isError with a parseable ToolError", async () => {
    const client = await connectClient(testServer().app);
    const results = await Promise.all([
      call(client, "analyze_property", {}),
      call(client, "analyze_property", { address: ADDR.ambiguous }),
      call(client, "analyze_property", { address: ADDR.unknown }),
      call(client, "analyze_property", { address: ADDR.rural }),
      call(client, "analyze_property", { address: ADDR.house, assumptions: { interestRatePct: 55 } }),
    ]);
    const codes = results.map((r) => errorOf(r).code);
    assert.deepEqual(codes, ["NEEDS_ADDRESS", "AMBIGUOUS_ADDRESS", "NOT_FOUND", "NEEDS_RENT", "INVALID_ASSUMPTION"]);
    for (const r of results) assert.equal(r.isError, true);
    await client.close();
  });
});

describe("summary numbers", () => {
  /** Numbers as displayed in text, with the rounding error their displayed precision allows. */
  function tokens(text: string): Array<{ value: number; tolerance: number; raw: string }> {
    return [...text.matchAll(/(-?)(\$?)(\d[\d,]*(?:\.\d+)?)(%?)/g)].map((m) => {
      const digits = m[3] as string;
      const decimals = digits.includes(".") ? (digits.split(".")[1] as string).length : 0;
      return { value: Number(digits.replace(/,/g, "")) * (m[1] === "-" ? -1 : 1), tolerance: 0.5 * Math.pow(10, -decimals), raw: m[0] };
    });
  }
  function numbersIn(value: unknown, pool: number[] = []): number[] {
    if (typeof value === "number" && Number.isFinite(value)) pool.push(value);
    else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, pool));
    else if (value !== null && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, pool));
    return pool;
  }
  function assertTraceable(text: string, address: string, pool: number[]): void {
    for (const t of tokens(text.split(address).join(""))) {
      assert.ok(pool.some((p) => Math.abs(Math.abs(p) - Math.abs(t.value)) <= t.tolerance + 1e-9), `"${t.raw}" in the summary is not in the structured content or analysis:\n${text}`);
    }
  }

  test("every number in content[0].text appears in structuredContent or the saved analysis (analyze and what_if)", async () => {
    const client = await connectClient(testServer().app);
    for (const address of [ADDR.condo, ADDR.house]) {
      const r = await call(client, "analyze_property", { address });
      const out = AnalyzePropertyOutputSchema.parse(r.structuredContent);
      assert.ok(tokens(textOf(r)).length > 3, "the summary has numbers to check");
      assertTraceable(textOf(r), out.card.address, [...numbersIn(out.card), ...numbersIn(analysisOf(r))]);

      const w = await call(client, "what_if", { analysisId: out.card.analysisId, overrides: { offerPrice: 250000, interestRatePct: 6.25 } });
      const wo = WhatIfOutputSchema.parse(w.structuredContent);
      assertTraceable(textOf(w), wo.card.address, [...numbersIn(wo.card), ...numbersIn(wo.rows), ...numbersIn(analysisOf(w)), ...numbersIn(analysisOf(r))]);
    }
    await client.close();
  });

  test("the check has teeth: a doctored number is caught", async () => {
    const client = await connectClient(testServer().app);
    const r = await call(client, "analyze_property", { address: ADDR.house });
    const out = AnalyzePropertyOutputSchema.parse(r.structuredContent);
    const doctored = `${textOf(r)} Expected resale value $9,876,543.`;
    assert.throws(() => assertTraceable(doctored, out.card.address, [...numbersIn(out.card), ...numbersIn(analysisOf(r))]));
    await client.close();
  });
});

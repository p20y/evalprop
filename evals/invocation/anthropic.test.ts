import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOL_DESCRIPTIONS } from "@evalprop/shared";
import { API_URL, DEFAULT_MODEL, buildRequest, runAnthropic } from "./anthropic.ts";
import { loadPrompts, type EvalPrompt } from "./schema.ts";
import { buildTools } from "./tools.ts";

const prompts = loadPrompts();

/** A fetch that fails the test if it is ever called. */
const forbiddenFetch: typeof fetch = () => {
  throw new Error("fetch must not be called");
};

function reply(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}
const toolUse = (name: string): unknown => ({ content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "tu_1", name, input: {} }] });
const textOnly: unknown = { content: [{ type: "text", text: "sure" }] };

test("the advertised tools are the four shared tools with their descriptions and object schemas", () => {
  const tools = buildTools();
  assert.deepEqual(tools.map((t) => t.name), ["analyze_property", "what_if", "compare_properties", "create_report"]);
  for (const t of tools) {
    assert.equal(t.description, TOOL_DESCRIPTIONS[t.name]);
    assert.equal(t.input_schema.type, "object");
    assert.ok(!("$schema" in t.input_schema));
  }
  const analyze = tools[0]?.input_schema as unknown as { properties: Record<string, unknown>; required?: string[] };
  assert.ok("address" in analyze.properties && "listing" in analyze.properties);
  assert.ok(!(analyze.required ?? []).includes("targetCashOnCashPct"), "fields with defaults are optional in the input schema");
  const whatIf = tools[1]?.input_schema as unknown as { required?: string[] };
  assert.deepEqual([...(whatIf.required ?? [])].sort(), ["analysisId", "overrides"]);
});

test("buildRequest: user message, auto tool choice, context as a system note, no label leaked", () => {
  const plain: EvalPrompt = { id: "x1", prompt: "is this a good rental? 12 Oak St, Dayton OH 45402", expect: "analyze_property" };
  const r1 = buildRequest(plain, "m-1");
  assert.equal(r1.model, "m-1");
  assert.deepEqual(r1.tool_choice, { type: "auto" });
  assert.deepEqual(r1.messages, [{ role: "user", content: plain.prompt }]);
  assert.equal(r1.tools.length, 4);
  assert.doesNotMatch(r1.system, /Conversation so far/);

  const followUp: EvalPrompt = { id: "x2", prompt: "put 30% down instead", expect: "what_if", context: "An analysis for 12 Oak St (id an_zz9) was just shown." };
  const r2 = buildRequest(followUp, "m-1");
  assert.match(r2.system, /Conversation so far.*an_zz9/);
  assert.equal(r2.messages[0]?.content, "put 30% down instead");
  assert.ok(!JSON.stringify(r2).includes('"what_if"') || r2.tools.some((t) => t.name === "what_if"));
  assert.ok(!JSON.stringify(r2.messages).includes("expect"));
});

test("--dry-run builds one request per prompt without touching the network or needing a key", async () => {
  const out = await runAnthropic({ prompts, model: DEFAULT_MODEL, dryRun: true, fetchImpl: forbiddenFetch });
  assert.equal(out.requests.length, prompts.length);
  assert.deepEqual(out.results, []);
  prompts.forEach((p, i) => {
    assert.equal(out.requests[i]?.messages[0]?.content, p.prompt);
    assert.equal(out.requests[i]?.model, "claude-sonnet-5-5");
    if (p.context !== undefined) assert.ok(out.requests[i]?.system.includes(p.context));
  });
});

test("a live run posts to the Messages API with the key in a header only, and records the first tool", async () => {
  const subset = prompts.slice(0, 3);
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  const answers = [toolUse("analyze_property"), textOnly, toolUse("what_if")];
  let n = 0;
  const fetchImpl: typeof fetch = (url, init) => {
    seen.push({ url: String(url), headers: init?.headers as Record<string, string>, body: String(init?.body) });
    return Promise.resolve(reply(answers[n++]));
  };
  const out = await runAnthropic({ prompts: subset, model: "m-2", apiKey: "sk-test-secret", concurrency: 1, fetchImpl });
  assert.deepEqual(out.results.map((r) => [r.id, r.called]), [[subset[0]?.id, "analyze_property"], [subset[1]?.id, "none"], [subset[2]?.id, "what_if"]]);
  assert.equal(seen.length, 3);
  for (const s of seen) {
    assert.equal(s.url, API_URL);
    assert.equal(s.headers["x-api-key"], "sk-test-secret");
    assert.equal(s.headers["anthropic-version"], "2023-06-01");
    assert.ok(!s.body.includes("sk-test-secret"), "the key never goes in the body");
  }
  assert.ok(!JSON.stringify(out).includes("sk-test-secret"), "the key never appears in the output");
});

test("a live run needs a key", async () => {
  await assert.rejects(runAnthropic({ prompts: prompts.slice(0, 1), model: "m", fetchImpl: forbiddenFetch }), /ANTHROPIC_API_KEY/);
});

test("429 and 5xx are retried with a delay; the Retry-After header is honoured", async () => {
  const delays: number[] = [];
  const replies = [
    new Response("{}", { status: 429, headers: { "retry-after": "2" } }),
    new Response(JSON.stringify({ error: { type: "overloaded_error", message: "busy" } }), { status: 529 }),
    reply(toolUse("create_report")),
  ];
  let n = 0;
  const out = await runAnthropic({
    prompts: prompts.slice(0, 1),
    model: "m",
    apiKey: "k",
    fetchImpl: () => Promise.resolve(replies[n++] as Response),
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  });
  assert.equal(n, 3);
  assert.equal(out.results[0]?.called, "create_report");
  assert.equal(delays[0], 2000);
  assert.ok((delays[1] ?? 0) >= 2000, "exponential backoff grows");
});

test("a network error is retried; giving up records an error and the run continues", async () => {
  const subset = prompts.slice(0, 2);
  let calls = 0;
  const fetchImpl: typeof fetch = (_url, init) => {
    calls += 1;
    const first = String(init?.body).includes(JSON.stringify(subset[0]?.prompt));
    return first ? Promise.reject(new TypeError("fetch failed")) : Promise.resolve(reply(textOnly));
  };
  const out = await runAnthropic({ prompts: subset, model: "m", apiKey: "k", maxRetries: 2, fetchImpl, sleep: () => Promise.resolve(), concurrency: 1 });
  assert.equal(calls, 4, "three attempts for the first prompt, one for the second");
  assert.match(out.results[0]?.error ?? "", /gave up after 3 attempts.*fetch failed/);
  assert.equal(out.results[0]?.called, undefined);
  assert.equal(out.results[1]?.called, "none");
});

test("a 401 stops the run; a 400 is recorded for that prompt only", async () => {
  await assert.rejects(
    runAnthropic({
      prompts: prompts.slice(0, 5),
      model: "m",
      apiKey: "bad",
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401 })),
    }),
    /stopped: 401 authentication_error/,
  );
  let n = 0;
  const out = await runAnthropic({
    prompts: prompts.slice(0, 2),
    model: "bad-model",
    apiKey: "k",
    concurrency: 1,
    fetchImpl: () => Promise.resolve(n++ === 0 ? new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "unknown model" } }), { status: 400 }) : reply(textOnly)),
  });
  assert.match(out.results[0]?.error ?? "", /400 invalid_request_error: unknown model/);
  assert.equal(out.results[1]?.called, "none");
});

test("concurrency is capped at the requested number", async () => {
  let active = 0;
  let peak = 0;
  const fetchImpl: typeof fetch = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return reply(textOnly);
  };
  const out = await runAnthropic({ prompts: prompts.slice(0, 12), model: "m", apiKey: "k", concurrency: 4, fetchImpl });
  assert.equal(out.results.length, 12);
  assert.equal(peak, 4);
});

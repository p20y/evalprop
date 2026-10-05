import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type Deps } from "./run.ts";
import { loadPrompts } from "./schema.ts";

const prompts = loadPrompts();

function harness(env: Record<string, string | undefined> = {}, fetchImpl?: typeof fetch) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: Deps = {
    env,
    now: () => new Date("2026-10-04T12:34:56Z"),
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    sleep: () => Promise.resolve(),
  };
  if (fetchImpl !== undefined) deps.fetchImpl = fetchImpl;
  return { deps, out, err, dir: mkdtempSync(join(tmpdir(), "evalprop-inv-")) };
}

const neverFetch: typeof fetch = () => {
  throw new Error("fetch must not be called");
};

test("--mode manual writes sheet.md containing every prompt id", async () => {
  const h = harness();
  assert.equal(await main(["--mode", "manual", "--out", h.dir], h.deps), 0);
  const sheet = readFileSync(join(h.dir, "sheet.md"), "utf8");
  for (const p of prompts) assert.ok(sheet.includes(`### ${p.id}\n`), `sheet is missing ${p.id}`);
});

test("a leading '--' (as pnpm passes it) is ignored", async () => {
  const h = harness();
  assert.equal(await main(["--", "--mode", "manual", "--out", h.dir], h.deps), 0);
});

test("--mode anthropic --dry-run prints the payloads, calls no fetch, and needs no key", async () => {
  const h = harness({}, neverFetch);
  assert.equal(await main(["--mode", "anthropic", "--dry-run", "--limit", "7", "--out", h.dir], h.deps), 0);
  const lines = h.out;
  assert.match(lines[0] ?? "", /DRY RUN.*7 requests to claude-sonnet-5-5/);
  assert.ok(lines.some((l) => l.includes("analyze_property:")), "lists the tools");
  const payloads = lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as { id: string; model: string; tool_choice: unknown; messages: { role: string; content: string }[] });
  assert.equal(payloads.length, 7);
  for (const p of payloads) {
    assert.deepEqual(p.tool_choice, { type: "auto" });
    assert.equal(p.messages[0]?.role, "user");
  }
  assert.equal(readdirSync(h.dir).length, 0, "a dry run writes nothing");
});

test("--model overrides the default and shows in the dry-run payload", async () => {
  const h = harness({}, neverFetch);
  await main(["--mode", "anthropic", "--dry-run", "--limit", "1", "--model", "claude-test-1", "--out", h.dir], h.deps);
  assert.ok(h.out.some((l) => l.includes('"model":"claude-test-1"')));
});

test("anthropic mode without a key (and not a dry run) refuses and never calls fetch", async () => {
  const h = harness({}, neverFetch);
  assert.equal(await main(["--mode", "anthropic", "--limit", "2", "--out", h.dir], h.deps), 2);
  assert.match(h.err.join("\n"), /ANTHROPIC_API_KEY is not set/);
});

test("anthropic mode with a stub fetch scores the run and writes a results file without the key", async () => {
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text: "no tool" }] }), { status: 200 }));
  const h = harness({ ANTHROPIC_API_KEY: "sk-test-secret" }, fetchImpl);
  assert.equal(await main(["--mode", "anthropic", "--limit", "10", "--out", h.dir], h.deps), 0);
  const files = readdirSync(h.dir).filter((f) => f.startsWith("results-anthropic-"));
  assert.deepEqual(files, ["results-anthropic-20261004T123456Z.json"]);
  const text = readFileSync(join(h.dir, files[0] as string), "utf8");
  assert.ok(!text.includes("sk-test-secret"));
  const parsed = JSON.parse(text) as { model: string; results: unknown[]; score: { scored: number } };
  assert.equal(parsed.model, "claude-sonnet-5-5");
  assert.equal(parsed.results.length, 10);
  assert.equal(parsed.score.scored, 10);
  assert.ok(!h.out.join("\n").includes("sk-test-secret"));
  assert.match(h.out.join("\n"), /OVERALL FAIL/, "an assistant that never calls a tool fails the should-call target");
});

test("--score reads a results file, prints the table and writes results-<mode>-<timestamp>.json", async () => {
  const h = harness();
  const file = join(h.dir, "filled.json");
  writeFileSync(file, JSON.stringify(prompts.map((p) => ({ id: p.id, called: p.expect }))));
  assert.equal(await main(["--score", file, "--out", h.dir], h.deps), 0);
  assert.match(h.out.join("\n"), /OVERALL PASS/);
  assert.ok(readdirSync(h.dir).includes("results-manual-20261004T123456Z.json"));
});

test("--score reads a filled sheet.md", async () => {
  const h = harness();
  await main(["--mode", "manual", "--out", h.dir], h.deps);
  const sheetPath = join(h.dir, "sheet.md");
  let sheet = readFileSync(sheetPath, "utf8");
  for (const p of prompts) sheet = sheet.replace(new RegExp(`(### ${p.id}\\n[\\s\\S]*?\\ncalled: )`), `$1${p.expect}`);
  writeFileSync(sheetPath, sheet);
  h.out.length = 0;
  assert.equal(await main(["--score", sheetPath, "--out", h.dir], h.deps), 0);
  assert.ok(h.out.join("\n").includes(`Scored ${prompts.length} of ${prompts.length} prompts. Accuracy 100.0%`));
});

test("bad input gives a nonzero exit code and a message", async () => {
  const h = harness();
  assert.equal(await main([], h.deps), 2);
  assert.equal(await main(["--mode", "nonsense", "--out", h.dir], h.deps), 2);
  assert.equal(await main(["--bogus"], h.deps), 2);
  assert.equal(await main(["--mode", "anthropic", "--dry-run", "--limit", "0"], h.deps), 1);
  assert.equal(await main(["--score", join(h.dir, "does-not-exist.json")], h.deps), 1);
});

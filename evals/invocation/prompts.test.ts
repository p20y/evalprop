import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BALANCE_TOLERANCE,
  LABELS,
  MIN_COUNTS,
  NEEDS_CONTEXT,
  PromptSetSchema,
  TARGET_SHARE,
  countByLabel,
  loadPrompts,
  selectSubset,
  shuffled,
  type EvalPrompt,
} from "./schema.ts";

const prompts = loadPrompts();

test("prompts.json validates against the schema", () => {
  assert.ok(prompts.length >= 60, `expected at least 60 prompts, got ${prompts.length}`);
});

test("ids are unique", () => {
  assert.equal(new Set(prompts.map((p) => p.id)).size, prompts.length);
});

test("every class meets its minimum count", () => {
  const counts = countByLabel(prompts);
  for (const label of LABELS) assert.ok(counts[label] >= MIN_COUNTS[label], `${label}: ${counts[label]} < ${MIN_COUNTS[label]}`);
});

test("the mix is close to the intended balance", () => {
  const counts = countByLabel(prompts);
  for (const label of LABELS) {
    const share = counts[label] / prompts.length;
    assert.ok(Math.abs(share - TARGET_SHARE[label]) <= BALANCE_TOLERANCE, `${label}: ${(share * 100).toFixed(1)}% vs ${TARGET_SHARE[label] * 100}%`);
  }
});

test("what_if, compare_properties and create_report prompts all carry a context", () => {
  for (const p of prompts.filter((q) => NEEDS_CONTEXT.includes(q.expect))) {
    assert.ok(p.context !== undefined && p.context.length > 0, `${p.id} has no context`);
  }
});

test("follow-up contexts name an analysis id the tools could use", () => {
  for (const p of prompts.filter((q) => NEEDS_CONTEXT.includes(q.expect))) {
    assert.match(p.context ?? "", /\ban_[a-z0-9]+\b/, `${p.id}: context should include an analysis id like an_x1`);
  }
});

test("the schema rejects duplicate ids, unknown labels, missing contexts and short sets", () => {
  const base: EvalPrompt[] = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, prompt: `prompt ${i}`, expect: "none" }));
  assert.ok(PromptSetSchema.safeParse(base).success);
  assert.ok(!PromptSetSchema.safeParse(base.slice(0, 59)).success, "fewer than 60 prompts");
  assert.ok(!PromptSetSchema.safeParse([...base, { id: "p0", prompt: "dup", expect: "none" }]).success, "duplicate id");
  assert.ok(!PromptSetSchema.safeParse([...base, { id: "x", prompt: "x", expect: "buy_house" }]).success, "unknown label");
  assert.ok(!PromptSetSchema.safeParse([...base, { id: "w", prompt: "what if 6%", expect: "what_if" }]).success, "what_if without context");
  assert.ok(PromptSetSchema.safeParse([...base, { id: "w", prompt: "what if 6%", expect: "what_if", context: "analysis an_x was shown" }]).success);
});

test("coverage: links, pasted listings, injection, typos and negatives are all present", () => {
  const text = (p: EvalPrompt): string => p.prompt;
  const analyze = prompts.filter((p) => p.expect === "analyze_property");
  assert.ok(analyze.some((p) => /redfin\.com/.test(text(p))), "a Redfin link");
  assert.ok(analyze.some((p) => /zillow\.com/.test(text(p))), "a Zillow link");
  assert.ok(analyze.some((p) => /realtor\.com/.test(text(p))), "a Realtor link");
  assert.ok(analyze.some((p) => /\n/.test(text(p))), "pasted listing text");
  assert.ok(prompts.some((p) => /ignore previous instructions/i.test(text(p)) && p.expect === "analyze_property"), "an injection with an analyze ask");
  assert.ok(prompts.some((p) => /ignore previous instructions/i.test(text(p)) && p.expect === "none"), "an injection with a no-tool ask");
});

test("selectSubset keeps every class represented and is deterministic", () => {
  const a = selectSubset(prompts, 10);
  assert.equal(a.length, 10);
  assert.deepEqual(a.map((p) => p.id), selectSubset(prompts, 10).map((p) => p.id));
  assert.equal(new Set(a.map((p) => p.expect)).size, 5);
  assert.equal(selectSubset(prompts, undefined).length, prompts.length);
  assert.equal(selectSubset(prompts, 10_000).length, prompts.length);
});

test("shuffled keeps every prompt exactly once", () => {
  const s = shuffled(prompts);
  assert.equal(s.length, prompts.length);
  assert.equal(new Set(s.map((p) => p.id)).size, prompts.length);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPrompts } from "./schema.ts";
import { buildSheet, parseSheet } from "./sheet.ts";

const prompts = loadPrompts();
const sheet = buildSheet(prompts, new Date("2026-10-04T12:00:00Z"));

test("the sheet has a section for every prompt id, and the full prompt text", () => {
  for (const p of prompts) {
    assert.ok(sheet.includes(`### ${p.id}\n`), `missing ${p.id}`);
    assert.ok(sheet.includes(p.prompt), `missing prompt text for ${p.id}`);
    if (p.context !== undefined) assert.ok(sheet.includes(p.context), `missing set-up for ${p.id}`);
  }
  assert.equal(sheet.match(/^### /gm)?.length, prompts.length);
});

test("the sheet does not reveal the expected label", () => {
  // Only the instructions mention tool names; the per-prompt blocks must not.
  const body = sheet.split("## Prompts")[1] ?? "";
  for (const name of ["analyze_property", "what_if", "compare_properties", "create_report"]) {
    const inPromptText = prompts.some((p) => p.prompt.includes(name) || (p.context ?? "").includes(name));
    if (!inPromptText) assert.ok(!body.includes(name), `${name} leaked into the prompt section`);
  }
});

test("a blank sheet parses to no results; a filled one round-trips", () => {
  assert.deepEqual(parseSheet(sheet).results, []);

  const filled = sheet
    .replace("assistant:        ", "assistant: ChatGPT")
    .replace("model/version:    ", "model/version: GPT-test 1")
    .replace(/(### a01\n[\s\S]*?\ncalled: )/, "$1analyze_property")
    .replace(/(### n01\n[\s\S]*?\ncalled: )/, "$1`NONE`")
    .replace(/(### w01\n[\s\S]*?\ncalled: )(\nnotes: )/, "$1what_if$2then asked a question");
  const { results, meta } = parseSheet(filled);
  assert.deepEqual(results.map((r) => [r.id, r.called]).sort(), [["a01", "analyze_property"], ["n01", "none"], ["w01", "what_if"]]);
  assert.equal(results.find((r) => r.id === "w01")?.note, "then asked a question");
  assert.equal(meta.assistant, "ChatGPT");
  assert.equal(meta.model, "GPT-test 1");
});

test("an invalid answer names the prompt", () => {
  const bad = sheet.replace(/(### a02\n[\s\S]*?\ncalled: )/, "$1search_listings");
  assert.throws(() => parseSheet(bad), /prompt a02.*search_listings/);
});

test("a prompt containing 'called:' is not misread as an answer", () => {
  const tricky = buildSheet([{ id: "z1", prompt: "line one\ncalled: what_if\nline three", expect: "none" }]);
  assert.deepEqual(parseSheet(tricky).results, []);
});

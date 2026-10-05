import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvalPrompt, Label } from "./schema.ts";
import { formatScore, parseResults, scoreResults, type EvalResult } from "./score.ts";

const P = (id: string, expect: Label): EvalPrompt => ({ id, prompt: `prompt ${id}`, expect });
const R = (id: string, called: Label): EvalResult => ({ id, called });

// 10 prompts: 4 analyze, 2 what_if, 1 compare, 1 report, 2 none.
const prompts = [
  P("a1", "analyze_property"), P("a2", "analyze_property"), P("a3", "analyze_property"), P("a4", "analyze_property"),
  P("w1", "what_if"), P("w2", "what_if"),
  P("c1", "compare_properties"),
  P("r1", "create_report"),
  P("n1", "none"), P("n2", "none"),
];

test("hand-checked metrics on a small results set", () => {
  const results = [
    R("a1", "analyze_property"), R("a2", "analyze_property"), R("a3", "what_if"), R("a4", "none"),
    R("w1", "what_if"), R("w2", "what_if"),
    R("c1", "analyze_property"),
    R("r1", "create_report"),
    R("n1", "none"), R("n2", "analyze_property"),
  ];
  const s = scoreResults(prompts, results);
  assert.equal(s.scored, 10);
  assert.equal(s.accuracy, 0.6);

  const analyze = s.perTool.find((t) => t.tool === "analyze_property");
  // called analyze: a1, a2, c1, n2 = 4, of which a1 and a2 are right; expected 4.
  assert.deepEqual([analyze?.expected, analyze?.predicted, analyze?.truePositives], [4, 4, 2]);
  assert.equal(analyze?.precision, 0.5);
  assert.equal(analyze?.recall, 0.5);

  const whatIf = s.perTool.find((t) => t.tool === "what_if");
  // called what_if: a3, w1, w2 = 3, right: 2; expected 2.
  assert.equal(whatIf?.precision, 2 / 3);
  assert.equal(whatIf?.recall, 1);

  const compare = s.perTool.find((t) => t.tool === "compare_properties");
  assert.equal(compare?.precision, null, "never called, so precision is undefined");
  assert.equal(compare?.recall, 0);

  const report = s.perTool.find((t) => t.tool === "create_report");
  assert.equal(report?.precision, 1);
  assert.equal(report?.recall, 1);

  assert.equal(s.shouldCall.total, 8);
  assert.equal(s.shouldCall.correct, 5);
  assert.equal(s.shouldCall.rate, 5 / 8);
  assert.equal(s.none.total, 2);
  assert.equal(s.none.falsePositives, 1);
  assert.equal(s.none.rate, 0.5);

  assert.equal(s.confusion.analyze_property.what_if, 1);
  assert.equal(s.confusion.analyze_property.none, 1);
  assert.equal(s.confusion.compare_properties.analyze_property, 1);
  assert.equal(s.confusion.none.analyze_property, 1);

  assert.deepEqual(s.misses.map((m) => m.id), ["a3", "a4", "c1", "n2"]);
  assert.equal(s.misses[0]?.prompt, "prompt a3");
  assert.equal(s.targets.pass, false);
});

test("a perfect run passes both targets", () => {
  const s = scoreResults(prompts, prompts.map((p) => R(p.id, p.expect)));
  assert.equal(s.accuracy, 1);
  assert.equal(s.misses.length, 0);
  assert.equal(s.targets.shouldCallCorrect.pass, true);
  assert.equal(s.targets.noneFalsePositive.pass, true);
  assert.equal(s.targets.pass, true);
});

test("thresholds: 90% should-call and 5% false positives are inclusive", () => {
  const many: EvalPrompt[] = [
    ...Array.from({ length: 10 }, (_, i) => P(`a${i}`, "analyze_property")),
    ...Array.from({ length: 20 }, (_, i) => P(`n${i}`, "none")),
  ];
  const results = many.map((p) => R(p.id, p.expect));
  results[0] = R("a0", "none"); // 9/10 = 90%
  results[10] = R("n0", "analyze_property"); // 1/20 = 5%
  const s = scoreResults(many, results);
  assert.equal(s.targets.shouldCallCorrect.pass, true);
  assert.equal(s.targets.noneFalsePositive.pass, true);
  results[1] = R("a1", "none"); // 8/10
  results[11] = R("n1", "analyze_property"); // 2/20 = 10%
  const worse = scoreResults(many, results);
  assert.equal(worse.targets.shouldCallCorrect.pass, false);
  assert.equal(worse.targets.noneFalsePositive.pass, false);
});

test("a wrong tool on a should-call prompt is a miss, not a hit", () => {
  const s = scoreResults([P("w1", "what_if"), P("n1", "none")], [R("w1", "analyze_property"), R("n1", "none")]);
  assert.equal(s.shouldCall.correct, 0);
  assert.equal(s.shouldCall.rate, 0);
  assert.equal(s.targets.pass, false);
});

test("edge case: an assistant that never calls a tool (all none)", () => {
  const s = scoreResults(prompts, prompts.map((p) => R(p.id, "none")));
  for (const t of s.perTool) {
    assert.equal(t.predicted, 0);
    assert.equal(t.precision, null);
    assert.equal(t.recall, 0);
  }
  assert.equal(s.shouldCall.rate, 0);
  assert.equal(s.none.rate, 0);
  assert.equal(s.targets.shouldCallCorrect.pass, false);
  assert.equal(s.targets.noneFalsePositive.pass, true);
  assert.equal(s.accuracy, 0.2);
});

test("edge case: a prompt set with no none prompts or no should-call prompts has undefined rates and cannot pass", () => {
  const onlyTools = scoreResults([P("a1", "analyze_property")], [R("a1", "analyze_property")]);
  assert.equal(onlyTools.none.rate, null);
  assert.equal(onlyTools.targets.noneFalsePositive.pass, false);
  assert.equal(onlyTools.targets.pass, false);
  const onlyNone = scoreResults([P("n1", "none")], [R("n1", "none")]);
  assert.equal(onlyNone.shouldCall.rate, null);
  assert.equal(onlyNone.perTool.every((t) => t.recall === null), true);
  assert.equal(onlyNone.targets.pass, false);
});

test("empty results: nothing scored, nothing divides by zero", () => {
  const s = scoreResults(prompts, []);
  assert.equal(s.scored, 0);
  assert.equal(s.accuracy, null);
  assert.equal(s.missing.length, prompts.length);
  assert.equal(s.targets.pass, false);
  assert.doesNotThrow(() => formatScore(s));
});

test("missing and errored results are left out of the metrics; unknown ids are reported", () => {
  const s = scoreResults(prompts, [R("a1", "analyze_property"), { id: "a2", error: "429 rate limited" }, R("zz", "none")]);
  assert.equal(s.scored, 1);
  assert.equal(s.missing.length, 9);
  assert.ok(s.missing.includes("a2"));
  assert.deepEqual(s.unknown, ["zz"]);
  assert.equal(s.accuracy, 1);
});

test("duplicate result ids are rejected", () => {
  assert.throws(() => scoreResults(prompts, [R("a1", "none"), R("a1", "analyze_property")]), /duplicate result for id a1/);
});

test("parseResults accepts a bare array or a { results } object and rejects bad labels", () => {
  assert.deepEqual(parseResults([{ id: "a1", called: "none" }]), [{ id: "a1", called: "none" }]);
  assert.deepEqual(parseResults({ mode: "manual", results: [{ id: "a1", called: "what_if" }] }), [{ id: "a1", called: "what_if" }]);
  assert.throws(() => parseResults([{ id: "a1", called: "buy_it" }]), /invalid results file/);
  assert.throws(() => parseResults({ nope: 1 }), /invalid results file/);
});

test("formatScore prints the targets, a PASS/FAIL line and every miss with its prompt", () => {
  const failing = formatScore(scoreResults(prompts, prompts.map((p) => R(p.id, "none"))));
  assert.match(failing, /OVERALL FAIL/);
  assert.match(failing, /prompt a1/);
  assert.match(failing, /confusion/);
  const passing = formatScore(scoreResults(prompts, prompts.map((p) => R(p.id, p.expect))));
  assert.match(passing, /OVERALL PASS/);
  assert.doesNotMatch(passing, /misses \(/);
});

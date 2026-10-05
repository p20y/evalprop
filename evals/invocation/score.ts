import { z } from "zod";
import { LABELS, LabelSchema, TOOL_NAMES, type EvalPrompt, type Label, type ToolName } from "./schema.ts";

/** Story S13 targets. */
export const TARGETS = { shouldCallCorrectMin: 0.9, noneFalsePositiveMax: 0.05 } as const;

/** One recorded outcome. `called` is absent when the run failed for that prompt (see `error`). */
export const ResultSchema = z.object({
  id: z.string(),
  called: LabelSchema.optional(),
  /** Every tool the model called, in order (anthropic mode). `called` is the first. */
  calls: z.array(z.string()).optional(),
  error: z.string().optional(),
  note: z.string().optional(),
});
export type EvalResult = z.infer<typeof ResultSchema>;

export const ResultsFileSchema = z.union([
  z.array(ResultSchema),
  z.object({ results: z.array(ResultSchema) }).loose(),
]);

/** Accepts either a bare array or an object with a `results` array (what this runner writes). */
export function parseResults(raw: unknown): EvalResult[] {
  const parsed = ResultsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.slice(0, 5).map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`invalid results file (expected [{ id, called: tool|none }]):\n${lines.join("\n")}`);
  }
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.results;
}

export interface ToolMetrics {
  tool: ToolName;
  /** Prompts that expected this tool. */
  expected: number;
  /** Times the assistant called it. */
  predicted: number;
  truePositives: number;
  /** null when undefined: no predictions (precision) or no expectations (recall). */
  precision: number | null;
  recall: number | null;
}

export interface Miss {
  id: string;
  prompt: string;
  expect: Label;
  called: Label;
  context?: string;
  notes?: string;
}

export interface Score {
  /** Prompts with a usable result. */
  scored: number;
  total: number;
  /** Prompt ids with no result or an errored one. They are left out of every metric. */
  missing: string[];
  /** Result ids that match no prompt. */
  unknown: string[];
  accuracy: number | null;
  perTool: ToolMetrics[];
  /** matrix[expected][called] */
  confusion: Record<Label, Record<Label, number>>;
  shouldCall: { total: number; correct: number; rate: number | null };
  none: { total: number; falsePositives: number; rate: number | null };
  misses: Miss[];
  targets: {
    shouldCallCorrect: { value: number | null; target: number; pass: boolean };
    noneFalsePositive: { value: number | null; target: number; pass: boolean };
    pass: boolean;
  };
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

/**
 * Scores results against the prompt set. Duplicate result ids are an error (a filled-in file should have
 * one answer per prompt). A prompt with no result is reported under `missing` and not counted.
 */
export function scoreResults(prompts: readonly EvalPrompt[], results: readonly EvalResult[]): Score {
  const byId = new Map<string, EvalResult>();
  for (const r of results) {
    if (byId.has(r.id)) throw new Error(`duplicate result for id ${r.id}`);
    byId.set(r.id, r);
  }
  const promptIds = new Set(prompts.map((p) => p.id));
  const unknown = results.map((r) => r.id).filter((id) => !promptIds.has(id));

  const confusion = Object.fromEntries(
    LABELS.map((e) => [e, Object.fromEntries(LABELS.map((c) => [c, 0]))]),
  ) as Record<Label, Record<Label, number>>;
  const missing: string[] = [];
  const misses: Miss[] = [];
  let scored = 0;
  let correct = 0;

  for (const p of prompts) {
    const called = byId.get(p.id)?.called;
    if (called === undefined) {
      missing.push(p.id);
      continue;
    }
    scored += 1;
    confusion[p.expect][called] += 1;
    if (called === p.expect) correct += 1;
    else {
      const miss: Miss = { id: p.id, prompt: p.prompt, expect: p.expect, called };
      if (p.context !== undefined) miss.context = p.context;
      if (p.notes !== undefined) miss.notes = p.notes;
      misses.push(miss);
    }
  }

  const perTool: ToolMetrics[] = TOOL_NAMES.map((tool) => {
    const truePositives = confusion[tool][tool];
    const expected = LABELS.reduce((sum, c) => sum + confusion[tool][c], 0);
    const predicted = LABELS.reduce((sum, e) => sum + confusion[e][tool], 0);
    return { tool, expected, predicted, truePositives, precision: ratio(truePositives, predicted), recall: ratio(truePositives, expected) };
  });

  const shouldCallTotal = perTool.reduce((sum, t) => sum + t.expected, 0);
  const shouldCallCorrect = perTool.reduce((sum, t) => sum + t.truePositives, 0);
  const noneTotal = LABELS.reduce((sum, c) => sum + confusion.none[c], 0);
  const noneFalsePositives = noneTotal - confusion.none.none;

  const shouldCallRate = ratio(shouldCallCorrect, shouldCallTotal);
  const noneRate = ratio(noneFalsePositives, noneTotal);
  const shouldCallPass = shouldCallRate !== null && shouldCallRate >= TARGETS.shouldCallCorrectMin;
  const nonePass = noneRate !== null && noneRate <= TARGETS.noneFalsePositiveMax;

  return {
    scored,
    total: prompts.length,
    missing,
    unknown,
    accuracy: ratio(correct, scored),
    perTool,
    confusion,
    shouldCall: { total: shouldCallTotal, correct: shouldCallCorrect, rate: shouldCallRate },
    none: { total: noneTotal, falsePositives: noneFalsePositives, rate: noneRate },
    misses,
    targets: {
      shouldCallCorrect: { value: shouldCallRate, target: TARGETS.shouldCallCorrectMin, pass: shouldCallPass },
      noneFalsePositive: { value: noneRate, target: TARGETS.noneFalsePositiveMax, pass: nonePass },
      pass: shouldCallPass && nonePass,
    },
  };
}

const pct = (v: number | null): string => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);

/** A compact plain-text report: headline, per-tool table, confusion matrix, targets, misses. */
export function formatScore(score: Score): string {
  const lines: string[] = [];
  lines.push(`Scored ${score.scored} of ${score.total} prompts. Accuracy ${pct(score.accuracy)}.`);
  if (score.missing.length > 0) lines.push(`Not scored (no result): ${score.missing.length} (${score.missing.slice(0, 12).join(", ")}${score.missing.length > 12 ? ", ..." : ""})`);
  if (score.unknown.length > 0) lines.push(`Ignored results with unknown ids: ${score.unknown.join(", ")}`);
  lines.push("");

  const pad = (s: string, n: number): string => s.padEnd(n);
  const padL = (s: string, n: number): string => s.padStart(n);
  lines.push(`${pad("tool", 20)}${padL("expected", 9)}${padL("called", 8)}${padL("hit", 5)}${padL("precision", 11)}${padL("recall", 9)}`);
  for (const t of score.perTool) {
    lines.push(`${pad(t.tool, 20)}${padL(String(t.expected), 9)}${padL(String(t.predicted), 8)}${padL(String(t.truePositives), 5)}${padL(pct(t.precision), 11)}${padL(pct(t.recall), 9)}`);
  }
  lines.push("");

  lines.push("confusion (rows = expected, columns = called)");
  const short: Record<Label, string> = { analyze_property: "analyze", what_if: "what_if", compare_properties: "compare", create_report: "report", none: "none" };
  lines.push(`${pad("", 20)}${LABELS.map((l) => padL(short[l], 9)).join("")}`);
  for (const e of LABELS) lines.push(`${pad(e, 20)}${LABELS.map((c) => padL(String(score.confusion[e][c]), 9)).join("")}`);
  lines.push("");

  const t = score.targets;
  const verdict = (pass: boolean): string => (pass ? "PASS" : "FAIL");
  lines.push(`should-call correct   ${pad(`${score.shouldCall.correct}/${score.shouldCall.total} = ${pct(t.shouldCallCorrect.value)}`, 20)} target >= ${pct(t.shouldCallCorrect.target)}  ${verdict(t.shouldCallCorrect.pass)}`);
  lines.push(`none false positives  ${pad(`${score.none.falsePositives}/${score.none.total} = ${pct(t.noneFalsePositive.value)}`, 20)} target <= ${pct(t.noneFalsePositive.target)}  ${verdict(t.noneFalsePositive.pass)}`);
  lines.push(`OVERALL ${verdict(t.pass)}`);

  if (score.misses.length > 0) {
    lines.push("", `misses (${score.misses.length})`);
    for (const m of score.misses) {
      const text = m.prompt.replace(/\s+/g, " ");
      lines.push(`  ${m.id}: expected ${m.expect}, called ${m.called}`);
      lines.push(`      ${text.length > 160 ? `${text.slice(0, 157)}...` : text}`);
    }
  }
  return lines.join("\n");
}

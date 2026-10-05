import { readFileSync } from "node:fs";
import { z } from "zod";

/** The four tools of ARCHITECTURE §5.1, in a fixed order used for tables and matrices. */
export const TOOL_NAMES = ["analyze_property", "what_if", "compare_properties", "create_report"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** What a prompt should lead to ("none" = the assistant should answer without calling any tool). */
export const LABELS = [...TOOL_NAMES, "none"] as const;
export type Label = (typeof LABELS)[number];
export const LabelSchema = z.enum(LABELS);

export const PromptSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/, "ids are lowercase letters, digits, - or _"),
  prompt: z.string().min(1),
  expect: LabelSchema,
  /** Prior conversation state for follow-ups, e.g. "an analysis for ... (id an_x) was just shown". */
  context: z.string().min(1).optional(),
  notes: z.string().optional(),
});
export type EvalPrompt = z.infer<typeof PromptSchema>;

/** Tools that only make sense after an analysis exists, so the prompt must say what was shown. */
export const NEEDS_CONTEXT: readonly Label[] = ["what_if", "compare_properties", "create_report"];

/** Minimum counts per class, and the intended mix (each share may drift by `BALANCE_TOLERANCE`). */
export const MIN_COUNTS: Record<Label, number> = { analyze_property: 30, what_if: 10, compare_properties: 4, create_report: 4, none: 25 };
export const TARGET_SHARE: Record<Label, number> = { analyze_property: 0.4, what_if: 0.15, compare_properties: 0.05, create_report: 0.05, none: 0.35 };
export const BALANCE_TOLERANCE = 0.06;
export const MIN_PROMPTS = 60;

export const PromptSetSchema = z.array(PromptSchema).min(MIN_PROMPTS).superRefine((prompts, ctx) => {
  const seen = new Set<string>();
  prompts.forEach((p, i) => {
    if (seen.has(p.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: `duplicate id ${p.id}` });
    seen.add(p.id);
    if (NEEDS_CONTEXT.includes(p.expect) && p.context === undefined) {
      ctx.addIssue({ code: "custom", path: [i, "context"], message: `${p.expect} prompts need a context (${p.id})` });
    }
  });
});

export const DEFAULT_PROMPTS_PATH = new URL("./prompts.json", import.meta.url);

/** Counts per label. */
export function countByLabel(prompts: readonly EvalPrompt[]): Record<Label, number> {
  const counts = Object.fromEntries(LABELS.map((l) => [l, 0])) as Record<Label, number>;
  for (const p of prompts) counts[p.expect] += 1;
  return counts;
}

/** Reads and validates a prompt file. Throws a readable error if it is invalid. */
export function loadPrompts(path: string | URL = DEFAULT_PROMPTS_PATH): EvalPrompt[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = PromptSetSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.slice(0, 10).map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`invalid prompt set:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

/**
 * A deterministic subset of size `n` that keeps every class represented: round-robin across the labels
 * in file order, so `--limit 10` is not just ten "analyze" prompts. `n` at or above the total returns all.
 */
export function selectSubset(prompts: readonly EvalPrompt[], n: number | undefined): EvalPrompt[] {
  if (n === undefined || n >= prompts.length) return [...prompts];
  const buckets = LABELS.map((l) => prompts.filter((p) => p.expect === l)).filter((b) => b.length > 0);
  const out: EvalPrompt[] = [];
  for (let round = 0; out.length < n; round++) {
    for (const bucket of buckets) {
      const next = bucket[round];
      if (next !== undefined && out.length < n) out.push(next);
    }
  }
  return out;
}

/** A fixed pseudo-random order (FNV-1a of the id), so sheets do not group prompts by class. */
export function shuffled(prompts: readonly EvalPrompt[]): EvalPrompt[] {
  const hash = (s: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h;
  };
  return [...prompts].sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id));
}

import { LABELS, shuffled, type EvalPrompt } from "./schema.ts";
import type { EvalResult } from "./score.ts";

/** What the tester records for a prompt. */
const CHOICES = LABELS.join(" | ");

/**
 * The manual test sheet: a Markdown checklist for running the prompts against a real assistant with the
 * connector installed. The expected label is deliberately not shown, so the tester is not primed.
 * The order is a fixed shuffle so the sheet does not group prompts by class.
 */
export function buildSheet(prompts: readonly EvalPrompt[], generatedAt: Date = new Date()): string {
  const out: string[] = [];
  out.push("# Invocation eval sheet", "");
  out.push(`Generated ${generatedAt.toISOString()} for ${prompts.length} prompts.`, "");
  out.push("Fill in the header, then work through every prompt in a fresh chat (new conversation per prompt unless it has a **Set up** line).", "");
  out.push("assistant:        ", "model/version:    ", "date:             ", "connector build:  ", "");
  out.push("## How to record", "");
  out.push(
    "1. Install the evalprop connector in the assistant. Do not mention evalprop or its tools in any prompt.",
    "2. Send the prompt exactly as written (copy the whole code block).",
    "3. Write which tool the assistant called on the `called:` line, using one of: " + `\`${CHOICES}\`.` + " If it asked a clarifying question or answered without a tool, write `none`. If it called several tools, record the **first** and put the rest in `notes:`.",
    "4. If a prompt has a **Set up** line, first get the assistant into that state (run a real analysis with the connector, for example), then send the prompt.",
    "5. Score the filled sheet: `pnpm eval:invocation -- --score evals/invocation/out/sheet.md`.",
    "",
  );
  out.push("## Prompts", "");
  for (const p of shuffled(prompts)) {
    out.push(`### ${p.id}`, "");
    if (p.context !== undefined) out.push(`**Set up:** ${p.context}`, "");
    out.push("```text", p.prompt, "```", "");
    out.push(`called: `, `notes: `, "");
  }
  return out.join("\n");
}

export interface SheetMeta {
  assistant?: string;
  model?: string;
  date?: string;
  connector?: string;
}

/**
 * Reads a filled-in sheet back into results. A prompt whose `called:` line is empty is treated as not
 * answered (it is left out of the results, so the scorer reports it as missing). A value outside the
 * allowed choices is an error naming the prompt.
 */
export function parseSheet(markdown: string): { results: EvalResult[]; meta: SheetMeta } {
  const labels = new Set<string>(LABELS);
  const results: EvalResult[] = [];
  const meta: SheetMeta = {};

  const header = markdown.split(/^## /m)[0] ?? "";
  const field = (name: string): string | undefined => {
    const m = new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(header);
    const v = m?.[1]?.trim();
    return v === undefined || v === "" ? undefined : v;
  };
  const assistant = field("assistant");
  const model = field("model/version");
  const date = field("date");
  const connector = field("connector build");
  if (assistant !== undefined) meta.assistant = assistant;
  if (model !== undefined) meta.model = model;
  if (date !== undefined) meta.date = date;
  if (connector !== undefined) meta.connector = connector;

  const blocks = markdown.split(/^### /m).slice(1);
  for (const block of blocks) {
    const id = block.split("\n", 1)[0]?.trim() ?? "";
    // Only look after the prompt's code fence, so a prompt containing "called:" cannot be misread.
    const afterFence = block.replace(/```text[\s\S]*?\n```/, "");
    const called = /^called:[ \t]*(.*)$/m.exec(afterFence)?.[1]?.trim().replace(/^`|`$/g, "").toLowerCase() ?? "";
    const note = /^notes:[ \t]*(.*)$/m.exec(afterFence)?.[1]?.trim();
    if (called === "") continue;
    if (!labels.has(called)) throw new Error(`prompt ${id}: "called: ${called}" is not one of ${CHOICES}`);
    const result: EvalResult = { id, called: called as EvalResult["called"] };
    if (note !== undefined && note !== "") result.note = note;
    results.push(result);
  }
  return { results, meta };
}

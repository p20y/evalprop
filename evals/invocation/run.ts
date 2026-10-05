import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_MODEL, runAnthropic } from "./anthropic.ts";
import { DEFAULT_PROMPTS_PATH, loadPrompts, selectSubset, type EvalPrompt } from "./schema.ts";
import { formatScore, parseResults, scoreResults, type EvalResult } from "./score.ts";
import { buildSheet, parseSheet, type SheetMeta } from "./sheet.ts";
import { buildTools } from "./tools.ts";

/**
 * Invocation eval runner (story S13, ARCHITECTURE §5.2 and §13).
 *
 *   pnpm eval:invocation -- --mode manual                  write out/sheet.md for a human to fill in
 *   pnpm eval:invocation -- --score <file.json|sheet.md>   score a filled results file or sheet
 *   pnpm eval:invocation -- --mode anthropic [--model m] [--limit n] [--dry-run]
 *
 * Anthropic mode makes real, paid API calls, only when run explicitly. It reads ANTHROPIC_API_KEY from the
 * environment and nowhere else. `pnpm test` never runs it.
 */

const USAGE = `usage:
  run.ts --mode manual                     write out/sheet.md (a checklist to fill in against a real assistant)
  run.ts --score <file.json|sheet.md>      score a results file ([{ id, called }]) or a filled sheet
  run.ts --mode anthropic [options]        call the Anthropic Messages API (paid; needs ANTHROPIC_API_KEY)

options:
  --model <id>        model for anthropic mode (default ${DEFAULT_MODEL})
  --limit <n>         only the first n prompts, spread across classes
  --concurrency <n>   parallel requests (default 4)
  --dry-run           print the requests that would be sent; no network, no key needed
  --out <dir>         output directory (default evals/invocation/out)
  --prompts <file>    prompt set (default evals/invocation/prompts.json)`;

export interface Deps {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now: () => Date;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultDeps = (): Deps => ({
  env: process.env,
  now: () => new Date(),
  stdout: (l) => console.log(l),
  stderr: (l) => console.error(l),
});

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

function positiveInt(name: string, v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
}

function scoreAndWrite(opts: {
  prompts: EvalPrompt[];
  results: EvalResult[];
  mode: string;
  outDir: string;
  deps: Deps;
  extra?: Record<string, unknown>;
}): number {
  const { prompts, results, mode, outDir, deps } = opts;
  const score = scoreResults(prompts, results);
  const createdAt = deps.now();
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `results-${mode}-${stamp(createdAt)}.json`);
  writeFileSync(file, `${JSON.stringify({ mode, createdAt: createdAt.toISOString(), ...opts.extra, score, results }, null, 2)}\n`);
  deps.stdout(formatScore(score));
  deps.stdout("");
  deps.stdout(`wrote ${file}`);
  return 0;
}

/** Runs the CLI. Returns the process exit code. */
export async function main(argv: string[], deps: Deps = defaultDeps()): Promise<number> {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        mode: { type: "string" },
        score: { type: "string" },
        model: { type: "string" },
        limit: { type: "string" },
        concurrency: { type: "string" },
        "dry-run": { type: "boolean" },
        out: { type: "string" },
        prompts: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }));
  } catch (err) {
    deps.stderr(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    return 2;
  }
  if (values.help === true || (values.mode === undefined && values.score === undefined)) {
    deps.stdout(USAGE);
    return values.help === true ? 0 : 2;
  }

  try {
    const outDir = values.out ?? new URL("./out/", import.meta.url).pathname;
    const prompts = loadPrompts(values.prompts ?? DEFAULT_PROMPTS_PATH);

    if (values.score !== undefined) {
      const text = readFileSync(values.score, "utf8");
      let results: EvalResult[];
      let meta: SheetMeta | undefined;
      let mode = values.mode ?? "manual";
      if (values.score.endsWith(".md")) {
        ({ results, meta } = parseSheet(text));
      } else {
        const raw: unknown = JSON.parse(text);
        results = parseResults(raw);
        if (values.mode === undefined && typeof raw === "object" && raw !== null && "mode" in raw && typeof raw.mode === "string") mode = raw.mode;
      }
      return scoreAndWrite({ prompts, results, mode, outDir, deps, extra: meta === undefined ? {} : { meta } });
    }

    if (values.mode === "manual") {
      mkdirSync(outDir, { recursive: true });
      const file = join(outDir, "sheet.md");
      writeFileSync(file, buildSheet(prompts, deps.now()));
      deps.stdout(`wrote ${file} (${prompts.length} prompts)`);
      deps.stdout("Fill it in against a real assistant, then: pnpm eval:invocation -- --score " + file);
      return 0;
    }

    if (values.mode === "anthropic") {
      const subset = selectSubset(prompts, positiveInt("limit", values.limit));
      const model = values.model ?? DEFAULT_MODEL;
      const dryRun = values["dry-run"] === true;
      const concurrency = positiveInt("concurrency", values.concurrency) ?? 4;

      if (dryRun) {
        const { requests } = await runAnthropic({ prompts: subset, model, dryRun: true });
        deps.stdout(`DRY RUN: nothing is sent. ${requests.length} requests to ${model}, tool_choice auto, concurrency ${concurrency}.`);
        deps.stdout("tools (identical in every request):");
        for (const t of buildTools()) deps.stdout(`  ${t.name}: ${t.description}`);
        subset.forEach((p, i) => {
          const r = requests[i];
          if (r === undefined) return;
          deps.stdout(JSON.stringify({ id: p.id, model: r.model, max_tokens: r.max_tokens, tool_choice: r.tool_choice, system: r.system, messages: r.messages }));
        });
        return 0;
      }

      const apiKey = deps.env.ANTHROPIC_API_KEY;
      if (apiKey === undefined || apiKey === "") {
        deps.stderr("ANTHROPIC_API_KEY is not set. Export it in your shell (never put it in a file in the repo) and re-run, or use --dry-run.");
        return 2;
      }
      deps.stderr(`calling ${model} for ${subset.length} prompts (paid API calls, concurrency ${concurrency})...`);
      const runOpts: Parameters<typeof runAnthropic>[0] = {
        prompts: subset,
        model,
        apiKey,
        concurrency,
        onProgress: (done, total) => {
          if (done % 10 === 0 || done === total) deps.stderr(`  ${done}/${total}`);
        },
      };
      if (deps.fetchImpl !== undefined) runOpts.fetchImpl = deps.fetchImpl;
      if (deps.sleep !== undefined) runOpts.sleep = deps.sleep;
      const { results } = await runAnthropic(runOpts);
      const errors = results.filter((r) => r.error !== undefined);
      if (errors.length > 0) deps.stderr(`${errors.length} prompts failed (recorded as errors, not scored): ${errors.slice(0, 3).map((e) => `${e.id}: ${e.error}`).join("; ")}`);
      return scoreAndWrite({ prompts: subset, results, mode: "anthropic", outDir, deps, extra: { model } });
    }

    deps.stderr(`unknown --mode ${values.mode}\n${USAGE}`);
    return 2;
  } catch (err) {
    deps.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}

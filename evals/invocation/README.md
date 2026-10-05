# Invocation evals (story S13)

Does the assistant call the right evalprop tool, without being told to, and stay quiet when it should? `prompts.json` holds 100 labelled user prompts; the runner scores an assistant's choices against them. Background: ARCHITECTURE §5.2 and §13.

Each prompt has an `expect` label: `analyze_property`, `what_if`, `compare_properties`, `create_report`, or `none` (no tool should be called). Follow-ups (`what_if`, `compare_properties`, `create_report`, and some negatives) carry a `context` describing the conversation state, such as "an analysis for 4417 S Quincy Ave (id an_q7x2) was just shown". The mix is about 40% analyze, 15% what_if, 5% compare, 5% report, 35% none, and includes pasted listing links, pasted listing text, typos, prompt-injection text inside a listing paste, and near-misses (tenant questions, tax and legal questions, "scrape this", "email the agent").

**Targets (S13):** at least 90% of should-call prompts call the right tool, and at most 5% of `none` prompts call any tool.

## Manual mode (ChatGPT or any other MCP client)

```bash
pnpm eval:invocation -- --mode manual      # writes evals/invocation/out/sheet.md (git-ignored)
```

1. Install the evalprop connector in the assistant (ChatGPT developer mode, or another MCP client). Fill in the header of the sheet: assistant, model/version, date, connector build.
2. For each prompt, start a fresh chat, paste the prompt exactly, and write on the `called:` line the **first** tool the assistant called: `analyze_property`, `what_if`, `compare_properties`, `create_report`, or `none`. A clarifying question or a plain answer is `none`. Put anything odd (several tools, wrong arguments, raw JSON relayed to the user) on the `notes:` line.
3. Prompts with a **Set up** line need the conversation in that state first: run a real analysis with the connector, then send the prompt. Use the real analysis id the connector returned if the assistant needs it.
4. Do not mention evalprop or tool names in prompts. The point is to test whether the assistant chooses the tool on its own.
5. Score the filled sheet (or a JSON file of `[{ "id": "a01", "called": "analyze_property" }, ...]`):

```bash
pnpm eval:invocation -- --score evals/invocation/out/sheet.md
```

Prompts left blank are reported as "not scored" and excluded from the metrics, so a partial run still gives numbers.

## Anthropic mode (opt-in, paid)

Sends each prompt to the Anthropic Messages API with the four tools (built from `@evalprop/shared`: `TOOL_DESCRIPTIONS` plus the input schemas as JSON Schema), `tool_choice: auto`, and the prompt's `context` as a system note. It records which tool the model called first. This is a cheap, repeatable proxy for the descriptions; it is not a substitute for the real-assistant runs, because ChatGPT and others add their own system prompts and tool-selection logic.

```bash
pnpm eval:invocation -- --mode anthropic --dry-run                 # print what would be sent; no key, no network
export ANTHROPIC_API_KEY=...                                       # in your shell only; never in a file in the repo
pnpm eval:invocation -- --mode anthropic --limit 10                # a small, class-balanced sample first
pnpm eval:invocation -- --mode anthropic --model claude-sonnet-5-5 # all 100 prompts (default model shown)
```

This makes real, paid API calls. `pnpm test` never does: the tests inject a fetch stub. The key is read only from the environment and is never logged or written to the results file. Requests run 4 at a time and retry on 429 and 5xx; a prompt that still fails is recorded as an error and left out of the metrics, and a 401 or 403 stops the run.

## Reading the results

Both modes print a table and write `out/results-<mode>-<timestamp>.json` (the raw results plus the full score, so a run can be re-scored later with `--score`).

- **Per tool:** `expected` (prompts that should call it), `called` (times it was called), `precision` (of the calls, how many were right), `recall` (of the prompts that should call it, how many did). `n/a` means no calls, or no prompts, for that tool.
- **Confusion matrix:** rows are what was expected, columns what happened. Look at the off-diagonal cells: `none` row, `analyze` column is a false positive (the assistant called a tool when it should not have); `analyze` row, `none` column is a miss.
- **Targets:** the should-call rate and the none false-positive rate with PASS or FAIL against S13's thresholds. A rate with no prompts behind it is `n/a` and counts as FAIL.
- **Misses:** every wrong answer with its prompt text, so you can see which phrasing the description fails on.

## What remains for the product owner

This part of S13 is the offline tooling and the prompt set. Still open, because they need real assistants and accounts:

1. Run manual mode against ChatGPT (and any other MCP client available) with the connector installed, and record the model/version, date, and the scores in the S13 Outcome block.
2. Use the misses to tune the tool descriptions (and field descriptions, F35) in `packages/shared/src/tools.ts`: when to use and when not to, plus one worked example call. Re-run after each change until the targets are met, or explain in the PR why they cannot be.
3. Optionally run anthropic mode between assistant runs to check a description change cheaply.
4. Watch the notes for assistants relaying raw JSON errors (F36) or failing to pass an address read from a link (F25).

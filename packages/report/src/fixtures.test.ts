import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fixtureModels } from "./fixtures.ts";
import { renderReport } from "./render.ts";

/**
 * Snapshot tests: the rendered HTML of three fixture reports (strong, marginal, degraded) is committed under
 * `evals/report-fixtures/` and compared byte for byte (after `normalize`). The same files are what the
 * product owner opens to review the design. Regenerate on purpose with:
 *
 *   pnpm --filter @evalprop/report fixtures:update
 */
const DIR = fileURLToPath(new URL("../../../evals/report-fixtures/", import.meta.url));
const UPDATE = process.env.UPDATE_FIXTURES === "1";

/** Stable normalizer so snapshots never churn on line endings or trailing whitespace. */
export function normalize(html: string): string {
  return html
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim()
    .concat("\n");
}

for (const [name, model] of Object.entries(fixtureModels())) {
  test(`snapshot: ${name} report HTML matches evals/report-fixtures/${name}.html`, () => {
    const file = `${DIR}${name}.html`;
    const actual = normalize(renderReport(model));
    if (UPDATE) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(file, actual);
      return;
    }
    assert.ok(existsSync(file), `missing snapshot ${file}; run: pnpm --filter @evalprop/report fixtures:update`);
    assert.equal(actual, readFileSync(file, "utf8"), `${name}.html is out of date; if the change is intended run: pnpm --filter @evalprop/report fixtures:update`);
  });
}

test("rendering is deterministic: the same model renders byte-identical HTML twice", () => {
  const m = fixtureModels().strong;
  assert.equal(renderReport(m), renderReport(m));
});

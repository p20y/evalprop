import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ENGINE_VERSION, evaluate } from "./index.ts";
import { REFERENCE_DEALS } from "./reference-deals.ts";
import { snapshotText } from "./snapshot-format.ts";

const snapshotFile = new URL("./reference-deals.snapshot.json", import.meta.url);

test("ENGINE_VERSION is a semver string", () => {
  assert.match(ENGINE_VERSION, /^\d+\.\d+\.\d+$/);
});

test("reference-deal snapshot matches the engine; if not, bump ENGINE_VERSION", () => {
  const recorded = readFileSync(snapshotFile, "utf8");
  const current = snapshotText(
    ENGINE_VERSION,
    REFERENCE_DEALS.map((d) => ({ name: d.name, input: d.input, evaluation: evaluate(d.input) })),
  );
  if (recorded === current) return;

  const recordedVersion = (JSON.parse(recorded) as { engineVersion: string }).engineVersion;
  const advice =
    recordedVersion === ENGINE_VERSION
      ? `The engine's output for the reference deals changed but ENGINE_VERSION is still ${ENGINE_VERSION}. ` +
        "A formula, default, or threshold changed: bump ENGINE_VERSION in packages/engine/src/version.ts, " +
        "update the golden cases in evals/golden/ if needed, then run `pnpm --filter @evalprop/engine snapshot:update`."
      : `ENGINE_VERSION is ${ENGINE_VERSION} but the snapshot was recorded at ${recordedVersion} and no longer matches. ` +
        "Run `pnpm --filter @evalprop/engine snapshot:update` to record the new output.";
  assert.fail(advice);
});

test("snapshot was recorded at the current ENGINE_VERSION", () => {
  const recorded = JSON.parse(readFileSync(snapshotFile, "utf8")) as { engineVersion: string; deals: unknown[] };
  assert.equal(recorded.engineVersion, ENGINE_VERSION, "bump or regenerate: see snapshot:update");
  assert.equal(recorded.deals.length, 3);
});

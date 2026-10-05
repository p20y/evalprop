// Regenerates src/reference-deals.snapshot.json from the current engine.
//
//   pnpm --filter @evalprop/engine snapshot:update
//
// Refuses to overwrite a changed snapshot unless ENGINE_VERSION was bumped first: the snapshot records the
// version it was generated with, and a change in output at the same version means the bump was forgotten.
import { readFileSync, writeFileSync } from "node:fs";
import { evaluate, ENGINE_VERSION } from "../src/index.ts";
import { REFERENCE_DEALS } from "../src/reference-deals.ts";
import { snapshotText } from "../src/snapshot-format.ts";

const file = new URL("../src/reference-deals.snapshot.json", import.meta.url);
const next = snapshotText(
  ENGINE_VERSION,
  REFERENCE_DEALS.map((d) => ({ name: d.name, input: d.input, evaluation: evaluate(d.input) })),
);

let previous: { engineVersion?: string } | null = null;
try {
  previous = JSON.parse(readFileSync(file, "utf8")) as { engineVersion?: string };
  const unchanged = readFileSync(file, "utf8") === next;
  if (unchanged) {
    console.log(`Snapshot already up to date at ENGINE_VERSION ${ENGINE_VERSION}.`);
    process.exit(0);
  }
} catch {
  // no snapshot yet
}

if (previous?.engineVersion === ENGINE_VERSION) {
  console.error(
    `Engine output changed but ENGINE_VERSION is still ${ENGINE_VERSION}. Bump ENGINE_VERSION in ` +
      `packages/engine/src/version.ts (and update evals/golden/cases.json if golden figures changed), then re-run.`,
  );
  process.exit(1);
}

writeFileSync(file, next);
console.log(`Wrote snapshot for ENGINE_VERSION ${ENGINE_VERSION}.`);

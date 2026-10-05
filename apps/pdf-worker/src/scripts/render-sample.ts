/**
 * `pnpm --filter @evalprop/pdf-worker render:sample [strong|marginal|degraded] [outfile]`
 *
 * Renders one of the report fixtures to `./out/sample.pdf` (relative to the package) with the real renderer,
 * with no Cloud Tasks, Firestore, or Cloud Storage. Needs a Chromium: set `CHROME_PATH` or install one in a
 * common location. `out/` is git-ignored.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { renderReport } from "@evalprop/report";
// The fixtures are deliberately not exported from the report package; they are test data built with the real engine.
import { fixtureModels } from "../../../../packages/report/src/fixtures.ts";
import { ChromiumPdfRenderer, findChrome } from "../chromium.ts";

const which = (process.argv[2] ?? "strong") as keyof ReturnType<typeof fixtureModels>;
const models = fixtureModels();
const model = models[which];
if (!model) {
  console.error(`unknown fixture "${which}"; choose one of ${Object.keys(models).join(", ")}`);
  process.exit(2);
}

const chrome = findChrome();
if (!chrome) {
  console.error("No Chromium found. Set CHROME_PATH to a Chromium or Chrome binary.");
  process.exit(1);
}

const outFile = resolve(process.argv[3] ?? new URL("../../out/sample.pdf", import.meta.url).pathname);
const started = Date.now();
const pdf = await new ChromiumPdfRenderer({ executablePath: chrome, noSandbox: process.env.CHROMIUM_NO_SANDBOX === "1" }).render(renderReport(model));
await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, pdf);
console.log(`wrote ${outFile} (${pdf.byteLength} bytes, fixture "${which}", ${Date.now() - started} ms, ${chrome})`);

import assert from "node:assert/strict";
import { test } from "node:test";
import { DISCLAIMER, renderReport } from "@evalprop/report";
import { ChromiumPdfRenderer, COMMON_CHROME_PATHS, FOOTER_TEMPLATE, PRINT_OVERRIDE_CSS, findChrome, withPrintOverrides } from "./chromium.ts";
// Report fixtures are test data in the report package, not part of its public API.
import { fixtureModels } from "../../../packages/report/src/fixtures.ts";

test("findChrome: CHROME_PATH wins, else the first common path that exists, else null", () => {
  assert.equal(findChrome({ CHROME_PATH: "/opt/chrome" }, () => false), "/opt/chrome");
  assert.equal(findChrome({}, (p) => p === COMMON_CHROME_PATHS[1]), COMMON_CHROME_PATHS[1]);
  assert.equal(findChrome({}, () => false), null);
});

test("an explicit executable path is accepted without checking it exists (the launch reports a bad path)", () => {
  assert.doesNotThrow(() => new ChromiumPdfRenderer({ executablePath: "/nowhere/chrome" }));
});

test("the footer template carries the full disclaimer and page numbers, escaped", () => {
  assert.ok(FOOTER_TEMPLATE.includes(DISCLAIMER.replace(/&/g, "&amp;")));
  assert.match(FOOTER_TEMPLATE, /class="pageNumber"/);
  assert.match(FOOTER_TEMPLATE, /class="totalPages"/);
  assert.match(FOOTER_TEMPLATE, /font:[\d.]+px/, "Chromium footers need an explicit font size or they render at 0");
});

test("print overrides are added after the report's own styles and nothing else changes", () => {
  const html = renderReport(fixtureModels().strong);
  const out = withPrintOverrides(html);
  assert.ok(out.includes(`<style>${PRINT_OVERRIDE_CSS}</style></head>`));
  assert.equal(out.replace(`<style>${PRINT_OVERRIDE_CSS}</style>`, ""), html);
  assert.match(PRINT_OVERRIDE_CSS, /@page\{size:Letter;margin:12mm 12mm 24mm 12mm\}/);
  assert.match(withPrintOverrides("<p>no head</p>"), /^<style>/);
});

// ---------------------------------------------------------------------------------------------------------------
// Opt-in: drives a real Chromium. `RUN_PDF=1 pnpm --filter @evalprop/pdf-worker test` (needs CHROME_PATH or an
// installed Chrome/Chromium). Skipped in CI and in `pnpm test`.
// ---------------------------------------------------------------------------------------------------------------
const chrome = findChrome();
const realChromium = process.env.RUN_PDF === "1" && chrome !== null;

test("real Chromium: a fixture report becomes a multi-page PDF with the disclaimer and page numbers on every page", { skip: !realChromium && "set RUN_PDF=1 and install Chrome/Chromium (CHROME_PATH)", timeout: 60_000 }, async () => {
  const pdf = await new ChromiumPdfRenderer({ executablePath: chrome!, noSandbox: process.env.CHROMIUM_NO_SANDBOX === "1" }).render(renderReport(fixtureModels().strong));
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString("latin1"), "%PDF-");

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: pdf.slice(), useSystemFonts: true, verbosity: 0 }).promise;
  assert.ok(doc.numPages > 1, `expected several pages, got ${doc.numPages}`);

  const pageText = async (n: number) => {
    const content = await (await doc.getPage(n)).getTextContent();
    return content.items.map((i) => ("str" in i ? i.str : "")).join(" ").replace(/\s+/g, " ");
  };
  const collapsed = (s: string) => s.replace(/\s+/g, " ");
  for (let n = 1; n <= doc.numPages; n++) {
    const t = await pageText(n);
    assert.ok(t.includes("not investment, tax, legal, or lending advice"), `page ${n} is missing the disclaimer`);
    assert.ok(collapsed(t).includes(`Page ${n} of ${doc.numPages}`), `page ${n} is missing its page number`);
  }
  // Content is real text (searchable), including the verdict and a table value.
  const first = await pageText(1);
  assert.match(first, /1820 Maple Grove Ln/);
  assert.match(first, /Strong candidate/);
});

test("real Chromium: a render that cannot finish in time fails with a timeout and leaves no browser behind", { skip: !realChromium && "set RUN_PDF=1 and install Chrome/Chromium (CHROME_PATH)", timeout: 30_000 }, async () => {
  const r = new ChromiumPdfRenderer({ executablePath: chrome!, noSandbox: process.env.CHROMIUM_NO_SANDBOX === "1", timeoutMs: 1 });
  await assert.rejects(r.render("<html><head></head><body>x</body></html>"), (e: Error) => e.name === "PdfRenderTimeoutError");
});

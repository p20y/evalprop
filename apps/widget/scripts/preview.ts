import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ANALYZE_FIXTURES, WHAT_IF_FIXTURES } from "../src/fixtures.ts";
import { buildWidgetHtml } from "./build-lib.ts";

/**
 * Writes one page per fixture to `preview/` (git-ignored): the real widget document with the tool output
 * injected the way ChatGPT's compatibility runtime provides it (`window.openai.toolOutput`), so a browser
 * exercises the same code path as the host. Open with a static server; resize the window to check layouts.
 */
const html = await buildWidgetHtml();
const dir = fileURLToPath(new URL("../preview/", import.meta.url));
await mkdir(dir, { recursive: true });

const fixtures: Record<string, unknown> = { ...ANALYZE_FIXTURES, ...WHAT_IF_FIXTURES };
for (const [name, output] of Object.entries(fixtures)) {
  const bootstrap = `<script>window.openai=${JSON.stringify({ toolOutput: output }).replace(/</g, "\\u003c")};</script>`;
  await writeFile(`${dir}${name}.html`, html.replace("<script>", `${bootstrap}<script>`));
}
const links = Object.keys(fixtures).map((n) => `<li><a href="${n}.html">${n}</a></li>`).join("");
await writeFile(`${dir}index.html`, `<!doctype html><meta charset="utf-8"><title>Widget previews</title><ul>${links}</ul>`);
console.log(`wrote ${Object.keys(fixtures).length} previews to apps/widget/preview/`);

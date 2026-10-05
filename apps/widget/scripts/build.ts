import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildWidgetHtml, generatedModule } from "./build-lib.ts";

/**
 * Bundles the widget and writes it twice: `src/bundle.generated.ts` (committed, imported by the server) and
 * `dist/widget.html` (git-ignored, handy for opening in a browser).
 */
const html = await buildWidgetHtml();
await writeFile(fileURLToPath(new URL("../src/bundle.generated.ts", import.meta.url)), generatedModule(html));
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
await mkdir(dist, { recursive: true });
await writeFile(`${dist}widget.html`, html);
console.log(`widget built: ${html.length} bytes`);

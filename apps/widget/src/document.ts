import { WIDGET_CSS } from "./styles.ts";

/** What the page shows until the host delivers the tool result. */
export const LOADING_HTML = `<p class="loading" role="status">Loading the deal card…</p>`;

/**
 * The single self-contained document served as the widget resource: inline CSS and one inline script, no
 * external stylesheet, font, script or image, so the resource needs no `resourceDomains` and the page makes
 * no request of its own. `script` is the bundled `client.ts`.
 */
export function assembleHtml(script: string): string {
  if (/<\/script/i.test(script)) throw new Error("widget script contains a closing script tag");
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark"><title>Deal card</title><style>${WIDGET_CSS}</style></head>` +
    `<body><div id="root">${LOADING_HTML}</div><script>${script}</script></body></html>`
  );
}

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildWidgetHtml } from "../scripts/build-lib.ts";
import { WIDGET_HTML } from "./bundle.generated.ts";
import { WIDGET_COLORS, WIDGET_CSS } from "./styles.ts";

describe("widget bundle", () => {
  test("the committed bundle is current (run `pnpm --filter @evalprop/widget build` after changing src/)", async () => {
    assert.equal(WIDGET_HTML, await buildWidgetHtml());
  });

  test("it is one self-contained document: inline style and script, nothing fetched, no URL of any kind", () => {
    assert.match(WIDGET_HTML, /^<!doctype html><html lang="en"><head>/);
    assert.equal((WIDGET_HTML.match(/<script/g) ?? []).length, 1);
    assert.equal((WIDGET_HTML.match(/<style>/g) ?? []).length, 1);
    assert.ok(!/<script[^>]*\ssrc=|<link|<img|<iframe|@import|url\(/i.test(WIDGET_HTML));
    // No URL literal: the runtime never builds or requests one (the report link arrives as data).
    assert.ok(!/https?:\/\/[a-z0-9]/i.test(WIDGET_HTML), "no absolute URL in the document or script");
    // Nothing that makes a request or opens a channel.
    for (const api of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "importScripts", "eval(", "new Function", "localStorage", "document.cookie"]) {
      assert.ok(!WIDGET_HTML.includes(api), `bundle must not use ${api}`);
    }
  });

  test("the zod schemas are not in the browser bundle", () => {
    assert.ok(!WIDGET_HTML.includes("ZodError"));
    assert.ok(WIDGET_HTML.length < 40_000, `bundle is ${WIDGET_HTML.length} bytes`);
  });

  test("the runtime talks to the host only through the documented channels", () => {
    for (const needle of ["ui/initialize", "ui/notifications/initialized", "ui/notifications/tool-result", "ui/message", "ui/open-link", "ui/notifications/size-changed", "sendFollowUpMessage", "openExternal", "openai:set_globals"]) {
      assert.ok(WIDGET_HTML.includes(needle), `expected ${needle}`);
    }
  });
});

describe("theme", () => {
  test("light by default, dark through prefers-color-scheme and through an explicit data-theme, which wins over the media query", () => {
    assert.match(WIDGET_CSS, /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme=light\]\)/);
    assert.match(WIDGET_CSS, /:root\[data-theme=dark\]/);
  });

  test("long strings wrap and nothing is wider than the viewport", () => {
    assert.match(WIDGET_CSS, /overflow-wrap:anywhere/);
    assert.match(WIDGET_CSS, /minmax\(0,1fr\)/);
  });
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("contrast (WCAG AA, 4.5:1 for text)", () => {
  // The page background is the host's, so text is checked against both a white/near-black chat surface and the card's own surfaces.
  const hostBackground = { light: "#ffffff", dark: "#212121" } as const;
  for (const mode of ["light", "dark"] as const) {
    const c = WIDGET_COLORS[mode];
    const pairs: Array<[string, string, string]> = [
      ["ink on host", c.ink, hostBackground[mode]],
      ["secondary ink on host", c.ink2, hostBackground[mode]],
      ["ink on tile", c.ink, c.surface],
      ["secondary ink on tile", c.ink2, c.surface],
      ["good on its tint", c.goodInk, c.goodBg],
      ["caution on its tint", c.warnInk, c.warnBg],
      ["concern on its tint", c.poorInk, c.poorBg],
      ["button text on accent", c.accentInk, c.accent],
    ];
    for (const [name, fg, bg] of pairs) {
      test(`${mode}: ${name}`, () => {
        assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg} is ${contrast(fg, bg).toFixed(2)}:1`);
      });
    }
  }
});

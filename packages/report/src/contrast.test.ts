import assert from "node:assert/strict";
import { test } from "node:test";
import { heatColor, PALETTE } from "./charts.ts";
import { STYLES } from "./styles.ts";

/** WCAG relative luminance and contrast ratio. */
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const token = (name: string) => STYLES.match(new RegExp(`--${name}:(#[0-9a-fA-F]{6})`))?.[1] ?? assert.fail(`missing token --${name}`);

test("the stylesheet uses the specified palette", () => {
  assert.equal(token("s1"), "#2a78d6");
  assert.equal(token("s2"), "#eb6834");
  assert.equal(token("s3"), "#1baf7a");
  assert.equal(token("neg"), "#e34948");
  assert.equal(token("neutral"), "#f0efec");
  assert.equal(token("good"), "#0ca30c");
  assert.equal(token("warn"), "#fab219");
  assert.equal(token("crit"), "#d03b3b");
  assert.equal(token("ink"), "#0b0b0b");
  assert.equal(token("ink-2"), "#52514e");
  assert.equal(token("surface"), "#fcfcfb");
  assert.equal(token("page"), "#f9f9f7");
});

test("text meets WCAG AA (4.5:1) on the surfaces it is drawn on", () => {
  const surface = token("surface");
  const pairs: Array<[string, string, string]> = [
    ["ink", token("ink"), surface],
    ["ink-2", token("ink-2"), surface],
    ["ink-3", token("ink-3"), surface],
    ["ink-2 on page", token("ink-2"), token("page")],
    ["ink-2 on neutral", token("ink-2"), token("neutral")],
    ["good label", token("good-ink"), surface],
    ["warning label", token("warn-ink"), surface],
    ["critical label", token("crit-ink"), surface],
    ["warning label on tint", token("warn-ink"), "#fff8e6"],
    ["white on ink (tooltip, watermark)", "#ffffff", token("ink")],
  ];
  for (const [name, fg, bg] of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${contrast(fg, bg).toFixed(2)}:1`);
});

test("heat-grid numbers stay readable on the most saturated cells", () => {
  const ink = token("ink");
  for (const v of [1, -1, 0.5, -0.5, 0]) {
    const bg = heatColor(v, 1);
    assert.ok(contrast(ink, bg) >= 4.5, `${bg}: ${contrast(ink, bg).toFixed(2)}:1`);
  }
  assert.equal(heatColor(0, 1), PALETTE.neutral);
});

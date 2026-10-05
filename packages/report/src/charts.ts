import type { YearRow } from "@evalprop/shared";
import { esc, mixHex, niceTicks, usd, usdCompact } from "./format.ts";

export const PALETTE = {
  series1: "#2a78d6",
  series2: "#eb6834",
  series3: "#1baf7a",
  pos: "#2a78d6",
  neg: "#e34948",
  neutral: "#f0efec",
} as const;

/** Horizontal bars for one measure (a single colour, so no legend). Each row is labelled directly with its value. */
export function barRows(rows: Array<{ label: string; value: number; note?: string }>, scaleMax: number): string {
  const max = Math.max(scaleMax, ...rows.map((r) => r.value), 1);
  return `<div class="bars">${rows
    .map(
      (r) => `<div class="bar-row">
<div class="bar-label">${esc(r.label)}${r.note ? `<span class="bar-note">${esc(r.note)}</span>` : ""}</div>
<div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${Math.max(r.value > 0 ? 0.8 : 0, (r.value / max) * 100).toFixed(1)}%"></div></div>
<div class="bar-value">${usd(r.value)}</div>
</div>`,
    )
    .join("")}</div>`;
}

interface Series {
  key: "equity" | "profit" | "loan";
  label: string;
  color: string;
  values: number[];
}

interface Layout {
  cls: "wide" | "narrow";
  W: number;
  H: number;
  m: { top: number; right: number; bottom: number; left: number };
  /** Maximum number of x-axis tick labels. */
  xTicks: number;
  yTicks: number;
}

const WIDE: Layout = { cls: "wide", W: 680, H: 340, m: { top: 30, right: 112, bottom: 34, left: 58 }, xTicks: 8, yTicks: 6 };
const NARROW: Layout = { cls: "narrow", W: 360, H: 300, m: { top: 34, right: 98, bottom: 32, left: 46 }, xTicks: 4, yTicks: 5 };

export function holdSeries(years: YearRow[]): Series[] {
  return [
    { key: "equity", label: "Equity", color: PALETTE.series1, values: years.map((y) => y.equity) },
    { key: "profit", label: "Profit if sold", color: PALETTE.series2, values: years.map((y) => y.totalProfit) },
    { key: "loan", label: "Loan balance", color: PALETTE.series3, values: years.map((y) => y.loanBalance) },
  ];
}

/** Spreads direct labels vertically so none overlap, keeping them as close to their line ends as possible. */
function spreadLabels(ys: number[], minGap: number, top: number, bottom: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = order.map((o) => o.y);
  for (let k = 1; k < out.length; k++) if (out[k]! < out[k - 1]! + minGap) out[k] = out[k - 1]! + minGap;
  const over = out[out.length - 1]! - bottom;
  if (over > 0) for (let k = 0; k < out.length; k++) out[k] = out[k]! - over;
  if (out[0]! < top) {
    const shift = top - out[0]!;
    for (let k = 0; k < out.length; k++) out[k] = out[k]! + shift;
  }
  const result: number[] = new Array(ys.length);
  order.forEach((o, k) => (result[o.i] = out[k]!));
  return result;
}

function oneChart(layout: Layout, years: YearRow[], breakEvenMonth: number | null, paybackMonth: number | null): string {
  const { W, H, m } = layout;
  const N = years.length;
  const series = holdSeries(years);
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(...all, 0), Math.max(...all, 1), layout.yTicks);
  const yMin = ticks[0]!;
  const yMax = ticks[ticks.length - 1]!;
  const x = (yr: number) => m.left + (yr / N) * iw;
  const y = (v: number) => m.top + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const f = (n: number) => n.toFixed(1);

  const grid = ticks
    .map(
      (t) =>
        `<line class="grid" x1="${m.left}" x2="${W - m.right}" y1="${f(y(t))}" y2="${f(y(t))}"/>` +
        `<text class="tick" x="${m.left - 6}" y="${f(y(t) + 4)}" text-anchor="end">${usdCompact(t)}</text>`,
    )
    .join("");
  const zero = yMin < 0 && yMax > 0 ? `<line class="zero" x1="${m.left}" x2="${W - m.right}" y1="${f(y(0))}" y2="${f(y(0))}"/>` : "";

  const step = [1, 2, 5, 10, 20, 25].find((s) => N / s <= layout.xTicks) ?? 25;
  const xs: number[] = [];
  for (let t = step; t <= N; t += step) xs.push(t);
  const xAxis =
    `<text class="tick" x="${f(x(0))}" y="${H - 10}" text-anchor="start">Yr 0</text>` +
    xs.map((t) => `<text class="tick" x="${f(x(t))}" y="${H - 10}" text-anchor="middle">Yr ${t}</text>`).join("");

  const lines = series
    .map((s) => {
      const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"}${f(x(i + 1))},${f(y(v))}`).join(" ");
      return `<path d="${d}" class="line" stroke="${s.color}"/>`;
    })
    .join("");

  // Direct labels at the right end of each line, spread so they never collide.
  const ends = series.map((s) => y(s.values[N - 1]!) + 4);
  const labelY = spreadLabels(ends, 15, m.top + 6, m.top + ih + 4);
  const labels = series
    .map(
      (s, i) =>
        `<circle cx="${f(x(N))}" cy="${f(y(s.values[N - 1]!))}" r="3.5" fill="${s.color}" stroke="#fcfcfb" stroke-width="1.5"/>` +
        `<text class="end-label" x="${f(x(N) + 9)}" y="${f(labelY[i]!)}">${esc(s.label)}</text>`,
    )
    .join("");

  // Markers for break-even and cash payback, labelled at the top, on separate rows so they never collide.
  const markers: string[] = [];
  const markerLabels: string[] = [];
  const addMarker = (month: number | null, text: string, row: number, cls: string) => {
    if (month === null || month / 12 > N) return;
    const mx = x(month / 12);
    const anchorEnd = mx > m.left + iw * 0.62;
    markers.push(`<line class="marker ${cls}" x1="${f(mx)}" x2="${f(mx)}" y1="${m.top - 2}" y2="${m.top + ih}"/>`);
    markerLabels.push(
      `<text class="marker-label" x="${f(mx + (anchorEnd ? -5 : 5))}" y="${m.top - 18 + row * 13}" text-anchor="${anchorEnd ? "end" : "start"}">${esc(text)}</text>`,
    );
  };
  addMarker(breakEvenMonth, `Break-even: month ${breakEvenMonth}`, 1, "m-break");
  if (paybackMonth !== null && paybackMonth !== breakEvenMonth) addMarker(paybackMonth, `Cash repaid: month ${paybackMonth}`, 0, "m-pay");

  const data = JSON.stringify({
    xs: years.map((_, i) => Number(x(i + 1).toFixed(2))),
    years: years.map((r) => r.year),
    series: series.map((s) => ({ label: s.label, color: s.color, values: s.values.map((v) => Math.round(v)) })),
  });

  return `<div class="chart ${layout.cls}" data-chart="${esc(data)}">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart of equity, profit if sold, and loan balance over the ${N}-year hold. The year-by-year table below lists the same figures.">
${grid}${zero}${markers.join("")}${lines}${markerLabels.join("")}${labels}${xAxis}
<line class="crosshair" x1="0" x2="0" y1="${m.top}" y2="${m.top + ih}" visibility="hidden"/>
<rect class="hit" x="${m.left}" y="${m.top - 4}" width="${iw + 4}" height="${ih + 4}" fill="transparent"/>
</svg>
<div class="tooltip" hidden></div>
</div>`;
}

/**
 * Hold-period line chart: equity, profit if sold and loan balance by year. Two SVGs (a wide and a narrow
 * layout, one shown at a time by CSS) keep text legible on a phone. Both carry the data for the hover tooltip.
 */
export function holdChart(years: YearRow[], breakEvenMonth: number | null, paybackMonth: number | null): string {
  const legend = holdSeries(years)
    .map((s) => `<span class="legend-item"><i style="background:${s.color}"></i>${esc(s.label)}</span>`)
    .join("");
  return `<div class="legend" aria-hidden="true">${legend}</div>${oneChart(WIDE, years, breakEvenMonth, paybackMonth)}${oneChart(NARROW, years, breakEvenMonth, paybackMonth)}`;
}

export interface HeatHeader {
  main: string;
  /** Smaller second line, e.g. the change from the base case. */
  sub?: string;
}

const headerHtml = (h: HeatHeader | undefined) => (h ? `${esc(h.main)}${h.sub ? `<small>${esc(h.sub)}</small>` : ""}` : "");

export interface HeatOptions {
  caption: string;
  xLabel: string;
  yLabel: string;
  xHeaders: HeatHeader[];
  yHeaders: HeatHeader[];
  /** cells[yIndex][xIndex] */
  cells: number[][];
  format: (n: number) => string;
  baseX: number;
  baseY: number;
}

/** Diverging colour for a value: blue above zero, red below, neutral at zero, saturating at the grid's largest magnitude. */
export function heatColor(v: number, maxAbs: number): string {
  if (maxAbs <= 0 || v === 0) return PALETTE.neutral;
  const t = Math.min(1, Math.abs(v) / maxAbs) * 0.72;
  return mixHex(PALETTE.neutral, v > 0 ? PALETTE.pos : PALETTE.neg, t);
}

/**
 * Two-way grid. Every cell prints its number (colour is never the only signal), the base case is outlined
 * and marked in the accessible name, and blue/red diverge around zero.
 */
export function heatGrid(o: HeatOptions): string {
  const maxAbs = Math.max(0, ...o.cells.flat().map(Math.abs));
  const head = `<tr><th class="corner" scope="col"><span class="ax-y">${esc(o.yLabel)} ↓</span><span class="ax-x">${esc(o.xLabel)} →</span></th>${o.xHeaders
    .map((h, xi) => `<th scope="col"${xi === o.baseX ? ' class="base-h"' : ""}>${headerHtml(h)}</th>`)
    .join("")}</tr>`;
  const body = o.cells
    .map(
      (row, yi) =>
        `<tr><th scope="row"${yi === o.baseY ? ' class="base-h"' : ""}>${headerHtml(o.yHeaders[yi])}</th>${row
          .map((v, xi) => {
            const isBase = xi === o.baseX && yi === o.baseY;
            return `<td class="${isBase ? "base" : ""}" style="background:${heatColor(v, maxAbs)}"${isBase ? ' aria-label="Base case"' : ""}>${esc(o.format(v))}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  return `<table class="heat"><caption>${esc(o.caption)}</caption><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/** Legend for the diverging scale. */
export function heatLegend(): string {
  const swatch = (c: string, t: string) => `<span class="legend-item"><i class="sw" style="background:${c}"></i>${esc(t)}</span>`;
  return `<div class="legend heat-legend">${swatch(heatColor(-1, 1), "Negative (red)")}${swatch(PALETTE.neutral, "Zero")}${swatch(heatColor(1, 1), "Positive (blue)")}<span class="legend-item"><i class="sw base-sw"></i>Base case (outlined)</span></div>`;
}

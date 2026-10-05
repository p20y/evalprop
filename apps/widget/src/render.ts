import type { AnalyzePropertyOutput, CardModel, ComparisonRow, WhatIfOutput } from "@evalprop/shared";
import { DASH, duration, esc, pct, ratio, usd } from "./format.ts";

/**
 * The card as a pure function of the tool's `structuredContent` (ARCHITECTURE §5.3): no clock, no network,
 * no host API. Used in three places with identical output: the browser runtime (`client.ts`) after the host
 * delivers the tool result, the tests, and the preview pages.
 *
 * Only `import type` from the shared package: the zod schemas must not end up in the browser bundle.
 * Every dynamic string is passed through `esc`; the report link is only ever an `href` when it is http(s).
 */

export type WidgetOutput = AnalyzePropertyOutput | WhatIfOutput;

type Tone = "good" | "ok" | "poor" | "neutral";

/** Distinct icon SHAPES (circle+check, triangle, circle+cross, dashed circle) so colour is never the only signal. */
const ICON_PATHS: Record<Tone | "info" | "up", string> = {
  good: `<circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M5.8 10.4l2.9 2.9 5.5-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  ok: `<path d="M10 1.8L19 17.6H1z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 7.4v5M10 14.2v.2" stroke="#1a1200" stroke-width="2" stroke-linecap="round"/>`,
  poor: `<circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M6.8 6.8l6.4 6.4M13.2 6.8l-6.4 6.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
  neutral: `<circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6.2 10h7.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  info: `<circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 9v5M10 6.2v.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`,
  up: `<path d="M10 3l7 8h-4.2v6H7.2v-6H3z" fill="currentColor"/>`,
};

function icon(kind: keyof typeof ICON_PATHS): string {
  return `<svg class="ico" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${ICON_PATHS[kind]}</svg>`;
}

const VERDICT_TONE: Record<CardModel["verdict"], Tone> = { strong: "good", good: "good", marginal: "ok", weak: "poor" };

const CONFIDENCE: Record<NonNullable<CardModel["compsConfidence"]>, { tone: Tone; label: string }> = {
  high: { tone: "good", label: "High confidence" },
  medium: { tone: "ok", label: "Medium confidence" },
  low: { tone: "poor", label: "Low confidence" },
};

/** Same wording as the report's source badges. */
const RENT_SOURCE: Record<CardModel["rentSource"], string> = {
  provided: "Provided",
  listing: "From listing",
  lookup: "Looked up",
  assumed: "Assumed default",
};

// ---- input handling

export interface ParsedOutput {
  card: CardModel;
  /** Present only for a what-if result. */
  rows: ComparisonRow[] | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T => typeof v === "string" && (allowed as readonly string[]).includes(v);

const VERDICTS = ["strong", "good", "marginal", "weak"] as const;
const SOURCES = ["provided", "listing", "lookup", "assumed"] as const;
const CONFIDENCES = ["high", "medium", "low"] as const;
const METRICS = ["monthlyCashFlow", "cashOnCashPct", "capRatePct", "dscr", "breakEvenMonth", "irr10Pct", "cashInvested"] as const;

/**
 * Reads `structuredContent` (`{ card, summary }` or `{ baseAnalysisId, card, rows, summary }`) without zod,
 * which would roughly triple the bundle. The server has already validated the output against the shared
 * schema; this only guards against a host handing over something unexpected, in which case the caller shows
 * a plain "unavailable" message instead of a half-empty card. Also accepts a bare card.
 */
export function parseWidgetOutput(raw: unknown): ParsedOutput | null {
  if (!isRecord(raw)) return null;
  const c = isRecord(raw["card"]) ? raw["card"] : "analysisId" in raw && "verdict" in raw ? raw : null;
  if (c === null) return null;
  const m = c["metrics"];
  if (
    typeof c["address"] !== "string" ||
    typeof c["analysisId"] !== "string" ||
    typeof c["verdictLabel"] !== "string" ||
    !oneOf(c["verdict"], VERDICTS) ||
    !oneOf(c["rentSource"], SOURCES) ||
    !isNum(c["analyzedPrice"]) ||
    !isNum(c["monthlyRent"]) ||
    !isRecord(m) ||
    !isNum(m["monthlyCashFlow"]) ||
    !isNum(m["cashOnCashPct"]) ||
    !isNum(m["capRatePct"])
  ) {
    return null;
  }
  const mo = c["maxOffer"];
  const usage = c["usage"];
  const card: CardModel = {
    analysisId: c["analysisId"],
    address: c["address"],
    listPrice: numOrNull(c["listPrice"]),
    analyzedPrice: c["analyzedPrice"],
    monthlyRent: c["monthlyRent"],
    rentSource: c["rentSource"],
    verdict: c["verdict"],
    verdictLabel: c["verdictLabel"],
    metrics: { monthlyCashFlow: m["monthlyCashFlow"], cashOnCashPct: m["cashOnCashPct"], capRatePct: m["capRatePct"], dscr: numOrNull(m["dscr"]) },
    maxOffer:
      isRecord(mo) && isNum(mo["price"]) && isNum(mo["targetCashOnCashPct"]) && isNum(mo["vsAnalyzedPricePct"])
        ? { price: mo["price"], targetCashOnCashPct: mo["targetCashOnCashPct"], vsAnalyzedPricePct: mo["vsAnalyzedPricePct"] }
        : null,
    breakEvenMonth: numOrNull(c["breakEvenMonth"]),
    irr10Pct: numOrNull(c["irr10Pct"]),
    compsConfidence: oneOf(c["compsConfidence"], CONFIDENCES) ? c["compsConfidence"] : null,
    reportUrl: typeof c["reportUrl"] === "string" ? c["reportUrl"] : "",
    dataNotes: Array.isArray(c["dataNotes"]) ? c["dataNotes"].filter((n): n is string => typeof n === "string") : [],
    ...(isRecord(usage) && isNum(usage["used"]) && isNum(usage["limit"]) && typeof usage["period"] === "string"
      ? { usage: { used: usage["used"], limit: usage["limit"], period: usage["period"] } }
      : {}),
  };

  let rows: ComparisonRow[] | null = null;
  if (Array.isArray(raw["rows"])) {
    rows = [];
    for (const r of raw["rows"]) {
      if (isRecord(r) && oneOf(r["metric"], METRICS) && typeof r["label"] === "string") {
        rows.push({ metric: r["metric"], label: r["label"], before: numOrNull(r["before"]), after: numOrNull(r["after"]) });
      }
    }
  }
  return { card, rows: rows !== null && rows.length > 0 ? rows : null };
}

// ---- pieces

/** An `href` only for http(s): a relative path would resolve against the host's sandbox origin and `javascript:` must never be linked. */
export function safeHref(url: string): string | null {
  return /^https?:\/\/[^\s"'<>]+$/i.test(url.trim()) ? url.trim() : null;
}

/**
 * The message "Change assumptions" posts to the conversation. It names the analysis so the assistant can
 * call `what_if`, and asks which assumptions to change rather than guessing values. The address is
 * collapsed to one short line: it is data from providers and becomes text in the user's message box.
 */
export function changeAssumptionsPrompt(card: Pick<CardModel, "address" | "analysisId">): string {
  const address = card.address.replace(/\s+/g, " ").trim().slice(0, 100);
  return (
    `I want to change the assumptions for ${address} (analysis ${card.analysisId.replace(/[^\w.-]/g, "").slice(0, 64)}). ` +
    "Ask me which ones to change (offer price, rent, down payment, interest rate, vacancy), then re-run it with what_if."
  );
}

function tile(label: string, value: string, unit: string): string {
  return `<div class="tile"><dt>${esc(label)}</dt><dd><span class="v">${esc(value)}</span><span class="u">${esc(unit)}</span></dd></div>`;
}

function row(label: string, value: string, detail?: string): string {
  return `<div class="row"><dt>${esc(label)}</dt><dd>${value}${detail ? `<small>${detail}</small>` : ""}</dd></div>`;
}

function head(card: CardModel, eyebrow: string): string {
  const tone = VERDICT_TONE[card.verdict];
  const facts: string[] = [`<span>Analyzed at ${esc(usd(card.analyzedPrice))}</span>`];
  if (card.listPrice !== null && Math.round(card.listPrice) !== Math.round(card.analyzedPrice)) {
    facts.push(`<span>List price ${esc(usd(card.listPrice))}</span>`);
  }
  facts.push(`<span>Rent ${esc(usd(card.monthlyRent))}/mo (${esc(RENT_SOURCE[card.rentSource].toLowerCase())})</span>`);
  return (
    `<header><p class="eyebrow">${esc(eyebrow)}</p><h1 class="addr">${esc(card.address)}</h1><p class="facts">${facts.join("")}</p>` +
    `<div class="pill t-${tone}">${icon(tone)}<span>${esc(card.verdictLabel)}</span></div></header>`
  );
}

function tiles(card: CardModel): string {
  const m = card.metrics;
  return (
    `<dl class="tiles" aria-label="Year-one metrics">` +
    tile("Monthly cash flow", usd(m.monthlyCashFlow), m.monthlyCashFlow < 0 ? "per month (negative)" : "per month") +
    tile("Cash-on-cash", pct(m.cashOnCashPct), "year 1") +
    tile("Cap rate", pct(m.capRatePct), "year 1") +
    tile("DSCR", m.dscr === null ? "No loan" : ratio(m.dscr), m.dscr === null ? "nothing to cover" : "debt coverage") +
    `</dl>`
  );
}

function facts(card: CardModel): string {
  const rows: string[] = [];
  if (card.maxOffer === null) {
    rows.push(row("Max offer", "Not reachable", "No price meets your cash-on-cash target with these assumptions."));
  } else {
    const d = card.maxOffer.vsAnalyzedPricePct;
    const where = Math.abs(d) < 0.05 ? "about the analyzed price" : d < 0 ? `${esc(pct(Math.abs(d)))} below the analyzed price` : `${esc(pct(d))} above the analyzed price`;
    rows.push(row("Max offer", esc(usd(card.maxOffer.price)), `for ${esc(pct(card.maxOffer.targetCashOnCashPct))} cash-on-cash, ${where}`));
  }
  rows.push(
    row(
      "Break-even",
      card.breakEvenMonth === null ? "Not reached" : esc(duration(card.breakEvenMonth)),
      card.breakEvenMonth === null ? "Not within the hold period" : "Cash flow plus sale proceeds repay cash invested",
    ),
  );
  rows.push(row("10-year IRR", card.irr10Pct === null ? `<span aria-label="Not available">${DASH}</span>` : esc(pct(card.irr10Pct))));
  rows.push(row("Rent source", esc(RENT_SOURCE[card.rentSource])));
  if (card.compsConfidence === null) {
    rows.push(row("Rent comps", `<span class="status t-neutral">${icon("neutral")}<span>No comparable rents used</span></span>`));
  } else {
    const c = CONFIDENCE[card.compsConfidence];
    rows.push(row("Rent comps", `<span class="status t-${c.tone}">${icon(c.tone)}<span>${esc(c.label)}</span></span>`));
  }
  return `<dl class="kv">${rows.join("")}</dl>`;
}

function notes(card: CardModel): string {
  const n = card.dataNotes;
  if (n.length === 0) return "";
  return (
    `<details class="notes"${n.length === 1 ? " open" : ""}><summary><span class="t-ok">${icon("ok")}</span><span>Data notes (${n.length})</span></summary>` +
    `<ul>${n.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>`
  );
}

function actions(card: CardModel): string {
  const href = safeHref(card.reportUrl);
  const open =
    href === null
      ? ""
      : `<a class="btn primary" data-action="open-report" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Open full report</a>`;
  return (
    `<div class="actions">${open}<button type="button" class="btn secondary" data-action="change-assumptions" data-prompt="${esc(changeAssumptionsPrompt(card))}">Change assumptions</button></div>` +
    `<p class="hint" data-hint hidden>Ask in the chat to change any assumption, for example the offer price, rent or interest rate.</p>`
  );
}

function usage(card: CardModel): string {
  if (card.usage === undefined) return "";
  const u = card.usage;
  return `<p class="foot">${esc(u.used)} of ${esc(u.limit)} analyses used (${esc(u.period)})</p>`;
}

// ---- what-if

type Direction = "higher" | "lower";
const BETTER: Record<ComparisonRow["metric"], Direction> = {
  monthlyCashFlow: "higher",
  cashOnCashPct: "higher",
  capRatePct: "higher",
  dscr: "higher",
  breakEvenMonth: "lower",
  irr10Pct: "higher",
  cashInvested: "lower",
};

function cell(metric: ComparisonRow["metric"], v: number | null): string {
  switch (metric) {
    case "monthlyCashFlow":
    case "cashInvested":
      return usd(v);
    case "cashOnCashPct":
    case "capRatePct":
    case "irr10Pct":
      return v === null ? "n/a" : pct(v);
    case "dscr":
      return v === null ? "No loan" : ratio(v);
    case "breakEvenMonth":
      return v === null ? "Not reached" : duration(v);
  }
}

/** Whether `after` is a better outcome than `before` for the investor. Null for no change or no honest answer. */
function change(r: ComparisonRow): "better" | "worse" | null {
  if (r.before === r.after) return null;
  // DSCR is null when there is no loan: moving between "no loan" and a ratio is not better or worse by itself.
  if (r.metric === "dscr" && (r.before === null || r.after === null)) return null;
  if (r.metric === "breakEvenMonth") {
    if (r.before === null) return "better";
    if (r.after === null) return "worse";
  }
  if (r.before === null) return "better";
  if (r.after === null) return "worse";
  const up = r.after > r.before;
  return up === (BETTER[r.metric] === "higher") ? "better" : "worse";
}

function comparison(rows: ComparisonRow[]): string {
  const body = rows
    .map((r) => {
      const c = change(r);
      const mark =
        c === "better"
          ? `<span class="delta t-good">${icon("up")}<span>Improved</span></span>`
          : c === "worse"
            ? `<span class="delta t-ok">${icon("ok")}<span>Worse</span></span>`
            : "";
      return `<tr><th scope="row">${esc(r.label)}</th><td>${esc(cell(r.metric, r.before))}</td><td class="after">${esc(cell(r.metric, r.after))}${mark}</td></tr>`;
    })
    .join("");
  return (
    `<section class="compare" aria-labelledby="cmp-h"><h2 id="cmp-h">Before and after</h2><table><thead><tr><th scope="col">Metric</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>` +
    `<tbody>${body}</tbody></table></section>`
  );
}

// ---- entry points

/** The card for a tool output. Returns an HTML fragment (one `<article>`), safe to assign to `innerHTML`. */
export function renderCard(output: WidgetOutput): string {
  return renderParsed(parseWidgetOutput(output));
}

/** Same, for data of unknown shape (what the host hands the runtime). Unrecognised input renders a plain message. */
export function renderUnknown(raw: unknown): string {
  return renderParsed(parseWidgetOutput(raw));
}

function renderParsed(parsed: ParsedOutput | null): string {
  if (parsed === null) return `<p class="unavailable" role="status">The deal card could not be shown. The analysis summary is in the chat.</p>`;
  const { card, rows } = parsed;
  const isWhatIf = rows !== null;
  return (
    `<article class="deal" aria-label="Rental deal summary">` +
    head(card, isWhatIf ? "What-if result" : "Rental analysis") +
    (rows !== null ? comparison(rows) : "") +
    tiles(card) +
    facts(card) +
    notes(card) +
    actions(card) +
    usage(card) +
    `<p class="foot">Informational only; not investment, tax, or legal advice.</p>` +
    `</article>`
  );
}

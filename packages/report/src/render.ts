import { sensitivity } from "@evalprop/engine";
import type {
  Analysis,
  Comp,
  CompResult,
  DataNote,
  LadderStep,
  ReportModel,
  ReportSection,
  ResolvedAssumption,
  School,
  Source,
} from "@evalprop/shared";
import { barRows, heatGrid, heatLegend, holdChart, type HeatHeader } from "./charts.ts";
import { esc, fmtDate, miles, multiple, num, pct, ratio, usd } from "./format.ts";
import { ENGINE_ASSUMPTION_FIELDS, analyzedPriceOf, assumptionValue, monthlyRentOf, reconstructEngineInput } from "./input.ts";
import { SCRIPT, STYLES } from "./styles.ts";
import { VERDICT_LABEL, buildSummary } from "./summary.ts";
import {
  CONFIDENCE,
  ICON_SPRITE,
  TONE_LABEL,
  VERDICT_TONE,
  icon,
  infoIcon,
  section,
  sourceBadge,
  status,
  type StatusTone,
} from "./ui.ts";

/** Bumped when the markup changes, so cached copies of a report are not reused across renderer versions. */
export const REPORT_RENDERER_VERSION = "1";

export const DISCLAIMER =
  "This report is for information only. It is not investment, tax, legal, or lending advice. Projections depend on the assumptions shown here and on data that can be incomplete or out of date; verify rents, taxes, insurance, HOA terms, and school assignment before you act.";

const SECTION_ORDER: ReportSection[] = [
  "summary",
  "scorecard",
  "maxOffer",
  "income",
  "returns",
  "hold",
  "sensitivity",
  "comps",
  "schools",
  "advisory",
  "assumptions",
];

const SECTION_NAV: Record<ReportSection, string> = {
  summary: "Summary",
  scorecard: "Scorecard",
  maxOffer: "Max offer",
  income: "Income and expenses",
  returns: "Returns",
  hold: "Long-term hold",
  sensitivity: "Sensitivity",
  comps: "Comps",
  schools: "Schools",
  advisory: "Flags",
  assumptions: "Assumptions",
};

const FIELD_LABEL: Record<string, { label: string; kind: "pct" | "usd" | "yrs" }> = {
  purchasePrice: { label: "Purchase price analyzed", kind: "usd" },
  offerPrice: { label: "Offer price", kind: "usd" },
  monthlyRent: { label: "Monthly rent", kind: "usd" },
  downPaymentPct: { label: "Down payment", kind: "pct" },
  interestRatePct: { label: "Interest rate", kind: "pct" },
  loanTermYears: { label: "Loan term", kind: "yrs" },
  closingCostPct: { label: "Closing costs (of price)", kind: "pct" },
  rehabCost: { label: "Rehab / upfront repairs", kind: "usd" },
  propertyTaxAnnual: { label: "Property tax (per year)", kind: "usd" },
  insuranceAnnual: { label: "Insurance (per year)", kind: "usd" },
  hoaMonthly: { label: "HOA (per month)", kind: "usd" },
  vacancyPct: { label: "Vacancy (of rent)", kind: "pct" },
  maintenancePct: { label: "Maintenance (of rent)", kind: "pct" },
  capexPct: { label: "CapEx reserve (of rent)", kind: "pct" },
  managementPct: { label: "Property management (of collected rent)", kind: "pct" },
  rentGrowthPct: { label: "Rent growth (per year)", kind: "pct" },
  expenseGrowthPct: { label: "Expense growth (per year)", kind: "pct" },
  appreciationPct: { label: "Appreciation (per year)", kind: "pct" },
  sellingCostPct: { label: "Selling costs (of sale price)", kind: "pct" },
  holdYears: { label: "Hold period", kind: "yrs" },
};

const fieldLabel = (f: string) => FIELD_LABEL[f]?.label ?? f;
const fieldValue = (f: string, v: number) => {
  const k = FIELD_LABEL[f]?.kind;
  if (k === "pct") return `${Number(v.toFixed(2))}%`;
  if (k === "yrs") return `${v} years`;
  return usd(v);
};

const PROPERTY_TYPE: Record<string, string> = {
  single_family: "Single-family",
  condo: "Condo",
  townhouse: "Townhouse",
  multi_family: "Multi-family",
  apartment_unit: "Apartment unit",
  other: "Other",
};

const STEP_LABEL: Record<LadderStep, string> = {
  "same-building": "Same building",
  "strict-0.5mi": "Strict match (same type, beds and size)",
  "strict-1mi": "Strict match (same type, beds and size)",
  "strict-2mi": "Strict match (same type, beds and size)",
  relaxed: "Relaxed match (different-size comps, adjusted to this size)",
  insufficient: "Not enough comps found",
};

const KIND_LABEL: Record<Comp["kind"], string> = {
  asking: "Asking",
  leased: "Leased",
  sold: "Sold",
  active: "Active listing",
  pending: "Pending",
};

const SECTION_NOTE_KEY: Record<string, string> = { rentComps: "Rent comparables", saleComps: "Sale comparables", schools: "Schools" };

export interface RenderedParts {
  html: string;
  /** True when the document contains the hover-tooltip script. */
  hasScript: boolean;
}

/**
 * Renders one self-contained HTML document: inline CSS, inline SVG charts, one small inline script for the
 * hold-chart tooltip. No external requests, no frameworks. A pure function of the model.
 */
export function renderReport(model: ReportModel): string {
  return renderParts(model).html;
}

export function renderParts(model: ReportModel): RenderedParts {
  const { analysis: a, options } = model;
  const wanted = (s: ReportSection) => !options.sections || options.sections.includes(s);
  const summary = buildSummary(a);
  const autoNotes: DataNote[] = [];
  const blocks: Array<{ id: ReportSection; html: string }> = [];
  let hasScript = false;

  const push = (id: ReportSection, html: string | null) => {
    if (html) blocks.push({ id, html });
  };

  if (wanted("summary")) push("summary", summarySection(summary.sentences));
  if (wanted("scorecard")) push("scorecard", scorecardSection(a));
  if (wanted("maxOffer")) push("maxOffer", maxOfferSection(a));
  if (wanted("income")) push("income", incomeSection(a));
  if (wanted("returns")) push("returns", returnsSection(a));
  if (wanted("hold")) {
    const hold = holdSection(a);
    if (hold) {
      push("hold", hold);
      hasScript = true;
    }
  }
  if (wanted("sensitivity")) {
    const s = sensitivitySection(a);
    if (s.html) push("sensitivity", s.html);
    else if (s.reason) autoNotes.push({ section: "sensitivity", severity: "info", message: s.reason });
  }
  if (wanted("comps")) {
    const c = compsSection(a, autoNotes);
    push("comps", c);
  }
  if (wanted("schools")) {
    if (a.market.schools && a.market.schools.length > 0) push("schools", schoolsSection(a.market.schools));
    else addMissing(a, "schools", autoNotes);
  }
  if (wanted("advisory") && a.advisoryFlags.length > 0) push("advisory", advisorySection(a));
  if (wanted("assumptions")) push("assumptions", assumptionsSection(a));

  const notes = dataNotesSection(a.dataNotes, autoNotes);
  const nav = blocks.map((b) => `<li><a href="#${esc(b.id)}">${esc(SECTION_NAV[b.id])}</a></li>`);
  const orderIdx = (id: ReportSection) => SECTION_ORDER.indexOf(id);
  const body = blocks
    .sort((x, y) => orderIdx(x.id) - orderIdx(y.id))
    .map((b) => b.html)
    .join("\n");

  const hasWarnings = a.dataNotes.some((n) => n.severity === "warning") || autoNotes.some((n) => n.severity === "warning");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>${esc(a.property.formattedAddress)} - Rental investment report</title>
<style>${STYLES}</style>
</head>
<body>
${ICON_SPRITE}
${options.watermark ? `<div class="watermark-banner" role="note">Free plan preview: this report carries an evalprop watermark.</div><div class="watermark-bg" aria-hidden="true"><span>evalprop free</span></div>` : ""}
<div class="wrap">
${headerBlock(model, summary.headline, nav, hasWarnings && !!notes)}
${body}
${notes ?? ""}
${footerBlock(model)}
</div>
${hasScript ? `<script>${SCRIPT}</script>` : ""}
</body>
</html>
`;
  return { html, hasScript };
}

// ---------------------------------------------------------------------------------------------
// Header, verdict, KPIs
// ---------------------------------------------------------------------------------------------

function headerBlock(model: ReportModel, headline: string, nav: string[], showDataBanner: boolean): string {
  const a = model.analysis;
  const p = a.property;
  const o = model.options;
  const facts = [
    p.propertyType ? PROPERTY_TYPE[p.propertyType] : undefined,
    p.beds !== undefined ? `${num(p.beds)} bd` : undefined,
    p.baths !== undefined ? `${num(p.baths, p.baths % 1 ? 1 : 0)} ba` : undefined,
    p.sqft !== undefined ? `${num(p.sqft)} sqft` : undefined,
    p.lotSqft !== undefined ? `${num(p.lotSqft)} sqft lot` : undefined,
    p.yearBuilt !== undefined ? `Built ${p.yearBuilt}` : undefined,
    p.unitsInBuilding !== undefined ? `${p.unitsInBuilding} units in building` : undefined,
    p.listPrice !== undefined ? `List ${usd(p.listPrice)}` : undefined,
    p.daysOnMarket !== undefined ? `${p.daysOnMarket} days on market` : undefined,
  ].filter((x): x is string => x !== undefined);

  const prepared = ["Prepared", o.recipientName ? `for ${esc(o.recipientName)}` : null, o.preparedBy ? `by ${esc(o.preparedBy)}` : null, `on ${esc(fmtDate(model.generatedAt))}`]
    .filter(Boolean)
    .join(" ");

  const v = a.evaluation.verdict;
  const tone = VERDICT_TONE[v];
  const desc = p.description?.trim()
    ? `<div class="property-desc"><span class="desc-label">Listing description (written by the seller or agent; shown as written, not used in any calculation)</span><p>${esc(p.description)}</p></div>`
    : "";

  return `<header>
<div class="eyebrow">Rental investment report</div>
<h1>${esc(p.formattedAddress)}</h1>
<p class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join("")}</p>
<p class="prepared">${prepared}</p>
${o.note ? `<p class="recipient-note">${esc(o.note)}</p>` : ""}
${desc}
</header>
<div class="verdict t-${tone}" role="group" aria-label="Verdict">
<span class="badge t-${tone}">${icon(tone)}<span>${esc(VERDICT_LABEL[v])}</span></span>
<p class="msg">${esc(headline)}</p>
</div>
${showDataBanner ? `<p class="note-box warn">${infoIcon(true)} Some data was unavailable or limited for this report. See <a href="#data-notes">data notes</a>.</p>` : ""}
${kpiTiles(a)}
${nav.length > 0 ? `<ul class="toc" aria-label="Sections">${nav.join("")}</ul>` : ""}`;
}

function checkFor(a: Analysis, needle: string) {
  return a.evaluation.checks.find((c) => c.name.toLowerCase().includes(needle));
}

function kpiTiles(a: Analysis): string {
  const y1 = a.evaluation.yearOne;
  const hold = a.evaluation.hold;
  const tile = (label: string, value: string, detail: string, tone?: StatusTone) =>
    `<div class="kpi"><div class="k">${esc(label)}</div><div class="v">${esc(value)}</div><div class="d">${tone ? icon(tone, true) : ""}<span>${esc(detail)}</span></div></div>`;
  const checkTile = (label: string, needle: string, value: string, passLabel?: [string, string]) => {
    const c = checkFor(a, needle);
    if (!c) return tile(label, value, "");
    const detail = passLabel ? passLabel[c.passed ? 0 : 1] : `${c.passed ? "Meets" : "Below"} ${c.threshold.replace(">=", "\u2265")}`;
    return tile(label, value, detail, c.passed ? "good" : "poor");
  };
  return `<div class="kpis">
${checkTile("Monthly cash flow", "cash flow", usd(y1.monthlyCashFlow), ["Positive", "Not positive"])}
${checkTile("Cash-on-cash", "cash-on-cash", pct(y1.cashOnCashPct))}
${checkTile("Cap rate", "cap rate", pct(y1.capRatePct))}
${checkTile("DSCR", "debt service", y1.dscr === null ? "No loan" : ratio(y1.dscr))}
${tile("Cash needed", usd(y1.cashInvested), "Down payment, closing, rehab")}
${tile("Break-even", hold.breakEvenMonth === null ? "Not reached" : `Month ${hold.breakEvenMonth}`, "Including sale proceeds")}
</div>`;
}

// ---------------------------------------------------------------------------------------------
// Summary and scorecard
// ---------------------------------------------------------------------------------------------

function summarySection(sentences: string[]): string {
  return section("summary", "Executive summary", "Generated from the calculation engine and comparable-selection results; no model-written text.", `<ul class="summary-list">${sentences.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`);
}

function scorecardSection(a: Analysis): string {
  const checks = a.evaluation.checks;
  const passed = checks.filter((c) => c.passed).length;
  const items = checks
    .map((c) => {
      const tone: StatusTone = c.passed ? "good" : "poor";
      return `<li><span>${icon(tone)}</span><span class="name">${esc(c.name)}</span><span class="act">${esc(c.actual)}</span><span class="thr">Pass line: ${esc(c.threshold.replace(">=", "≥"))}</span><span class="st">${status(tone, c.passed ? "Pass" : "Fail")}</span></li>`;
    })
    .join("");
  return section(
    "scorecard",
    "Investment scorecard",
    `${passed} of ${checks.length} checks pass. These are the engine's screening rules, shown so you can see exactly why the verdict was reached.`,
    `<ul class="checks">${items}</ul>`,
  );
}

// ---------------------------------------------------------------------------------------------
// Max offer
// ---------------------------------------------------------------------------------------------

function maxOfferSection(a: Analysis): string {
  const price = analyzedPriceOf(a);
  const rent = monthlyRentOf(a);
  const lpc = a.evaluation.listPriceComparison;
  const target = `${Number(a.targetCashOnCashPct.toFixed(2))}%`;

  const callouts: string[] = [];
  callouts.push(
    `<div class="callout hero"><div class="k">Max allowable offer</div><div class="v">${a.maxOfferPrice === null ? "Not reachable" : usd(a.maxOfferPrice)}</div><div class="d">${
      a.maxOfferPrice === null ? `No price reaches ${esc(target)} cash-on-cash with these assumptions` : `Highest price that still reaches ${esc(target)} cash-on-cash`
    }</div></div>`,
  );
  if (price !== null) {
    let detail = "The price this report analyzes";
    if (lpc && lpc.discountPct !== 0) detail = `${pct(Math.abs(lpc.discountPct))} ${lpc.discountPct > 0 ? "below" : "above"} the ${usd(lpc.listPrice)} list price`;
    else if (lpc) detail = `Equal to the ${usd(lpc.listPrice)} list price`;
    callouts.push(`<div class="callout"><div class="k">Analyzed price</div><div class="v">${usd(price)}</div><div class="d">${esc(detail)}</div></div>`);
  }
  if (a.breakEvenRent !== null) {
    callouts.push(
      `<div class="callout"><div class="k">Rent for $0 cash flow</div><div class="v">${usd(a.breakEvenRent)}<span style="font-size:14px;font-weight:500"> /mo</span></div><div class="d">Assumed rent is ${usd(rent)} per month</div></div>`,
    );
  }

  const works: string[] = [];
  const li = (tone: StatusTone, text: string) => `<li>${icon(tone)}<span>${esc(text)}</span></li>`;
  if (a.maxOfferPrice === null) {
    works.push(li("poor", `Price alone cannot get there: no purchase price reaches the ${target} cash-on-cash target with the other assumptions unchanged.`));
  } else if (price !== null && a.maxOfferPrice >= price) {
    works.push(li("good", `Price: the analyzed ${usd(price)} already meets the ${target} target. You could pay up to ${usd(a.maxOfferPrice)} and still reach it.`));
  } else {
    works.push(li("ok", `Price: negotiate to ${usd(a.maxOfferPrice)} or lower to reach the ${target} target${price !== null ? ` (analyzed at ${usd(price)})` : ""}.`));
  }
  if (a.breakEvenRent !== null) {
    works.push(
      a.breakEvenRent > rent
        ? li("poor", `Rent: cash flow is negative at the assumed ${usd(rent)}; rent would need to reach about ${usd(a.breakEvenRent)} per month to cover all costs and debt.`)
        : li("good", `Rent: cash flow is positive at the assumed ${usd(rent)}; it would fall to $0 at about ${usd(a.breakEvenRent)} per month.`),
    );
  }
  const body = `<div class="callouts">${callouts.join("")}</div><h3>What would make this work</h3><ul class="works">${works.join("")}</ul>`;
  return section("maxOffer", "Max allowable offer", `Computed by the engine for your ${target} cash-on-cash target, holding every other assumption fixed.`, body);
}

// ---------------------------------------------------------------------------------------------
// Income and expenses
// ---------------------------------------------------------------------------------------------

function incomeSection(a: Analysis): string {
  const y1 = a.evaluation.yearOne;
  const e = y1.operatingExpenses;
  const m = (annual: number) => annual / 12;
  const rentMo = m(y1.grossAnnualRent);
  const rows = [
    { label: "Mortgage (principal + interest)", value: y1.monthlyPrincipalAndInterest },
    { label: "Property tax", value: m(e.propertyTax) },
    { label: "Insurance", value: m(e.insurance) },
    { label: "HOA", value: m(e.hoa) },
    { label: "Maintenance", value: m(e.maintenance) },
    { label: "CapEx reserve", value: m(e.capex) },
    { label: "Property management", value: m(e.management) },
    { label: "Vacancy allowance", value: m(y1.vacancyLoss) },
  ];
  const structure = [
    ["Gross rent", y1.grossAnnualRent],
    ["Vacancy loss", -y1.vacancyLoss],
    ["Effective rent", y1.effectiveRent],
    ["Operating expenses", -e.total],
    ["Net operating income (NOI)", y1.noi],
    ["Debt service", -y1.annualDebtService],
    ["Cash flow", y1.annualCashFlow],
  ] as const;
  const price = analyzedPriceOf(a);
  const rehab = assumptionValue(a, "rehabCost");
  const down = assumptionValue(a, "downPaymentPct");
  const closing = assumptionValue(a, "closingCostPct");

  const bars = `<p class="metaline"><span>Monthly rent <b>${usd(rentMo)}</b></span><span>Net monthly cash flow <b>${usd(y1.monthlyCashFlow)}</b></span></p>
${barRows(rows, rentMo)}
<div class="net-row"><span>Net monthly cash flow</span><span>${usd(y1.monthlyCashFlow)}</span></div>
<p class="chart-note">Year-one figures. Monthly values are the annual engine figures divided by 12; the bar scale is the monthly rent.</p>`;

  const structTable = `<table><caption>Year-one structure</caption><thead><tr><th>Line</th><th>Per year</th><th>Per month</th></tr></thead><tbody>${structure
    .map(
      ([label, v], i) =>
        `<tr${i === 2 || i === 4 || i === 6 ? ' style="font-weight:700"' : ""}><td>${esc(label)}</td><td class="num" data-label="Per year">${usd(v)}</td><td class="num" data-label="Per month">${usd(m(v))}</td></tr>`,
    )
    .join("")}</tbody></table>`;

  const cashRows: string[] = [];
  if (price !== null) cashRows.push(`<tr><td>Purchase price</td><td class="num" data-label="Amount">${usd(price)}</td></tr>`);
  cashRows.push(`<tr><td>Loan amount</td><td class="num" data-label="Amount">${usd(y1.loanAmount)}</td></tr>`);
  cashRows.push(`<tr style="font-weight:700"><td>Cash needed</td><td class="num" data-label="Amount">${usd(y1.cashInvested)}</td></tr>`);
  const includes = [
    down !== null ? `${Number(down.toFixed(2))}% down payment` : null,
    closing !== null ? `${Number(closing.toFixed(2))}% closing costs` : null,
    rehab !== null && rehab > 0 ? `${usd(rehab)} rehab` : null,
  ].filter(Boolean);
  const cashTable = `<table><caption>Cash needed at purchase</caption><thead><tr><th>Item</th><th>Amount</th></tr></thead><tbody>${cashRows.join("")}</tbody></table>${
    includes.length > 0 ? `<p class="chart-note">Cash needed includes ${esc(includes.join(", "))}.</p>` : ""
  }`;

  return section("income", "Income and expenses", "Where each month's rent goes in year one.", `${bars}<div class="grid2"><div class="scroll">${structTable}</div><div class="scroll">${cashTable}</div></div>`);
}

// ---------------------------------------------------------------------------------------------
// Returns and rules of thumb
// ---------------------------------------------------------------------------------------------

function returnsSection(a: Analysis): string {
  const y1 = a.evaluation.yearOne;
  const thr = (needle: string, fallback: string) => (checkFor(a, needle)?.threshold ?? fallback).replace(">=", "≥");
  const tone = (ok: boolean): StatusTone => (ok ? "good" : "poor");
  const row = (metric: string, value: string, benchmark: string, st: { tone: StatusTone; label: string }) =>
    `<tr><td>${esc(metric)}</td><td class="num" data-label="Value"><b>${esc(value)}</b></td><td data-label="Benchmark" class="l">${esc(benchmark)}</td><td data-label="Status" class="l">${status(st.tone, st.label)}</td></tr>`;
  const neutral = { tone: "neutral" as StatusTone, label: "For reference" };
  const pf = (ok: boolean, yes = "Meets", no = "Below") => ({ tone: tone(ok), label: ok ? yes : no });
  const rows = [
    row("Net operating income (per year)", usd(y1.noi), "Income after operating costs, before debt", neutral),
    row("Cap rate", pct(y1.capRatePct), thr("cap rate", "≥ 6%"), pf(checkFor(a, "cap rate")?.passed ?? y1.capRatePct >= 6)),
    row("Cash-on-cash return", pct(y1.cashOnCashPct), thr("cash-on-cash", "≥ 8%"), pf(checkFor(a, "cash-on-cash")?.passed ?? y1.cashOnCashPct >= 8)),
    row("Debt service coverage (DSCR)", y1.dscr === null ? "No loan" : ratio(y1.dscr), `${thr("debt service", "≥ 1.25")} (typical lender minimum)`, pf(y1.dscr === null || (checkFor(a, "debt service")?.passed ?? y1.dscr >= 1.25))),
    row("Gross rent multiplier", y1.grossRentMultiplier === null ? "n/a" : ratio(y1.grossRentMultiplier), "Lower is better; compare with similar local rentals", neutral),
    row("1% rule (monthly rent as % of price)", pct(y1.rentToPricePct, 2), "≥ 1% of price plus rehab", pf(y1.rentToPricePct >= 1)),
    row("50% rule (monthly cash flow)", usd(y1.fiftyPercentRuleMonthlyCashFlow), "Above $0 after debt, with half of rent going to operating costs", pf(y1.fiftyPercentRuleMonthlyCashFlow > 0, "Meets", "Below")),
    row("Break-even occupancy", y1.breakEvenOccupancyPct >= 999 ? "n/a" : pct(y1.breakEvenOccupancyPct), "Lower is safer; about 85% or less is comfortable", pf(y1.breakEvenOccupancyPct <= 85, "Comfortable", "Thin cushion")),
  ].join("");
  return section(
    "returns",
    "Returns and rules of thumb",
    "Year-one metrics. Cap rate, cash-on-cash and DSCR feed the verdict; the other rows are quick rules of thumb and do not change it.",
    `<div class="scroll"><table class="rt"><thead><tr><th>Metric</th><th>Value</th><th class="l">Benchmark</th><th class="l">Status</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  );
}

// ---------------------------------------------------------------------------------------------
// Long-term hold
// ---------------------------------------------------------------------------------------------

function holdSection(a: Analysis): string | null {
  const hold = a.evaluation.hold;
  if (hold.years.length === 0) return null;
  const N = hold.years.length;
  const callout = (k: string, month: number | null, none: string, detail: string) =>
    `<div class="callout"><div class="k">${esc(k)}</div><div class="v">${month === null ? esc(none) : `Month ${month}`}</div><div class="d">${esc(detail)}</div></div>`;
  const callouts = `<div class="callouts">${callout("Cash repaid by rent alone", hold.cashPaybackMonth, `Not within ${N} years`, "Cumulative cash flow has repaid the cash you put in")}${callout("Break-even including sale", hold.breakEvenMonth, `Not within ${N} years`, "Cash flow plus net sale proceeds first exceeds cash invested")}</div>`;

  const yearRows = hold.years
    .map(
      (r) =>
        `<tr><td>${r.year}</td><td class="num">${usd(r.cashFlow)}</td><td class="num">${usd(r.cumulativeCashFlow)}</td><td class="num">${usd(r.propertyValue)}</td><td class="num">${usd(r.loanBalance)}</td><td class="num">${usd(r.equity)}</td><td class="num">${usd(r.totalProfit)}</td></tr>`,
    )
    .join("");
  const yearTable = `<div class="scroll"><table class="yt"><caption>Year-by-year (the table view of the chart above)</caption><thead><tr><th>Year</th><th>Cash flow</th><th>Cumulative cash flow</th><th>Property value</th><th>Loan balance</th><th>Equity</th><th>Profit if sold</th></tr></thead><tbody>${yearRows}</tbody></table></div>`;

  const horizonRows = hold.horizons
    .map((h) => `<tr><td>${h.years}&nbsp;years</td><td class="num">${usd(h.totalProfit)}</td><td class="num">${multiple(h.equityMultiple)}</td><td class="num">${h.irrPct === null ? "n/a" : pct(h.irrPct)}</td></tr>`)
    .join("");
  const horizons = `<h3>Returns by horizon</h3><div class="scroll"><table><thead><tr><th>Sell after</th><th>Total profit</th><th>Equity multiple</th><th>IRR</th></tr></thead><tbody>${horizonRows}</tbody></table></div>`;

  const chart = `<h3>Equity, profit if sold, and loan balance</h3>${holdChart(hold.years, hold.breakEvenMonth, hold.cashPaybackMonth)}<p class="chart-note">Hover or tap the chart for exact values by year. Profit if sold = cumulative cash flow plus net sale proceeds (after selling costs and the loan) minus cash invested.</p>`;
  return section("hold", "Long-term hold", `Month-by-month projection over the ${N}-year hold, with rent and expense growth applied.`, `${callouts}${chart}${yearTable}${horizons}`);
}

// ---------------------------------------------------------------------------------------------
// Sensitivity
// ---------------------------------------------------------------------------------------------

const unique = (xs: number[]) => [...new Set(xs)].sort((p, q) => p - q);

function sensitivitySection(a: Analysis): { html: string | null; reason?: string } {
  const rec = reconstructEngineInput(a);
  if (!rec || !rec.reproduces) {
    return { html: null, reason: "Sensitivity grids are not shown: the saved assumptions could not be re-run to reproduce this analysis exactly (the calculation engine may have changed since it was saved)." };
  }
  const price = analyzedPriceOf(a);
  const rate = assumptionValue(a, "interestRatePct");
  const vacancy = assumptionValue(a, "vacancyPct");
  const rent = monthlyRentOf(a);
  if (price === null || rate === null || vacancy === null) return { html: null, reason: "Sensitivity grids are not shown: the price, rate, or vacancy assumption is missing." };

  const base = rec.input;
  const priceSteps = [-10, -5, 0, 5, 10];
  const prices = priceSteps.map((s) => (s === 0 ? price : Math.round((price * (1 + s / 100)) / 500) * 500));
  const rents = priceSteps.map((s) => (s === 0 ? rent : Math.round((rent * (1 + s / 100)) / 5) * 5));
  const rateOffsets = [-1, -0.5, 0, 0.5, 1].filter((o) => rate + o >= 0 && rate + o <= 30);
  const rates = rateOffsets.map((o) => Number((rate + o).toFixed(4)));
  const vacOffsets = [-4, -2, 0, 2, 4].filter((o) => vacancy + o >= 0 && vacancy + o <= 100);
  const vacs = vacOffsets.map((o) => Number((vacancy + o).toFixed(4)));
  if (unique(prices).length !== prices.length || unique(rents).length !== rents.length) return { html: null, reason: "Sensitivity grids are not shown: the price or rent is too small to vary meaningfully." };

  const g1 = sensitivity(base, "purchasePrice", prices, "interestRatePct", rates, (e) => e.yearOne.monthlyCashFlow);
  const g2 = sensitivity(base, "monthlyRent", rents, "vacancyPct", vacs, (e) => e.yearOne.cashOnCashPct);

  const k = (n: number) => `$${Number((n / 1000).toFixed(1)).toLocaleString("en-US")}k`;
  const delta = (s: number): string | undefined => (s === 0 ? "base" : `${s > 0 ? "+" : "-"}${Math.abs(s)}%`);
  const ptDelta = (o: number, unit: string): string => (o === 0 ? "base" : `${o > 0 ? "+" : "-"}${Math.abs(o)} ${unit}`);
  const hdr = (main: string, sub?: string): HeatHeader => (sub === undefined ? { main } : { main, sub });

  const grid1 = heatGrid({
    caption: "Monthly cash flow: purchase price by interest rate",
    xLabel: "Price",
    yLabel: "Rate",
    xHeaders: prices.map((p, i) => hdr(k(p), delta(priceSteps[i]!))),
    yHeaders: rates.map((r, i) => hdr(`${Number(r.toFixed(2))}%`, ptDelta(rateOffsets[i]!, "pt"))),
    cells: g1.cells,
    format: (n) => usd(n),
    baseX: 2,
    baseY: rateOffsets.indexOf(0),
  });
  const grid2 = heatGrid({
    caption: "Cash-on-cash return: monthly rent by vacancy",
    xLabel: "Rent",
    yLabel: "Vacancy",
    xHeaders: rents.map((r, i) => hdr(usd(r), delta(priceSteps[i]!))),
    yHeaders: vacs.map((v, i) => hdr(`${Number(v.toFixed(2))}%`, ptDelta(vacOffsets[i]!, "pt"))),
    cells: g2.cells,
    format: (n) => pct(n),
    baseX: 2,
    baseY: vacOffsets.indexOf(0),
  });
  const body = `${heatLegend()}<div class="grid2"><div class="heat-wrap">${grid1}</div><div class="heat-wrap">${grid2}</div></div><p class="chart-note">Each cell re-runs the engine with only the two named inputs changed. Colors diverge around zero (blue above, red below); every cell also prints its number.</p>`;
  return { html: section("sensitivity", "Sensitivity", "How much the answer moves when price, rate, rent, or vacancy move.", body) };
}

// ---------------------------------------------------------------------------------------------
// Comps
// ---------------------------------------------------------------------------------------------

function matchTag(c: Comp): string {
  if (c.matchClass === "different-size") return `<span class="tag fb">Different size: fallback</span>`;
  if (c.matchClass === "same-building") return `<span class="tag same">Same building</span>`;
  return `<span class="tag same">Same size</span>`;
}

function compMeta(result: CompResult, extra: string): string {
  const conf = CONFIDENCE[result.confidence];
  const est = result.estimate;
  return `<p class="metaline"><span>Search step reached: <b>${esc(STEP_LABEL[result.stepReached])}</b></span>${
    result.radiusUsedMiles !== null ? `<span>Radius: <b>${esc(miles(result.radiusUsedMiles))}</b></span>` : ""
  }<span>${status(conf.tone, conf.label)}</span>${est ? `<span>Range: <b>${usd(est.low)} to ${usd(est.high)}</b> (median ${usd(est.median)})</span>` : ""}${extra}</p>`;
}

function provLine(a: Analysis, key: string): string {
  const p = a.market.provenance[key];
  if (!p) return "";
  return `<p class="chart-note">Source: ${esc(p.provider)}, fetched ${esc(fmtDate(p.fetchedAt))}${p.cached ? " (cached)" : ""}.</p>`;
}

function rentCompsBlock(a: Analysis, r: CompResult): string {
  const rent = monthlyRentOf(a);
  let compare = "";
  if (r.estimate) {
    const med = r.estimate.median;
    const rel = Math.round(rent) === Math.round(med) ? "the same as" : rent > med ? "above" : "below";
    const src = a.assumptions.find((x) => x.field === "monthlyRent")?.source;
    compare = `<p class="note-box">The rent assumed in this analysis (${usd(rent)}) is ${rel} the comp median (${usd(med)})${src === "provided" ? "; you supplied it" : src === "listing" ? "; it came from the listing" : ""}.</p>`;
  }
  let table = "";
  if (r.comps.length > 0) {
    const rows = r.comps
      .map((c) => {
        const size = [c.beds !== undefined ? `${num(c.beds)} bd` : null, c.baths !== undefined ? `${num(c.baths, c.baths % 1 ? 1 : 0)} ba` : null, c.sqft !== undefined ? `${num(c.sqft)} sqft` : null].filter(Boolean).join(" · ");
        const amount = c.adjustedAmount !== undefined ? `<span>${usd(c.amount)}<span class="adj">${usd(c.adjustedAmount)} adjusted</span></span>` : usd(c.amount);
        return `<tr><td>${esc(c.address)}</td><td class="num" data-label="Distance">${esc(miles(c.distanceMiles))}</td><td data-label="Size" class="l">${esc(size || "n/a")}</td><td class="num" data-label="Rent">${amount}</td><td data-label="Listing" class="l">${esc(KIND_LABEL[c.kind])}, ${esc(fmtDate(c.date))}</td><td data-label="Why chosen" class="l full">${matchTag(c)} ${esc(c.matchReason)}</td></tr>`;
      })
      .join("");
    table = `<div class="scroll"><table class="rt"><thead><tr><th>Address</th><th>Distance</th><th class="l">Size</th><th>Rent per month</th><th class="l">Asking or leased</th><th class="l">Why chosen</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else {
    table = `<p class="note-box">No usable rent comps were found, so rent was not checked against the market.</p>`;
  }
  const notes = r.notes.length > 0 ? `<ul class="src-list">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  return `<h3>Rent comps</h3>${compMeta(r, "")}${compare}${table}${notes}${provLine(a, "rentComps")}`;
}

function saleCompsBlock(a: Analysis, r: CompResult): string {
  let table = "";
  if (r.comps.length > 0) {
    const rows = r.comps
      .map((c) => {
        const size = [c.beds !== undefined ? `${num(c.beds)} bd` : null, c.sqft !== undefined ? `${num(c.sqft)} sqft` : null].filter(Boolean).join(" · ");
        return `<tr><td>${esc(c.address)}</td><td class="num" data-label="Distance">${esc(miles(c.distanceMiles))}</td><td data-label="Size" class="l">${esc(size || "n/a")}</td><td class="num" data-label="Price">${usd(c.amount)}</td><td data-label="Status" class="l">${esc(KIND_LABEL[c.kind])}, ${esc(fmtDate(c.date))}</td><td data-label="Why chosen" class="l full">${matchTag(c)} ${esc(c.matchReason)}</td></tr>`;
      })
      .join("");
    table = `<div class="scroll"><table class="rt"><thead><tr><th>Address</th><th>Distance</th><th class="l">Size</th><th>Price</th><th class="l">Status</th><th class="l">Why chosen</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else {
    table = `<p class="note-box">No usable sale comps were found, so the price was not checked against nearby sales.</p>`;
  }
  const list = a.property.listPrice;
  const implied = r.estimate && list !== undefined ? `<p class="note-box">Nearby sales imply about ${usd(r.estimate.median)} for this property (range ${usd(r.estimate.low)} to ${usd(r.estimate.high)}), against a list price of ${usd(list)}.</p>` : "";
  const notes = r.notes.length > 0 ? `<ul class="src-list">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  return `<h3>Sale comps</h3>${compMeta(r, "")}${implied}${table}${notes}${provLine(a, "saleComps")}`;
}

function compsSection(a: Analysis, autoNotes: DataNote[]): string | null {
  const parts: string[] = [];
  if (a.market.rentComps) parts.push(rentCompsBlock(a, a.market.rentComps));
  else addMissing(a, "rentComps", autoNotes);
  if (a.market.saleComps) parts.push(saleCompsBlock(a, a.market.saleComps));
  else addMissing(a, "saleComps", autoNotes);
  if (parts.length === 0) return null;
  return section("comps", "Rent and sale comps", "Nearest first. Same-size matches are used before different-size ones; any different-size fallback is tagged.", parts.join(""));
}

/** When a dataset is missing and no data note already explains it, add one so the gap is never silent. */
function addMissing(a: Analysis, key: "rentComps" | "saleComps" | "schools", autoNotes: DataNote[]): void {
  if (a.dataNotes.some((n) => n.section === key)) return;
  autoNotes.push({ section: key, severity: "info", message: `${SECTION_NOTE_KEY[key]} were not available for this report, so that section is left out.` });
}

// ---------------------------------------------------------------------------------------------
// Schools, advisory, assumptions, notes, footer
// ---------------------------------------------------------------------------------------------

const LEVEL: Record<School["level"], string> = { elementary: "Elementary", middle: "Middle", high: "High", other: "Other" };

function schoolsSection(schools: School[]): string {
  const rows = schools
    .map((s) => {
      const rating =
        s.rating === undefined
          ? `<span class="status t-neutral">${icon("neutral", true)}Not rated</span>`
          : `<span class="rating"><b>${Number(s.rating.toFixed(1))}/10</b><span class="meter" aria-hidden="true"><i style="width:${(s.rating * 10).toFixed(0)}%"></i></span></span>`;
      const assigned =
        s.assigned === true ? status("good", "Assigned school") : s.assigned === false ? status("neutral", "Not the assigned school") : status("ok", "Assignment unconfirmed");
      return `<tr><td>${esc(s.name)}</td><td data-label="Level" class="l">${esc(LEVEL[s.level])}</td><td data-label="Rating" class="l">${rating}</td><td data-label="Distance" class="num">${esc(miles(s.distanceMiles))}</td><td data-label="Assignment" class="l">${assigned}</td></tr>`;
    })
    .join("");
  const attributions = [...new Set(schools.map((s) => s.attribution).filter((x): x is string => !!x))];
  const attr = attributions.length > 0 ? `<ul class="src-list">${attributions.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";
  return section(
    "schools",
    "Nearby schools",
    "Facts from the school data provider, nearest first within each level. Ratings are one input, not a verdict on a school.",
    `<div class="scroll"><table class="rt"><thead><tr><th>School</th><th class="l">Level</th><th class="l">Rating</th><th>Distance</th><th class="l">Assignment</th></tr></thead><tbody>${rows}</tbody></table></div>${attr}<p class="note-box">Confirm school assignment and boundaries with the district before relying on them.</p>`,
  );
}

function advisorySection(a: Analysis): string {
  const items = a.advisoryFlags
    .map(
      (f) =>
        `<li>${icon(f.tone)}<div><b>${esc(f.title)} <span class="status t-${f.tone}" style="font-weight:500">(${esc(TONE_LABEL[f.tone])})</span></b><span class="d">${esc(f.detail)}</span></div></li>`,
    )
    .join("");
  return section(
    "advisory",
    "Advisory flags",
    null,
    `<p class="note-box">${infoIcon(true)} <b>Not included in the calculations.</b> These are signals noticed while reading the listing. They never change a number in this report.</p><ul class="flags">${items}</ul>`,
  );
}

function assumptionRows(a: Analysis): Array<{ field: string; value: number; source: Source; provider?: string; fetchedAt?: string; notes: string[] }> {
  const byField = new Map<string, ResolvedAssumption>();
  for (const r of a.assumptions) if (!byField.has(r.field)) byField.set(r.field, r);
  const evalByField = new Map(a.evaluation.assumptions.map((r) => [r.field, r]));
  const fields = ["purchasePrice", "monthlyRent", ...ENGINE_ASSUMPTION_FIELDS];
  const extra = [...byField.keys(), ...evalByField.keys()].filter((f) => !fields.includes(f));
  const out: ReturnType<typeof assumptionRows> = [];
  const seen = new Set<string>();
  for (const f of [...fields, ...extra]) {
    if (seen.has(f)) continue;
    seen.add(f);
    const r = byField.get(f);
    const e = evalByField.get(f);
    let value = r?.value ?? e?.value;
    let source: Source | undefined = r?.source ?? e?.source;
    if (f === "purchasePrice" && value === undefined) {
      value = analyzedPriceOf(a) ?? undefined;
      source = byField.get("offerPrice")?.source ?? "provided";
    }
    if (f === "monthlyRent" && value === undefined) {
      value = monthlyRentOf(a);
      source = "assumed";
    }
    if (value === undefined || source === undefined) continue;
    const notes = [r?.note, e?.note].filter((x): x is string => !!x);
    const row: (typeof out)[number] = { field: f, value, source, notes: [...new Set(notes)] };
    if (r?.provenance) {
      row.provider = r.provenance.provider;
      row.fetchedAt = r.provenance.fetchedAt;
    }
    out.push(row);
  }
  return out;
}

function assumptionsSection(a: Analysis): string {
  const rows = assumptionRows(a)
    .map((r) => {
      const badge = sourceBadge({ source: r.source, ...(r.provider ? { provider: r.provider } : {}), ...(r.fetchedAt ? { fetchedAt: r.fetchedAt } : {}) });
      return `<tr><td>${esc(fieldLabel(r.field))}</td><td class="num" data-label="Value"><b>${esc(fieldValue(r.field, r.value))}</b></td><td data-label="Source" class="l">${badge}</td><td data-label="Note" class="l full${r.notes.length === 0 ? " empty" : ""}">${r.notes.map(esc).join(" ")}</td></tr>`;
    })
    .join("");
  const prov = Object.entries(a.market.provenance);
  const provList =
    prov.length > 0
      ? `<h3>Data sources</h3><ul class="src-list">${prov
          .map(([k, p]) => `<li>${esc(SECTION_NOTE_KEY[k] ?? k)}: ${esc(p.provider)}, fetched ${esc(fmtDate(p.fetchedAt))}${p.cached ? " (cached)" : ""}${p.confidence ? `, ${esc(p.confidence)} confidence` : ""}${p.note ? `. ${esc(p.note)}` : ""}</li>`)
          .join("")}</ul>`
      : "";
  return section(
    "assumptions",
    "Assumptions",
    "Every input behind the numbers and where it came from. Provided values are yours; assumed defaults are conservative placeholders to replace with real figures.",
    `<div class="scroll"><table class="rt"><thead><tr><th>Assumption</th><th>Value</th><th class="l">Source</th><th class="l">Note</th></tr></thead><tbody>${rows}</tbody></table></div>${provList}`,
  );
}

function dataNotesSection(notes: DataNote[], auto: DataNote[]): string | null {
  const all = [...notes, ...auto];
  if (all.length === 0) return null;
  const items = all
    .map((n) => {
      const warn = n.severity === "warning";
      return `<li>${warn ? icon("ok") : infoIcon()}<div><span class="sec">${esc(n.section)} · ${warn ? "Warning" : "Note"}</span>${esc(n.message)}</div></li>`;
    })
    .join("");
  return `<section class="card" id="data-notes" aria-labelledby="data-notes-h"><h2 id="data-notes-h">Data notes</h2><p class="sub">What was missing, limited, or estimated in this report.</p><ul class="dnotes">${items}</ul></section>`;
}

function footerBlock(model: ReportModel): string {
  const a = model.analysis;
  return `<footer class="disclaimer"><p>${esc(DISCLAIMER)}</p><p>Generated ${esc(fmtDate(model.generatedAt))} · calculation engine v${esc(a.engineVersion)} · report version ${model.version}${model.options.preparedBy ? ` · prepared by ${esc(model.options.preparedBy)}` : ""}</p></footer>`;
}

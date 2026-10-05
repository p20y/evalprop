import type { Analysis, CardModel, ComparisonRow, ResolvedAssumption, Verdict } from "@evalprop/shared";
import { FIELD_LABELS, formatField, pct, ratio, round2, usd } from "./format.ts";

/**
 * Stage 8 (ARCHITECTURE §7.1): the card and the summary are pure functions of the SAVED analysis.
 * Nothing here reads a provider, the clock, or the request, so a retry, a what-if, and the report all
 * show the same numbers for the same analysis, and a test can prove it (`summary.test.ts`).
 */

export const VERDICT_LABELS: Record<Verdict, string> = {
  strong: "Strong deal",
  good: "Good deal",
  marginal: "Proceed with caution",
  weak: "Weak deal",
};

function assumption(analysis: Analysis, field: string): ResolvedAssumption {
  const found = analysis.assumptions.find((a) => a.field === field);
  if (found === undefined) throw new Error(`analysis ${analysis.id} has no ${field} assumption`);
  return found;
}

/** IRR at ten years, or null when the hold period is shorter than that. */
export function irr10(analysis: Analysis): number | null {
  return analysis.evaluation.hold.horizons.find((h) => h.years === 10)?.irrPct ?? null;
}

export function buildCard(analysis: Analysis, reportUrl: string): CardModel {
  const { evaluation: ev } = analysis;
  const price = assumption(analysis, "offerPrice").value;
  const rent = assumption(analysis, "monthlyRent");
  const max = analysis.maxOfferPrice;
  return {
    analysisId: analysis.id,
    address: analysis.property.formattedAddress,
    listPrice: analysis.property.listPrice ?? null,
    analyzedPrice: price,
    monthlyRent: rent.value,
    rentSource: rent.source,
    verdict: ev.verdict,
    verdictLabel: VERDICT_LABELS[ev.verdict],
    metrics: {
      monthlyCashFlow: round2(ev.yearOne.monthlyCashFlow),
      cashOnCashPct: round2(ev.yearOne.cashOnCashPct),
      capRatePct: round2(ev.yearOne.capRatePct),
      dscr: ev.yearOne.dscr === null ? null : round2(ev.yearOne.dscr),
    },
    maxOffer:
      max === null
        ? null
        : {
            price: Math.round(max),
            targetCashOnCashPct: analysis.targetCashOnCashPct,
            // How far the max offer sits from the analyzed price: a presentation ratio of two engine outputs.
            vsAnalyzedPricePct: round2(((max - price) / price) * 100),
          },
    breakEvenMonth: ev.hold.breakEvenMonth,
    irr10Pct: irr10(analysis) === null ? null : round2(irr10(analysis) as number),
    compsConfidence: analysis.market.rentComps?.confidence ?? null,
    reportUrl,
    // Only what degraded: info-level notes stay in the saved analysis and the report.
    dataNotes: analysis.dataNotes.filter((n) => n.severity === "warning").map((n) => n.message),
  };
}

function rentOrigin(analysis: Analysis, rent: ResolvedAssumption): string {
  if (rent.source === "provided") return "the rent you supplied";
  if (rent.source === "listing") return "the actual rent from the listing";
  const median = analysis.market.rentComps?.estimate?.median;
  return median !== undefined && Math.round(median) === Math.round(rent.value)
    ? "the median of nearby comparable rentals"
    : "the data provider's automated estimate, which is low confidence";
}

/**
 * Plain-language read for the assistant to relay. Every number below is read from `analysis` (through the
 * card, which is itself built from it), never computed from model output and never typed in.
 */
export function buildSummary(analysis: Analysis, card: CardModel): string {
  const ev = analysis.evaluation;
  const rent = assumption(analysis, "monthlyRent");
  const parts: string[] = [];

  parts.push(`Verdict for ${card.address}: ${card.verdictLabel}.`);

  const cmp = ev.listPriceComparison;
  let against = "";
  if (cmp !== undefined && Math.abs(cmp.discountAmount) >= 1) {
    against = ` (${pct(Math.abs(cmp.discountPct))} ${cmp.discountAmount > 0 ? "below" : "above"} the ${usd(cmp.listPrice)} list price)`;
  }
  const dscr = card.metrics.dscr === null ? "no loan to cover" : `a DSCR of ${ratio(card.metrics.dscr)}`;
  parts.push(
    `At ${usd(card.analyzedPrice)}${against}, rent is ${usd(card.monthlyRent)} a month (${rentOrigin(analysis, rent)}). ` +
      `That gives monthly cash flow of ${usd(card.metrics.monthlyCashFlow)}, cash-on-cash of ${pct(card.metrics.cashOnCashPct)}, ` +
      `a cap rate of ${pct(card.metrics.capRatePct)} and ${dscr}.`,
  );

  const target = pct(analysis.targetCashOnCashPct);
  if (card.maxOffer === null) {
    parts.push(`No purchase price reaches the ${target} cash-on-cash target with these assumptions.`);
  } else {
    const delta = card.maxOffer.vsAnalyzedPricePct;
    const where =
      Math.abs(delta) < 0.05
        ? "about the analyzed price"
        : delta < 0
          ? `${pct(Math.abs(delta))} below the analyzed price`
          : `${pct(delta)} above the analyzed price, so there is room`;
    parts.push(`For a cash-on-cash return of ${target}, the most to pay is ${usd(card.maxOffer.price)}, ${where}.`);
  }

  if (card.metrics.monthlyCashFlow <= 0 && analysis.breakEvenRent !== null) {
    parts.push(`Monthly rent would need to reach about ${usd(analysis.breakEvenRent)} for cash flow to break even.`);
  }

  if (card.breakEvenMonth !== null) {
    parts.push(`Counting sale proceeds after selling costs, the investment breaks even in month ${card.breakEvenMonth}.`);
  } else {
    parts.push("The investment does not break even within the hold period.");
  }
  if (card.irr10Pct !== null) parts.push(`The ten-year IRR is ${pct(card.irr10Pct)}.`);

  if (card.dataNotes.length > 0) parts.push(`Data caveats: ${card.dataNotes.join(" ")}`);
  parts.push("Informational only; not investment, tax, or legal advice.");
  return parts.join(" ");
}

/** Before/after rows for a what-if, read from the two saved analyses. */
export function buildComparisonRows(before: Analysis, after: Analysis): ComparisonRow[] {
  const b = before.evaluation;
  const a = after.evaluation;
  return [
    { metric: "monthlyCashFlow", label: "Monthly cash flow", before: round2(b.yearOne.monthlyCashFlow), after: round2(a.yearOne.monthlyCashFlow) },
    { metric: "cashOnCashPct", label: "Cash-on-cash return (%)", before: round2(b.yearOne.cashOnCashPct), after: round2(a.yearOne.cashOnCashPct) },
    { metric: "dscr", label: "DSCR", before: b.yearOne.dscr === null ? null : round2(b.yearOne.dscr), after: a.yearOne.dscr === null ? null : round2(a.yearOne.dscr) },
    { metric: "breakEvenMonth", label: "Break-even month", before: b.hold.breakEvenMonth, after: a.hold.breakEvenMonth },
    { metric: "irr10Pct", label: "10-year IRR (%)", before: irr10(before) === null ? null : round2(irr10(before) as number), after: irr10(after) === null ? null : round2(irr10(after) as number) },
    { metric: "cashInvested", label: "Cash invested", before: round2(b.yearOne.cashInvested), after: round2(a.yearOne.cashInvested) },
  ];
}

/** Assumptions the user overrode in this what-if that actually changed a value. */
export function changedOverrides(before: Analysis, after: Analysis): Array<{ field: string; from: number; to: number }> {
  const out: Array<{ field: string; from: number; to: number }> = [];
  for (const a of after.assumptions) {
    if (a.source !== "provided") continue;
    const prev = before.assumptions.find((x) => x.field === a.field);
    if (prev === undefined || prev.value !== a.value) out.push({ field: a.field, from: prev?.value ?? Number.NaN, to: a.value });
  }
  return out;
}

const fmtRow = (row: ComparisonRow, f: (n: number) => string): string =>
  `${row.before === null ? "not available" : f(row.before)} to ${row.after === null ? "not available" : f(row.after)}`;

export function buildWhatIfSummary(before: Analysis, after: Analysis, rows: ComparisonRow[], card: CardModel): string {
  const changed = changedOverrides(before, after);
  const parts: string[] = [];
  parts.push(`What-if for ${card.address}: ${card.verdictLabel} (it was ${VERDICT_LABELS[before.evaluation.verdict]}).`);
  parts.push(
    changed.length === 0
      ? "None of the overrides changed a value."
      : `Changed: ${changed.map((c) => `${FIELD_LABELS[c.field]?.label ?? c.field} to ${formatField(c.field, c.to)}`).join(", ")}.`,
  );
  const row = (m: ComparisonRow["metric"]) => rows.find((r) => r.metric === m) as ComparisonRow;
  parts.push(
    `Monthly cash flow goes from ${fmtRow(row("monthlyCashFlow"), usd)}; ` +
      `cash-on-cash from ${fmtRow(row("cashOnCashPct"), (n) => pct(n))}; ` +
      `DSCR from ${fmtRow(row("dscr"), ratio)}; ` +
      `cash invested from ${fmtRow(row("cashInvested"), usd)}.`,
  );
  parts.push(
    `Break-even month goes from ${fmtRow(row("breakEvenMonth"), (n) => `month ${n}`)}, and the ten-year IRR from ${fmtRow(row("irr10Pct"), (n) => pct(n))}.`,
  );
  if (card.maxOffer !== null) {
    parts.push(`For a cash-on-cash return of ${pct(card.maxOffer.targetCashOnCashPct)}, the most to pay is now ${usd(card.maxOffer.price)}.`);
  }
  if (card.dataNotes.length > 0) parts.push(`Data caveats: ${card.dataNotes.join(" ")}`);
  parts.push("Informational only; not investment, tax, or legal advice.");
  return parts.join(" ");
}

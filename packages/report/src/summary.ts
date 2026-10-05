import type { Analysis, Verdict } from "@evalprop/shared";
import { multiple, pct, usd } from "./format.ts";
import { analyzedPriceOf, assumptionValue, monthlyRentOf } from "./input.ts";

export const VERDICT_LABEL: Record<Verdict, string> = {
  strong: "Strong candidate",
  good: "Good candidate",
  marginal: "Proceed with caution",
  weak: "Weak at this price",
};

export interface ReportSummary {
  /** One sentence for the verdict banner. */
  headline: string;
  /** The executive summary, one sentence each. */
  sentences: string[];
}

/** "25%" or "6.75%": no trailing zeros, at most two decimals. */
const pctTrim = (n: number) => `${Number(n.toFixed(2))}%`;

/** ">= 8%" becomes "at least 8%" so the sentence reads as prose. */
const thresholdPhrase = (t: string) => t.replace(/^>=\s*/, "at least ").replace(/^>\s*/, "more than ").replace(/^<=\s*/, "at most ").replace(/^<\s*/, "less than ");

const lowerFirst = (s: string) => (s.length > 0 ? s[0]!.toLowerCase() + s.slice(1) : s);

/**
 * The executive summary. Every sentence is assembled from fields of the saved analysis (engine output,
 * comp-selection output, and the resolved assumptions), never from model-written text. The only numbers it
 * can contain are values from the analysis, counts of items in it (checks passed, comps used), or those
 * values formatted for display; `summary.test.ts` checks that for every fixture.
 */
export function buildSummary(a: Analysis): ReportSummary {
  const y1 = a.evaluation.yearOne;
  const hold = a.evaluation.hold;
  const price = analyzedPriceOf(a);
  const rent = monthlyRentOf(a);
  const down = assumptionValue(a, "downPaymentPct");
  const rate = assumptionValue(a, "interestRatePct");
  const holdYears = assumptionValue(a, "holdYears");
  const checks = a.evaluation.checks;
  const passed = checks.filter((c) => c.passed);
  const failed = checks.filter((c) => !c.passed);

  const headline =
    `Projected cash flow of ${usd(y1.monthlyCashFlow)} per month and a ${pct(y1.cashOnCashPct)} cash-on-cash return; ` +
    `it passes ${passed.length} of ${checks.length} screening checks.`;

  const sentences: string[] = [];

  // 1. The deal in one line.
  const financing =
    price !== null && down !== null && rate !== null ? `At ${usd(price)} with ${pctTrim(down)} down at a ${pctTrim(rate)} interest rate, the` : "The";
  sentences.push(
    `${financing} property is projected to ${y1.monthlyCashFlow >= 0 ? "produce" : "lose"} ${usd(Math.abs(y1.monthlyCashFlow))} per month after operating expenses and debt service ` +
      `(${pct(y1.cashOnCashPct)} cash-on-cash on ${usd(y1.cashInvested)} invested, ${pct(y1.capRatePct)} cap rate).`,
  );

  // 2. The scorecard.
  if (checks.length > 0) {
    if (failed.length === 0) {
      sentences.push(`It passes all ${checks.length} screening checks.`);
    } else {
      const misses = failed.map((c) => `${lowerFirst(c.name)} (${c.actual}, needs ${thresholdPhrase(c.threshold)})`);
      const list = misses.length > 1 ? `${misses.slice(0, -1).join(", ")} and ${misses[misses.length - 1]}` : misses[0];
      sentences.push(`It passes ${passed.length} of ${checks.length} screening checks and falls short on ${list}.`);
    }
  }

  // 3. Max offer and list price.
  if (a.maxOfferPrice === null) {
    sentences.push(`No purchase price reaches the ${pctTrim(a.targetCashOnCashPct)} cash-on-cash target with the other assumptions unchanged.`);
  } else if (price !== null && a.maxOfferPrice >= price) {
    sentences.push(
      `The analyzed price already meets your ${pctTrim(a.targetCashOnCashPct)} cash-on-cash target; the highest price that still reaches it is ${usd(a.maxOfferPrice)}.`,
    );
  } else {
    sentences.push(
      `To reach your ${pctTrim(a.targetCashOnCashPct)} cash-on-cash target, the purchase price would need to be ${usd(a.maxOfferPrice)} or less` +
        (price !== null ? ` (analyzed at ${usd(price)}).` : "."),
    );
  }
  const lpc = a.evaluation.listPriceComparison;
  if (lpc && lpc.discountPct !== 0) {
    sentences.push(
      `The analyzed price is ${pct(Math.abs(lpc.discountPct))} ${lpc.discountPct > 0 ? "below" : "above"} the list price of ${usd(lpc.listPrice)}.`,
    );
  }

  // 4. Rent needed to break even.
  if (a.breakEvenRent !== null) {
    sentences.push(`Cash flow reaches $0 at about ${usd(a.breakEvenRent)} per month in rent, against the ${usd(rent)} assumed.`);
  }

  // 5. Payback and break-even.
  const window = holdYears !== null ? `the ${holdYears}-year hold` : "the hold period";
  if (hold.breakEvenMonth === null) {
    sentences.push(`Counting equity and sale proceeds after selling costs, it does not break even within ${window}.`);
  } else {
    const payback =
      hold.cashPaybackMonth === null
        ? `rental cash flow alone does not repay your cash invested within ${window}`
        : `rental cash flow alone repays your cash invested in month ${hold.cashPaybackMonth}`;
    sentences.push(`Counting equity and sale proceeds after selling costs, you break even in month ${hold.breakEvenMonth}; ${payback}.`);
  }

  // 6. A long-horizon return.
  const horizon = hold.horizons.find((h) => h.years === 10) ?? hold.horizons[hold.horizons.length - 1];
  if (horizon) {
    const irr = horizon.irrPct === null ? "" : `, an IRR of ${pct(horizon.irrPct)}`;
    sentences.push(`Over ${horizon.years} years the projected total profit if sold is ${usd(horizon.totalProfit)}${irr} and a ${multiple(horizon.equityMultiple)} equity multiple.`);
  }

  // 7. Where the rent came from.
  sentences.push(rentSentence(a, rent));

  // 8. Do nearby sales support the price?
  const sale = a.market.saleComps;
  if (sale?.estimate && a.property.listPrice !== undefined) {
    sentences.push(`Nearby sales imply a value of about ${usd(sale.estimate.median)} for this property, against a list price of ${usd(a.property.listPrice)}.`);
  }

  return { headline, sentences };
}

function rentSentence(a: Analysis, rent: number): string {
  const source = a.assumptions.find((r) => r.field === "monthlyRent")?.source;
  const comps = a.market.rentComps;
  const radius = comps?.radiusUsedMiles;
  const compFacts =
    comps && comps.estimate && comps.comps.length > 0
      ? `${comps.comps.length} rent comps${radius != null ? ` within ${radius} miles` : ""} give a median of ${usd(comps.estimate.median)} (confidence: ${comps.confidence})`
      : null;
  switch (source) {
    case "provided":
      return `The ${usd(rent)} monthly rent is the figure you supplied` + (compFacts ? `; ${compFacts}.` : "; no rent comps were available to check it.");
    case "listing":
      return `The ${usd(rent)} monthly rent is taken from the listing` + (compFacts ? `; ${compFacts}.` : "; no rent comps were available to check it.");
    case "lookup":
      return `The ${usd(rent)} monthly rent is looked up from nearby rent comps` + (compFacts ? `: ${compFacts}.` : ".");
    default:
      return `The ${usd(rent)} monthly rent is an assumed value and was not looked up.`;
  }
}

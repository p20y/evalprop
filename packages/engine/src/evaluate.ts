import { resolveInput } from "./defaults.ts";
import { holdAnalysis } from "./hold.ts";
import { yearOne } from "./yearOne.ts";
import type { Check, Evaluation, PropertyInput, Verdict } from "./types.ts";

const fmtPct = (n: number) => {
  const s = n.toFixed(1);
  return `${s === "-0.0" ? "0.0" : s}%`;
};
/** Whole dollars with the sign in front: "$1,200", "-$68" (never "$-68", never "-$0"). */
const fmtUsd = (n: number) => {
  const rounded = Math.round(n);
  return `${rounded < 0 ? "-" : ""}$${Math.abs(rounded).toLocaleString("en-US")}`;
};

/** Thresholds are deliberately simple and visible so the report can show why a verdict was reached. */
export function evaluate(input: PropertyInput): Evaluation {
  const { resolved, assumptions, listPrice } = resolveInput(input);
  const y1 = yearOne(resolved);
  const hold = holdAnalysis(resolved);

  const checks: Check[] = [
    {
      name: "Positive monthly cash flow",
      passed: y1.monthlyCashFlow > 0,
      actual: `${fmtUsd(y1.monthlyCashFlow)}/mo`,
      threshold: "> $0",
    },
    {
      name: "Cash-on-cash return",
      passed: y1.cashOnCashPct >= 8,
      actual: fmtPct(y1.cashOnCashPct),
      threshold: ">= 8%",
    },
    {
      name: "Cap rate",
      passed: y1.capRatePct >= 6,
      actual: fmtPct(y1.capRatePct),
      threshold: ">= 6%",
    },
    {
      name: "Debt service coverage",
      passed: y1.dscr === null || y1.dscr >= 1.25,
      actual: y1.dscr === null ? "no loan" : y1.dscr.toFixed(2),
      threshold: ">= 1.25",
    },
  ];

  const passed = checks.filter((c) => c.passed).length;
  const verdict: Verdict = passed === 4 ? "strong" : passed === 3 ? "good" : passed === 2 ? "marginal" : "weak";

  const evaluation: Evaluation = { verdict, checks, yearOne: y1, hold, assumptions };
  if (listPrice !== null) {
    const discountAmount = listPrice - resolved.purchasePrice;
    evaluation.listPriceComparison = {
      listPrice,
      purchasePrice: resolved.purchasePrice,
      discountAmount,
      discountPct: (discountAmount / listPrice) * 100,
    };
  }
  return evaluation;
}

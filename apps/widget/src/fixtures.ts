import type { AnalyzePropertyOutput, CardModel, WhatIfOutput } from "@evalprop/shared";

/**
 * Sample tool outputs for the component tests and the preview pages. Illustrative values, not market data.
 * The shapes are checked against the shared zod schemas in `fixtures.test.ts`.
 */

const base: CardModel = {
  analysisId: "an_fixture_1",
  address: "4417 S Quincy Ave, Tulsa, OK 74105",
  listPrice: 239000,
  analyzedPrice: 239000,
  monthlyRent: 2250,
  rentSource: "lookup",
  verdict: "marginal",
  verdictLabel: "Proceed with caution",
  metrics: { monthlyCashFlow: 17, cashOnCashPct: 0.3, capRatePct: 6.1, dscr: 1.01 },
  maxOffer: { price: 176000, targetCashOnCashPct: 8, vsAnalyzedPricePct: -26.36 },
  breakEvenMonth: 28,
  irr10Pct: 10.4,
  compsConfidence: "high",
  reportUrl: "https://app.example.test/r/an_fixture_1",
  dataNotes: [],
};

const out = (card: CardModel, summary = "Fixture summary."): AnalyzePropertyOutput => ({ card, summary });

export const strong: AnalyzePropertyOutput = out({
  ...base,
  analysisId: "an_fixture_strong",
  address: "812 Maple Ridge Dr, Indianapolis, IN 46227",
  listPrice: 189900,
  analyzedPrice: 175000,
  monthlyRent: 1895,
  rentSource: "listing",
  verdict: "strong",
  verdictLabel: "Strong deal",
  metrics: { monthlyCashFlow: 412.5, cashOnCashPct: 11.84, capRatePct: 8.2, dscr: 1.48 },
  maxOffer: { price: 181500, targetCashOnCashPct: 8, vsAnalyzedPricePct: 3.71 },
  breakEvenMonth: 12,
  irr10Pct: 16.72,
  compsConfidence: "high",
  usage: { used: 3, limit: 10, period: "this month" },
});

export const marginal: AnalyzePropertyOutput = out(base);

export const weak: AnalyzePropertyOutput = out({
  ...base,
  analysisId: "an_fixture_weak",
  address: "27 Harbor View Ter Unit 4B, Miami, FL 33139",
  listPrice: 615000,
  analyzedPrice: 615000,
  monthlyRent: 3100,
  rentSource: "assumed",
  verdict: "weak",
  verdictLabel: "Weak deal",
  metrics: { monthlyCashFlow: -1268.4, cashOnCashPct: -6.9, capRatePct: 2.4, dscr: 0.62 },
  maxOffer: { price: 402000, targetCashOnCashPct: 8, vsAnalyzedPricePct: -34.63 },
  breakEvenMonth: null,
  irr10Pct: 1.2,
  compsConfidence: "low",
});

/** Missing max offer, no IRR, no break-even, no comps, several warnings. */
export const degraded: AnalyzePropertyOutput = out({
  ...base,
  analysisId: "an_fixture_degraded",
  address: "Rural Route 2, Quietfield, MT 59000",
  listPrice: null,
  analyzedPrice: 210000,
  monthlyRent: 1400,
  rentSource: "provided",
  metrics: { monthlyCashFlow: -140, cashOnCashPct: -1.9, capRatePct: 4.8, dscr: 0.88 },
  maxOffer: null,
  breakEvenMonth: null,
  irr10Pct: null,
  compsConfidence: null,
  dataNotes: [
    "No comparable rentals were found within 10 miles, so the rent you supplied is used as is.",
    "Property tax is the county average; the actual bill may differ.",
    "School data was unavailable.",
  ],
});

/** All cash: no loan, so no DSCR. One data note (shown open). */
export const noLoan: AnalyzePropertyOutput = out({
  ...base,
  analysisId: "an_fixture_noloan",
  address: "1500 Oak St, Cleveland, OH 44113",
  listPrice: 145000,
  analyzedPrice: 140000,
  monthlyRent: 1350,
  rentSource: "lookup",
  verdict: "good",
  verdictLabel: "Good deal",
  metrics: { monthlyCashFlow: 905, cashOnCashPct: 7.4, capRatePct: 7.4, dscr: null },
  maxOffer: { price: 140000, targetCashOnCashPct: 7, vsAnalyzedPricePct: 0 },
  breakEvenMonth: 156,
  irr10Pct: 9.1,
  compsConfidence: "medium",
  dataNotes: ["Rent comps are older than 90 days."],
});

export const longAddress: AnalyzePropertyOutput = out({
  ...base,
  analysisId: "an_fixture_long",
  address:
    "Building C, Unit 12-B, The Residences at Extraordinarily-Long-Named-Development-Name-Phase-Two, 123456 North Southwest Boulevard Extension, Sprawling Metropolitan Township, California 90210-1234",
});

/** Hostile strings in every free-text field: must render as text, never as markup. */
export const hostile: AnalyzePropertyOutput = out({
  ...base,
  analysisId: "an_x\"><img src=x onerror=alert(1)>",
  address: `<img src=x onerror=alert(1)> 1 "Main" St & <script>alert('x')</script>`,
  verdictLabel: `<b>Strong</b> & "safe"`,
  reportUrl: "javascript:alert(1)",
  dataNotes: [`<script>alert(1)</script>`, `</details><svg onload=alert(2)>`, `Tom & Jerry's "note"`],
  usage: { used: 1, limit: 3, period: `<i>month</i>` },
});

export const whatIf: WhatIfOutput = {
  baseAnalysisId: "an_fixture_1",
  card: {
    ...base,
    analysisId: "an_fixture_whatif",
    analyzedPrice: 220000,
    verdict: "good",
    verdictLabel: "Good deal",
    metrics: { monthlyCashFlow: 268.75, cashOnCashPct: 4.9, capRatePct: 6.6, dscr: 1.16 },
    maxOffer: { price: 176000, targetCashOnCashPct: 8, vsAnalyzedPricePct: -20 },
    breakEvenMonth: 52,
    irr10Pct: 12.3,
  },
  rows: [
    { metric: "monthlyCashFlow", label: "Monthly cash flow", before: 17, after: 268.75 },
    { metric: "cashOnCashPct", label: "Cash-on-cash return (%)", before: 0.3, after: 4.9 },
    { metric: "dscr", label: "DSCR", before: 1.01, after: 1.16 },
    { metric: "breakEvenMonth", label: "Break-even month", before: 28, after: 52 },
    { metric: "irr10Pct", label: "10-year IRR (%)", before: 10.4, after: 12.3 },
    { metric: "cashInvested", label: "Cash invested", before: 66920, after: 61000 },
  ],
  summary: "Fixture what-if summary.",
};

/** A what-if where the metric lists include nulls and a change for the worse. */
export const whatIfEdges: WhatIfOutput = {
  ...whatIf,
  rows: [
    { metric: "monthlyCashFlow", label: "Monthly cash flow", before: 17, after: -90 },
    { metric: "cashOnCashPct", label: "Cash-on-cash return (%)", before: 0.3, after: 0.3 },
    { metric: "dscr", label: "DSCR", before: 1.01, after: null },
    { metric: "breakEvenMonth", label: "Break-even month", before: null, after: 90 },
    { metric: "irr10Pct", label: "10-year IRR (%)", before: 10.4, after: null },
    { metric: "cashInvested", label: "Cash invested", before: 66920, after: 140000 },
  ],
};

export const ANALYZE_FIXTURES = { strong, marginal, weak, degraded, noLoan, longAddress, hostile } as const;
export const WHAT_IF_FIXTURES = { whatIf, whatIfEdges } as const;

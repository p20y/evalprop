import { z } from "zod";

/** Mirrors the engine's output types (packages/engine). S01 adds a compile-time equivalence check. */
export const VerdictSchema = z.enum(["strong", "good", "marginal", "weak"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const CheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  actual: z.string(),
  threshold: z.string(),
});
export type Check = z.infer<typeof CheckSchema>;

export const YearOneMetricsSchema = z.object({
  grossAnnualRent: z.number(),
  vacancyLoss: z.number(),
  effectiveRent: z.number(),
  operatingExpenses: z.object({
    propertyTax: z.number(),
    insurance: z.number(),
    hoa: z.number(),
    maintenance: z.number(),
    capex: z.number(),
    management: z.number(),
    total: z.number(),
  }),
  noi: z.number(),
  loanAmount: z.number(),
  monthlyPrincipalAndInterest: z.number(),
  annualDebtService: z.number(),
  annualCashFlow: z.number(),
  monthlyCashFlow: z.number(),
  cashInvested: z.number(),
  capRatePct: z.number(),
  cashOnCashPct: z.number(),
  dscr: z.number().nullable(),
  /** null when rent is zero (never Infinity: JSON cannot carry it). */
  grossRentMultiplier: z.number().nullable(),
  rentToPricePct: z.number(),
  breakEvenOccupancyPct: z.number(),
  fiftyPercentRuleMonthlyCashFlow: z.number(),
});
export type YearOneMetrics = z.infer<typeof YearOneMetricsSchema>;

export const YearRowSchema = z.object({
  year: z.number().int(),
  grossRent: z.number(),
  operatingExpenses: z.number(),
  noi: z.number(),
  debtService: z.number(),
  cashFlow: z.number(),
  cumulativeCashFlow: z.number(),
  propertyValue: z.number(),
  loanBalance: z.number(),
  equity: z.number(),
  netSaleProceeds: z.number(),
  totalProfit: z.number(),
});
export type YearRow = z.infer<typeof YearRowSchema>;

export const HoldAnalysisSchema = z.object({
  years: z.array(YearRowSchema),
  cashPaybackMonth: z.number().int().nullable(),
  breakEvenMonth: z.number().int().nullable(),
  horizons: z.array(
    z.object({
      years: z.number().int(),
      totalProfit: z.number(),
      equityMultiple: z.number(),
      irrPct: z.number().nullable(),
    }),
  ),
});
export type HoldAnalysis = z.infer<typeof HoldAnalysisSchema>;

export const EvaluationSchema = z.object({
  verdict: VerdictSchema,
  checks: z.array(CheckSchema),
  yearOne: YearOneMetricsSchema,
  hold: HoldAnalysisSchema,
  assumptions: z.array(
    z.object({ field: z.string(), value: z.number(), source: z.enum(["provided", "assumed"]) }),
  ),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

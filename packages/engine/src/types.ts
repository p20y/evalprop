export type Source = "provided" | "assumed";

/** Numeric overrides the caller may supply; each falls back to a flagged default. */
export interface AssumptionInputs {
  downPaymentPct?: number;
  interestRatePct?: number;
  loanTermYears?: number;
  closingCostPct?: number;
  rehabCost?: number;
  propertyTaxAnnual?: number;
  insuranceAnnual?: number;
  hoaMonthly?: number;
  vacancyPct?: number;
  maintenancePct?: number;
  capexPct?: number;
  managementPct?: number;
  rentGrowthPct?: number;
  expenseGrowthPct?: number;
  appreciationPct?: number;
  sellingCostPct?: number;
  holdYears?: number;
}

/**
 * The price being analysed. Supply `purchasePrice`, or `offerPrice` as an alias for it
 * (if both are given they must be equal).
 */
export type PriceInput =
  | { purchasePrice: number; offerPrice?: number }
  | { offerPrice: number; purchasePrice?: number };

/** What the caller knows. Only a price and rent are required; everything else falls back to a flagged default. */
export type PropertyInput = AssumptionInputs &
  PriceInput & {
    monthlyRent: number;
    /** Asking price. When supplied, the evaluation reports the offer's discount versus list. */
    listPrice?: number;
    /** Two-letter US state code. Selects the property tax default in states that reassess on sale. */
    state?: string;
  };

/** Every numeric field the engine uses after defaults are applied. */
export type ResolvedInput = Required<AssumptionInputs> & { purchasePrice: number; monthlyRent: number };

export interface AssumptionRecord {
  field: string;
  value: number;
  source: Source;
  /** Why this value was chosen (e.g. a state reassessment default). Not yet in the shared EvaluationSchema. */
  note?: string;
}

export interface YearRow {
  year: number;
  grossRent: number;
  operatingExpenses: number;
  noi: number;
  debtService: number;
  cashFlow: number;
  cumulativeCashFlow: number;
  propertyValue: number;
  loanBalance: number;
  equity: number;
  /** Cash left after selling at year end: value less selling costs less loan balance. */
  netSaleProceeds: number;
  /** Cumulative cash flow + net sale proceeds - cash invested. */
  totalProfit: number;
}

export interface YearOneMetrics {
  grossAnnualRent: number;
  vacancyLoss: number;
  effectiveRent: number;
  operatingExpenses: {
    propertyTax: number;
    insurance: number;
    hoa: number;
    maintenance: number;
    capex: number;
    management: number;
    total: number;
  };
  noi: number;
  loanAmount: number;
  monthlyPrincipalAndInterest: number;
  annualDebtService: number;
  annualCashFlow: number;
  monthlyCashFlow: number;
  cashInvested: number;
  capRatePct: number;
  cashOnCashPct: number;
  /** null when there is no loan. */
  dscr: number | null;
  /** null when rent is zero (never Infinity). */
  grossRentMultiplier: number | null;
  /** Monthly rent as % of purchase price + rehab (the "1% rule"). */
  rentToPricePct: number;
  /** Occupancy needed for cash flow to hit zero, as %. Above 100 means it cannot break even at any occupancy. */
  breakEvenOccupancyPct: number;
  /** Rule-of-thumb check: half of rent goes to operating costs, then P&I comes out of the other half. */
  fiftyPercentRuleMonthlyCashFlow: number;
}

export interface HoldAnalysis {
  years: YearRow[];
  /** Month when cumulative cash flow alone has repaid cash invested; null if not within the horizon. */
  cashPaybackMonth: number | null;
  /** Month when cumulative cash flow plus net sale proceeds first exceeds cash invested; null if never. */
  breakEvenMonth: number | null;
  horizons: Array<{
    years: number;
    totalProfit: number;
    equityMultiple: number;
    irrPct: number | null;
  }>;
}

export type Verdict = "strong" | "good" | "marginal" | "weak";

export interface Check {
  name: string;
  passed: boolean;
  /** Display string for the measured value, e.g. "$250/mo", "7.2%". */
  actual: string;
  /** Display string for the pass line, e.g. ">= 8%". */
  threshold: string;
}

/** Offer versus asking price. Present only when `listPrice` was supplied. */
export interface ListPriceComparison {
  listPrice: number;
  purchasePrice: number;
  /** listPrice - purchasePrice. Positive = below list, negative = above list. */
  discountAmount: number;
  /** discountAmount as % of listPrice. */
  discountPct: number;
}

export interface Evaluation {
  verdict: Verdict;
  checks: Check[];
  yearOne: YearOneMetrics;
  hold: HoldAnalysis;
  assumptions: AssumptionRecord[];
  /** Not yet in the shared EvaluationSchema. */
  listPriceComparison?: ListPriceComparison;
}

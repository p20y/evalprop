export type Source = "provided" | "assumed";

/** What the caller knows. Only price and rent are required; everything else falls back to a flagged default. */
export interface PropertyInput {
  purchasePrice: number;
  monthlyRent: number;
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

export type ResolvedInput = Required<PropertyInput>;

export interface AssumptionRecord {
  field: keyof ResolvedInput;
  value: number;
  source: Source;
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
  grossRentMultiplier: number;
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
  actual: string;
  threshold: string;
}

export interface Evaluation {
  verdict: Verdict;
  checks: Check[];
  yearOne: YearOneMetrics;
  hold: HoldAnalysis;
  assumptions: AssumptionRecord[];
}

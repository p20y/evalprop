/** Display formatting for the summary text. Pure: every number it prints is an argument. */

/** "$1,234", "-$68" (sign first; never "$-68" or "-$0"). */
export function usd(n: number): string {
  const rounded = Math.round(n);
  return `${rounded < 0 ? "-" : ""}$${Math.abs(rounded).toLocaleString("en-US")}`;
}

/** "7.2%", "8%" when whole, never "-0.0%". */
export function pct(n: number, digits = 1): string {
  const fixed = n.toFixed(digits);
  const trimmed = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  return `${trimmed === "-0" ? "0" : trimmed}%`;
}

export function ratio(n: number): string {
  return n.toFixed(2);
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export type FieldKind = "usd" | "pct" | "years";

/** Human label and display kind for every field a user can set. */
export const FIELD_LABELS: Record<string, { label: string; kind: FieldKind }> = {
  offerPrice: { label: "offer price", kind: "usd" },
  monthlyRent: { label: "monthly rent", kind: "usd" },
  downPaymentPct: { label: "down payment", kind: "pct" },
  interestRatePct: { label: "interest rate", kind: "pct" },
  loanTermYears: { label: "loan term", kind: "years" },
  closingCostPct: { label: "closing costs", kind: "pct" },
  rehabCost: { label: "rehab cost", kind: "usd" },
  propertyTaxAnnual: { label: "annual property tax", kind: "usd" },
  insuranceAnnual: { label: "annual insurance", kind: "usd" },
  hoaMonthly: { label: "monthly HOA", kind: "usd" },
  vacancyPct: { label: "vacancy", kind: "pct" },
  maintenancePct: { label: "maintenance", kind: "pct" },
  capexPct: { label: "CapEx reserve", kind: "pct" },
  managementPct: { label: "management fee", kind: "pct" },
  rentGrowthPct: { label: "rent growth", kind: "pct" },
  expenseGrowthPct: { label: "expense growth", kind: "pct" },
  appreciationPct: { label: "appreciation", kind: "pct" },
  sellingCostPct: { label: "selling costs", kind: "pct" },
  holdYears: { label: "hold period", kind: "years" },
};

export function formatField(field: string, value: number): string {
  const kind = FIELD_LABELS[field]?.kind ?? "usd";
  if (kind === "pct") return pct(value, 2);
  if (kind === "years") return `${value} ${value === 1 ? "year" : "years"}`;
  return usd(value);
}

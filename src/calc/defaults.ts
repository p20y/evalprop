import type { AssumptionRecord, PropertyInput, ResolvedInput } from "./types.ts";

/** Defaults are conservative and always reported back as "assumed" so no number is silently invented. */
export function defaultsFor(input: PropertyInput): Omit<ResolvedInput, "purchasePrice" | "monthlyRent"> {
  return {
    downPaymentPct: 25,
    interestRatePct: 6.75,
    loanTermYears: 30,
    closingCostPct: 3,
    rehabCost: 0,
    propertyTaxAnnual: round2(input.purchasePrice * 0.011),
    insuranceAnnual: round2(input.purchasePrice * 0.005),
    hoaMonthly: 0,
    vacancyPct: 8,
    maintenancePct: 8,
    capexPct: 5,
    managementPct: 8,
    rentGrowthPct: 3,
    expenseGrowthPct: 3,
    appreciationPct: 3,
    sellingCostPct: 6,
    holdYears: 30,
  };
}

const RANGES: Partial<Record<keyof ResolvedInput, [number, number]>> = {
  purchasePrice: [1, 1e9],
  monthlyRent: [0, 1e6],
  downPaymentPct: [0, 100],
  interestRatePct: [0, 30],
  loanTermYears: [1, 50],
  closingCostPct: [0, 20],
  rehabCost: [0, 1e9],
  propertyTaxAnnual: [0, 1e8],
  insuranceAnnual: [0, 1e8],
  hoaMonthly: [0, 1e5],
  vacancyPct: [0, 100],
  maintenancePct: [0, 100],
  capexPct: [0, 100],
  managementPct: [0, 100],
  rentGrowthPct: [-20, 30],
  expenseGrowthPct: [-20, 30],
  appreciationPct: [-50, 30],
  sellingCostPct: [0, 30],
  holdYears: [1, 50],
};

export class InputError extends Error {}

export function resolveInput(input: PropertyInput): { resolved: ResolvedInput; assumptions: AssumptionRecord[] } {
  const defaults = defaultsFor(input);
  const resolved = { ...defaults, purchasePrice: input.purchasePrice, monthlyRent: input.monthlyRent } as ResolvedInput;
  const assumptions: AssumptionRecord[] = [];

  for (const key of Object.keys(RANGES) as Array<keyof ResolvedInput>) {
    const provided = input[key];
    if (provided !== undefined && provided !== null) {
      resolved[key] = provided;
    }
    const value = resolved[key];
    const [min, max] = RANGES[key]!;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new InputError(`${key} must be a finite number`);
    }
    if (value < min || value > max) {
      throw new InputError(`${key} must be between ${min} and ${max} (got ${value})`);
    }
    if (key !== "purchasePrice" && key !== "monthlyRent") {
      assumptions.push({ field: key, value, source: provided !== undefined && provided !== null ? "provided" : "assumed" });
    }
  }
  if (!Number.isInteger(resolved.holdYears) || !Number.isInteger(resolved.loanTermYears)) {
    throw new InputError("holdYears and loanTermYears must be whole numbers");
  }
  return { resolved, assumptions };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

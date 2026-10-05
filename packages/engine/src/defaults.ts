import { defaultPropertyTax } from "./property-tax-reassessment.ts";
import type { AssumptionInputs, AssumptionRecord, PropertyInput, ResolvedInput } from "./types.ts";

export class InputError extends Error {
  /** The input field that failed validation. */
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "InputError";
    this.field = field;
  }
}

type AssumptionField = keyof AssumptionInputs;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Defaults are conservative and always reported back as "assumed" so no number is silently invented. */
export function defaultsFor(purchasePrice: number, state?: string): { values: Required<AssumptionInputs>; propertyTaxNote: string } {
  const tax = defaultPropertyTax(purchasePrice, state);
  return {
    propertyTaxNote: tax.note,
    values: {
      downPaymentPct: 25,
      interestRatePct: 6.75,
      loanTermYears: 30,
      closingCostPct: 3,
      rehabCost: 0,
      propertyTaxAnnual: tax.annual,
      insuranceAnnual: round2(purchasePrice * 0.005),
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
    },
  };
}

const RANGES: Record<keyof ResolvedInput, [number, number]> = {
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

const ASSUMPTION_FIELDS = (Object.keys(RANGES) as Array<keyof ResolvedInput>).filter(
  (k): k is AssumptionField => k !== "purchasePrice" && k !== "monthlyRent",
);

function checkNumber(field: string, value: unknown, [min, max]: [number, number]): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InputError(field, `${field} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new InputError(field, `${field} must be between ${min} and ${max} (got ${value})`);
  }
  return value;
}

/** Price being analysed: `purchasePrice`, or its alias `offerPrice`. Returns the value and the field name the caller used. */
function resolvePrice(input: { purchasePrice?: number; offerPrice?: number }): { value: number; field: string } {
  const { purchasePrice, offerPrice } = input;
  const has = (v: number | undefined) => v !== undefined && v !== null;
  if (has(purchasePrice) && has(offerPrice) && purchasePrice !== offerPrice) {
    throw new InputError("offerPrice", `offerPrice and purchasePrice disagree (${offerPrice} vs ${purchasePrice}); supply one`);
  }
  const field = has(purchasePrice) ? "purchasePrice" : has(offerPrice) ? "offerPrice" : "purchasePrice";
  const raw = has(purchasePrice) ? purchasePrice : offerPrice;
  if (raw === undefined) throw new InputError("purchasePrice", "purchasePrice (or offerPrice) is required");
  return { value: checkNumber(field, raw, RANGES.purchasePrice), field };
}

/**
 * Returns the input with `offerPrice` folded into `purchasePrice`. Used by helpers that override the price
 * (targets, sensitivity) so an alias on the base input cannot conflict with the override.
 */
export function normalizeInput(input: PropertyInput): PropertyInput & { purchasePrice: number } {
  const { value } = resolvePrice(input);
  const { offerPrice: _offer, ...rest } = input;
  return { ...rest, purchasePrice: value };
}

export interface ResolvedInputs {
  resolved: ResolvedInput;
  assumptions: AssumptionRecord[];
  listPrice: number | null;
}

export function resolveInput(input: PropertyInput): ResolvedInputs {
  const price = resolvePrice(input);

  const { state } = input;
  if (state !== undefined && (typeof state !== "string" || !/^[A-Za-z]{2}$/.test(state))) {
    throw new InputError("state", "state must be a two-letter US state code");
  }
  let listPrice: number | null = null;
  if (input.listPrice !== undefined && input.listPrice !== null) {
    listPrice = checkNumber("listPrice", input.listPrice, RANGES.purchasePrice);
  }

  const { values, propertyTaxNote } = defaultsFor(price.value, state);
  const resolved: ResolvedInput = {
    ...values,
    purchasePrice: price.value,
    monthlyRent: checkNumber("monthlyRent", input.monthlyRent, RANGES.monthlyRent),
  };
  const assumptions: AssumptionRecord[] = [];

  for (const key of ASSUMPTION_FIELDS) {
    const provided = input[key];
    const isProvided = provided !== undefined && provided !== null;
    if (isProvided) resolved[key] = provided;
    const value = checkNumber(key, resolved[key], RANGES[key]);
    const record: AssumptionRecord = { field: key, value, source: isProvided ? "provided" : "assumed" };
    if (!isProvided && key === "propertyTaxAnnual") record.note = propertyTaxNote;
    assumptions.push(record);
  }
  for (const field of ["holdYears", "loanTermYears"] as const) {
    if (!Number.isInteger(resolved[field])) throw new InputError(field, `${field} must be a whole number`);
  }
  return { resolved, assumptions, listPrice };
}

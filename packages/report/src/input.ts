import { evaluate } from "@evalprop/engine";
import type { PropertyInput } from "@evalprop/engine";
import type { Analysis } from "@evalprop/shared";

/** Assumption fields the engine accepts as overrides (everything except price and rent). */
export const ENGINE_ASSUMPTION_FIELDS = [
  "downPaymentPct",
  "interestRatePct",
  "loanTermYears",
  "closingCostPct",
  "rehabCost",
  "propertyTaxAnnual",
  "insuranceAnnual",
  "hoaMonthly",
  "vacancyPct",
  "maintenancePct",
  "capexPct",
  "managementPct",
  "rentGrowthPct",
  "expenseGrowthPct",
  "appreciationPct",
  "sellingCostPct",
  "holdYears",
] as const;

export interface ReconstructedInput {
  input: PropertyInput;
  /**
   * True when running the engine on `input` reproduces the analysis' stored year-one numbers. When false
   * (for example the engine's defaults changed after the analysis was saved) the sensitivity grids must
   * not be shown: they would be computed from different inputs than the rest of the report.
   */
  reproduces: boolean;
}

interface Known {
  value: number;
  assumed: boolean;
}

/** Collects every known numeric field. `analysis.assumptions` wins; `evaluation.assumptions` fills gaps. */
function knownFields(a: Analysis): Map<string, Known> {
  const known = new Map<string, Known>();
  for (const r of a.assumptions) {
    if (!known.has(r.field)) known.set(r.field, { value: r.value, assumed: r.source === "assumed" });
  }
  for (const r of a.evaluation.assumptions) {
    if (!known.has(r.field)) known.set(r.field, { value: r.value, assumed: r.source === "assumed" });
  }
  return known;
}

/** The price the analysis was run at: the offer/purchase assumption, else the engine's comparison, else the list price. */
function purchasePriceOf(a: Analysis, known: Map<string, Known>): number | null {
  return (
    known.get("purchasePrice")?.value ??
    known.get("offerPrice")?.value ??
    a.evaluation.listPriceComparison?.purchasePrice ??
    a.property.listPrice ??
    null
  );
}

function build(a: Analysis, known: Map<string, Known>, price: number, rent: number, includeAssumed: boolean): PropertyInput {
  const input: PropertyInput = { purchasePrice: price, monthlyRent: rent, state: a.property.state };
  const listPrice = a.property.listPrice ?? a.evaluation.listPriceComparison?.listPrice;
  if (listPrice !== undefined) input.listPrice = listPrice;
  for (const field of ENGINE_ASSUMPTION_FIELDS) {
    const k = known.get(field);
    if (!k) continue;
    // Assumed values are left to the engine's own defaults so that price-dependent defaults (insurance,
    // property tax) keep scaling when a sensitivity grid varies the price.
    if (k.assumed && !includeAssumed) continue;
    input[field] = k.value;
  }
  return input;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.002);
}

function reproducesStored(a: Analysis, input: PropertyInput): boolean {
  try {
    const e = evaluate(input).yearOne;
    const s = a.evaluation.yearOne;
    return (
      close(e.noi, s.noi) &&
      close(e.annualCashFlow, s.annualCashFlow) &&
      close(e.cashInvested, s.cashInvested) &&
      close(e.loanAmount, s.loanAmount)
    );
  } catch {
    return false;
  }
}

/** Price the analysis was run at (purchase/offer assumption, else the engine's list-price comparison, else the list price). */
export function analyzedPriceOf(a: Analysis): number | null {
  return purchasePriceOf(a, knownFields(a));
}

/** Monthly rent used by the engine (the `monthlyRent` assumption, else gross annual rent / 12). */
export function monthlyRentOf(a: Analysis): number {
  return knownFields(a).get("monthlyRent")?.value ?? a.evaluation.yearOne.grossAnnualRent / 12;
}

/** Resolved value of an engine assumption such as `downPaymentPct`, or null when absent. */
export function assumptionValue(a: Analysis, field: string): number | null {
  return knownFields(a).get(field)?.value ?? null;
}

/**
 * Rebuilds the engine's `PropertyInput` from a saved analysis so the report can re-run the engine
 * (sensitivity grids). Price comes from the purchase/offer assumption (else the engine's list-price
 * comparison, else the list price); rent from the `monthlyRent` assumption (else the engine's gross annual
 * rent / 12). Values the user, the listing or a lookup supplied are passed as overrides; values that were
 * defaults are left to the engine, unless that does not reproduce the stored numbers, in which case the
 * resolved values are pinned. Returns null when no price can be determined.
 */
export function reconstructEngineInput(a: Analysis): ReconstructedInput | null {
  const known = knownFields(a);
  const price = purchasePriceOf(a, known);
  if (price === null) return null;
  const rent = known.get("monthlyRent")?.value ?? a.evaluation.yearOne.grossAnnualRent / 12;

  const lean = build(a, known, price, rent, false);
  if (reproducesStored(a, lean)) return { input: lean, reproduces: true };
  const pinned = build(a, known, price, rent, true);
  if (reproducesStored(a, pinned)) return { input: pinned, reproduces: true };
  return { input: lean, reproduces: false };
}

/** Same as {@link reconstructEngineInput} but throws when no price can be found. */
export function engineInputFromAnalysis(a: Analysis): PropertyInput {
  const r = reconstructEngineInput(a);
  if (!r) throw new Error("Cannot rebuild the engine input: the analysis has no purchase price, offer price, or list price");
  return r.input;
}

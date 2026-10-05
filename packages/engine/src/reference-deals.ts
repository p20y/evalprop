import type { PropertyInput } from "./types.ts";

/**
 * Three reference deals whose full evaluation output is snapshotted in reference-deals.snapshot.json.
 * Changing a deal here changes the snapshot; changing the engine's output for them requires an
 * ENGINE_VERSION bump (see version-guard.test.ts).
 */
export const REFERENCE_DEALS: ReadonlyArray<{ name: string; input: PropertyInput }> = [
  { name: "defaults only", input: { purchasePrice: 300_000, monthlyRent: 2_500 } },
  {
    name: "California purchase with offer below list, rehab, 15-year loan",
    input: {
      offerPrice: 640_000,
      listPrice: 675_000,
      state: "CA",
      monthlyRent: 3_800,
      rehabCost: 15_000,
      loanTermYears: 15,
      downPaymentPct: 30,
      holdYears: 12,
    },
  },
  {
    name: "high rate, HOA, all assumptions provided",
    input: {
      purchasePrice: 180_000,
      monthlyRent: 1_700,
      downPaymentPct: 20,
      interestRatePct: 9.25,
      loanTermYears: 30,
      closingCostPct: 4,
      rehabCost: 8_000,
      propertyTaxAnnual: 2_900,
      insuranceAnnual: 1_300,
      hoaMonthly: 120,
      vacancyPct: 6,
      maintenancePct: 7,
      capexPct: 4,
      managementPct: 10,
      rentGrowthPct: 2.5,
      expenseGrowthPct: 3.5,
      appreciationPct: 2,
      sellingCostPct: 7,
      holdYears: 20,
    },
  },
];

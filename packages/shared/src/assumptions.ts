import { z } from "zod";
import { ProvenanceSchema, SourceSchema } from "./common.ts";

const pct = (max = 100) => z.number().min(0).max(max);

/** Everything the user (or assistant) can override. All optional. Mirrors the engine's PropertyInput plus offerPrice. */
export const AssumptionsSchema = z.object({
  offerPrice: z.number().positive().optional(),
  monthlyRent: z.number().nonnegative().optional(),
  downPaymentPct: pct().optional(),
  interestRatePct: pct(30).optional(),
  loanTermYears: z.number().int().min(1).max(50).optional(),
  closingCostPct: pct(20).optional(),
  rehabCost: z.number().nonnegative().optional(),
  propertyTaxAnnual: z.number().nonnegative().optional(),
  insuranceAnnual: z.number().nonnegative().optional(),
  hoaMonthly: z.number().nonnegative().optional(),
  vacancyPct: pct().optional(),
  maintenancePct: pct().optional(),
  capexPct: pct().optional(),
  managementPct: pct().optional(),
  rentGrowthPct: z.number().min(-20).max(30).optional(),
  expenseGrowthPct: z.number().min(-20).max(30).optional(),
  appreciationPct: z.number().min(-50).max(30).optional(),
  sellingCostPct: pct(30).optional(),
  holdYears: z.number().int().min(1).max(50).optional(),
});
export type Assumptions = z.infer<typeof AssumptionsSchema>;

export const ResolvedAssumptionSchema = z.object({
  field: z.string(),
  value: z.number(),
  source: SourceSchema,
  /** Why this value was chosen, e.g. "State reassesses property tax on sale." */
  note: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
});
export type ResolvedAssumption = z.infer<typeof ResolvedAssumptionSchema>;

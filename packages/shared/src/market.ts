import { z } from "zod";
import { ConfidenceSchema } from "./common.ts";
import { PropertyTypeSchema } from "./property.ts";

export const ListingKindSchema = z.enum(["asking", "leased"]);
export type ListingKind = z.infer<typeof ListingKindSchema>;

/** Normalized rental listing returned by a RentProvider. */
export const RentListingSchema = z.object({
  id: z.string(),
  address: z.string(),
  distanceMiles: z.number().nonnegative(),
  propertyType: PropertyTypeSchema.optional(),
  beds: z.number().nonnegative(),
  baths: z.number().nonnegative().optional(),
  sqft: z.number().positive().optional(),
  rent: z.number().positive(),
  kind: ListingKindSchema,
  /** ISO date listed or leased. */
  date: z.string(),
  /** Set when the provider can tell the listing is in the same building as the subject. */
  sameBuilding: z.boolean().optional(),
});
export type RentListing = z.infer<typeof RentListingSchema>;

/** Normalized sale listing or sold record returned by a SalesProvider. */
export const SaleListingSchema = z.object({
  id: z.string(),
  address: z.string(),
  distanceMiles: z.number().nonnegative(),
  propertyType: PropertyTypeSchema.optional(),
  beds: z.number().nonnegative().optional(),
  baths: z.number().nonnegative().optional(),
  sqft: z.number().positive().optional(),
  price: z.number().positive(),
  status: z.enum(["sold", "active", "pending"]),
  /** ISO date sold or listed. */
  date: z.string(),
});
export type SaleListing = z.infer<typeof SaleListingSchema>;

export const MatchClassSchema = z.enum(["same-building", "same-size", "different-size"]);
export type MatchClass = z.infer<typeof MatchClassSchema>;

export const LadderStepSchema = z.enum([
  "same-building",
  "strict-0.5mi",
  "strict-1mi",
  "strict-2mi",
  "relaxed",
  "insufficient",
]);
export type LadderStep = z.infer<typeof LadderStepSchema>;

/** A comparable chosen by the comp-selection engine, with the reason it was chosen. */
export const CompSchema = z.object({
  id: z.string(),
  address: z.string(),
  distanceMiles: z.number().nonnegative(),
  beds: z.number().nonnegative().optional(),
  baths: z.number().nonnegative().optional(),
  sqft: z.number().positive().optional(),
  /** Monthly rent for rent comps, price for sale comps. */
  amount: z.number().positive(),
  kind: z.enum(["asking", "leased", "sold", "active", "pending"]),
  date: z.string(),
  matchClass: MatchClassSchema,
  /** Human-readable, e.g. "Same size, 0.3 mi". */
  matchReason: z.string(),
  /** Amount rescaled to the subject's size (different-size comps only). */
  adjustedAmount: z.number().positive().optional(),
});
export type Comp = z.infer<typeof CompSchema>;

export const CompResultSchema = z.object({
  estimate: z.object({ low: z.number(), median: z.number(), high: z.number() }).nullable(),
  comps: z.array(CompSchema),
  stepReached: LadderStepSchema,
  radiusUsedMiles: z.number().nonnegative().nullable(),
  confidence: ConfidenceSchema,
  notes: z.array(z.string()),
});
export type CompResult = z.infer<typeof CompResultSchema>;

export const SchoolSchema = z.object({
  name: z.string(),
  level: z.enum(["elementary", "middle", "high", "other"]),
  /** 0–10 scale; undefined when the provider has no rating. */
  rating: z.number().min(0).max(10).optional(),
  distanceMiles: z.number().nonnegative(),
  /** True when the provider confirmed this is the assigned school; "unknown" when it cannot say. */
  assigned: z.union([z.boolean(), z.literal("unknown")]),
  /** Attribution text the provider's license requires alongside the rating. */
  attribution: z.string().optional(),
});
export type School = z.infer<typeof SchoolSchema>;

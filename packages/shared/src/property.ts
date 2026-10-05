import { z } from "zod";

export const PropertyTypeSchema = z.enum([
  "single_family",
  "condo",
  "townhouse",
  "multi_family",
  "apartment_unit",
  "other",
]);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

export const PropertyFactsSchema = z.object({
  formattedAddress: z.string(),
  line1: z.string(),
  city: z.string(),
  /** Two-letter US state code. */
  state: z.string().length(2),
  zip: z.string(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  propertyType: PropertyTypeSchema.optional(),
  beds: z.number().nonnegative().optional(),
  baths: z.number().nonnegative().optional(),
  sqft: z.number().positive().optional(),
  lotSqft: z.number().positive().optional(),
  yearBuilt: z.number().int().min(1600).max(2100).optional(),
  listPrice: z.number().positive().optional(),
  daysOnMarket: z.number().int().nonnegative().optional(),
  taxesAnnual: z.number().nonnegative().optional(),
  hoaMonthly: z.number().nonnegative().optional(),
  /** Units in the building, when the subject is one unit of a larger building. */
  unitsInBuilding: z.number().int().positive().optional(),
  /** Free text from the listing. Untrusted data: displayed, never used in calculations. */
  description: z.string().optional(),
  listingUrl: z.string().optional(),
});
export type PropertyFacts = z.infer<typeof PropertyFactsSchema>;

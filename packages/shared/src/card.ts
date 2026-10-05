import { z } from "zod";
import { ConfidenceSchema } from "./common.ts";
import { VerdictSchema } from "./evaluation.ts";

/** Compact model for the inline chat card and the assistant's summary. */
export const CardModelSchema = z.object({
  analysisId: z.string(),
  address: z.string(),
  listPrice: z.number().nullable(),
  analyzedPrice: z.number(),
  monthlyRent: z.number(),
  rentSource: z.enum(["provided", "listing", "lookup", "assumed"]),
  verdict: VerdictSchema,
  verdictLabel: z.string(),
  metrics: z.object({
    monthlyCashFlow: z.number(),
    cashOnCashPct: z.number(),
    capRatePct: z.number(),
    dscr: z.number().nullable(),
  }),
  maxOffer: z.object({ price: z.number(), targetCashOnCashPct: z.number(), vsAnalyzedPricePct: z.number() }).nullable(),
  breakEvenMonth: z.number().int().nullable(),
  irr10Pct: z.number().nullable(),
  compsConfidence: ConfidenceSchema.nullable(),
  reportUrl: z.string(),
  dataNotes: z.array(z.string()),
  usage: z.object({ used: z.number().int(), limit: z.number().int(), period: z.string() }).optional(),
});
export type CardModel = z.infer<typeof CardModelSchema>;

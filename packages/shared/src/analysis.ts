import { z } from "zod";
import { DataNoteSchema, ProvenanceSchema } from "./common.ts";
import { ResolvedAssumptionSchema } from "./assumptions.ts";
import { EvaluationSchema } from "./evaluation.ts";
import { CompResultSchema, SchoolSchema } from "./market.ts";
import { PropertyFactsSchema } from "./property.ts";

export const ToneSchema = z.enum(["good", "ok", "poor", "neutral"]);
export type Tone = z.infer<typeof ToneSchema>;

/** Signals the assistant spotted ("tenant-occupied", "new roof"). Displayed, never calculated. */
export const AdvisoryFlagSchema = z.object({
  title: z.string(),
  detail: z.string(),
  tone: ToneSchema,
});
export type AdvisoryFlag = z.infer<typeof AdvisoryFlagSchema>;

export const MarketDataSchema = z.object({
  rentComps: CompResultSchema.nullable(),
  saleComps: CompResultSchema.nullable(),
  schools: z.array(SchoolSchema).nullable(),
  /** Provenance per looked-up section, keyed by section name (e.g. "rentComps"). */
  provenance: z.record(z.string(), ProvenanceSchema),
});
export type MarketData = z.infer<typeof MarketDataSchema>;

/** A saved analysis. Immutable after creation; a what-if creates a new one with baseAnalysisId. */
export const AnalysisSchema = z.object({
  id: z.string(),
  ownerUid: z.string(),
  createdAt: z.string(),
  engineVersion: z.string(),
  pipelineVersion: z.string(),
  inputHash: z.string(),
  baseAnalysisId: z.string().optional(),
  property: PropertyFactsSchema,
  assumptions: z.array(ResolvedAssumptionSchema),
  evaluation: EvaluationSchema,
  market: MarketDataSchema,
  advisoryFlags: z.array(AdvisoryFlagSchema),
  dataNotes: z.array(DataNoteSchema),
  /** Target used for the max allowable offer. */
  targetCashOnCashPct: z.number(),
  /** Highest price reaching the target, or null if unreachable. */
  maxOfferPrice: z.number().nullable(),
  /** Monthly rent at which cash flow is zero, or null. */
  breakEvenRent: z.number().nullable(),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

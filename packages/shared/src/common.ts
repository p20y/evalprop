import { z } from "zod";

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Where a value came from. Precedence (highest first): provided > listing > lookup > assumed. */
export const SourceSchema = z.enum(["provided", "listing", "lookup", "assumed"]);
export type Source = z.infer<typeof SourceSchema>;

export const ProvenanceSchema = z.object({
  provider: z.string(),
  /** ISO timestamp of when the provider returned the data (not when we cached it). */
  fetchedAt: z.string(),
  cached: z.boolean(),
  confidence: ConfidenceSchema.optional(),
  note: z.string().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** Wraps any provider payload with its provenance. */
export const resolvedSchema = <T extends z.ZodType>(data: T) => z.object({ data, provenance: ProvenanceSchema });
export type Resolved<T> = { data: T; provenance: Provenance };

export const DataNoteSchema = z.object({
  section: z.string(),
  severity: z.enum(["info", "warning"]),
  message: z.string(),
});
export type DataNote = z.infer<typeof DataNoteSchema>;

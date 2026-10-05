import { z } from "zod";
import { AnalysisSchema } from "./analysis.ts";

export const ReportSectionSchema = z.enum([
  "summary",
  "scorecard",
  "maxOffer",
  "income",
  "returns",
  "hold",
  "sensitivity",
  "comps",
  "schools",
  "advisory",
  "assumptions",
]);
export type ReportSection = z.infer<typeof ReportSectionSchema>;

export const ReportOptionsSchema = z.object({
  recipientName: z.string().max(120).optional(),
  note: z.string().max(2000).optional(),
  /** Sections to include; omitted = all. */
  sections: z.array(ReportSectionSchema).optional(),
  watermark: z.boolean().default(false),
  preparedBy: z.string().max(120).optional(),
});
export type ReportOptions = z.infer<typeof ReportOptionsSchema>;

/** Everything the renderer needs. The renderer is a pure function of this. */
export const ReportModelSchema = z.object({
  analysis: AnalysisSchema,
  options: ReportOptionsSchema,
  generatedAt: z.string(),
  version: z.number().int().positive(),
});
export type ReportModel = z.infer<typeof ReportModelSchema>;

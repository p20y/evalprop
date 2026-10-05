import { z } from "zod";
import { AssumptionsSchema } from "./assumptions.ts";
import { AdvisoryFlagSchema } from "./analysis.ts";
import { CardModelSchema } from "./card.ts";
import { ReportOptionsSchema } from "./report.ts";

export const TOOL_ERROR_CODES = [
  "NEEDS_ADDRESS",
  "AMBIGUOUS_ADDRESS",
  "NOT_FOUND",
  "INVALID_ASSUMPTION",
  "NEEDS_RENT",
  "QUOTA_EXCEEDED",
  "UNAUTHENTICATED",
  "INTERNAL",
] as const;
export const ToolErrorCodeSchema = z.enum(TOOL_ERROR_CODES);
export type ToolErrorCode = z.infer<typeof ToolErrorCodeSchema>;

export const ToolErrorSchema = z.object({
  code: ToolErrorCodeSchema,
  message: z.string(),
  /** AMBIGUOUS_ADDRESS: candidate addresses to choose from. */
  candidates: z.array(z.string()).optional(),
  /** INVALID_ASSUMPTION: the offending field. */
  field: z.string().optional(),
  /** QUOTA_EXCEEDED: where to upgrade, and the numbers. */
  upgradeUrl: z.string().optional(),
  used: z.number().int().optional(),
  limit: z.number().int().optional(),
});
export type ToolError = z.infer<typeof ToolErrorSchema>;

/** Placeholder descriptions; S13 tunes these against the invocation evals. */
export const TOOL_DESCRIPTIONS = {
  analyze_property:
    "Evaluate a US property as a rental investment. Use when the user shares a listing link or address and asks about investment value, rental yield, cash flow, whether to buy, or what to offer.",
  what_if:
    "Re-run a saved analysis with different assumptions (offer price, rate, down payment, rent...) and show before/after.",
  compare_properties: "Compare two to five saved analyses side by side and rank them.",
  create_report: "Create a shareable, client-ready report (web page and PDF) from a saved analysis.",
} as const;

// ---- analyze_property
export const AnalyzePropertyInputSchema = z.object({
  address: z.string().min(1).optional(),
  listing: z
    .object({
      url: z.string().optional(),
      price: z.number().positive().optional(),
      beds: z.number().nonnegative().optional(),
      baths: z.number().nonnegative().optional(),
      sqft: z.number().positive().optional(),
      yearBuilt: z.number().int().optional(),
      propertyType: z.string().optional(),
      taxesAnnual: z.number().nonnegative().optional(),
      hoaMonthly: z.number().nonnegative().optional(),
      daysOnMarket: z.number().int().nonnegative().optional(),
      description: z.string().max(20000).optional(),
      monthlyRentActual: z.number().nonnegative().optional(),
    })
    .optional(),
  assumptions: AssumptionsSchema.optional(),
  targetCashOnCashPct: z.number().min(0).max(100).default(8),
  advisoryFlags: z.array(AdvisoryFlagSchema).max(20).optional(),
});
export type AnalyzePropertyInput = z.infer<typeof AnalyzePropertyInputSchema>;

export const AnalyzePropertyOutputSchema = z.object({
  card: CardModelSchema,
  /** Plain-language summary the assistant can relay. Every number is generated from the saved analysis. */
  summary: z.string(),
});
export type AnalyzePropertyOutput = z.infer<typeof AnalyzePropertyOutputSchema>;

// ---- what_if
export const WhatIfInputSchema = z.object({
  analysisId: z.string().min(1),
  overrides: AssumptionsSchema,
});
export type WhatIfInput = z.infer<typeof WhatIfInputSchema>;

export const ComparisonRowSchema = z.object({
  metric: z.enum(["monthlyCashFlow", "cashOnCashPct", "capRatePct", "dscr", "breakEvenMonth", "irr10Pct", "cashInvested"]),
  label: z.string(),
  before: z.number().nullable(),
  after: z.number().nullable(),
});
export type ComparisonRow = z.infer<typeof ComparisonRowSchema>;

export const WhatIfOutputSchema = z.object({
  baseAnalysisId: z.string(),
  card: CardModelSchema,
  rows: z.array(ComparisonRowSchema),
  summary: z.string(),
});
export type WhatIfOutput = z.infer<typeof WhatIfOutputSchema>;

// ---- compare_properties
export const ComparePropertiesInputSchema = z.object({
  analysisIds: z.array(z.string().min(1)).min(2).max(5),
});
export type ComparePropertiesInput = z.infer<typeof ComparePropertiesInputSchema>;

export const ComparePropertiesOutputSchema = z.object({
  cards: z.array(CardModelSchema),
  /** Analysis IDs from best to worst, with the rule used. */
  ranking: z.array(z.object({ analysisId: z.string(), rank: z.number().int().positive(), reason: z.string() })),
  summary: z.string(),
});
export type ComparePropertiesOutput = z.infer<typeof ComparePropertiesOutputSchema>;

// ---- create_report
export const CreateReportInputSchema = z.object({
  analysisId: z.string().min(1),
  options: ReportOptionsSchema.omit({ watermark: true }).optional(),
});
export type CreateReportInput = z.infer<typeof CreateReportInputSchema>;

export const CreateReportOutputSchema = z.object({
  reportId: z.string(),
  reportUrl: z.string(),
  /** Null until the PDF worker finishes. */
  pdfUrl: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export type CreateReportOutput = z.infer<typeof CreateReportOutputSchema>;

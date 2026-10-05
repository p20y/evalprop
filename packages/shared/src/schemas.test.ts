import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AnalysisSchema,
  AnalyzePropertyInputSchema,
  AnalyzePropertyOutputSchema,
  AssumptionsSchema,
  CardModelSchema,
  ComparePropertiesInputSchema,
  CompResultSchema,
  CreateReportInputSchema,
  CreateReportOutputSchema,
  EvaluationSchema,
  PLANS,
  PropertyFactsSchema,
  ReportModelSchema,
  ResolvedAssumptionSchema,
  SchoolSchema,
  TOOL_ERROR_CODES,
  ToolErrorSchema,
  WhatIfInputSchema,
  WhatIfOutputSchema,
  resolvedSchema,
  sampleAnalysis,
  sampleCard,
  sampleProvenance,
} from "./index.ts";
import { z } from "zod";

const roundTrip = <T extends z.ZodType>(schema: T, value: unknown) => {
  const parsed = schema.parse(value);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), JSON.parse(JSON.stringify(value)));
};

test("sample analysis and its parts round-trip", () => {
  roundTrip(AnalysisSchema, sampleAnalysis);
  roundTrip(PropertyFactsSchema, sampleAnalysis.property);
  roundTrip(EvaluationSchema, sampleAnalysis.evaluation);
  roundTrip(CompResultSchema, sampleAnalysis.market.rentComps);
  roundTrip(SchoolSchema, sampleAnalysis.market.schools![0]);
  roundTrip(ResolvedAssumptionSchema, sampleAnalysis.assumptions[2]);
  roundTrip(CardModelSchema, sampleCard);
});

test("report model round-trips and applies the watermark default", () => {
  const model = ReportModelSchema.parse({
    analysis: sampleAnalysis,
    options: { recipientName: "Sam" },
    generatedAt: "2026-10-04T12:00:00.000Z",
    version: 1,
  });
  assert.equal(model.options.watermark, false);
});

test("Resolved<T> wrapper validates provenance", () => {
  const schema = resolvedSchema(z.object({ n: z.number() }));
  assert.ok(schema.safeParse({ data: { n: 1 }, provenance: sampleProvenance }).success);
  assert.ok(!schema.safeParse({ data: { n: 1 } }).success);
});

test("assumptions reject out-of-range values and accept an empty object", () => {
  assert.ok(AssumptionsSchema.safeParse({}).success);
  assert.ok(!AssumptionsSchema.safeParse({ downPaymentPct: 120 }).success);
  assert.ok(!AssumptionsSchema.safeParse({ holdYears: 2.5 }).success);
  assert.ok(!AssumptionsSchema.safeParse({ offerPrice: -1 }).success);
});

test("analyze_property input: defaults, optional fields, limits", () => {
  const parsed = AnalyzePropertyInputSchema.parse({ address: "1 Main St, Tulsa, OK" });
  assert.equal(parsed.targetCashOnCashPct, 8);
  assert.ok(!AnalyzePropertyInputSchema.safeParse({ address: "1 Main St", targetCashOnCashPct: 150 }).success);
  assert.ok(!AnalyzePropertyInputSchema.safeParse({ listing: { description: "x".repeat(20001) } }).success);
});

test("what_if, compare, and create_report inputs", () => {
  assert.ok(WhatIfInputSchema.safeParse({ analysisId: "a", overrides: { offerPrice: 215000, interestRatePct: 6.5 } }).success);
  assert.ok(!WhatIfInputSchema.safeParse({ overrides: {} }).success);
  assert.ok(ComparePropertiesInputSchema.safeParse({ analysisIds: ["a", "b"] }).success);
  assert.ok(!ComparePropertiesInputSchema.safeParse({ analysisIds: ["a"] }).success);
  assert.ok(!ComparePropertiesInputSchema.safeParse({ analysisIds: ["a", "b", "c", "d", "e", "f"] }).success);
  assert.ok(CreateReportInputSchema.safeParse({ analysisId: "a", options: { recipientName: "Sam" } }).success);
});

test("tool outputs round-trip", () => {
  roundTrip(AnalyzePropertyOutputSchema, { card: sampleCard, summary: "Summary." });
  roundTrip(WhatIfOutputSchema, {
    baseAnalysisId: "a",
    card: sampleCard,
    rows: [{ metric: "monthlyCashFlow", label: "Cash flow", before: 17, after: 212 }],
    summary: "Better.",
  });
  roundTrip(CreateReportOutputSchema, { reportId: "r", reportUrl: "https://example.test/r/t", pdfUrl: null, expiresAt: null });
});

test("tool errors use stable codes", () => {
  for (const code of TOOL_ERROR_CODES) assert.ok(ToolErrorSchema.safeParse({ code, message: "m" }).success);
  assert.ok(!ToolErrorSchema.safeParse({ code: "NOPE", message: "m" }).success);
  assert.deepEqual([...TOOL_ERROR_CODES].sort(), [
    "AMBIGUOUS_ADDRESS",
    "INTERNAL",
    "INVALID_ASSUMPTION",
    "NEEDS_ADDRESS",
    "NEEDS_RENT",
    "NOT_FOUND",
    "QUOTA_EXCEEDED",
    "UNAUTHENTICATED",
  ]);
});

test("plans define free and pro", () => {
  assert.equal(PLANS.free.watermark, true);
  assert.equal(PLANS.pro.watermark, false);
  assert.ok(PLANS.pro.monthlyAnalyses > PLANS.free.monthlyAnalyses);
});

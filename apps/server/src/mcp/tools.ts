import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import {
  AnalyzePropertyInputSchema,
  AnalyzePropertyOutputSchema,
  TOOL_DESCRIPTIONS,
  WhatIfInputSchema,
  WhatIfOutputSchema,
  type Analysis,
  type CardModel,
} from "@evalprop/shared";
import { runAnalysis, runWhatIf, type PipelineContext } from "../pipeline/index.ts";
import { INTERNAL_ERROR, toolErrorResult } from "./results.ts";

/**
 * The tool registry (ARCHITECTURE §5.1). One entry per tool: name, description and schemas come from
 * `packages/shared`, and the handler is validation (done inside the pipeline's stage 1 with the same shared
 * schema), one pipeline call, and result mapping. Adding `compare_properties` or `create_report` is one
 * new entry in `TOOLS`.
 */

export type McpLogger = (event: string, fields?: Record<string, unknown>) => void;

/** What a handler may use: the verified caller, the pipeline runtime, and a logger. Nothing else. */
export interface ToolContext {
  uid: string;
  pipeline: PipelineContext;
  log: McpLogger;
  /** Mints a share link for an analysis of this caller (see `McpHandlerDeps.createReportLink`). */
  createReportLink?: (analysisId: string) => Promise<string>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** Advertised in `tools/list`. Validation itself happens in the pipeline (same schema), so a failure is a typed `ToolError`. */
  inputSchema: z.ZodType;
  /** Advertised in `tools/list`, and every successful result is checked against it before it is returned. */
  outputSchema: z.ZodType;
  annotations: ToolAnnotations;
  handler: (args: unknown, ctx: ToolContext) => Promise<CallToolResult>;
}

/** Full evaluation and provenance for widgets and follow-ups. Not shown to the user directly. */
function analysisMeta(analysis: Analysis, reused: boolean): Record<string, unknown> {
  return { analysis, provenance: analysis.market.provenance, reused };
}

function successResult(
  schema: z.ZodType,
  output: unknown,
  summary: string,
  analysis: Analysis,
  reused: boolean,
  ctx: ToolContext,
): CallToolResult {
  const checked = schema.safeParse(output);
  if (!checked.success) {
    // A contract violation is our bug, not the caller's: log the paths, never the values, and return INTERNAL.
    ctx.log("mcp.output_invalid", { analysisId: analysis.id, issues: checked.error.issues.map((i) => i.path.join(".")) });
    return toolErrorResult(INTERNAL_ERROR);
  }
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: checked.data as Record<string, unknown>,
    _meta: analysisMeta(analysis, reused),
  };
}

/** The card with its `reportUrl` replaced by a real share link. A failure keeps the placeholder and is logged. */
async function withReportLink(card: CardModel, analysisId: string, ctx: ToolContext): Promise<CardModel> {
  if (ctx.createReportLink === undefined) return card;
  try {
    return { ...card, reportUrl: await ctx.createReportLink(analysisId) };
  } catch (err) {
    ctx.log("mcp.report_link_failed", { analysisId, error: err instanceof Error ? err.name : "unknown" });
    return card;
  }
}

const analyzeProperty: ToolDefinition = {
  name: "analyze_property",
  description: TOOL_DESCRIPTIONS.analyze_property,
  inputSchema: AnalyzePropertyInputSchema,
  outputSchema: AnalyzePropertyOutputSchema,
  annotations: {
    title: "Analyze a rental property",
    // Saves an analysis (and a usage record), never changes or deletes anything that exists, and a retry
    // of the same input within 10 minutes returns the same analysis. Looks up outside data providers.
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async handler(args, ctx) {
    const outcome = await runAnalysis({ uid: ctx.uid, input: args }, ctx.pipeline);
    if (!outcome.ok) return toolErrorResult(outcome.error, outcome);
    return successResult(
      AnalyzePropertyOutputSchema,
      { card: await withReportLink(outcome.card, outcome.analysis.id, ctx), summary: outcome.summary },
      outcome.summary,
      outcome.analysis,
      outcome.reused,
      ctx,
    );
  },
};

const whatIf: ToolDefinition = {
  name: "what_if",
  description: TOOL_DESCRIPTIONS.what_if,
  inputSchema: WhatIfInputSchema,
  outputSchema: WhatIfOutputSchema,
  annotations: {
    title: "Re-run an analysis with different assumptions",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    // Reuses the saved market data: no provider is called.
    openWorldHint: false,
  },
  async handler(args, ctx) {
    const outcome = await runWhatIf({ uid: ctx.uid, input: args }, ctx.pipeline);
    if (!outcome.ok) return toolErrorResult(outcome.error, outcome);
    return successResult(
      WhatIfOutputSchema,
      {
        baseAnalysisId: outcome.baseAnalysisId,
        card: await withReportLink(outcome.card, outcome.analysis.id, ctx),
        rows: outcome.rows,
        summary: outcome.summary,
      },
      outcome.summary,
      outcome.analysis,
      outcome.reused,
      ctx,
    );
  },
};

/** Every tool the server exposes. S08 adds `create_report`, a later story `compare_properties`: one line each. */
export const TOOLS: readonly ToolDefinition[] = [analyzeProperty, whatIf];

/** Looks a tool up and runs it; anything it throws becomes a sanitized `INTERNAL` tool error. */
export async function callTool(tools: readonly ToolDefinition[], name: string, args: unknown, ctx: ToolContext): Promise<CallToolResult | null> {
  const tool = tools.find((t) => t.name === name);
  if (tool === undefined) return null;
  try {
    return await tool.handler(args, ctx);
  } catch (err) {
    ctx.log("mcp.tool_exception", { tool: name, error: err instanceof Error ? `${err.name}: ${err.message}` : "non-error thrown" });
    return toolErrorResult(INTERNAL_ERROR);
  }
}

import { z } from "zod";
import {
  AnalyzePropertyInputSchema,
  ComparePropertiesInputSchema,
  CreateReportInputSchema,
  TOOL_DESCRIPTIONS,
  WhatIfInputSchema,
} from "@evalprop/shared";
import type { ToolName } from "./schema.ts";

/** A tool as the Anthropic Messages API takes it. */
export interface AnthropicTool {
  name: ToolName;
  description: string;
  input_schema: Record<string, unknown> & { type: "object" };
}

/**
 * The tool list an assistant sees, built from the shared contracts: `TOOL_DESCRIPTIONS` and the input
 * schemas as JSON Schema (`io: "input"`, so fields with defaults are optional, as over MCP).
 *
 * Why not import the server's registry (`apps/server/src/mcp/tools.ts`): it only registers the tools that
 * are built so far (two of four), and importing it drags in Firebase and the pipeline. These evals cover
 * all four tools from day one, and the descriptions and schemas are the same objects the registry uses.
 */
const INPUT_SCHEMAS: Record<ToolName, z.ZodType> = {
  analyze_property: AnalyzePropertyInputSchema,
  what_if: WhatIfInputSchema,
  compare_properties: ComparePropertiesInputSchema,
  create_report: CreateReportInputSchema,
};

export function buildTools(): AnthropicTool[] {
  return (Object.keys(INPUT_SCHEMAS) as ToolName[]).map((name) => {
    const { $schema: _dropped, ...schema } = z.toJSONSchema(INPUT_SCHEMAS[name], { io: "input" }) as Record<string, unknown>;
    return { name, description: TOOL_DESCRIPTIONS[name], input_schema: { type: "object", ...schema } };
  });
}

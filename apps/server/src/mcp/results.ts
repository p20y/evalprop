import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ToolErrorSchema, type DataNote, type PropertyFacts, type ToolError } from "@evalprop/shared";

/**
 * Mapping from pipeline outcomes to MCP tool results (ARCHITECTURE §5.1). No numbers are produced here:
 * the summary text and the card both come from the pipeline, built from the saved analysis.
 */

export interface ErrorExtras {
  dataNotes?: readonly DataNote[];
  property?: PropertyFacts;
}

/**
 * A tool error: `isError: true`, with the stable code and a `ToolError`-shaped JSON document as the single
 * text block (the assistant reads `message`, a client can switch on `code`). Only `ToolErrorSchema`
 * fields are emitted, so nothing else a failure object carries can leak. What the pipeline learned before
 * failing (for example the resolved facts behind `NEEDS_RENT`) goes in `_meta`, which clients do not show to the user.
 */
export function toolErrorResult(error: ToolError, extras: ErrorExtras = {}): CallToolResult {
  const safe = ToolErrorSchema.parse(error);
  const meta: Record<string, unknown> = {};
  if (extras.dataNotes !== undefined && extras.dataNotes.length > 0) meta["dataNotes"] = extras.dataNotes;
  if (extras.property !== undefined) meta["property"] = extras.property;
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(safe) }],
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}

/** The error every unexpected failure becomes. Never carries a message from the underlying exception. */
export const INTERNAL_ERROR: ToolError = {
  code: "INTERNAL",
  message: "Something went wrong on our side. Nothing was saved and no allowance was used. Try again.",
};

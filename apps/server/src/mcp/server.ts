import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { toJSONSchema, type z } from "zod";
import { callTool, type ToolContext, type ToolDefinition } from "./tools.ts";
import { listWidgetResources, readWidgetResource, type WidgetRegistrationOptions } from "./widget-registration.ts";

export const SERVER_INFO = { name: "evalprop", version: "0.1.0" } as const;

type JsonSchemaObject = Tool["inputSchema"];

/** Zod v4 schema to the JSON Schema the MCP spec expects, draft-07 like the SDK's own converter. */
function jsonSchemaOf(schema: z.ZodType, io: "input" | "output"): JsonSchemaObject {
  const { $schema: _ignored, ...rest } = toJSONSchema(schema, { target: "draft-7", io }) as Record<string, unknown>;
  return { type: "object", ...rest } as JsonSchemaObject;
}

/** The `tools/list` entry for a tool, derived once from the shared zod schemas. */
export function describeTool(tool: ToolDefinition): Tool {
  return {
    name: tool.name,
    title: tool.annotations.title ?? tool.name,
    description: tool.description,
    inputSchema: jsonSchemaOf(tool.inputSchema, "input"),
    outputSchema: jsonSchemaOf(tool.outputSchema, "output"),
    annotations: tool.annotations,
    ...(tool.meta !== undefined ? { _meta: tool.meta } : {}),
  };
}

/**
 * One MCP server for ONE authenticated request (stateless mode): `tools/list` and `tools/call` over the
 * given registry, with the caller's uid baked into the tool context. This uses the SDK's low-level
 * `Server` rather than `McpServer.registerTool` on purpose: `McpServer` validates the arguments itself and
 * turns a failure into a free-text error, while the contract here is a typed `ToolError` with a stable
 * code, produced by the pipeline's stage 1 from the same shared schema.
 *
 * It also serves the inline deal card as an MCP resource (`resources/list`, `resources/read`; S09, see
 * `widget-registration.ts`). Resources are static, so the same handlers answer every request.
 */
export function createMcpServer(tools: readonly ToolDefinition[], ctx: ToolContext, widget: WidgetRegistrationOptions = {}): Server {
  const listed = tools.map(describeTool);
  const server = new Server(SERVER_INFO, { capabilities: { tools: { listChanged: false }, resources: { listChanged: false } } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listed }));
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: listWidgetResources(widget) }));
  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const result = readWidgetResource(request.params.uri, widget);
    // -32002 is the MCP spec's "resource not found" code.
    if (result === null) throw new McpError(-32002, `Resource not found: ${request.params.uri}`);
    return result;
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(tools, request.params.name, request.params.arguments, ctx);
    if (result === null) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    return result;
  });
  return server;
}

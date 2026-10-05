import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Hono } from "hono";
import { ToolErrorSchema, type ToolError } from "@evalprop/shared";
import { createApp } from "../app.ts";
import { FakeAuthProvider, fakeTokenFor } from "../auth/fake.ts";
import type { QuotaGate } from "../pipeline/index.ts";
import { InMemoryAnalysisRepo } from "../repos/memory.ts";
import type { McpHandlerDeps } from "./handler.ts";
import { createLocalPipelineRuntime } from "./local-runtime.ts";

export const BASE_URL = "http://mcp.test";

export interface TestServer {
  app: Hono;
  repo: InMemoryAnalysisRepo;
  /** Everything the server logged (it logs nothing on the happy path). */
  logs: Array<{ event: string; fields?: Record<string, unknown> }>;
  deps: McpHandlerDeps;
}

/** The app with fake auth, the recorded fixture providers, an in-memory repo and a silent logger. */
export function testServer(overrides: Partial<McpHandlerDeps> & { quota?: QuotaGate } = {}): TestServer {
  const repo = new InMemoryAnalysisRepo();
  const logs: TestServer["logs"] = [];
  const { quota, ...rest } = overrides;
  const runtime = createLocalPipelineRuntime({ repo });
  const deps: McpHandlerDeps = {
    auth: new FakeAuthProvider(),
    pipelineRuntime: quota !== undefined ? { ...runtime, quota } : runtime,
    baseUrl: BASE_URL,
    authorizationServers: ["https://auth.example.test"],
    logger: (event, fields) => logs.push({ event, ...(fields !== undefined ? { fields } : {}) }),
    ...rest,
  };
  return { app: createApp({ mcp: deps }), repo, logs, deps };
}

/** An in-process MCP client (the SDK's own Streamable HTTP client) whose `fetch` calls the Hono app directly. */
export async function connectClient(app: Hono, uid = "user_a"): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    fetch: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
    requestInit: { headers: { authorization: `Bearer ${fakeTokenFor(uid)}` } },
  });
  const client = new Client({ name: "evalprop-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

/** `callTool` narrowed to a CallToolResult. */
export async function call(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

/** The `ToolError` carried by an error result, parsed with the shared schema. */
export function errorOf(result: CallToolResult): ToolError {
  if (result.isError !== true) throw new Error(`expected a tool error, got ${JSON.stringify(result.content)}`);
  const block = result.content[0];
  if (block?.type !== "text") throw new Error("error result has no text block");
  return ToolErrorSchema.parse(JSON.parse(block.text));
}

export function textOf(result: CallToolResult): string {
  const block = result.content[0];
  if (block?.type !== "text") throw new Error("result has no text block");
  return block.text;
}

/** A raw JSON-RPC POST, for the HTTP-level tests that must not go through the client. */
export function rawPost(app: Hono, headers: Record<string, string>, body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" }): Promise<Response> {
  return Promise.resolve(
    app.request(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

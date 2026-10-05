import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hono } from "hono";
import type { AuthProvider } from "../auth/interface.ts";
import type { PipelineContext } from "../pipeline/index.ts";
import { createMcpServer } from "./server.ts";
import { TOOLS, type McpLogger, type ToolDefinition } from "./tools.ts";

/** Where the MCP endpoint and its OAuth discovery document live (ARCHITECTURE §6.1). */
export const MCP_PATH = "/mcp";
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

export interface McpHandlerDeps {
  auth: AuthProvider;
  /**
   * Everything the pipeline needs: repo, gateway, providers, clock, quota. Injected, so tests pass
   * fixture providers, an in-memory repo and a stub quota gate. Its `reportUrl`, if set, is kept unless
   * `reportUrl` below is given.
   */
  pipelineRuntime: PipelineContext;
  /** Public origin of this server, no trailing slash, e.g. `https://api.evalprop.example`. Used in the 401 challenge, the discovery document and report links. */
  baseUrl: string;
  /**
   * OAuth authorization server issuer URLs for the protected-resource metadata. Empty until S11 chooses a
   * vendor; the metadata document is then served without the `authorization_servers` field.
   */
  authorizationServers?: readonly string[];
  /**
   * Report link for an analysis. Default: `${baseUrl}/r/${analysisId}`.
   * TODO(S08/S14): a share link is a tokenised URL minted by `create_report`; wire that here (or have the
   * card link to an owner-authenticated route). The default is a placeholder, not a token scheme.
   */
  reportUrl?: (analysisId: string) => string;
  /** The tool registry. Default: `analyze_property` and `what_if`. */
  tools?: readonly ToolDefinition[];
  /** Structured log sink. Default: one JSON line on stderr. Never receives tokens or request bodies. */
  logger?: McpLogger;
}

export interface McpHandler {
  /** `POST /mcp`: authenticates, then serves one stateless Streamable HTTP exchange. */
  handleMcp(request: Request): Promise<Response>;
  /** `GET /.well-known/oauth-protected-resource` (RFC 9728). */
  handleProtectedResource(request: Request): Response;
  /** Mounts both routes on a Hono app. */
  mount(app: Hono): void;
}

const defaultLogger: McpLogger = (event, fields) => {
  console.error(JSON.stringify({ severity: "ERROR", event, ...fields }));
};

const trimSlash = (s: string): string => s.replace(/\/+$/, "");

function jsonRpcHttpError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** `Bearer <token>` (scheme is case-insensitive per RFC 7235), or null. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * Builds the `/mcp` handler. HTTP bridge: the SDK ships `WebStandardStreamableHTTPServerTransport`, which
 * speaks the Fetch API (`Request` in, `Response` out). Hono routes are Fetch handlers too and
 * `@hono/node-server` converts Node's req/res, so the transport is called with `c.req.raw` and its
 * `Response` is returned as is: no Node `IncomingMessage` bridging is needed. Stateless mode: a fresh
 * `Server` and transport per request (no session id, nothing kept between calls, so any Cloud Run instance
 * can serve any call), with JSON responses rather than SSE because every tool call is one request/response.
 */
export function buildMcpHandler(deps: McpHandlerDeps): McpHandler {
  const baseUrl = trimSlash(deps.baseUrl);
  const tools = deps.tools ?? TOOLS;
  const log = deps.logger ?? defaultLogger;
  const metadataUrl = `${baseUrl}${PROTECTED_RESOURCE_PATH}`;
  const reportUrl = deps.reportUrl ?? deps.pipelineRuntime.reportUrl ?? ((id: string) => `${baseUrl}/r/${id}`);
  const pipeline: PipelineContext = { ...deps.pipelineRuntime, reportUrl };

  /** 401 with the RFC 9728 challenge the MCP authorization spec (2025-06-18) requires. */
  const unauthorized = (invalidToken: { description: string } | null): Response => {
    const params = invalidToken
      ? `Bearer error="invalid_token", error_description="${invalidToken.description}", resource_metadata="${metadataUrl}"`
      : `Bearer resource_metadata="${metadataUrl}"`;
    return jsonRpcHttpError(401, -32001, invalidToken ? "Invalid or expired access token." : "Authentication required.", {
      "www-authenticate": params,
    });
  };

  async function handleMcp(request: Request): Promise<Response> {
    const token = bearerToken(request);
    if (token === null) return unauthorized(null);

    let identity;
    try {
      identity = await deps.auth.verifyAccessToken(token);
    } catch (err) {
      // An outage at the auth vendor is not a bad token: a 5xx keeps clients from re-authenticating.
      log("mcp.auth_error", { error: err instanceof Error ? err.name : "unknown" });
      return jsonRpcHttpError(503, -32603, "Authentication is temporarily unavailable.");
    }
    if (!identity.ok) {
      return unauthorized({ description: identity.reason === "expired_token" ? "The access token expired" : "The access token is invalid" });
    }

    // Stateless: there is no server-to-client stream and no session to terminate.
    if (request.method !== "POST") {
      return jsonRpcHttpError(405, -32000, "Method not allowed.", { allow: "POST" });
    }

    const server = createMcpServer(tools, { uid: identity.uid, pipeline, log });
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } catch (err) {
      log("mcp.transport_error", { error: err instanceof Error ? `${err.name}: ${err.message}` : "unknown" });
      return jsonRpcHttpError(500, -32603, "Internal error.");
    } finally {
      // With JSON responses the Response is complete when handleRequest returns, so it is safe to tear down.
      await server.close().catch(() => {});
    }
  }

  function handleProtectedResource(_request: Request): Response {
    const servers = (deps.authorizationServers ?? []).map(trimSlash);
    return new Response(
      JSON.stringify({
        resource: `${baseUrl}${MCP_PATH}`,
        ...(servers.length > 0 ? { authorization_servers: servers } : {}),
        bearer_methods_supported: ["header"],
        resource_name: "evalprop",
      }),
      { status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } },
    );
  }

  return {
    handleMcp,
    handleProtectedResource,
    mount(app) {
      app.all(MCP_PATH, (c) => handleMcp(c.req.raw));
      // Clients derive the metadata URL from the 401 challenge; the path-suffixed form is RFC 9728's default for a resource at /mcp.
      app.get(PROTECTED_RESOURCE_PATH, (c) => handleProtectedResource(c.req.raw));
      app.get(`${PROTECTED_RESOURCE_PATH}${MCP_PATH}`, (c) => handleProtectedResource(c.req.raw));
    },
  };
}

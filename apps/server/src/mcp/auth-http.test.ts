import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AnalyzePropertyOutputSchema } from "@evalprop/shared";
import { createApp } from "../app.ts";
import { FakeAuthProvider, fakeTokenFor } from "../auth/fake.ts";
import type { AuthProvider } from "../auth/interface.ts";
import { ADDR } from "../pipeline/test-helpers.ts";
import { createLocalPipelineRuntime } from "./local-runtime.ts";
import { BASE_URL, rawPost, testServer } from "./test-helpers.ts";

const METADATA = `${BASE_URL}/.well-known/oauth-protected-resource`;

describe("FakeAuthProvider", () => {
  const auth = new FakeAuthProvider();
  test("accepts test-token-<uid> and resolves the uid", async () => {
    assert.deepEqual(await auth.verifyAccessToken("test-token-dev"), { ok: true, uid: "dev", email: "dev@example.test" });
    assert.deepEqual(await auth.verifyAccessToken(fakeTokenFor("a_b-1")), { ok: true, uid: "a_b-1", email: "a_b-1@example.test" });
  });
  test("rejects everything else", async () => {
    for (const token of ["", "test-token-", "test-token-has space", "test-token-a/b", "Bearer test-token-x", "real-token", "TEST-TOKEN-dev", `test-token-${"x".repeat(65)}`]) {
      const r = await auth.verifyAccessToken(token);
      assert.equal(r.ok, false, token);
    }
    const expired = await auth.verifyAccessToken("test-token-expired");
    assert.equal(expired.ok === false && expired.reason, "expired_token");
  });
});

describe("authentication on /mcp (MCP authorization spec, 2025-06-18)", () => {
  test("no Authorization header: 401 with WWW-Authenticate pointing at the protected-resource metadata", async () => {
    const { app } = testServer();
    const res = await rawPost(app, {});
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("www-authenticate"), `Bearer resource_metadata="${METADATA}"`);
    assert.equal(res.headers.get("content-type"), "application/json");
  });

  test("a bad, expired or non-Bearer credential: 401 with error=\"invalid_token\" and the same metadata pointer", async () => {
    const { app } = testServer();
    for (const authorization of ["Bearer nope", "Bearer test-token-expired", "Bearer test-token-", "Basic dGVzdDp0ZXN0", "Bearer"]) {
      const res = await rawPost(app, { authorization });
      assert.equal(res.status, 401, authorization);
      const challenge = res.headers.get("www-authenticate") ?? "";
      assert.match(challenge, /^Bearer /);
      assert.ok(challenge.includes(`resource_metadata="${METADATA}"`), authorization);
      if (authorization.startsWith("Bearer ")) assert.ok(challenge.includes('error="invalid_token"'), authorization);
    }
  });

  test("a rejected call runs nothing: no analysis is saved", async () => {
    const { app, repo } = testServer();
    const res = await rawPost(app, { authorization: "Bearer nope" }, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "analyze_property", arguments: { address: ADDR.house } } });
    assert.equal(res.status, 401);
    assert.equal((await repo.listUsage("nope")).length, 0);
  });

  test("a valid token passes (scheme is case-insensitive); the uid comes from the token", async () => {
    const { app } = testServer();
    const res = await rawPost(app, { authorization: `bearer ${fakeTokenFor("dev")}` });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    assert.deepEqual(body.result.tools.map((t) => t.name).sort(), ["analyze_property", "what_if"]);
  });

  test("an outage in the auth provider is a 503, not a 401 (clients must not re-authenticate)", async () => {
    const down: AuthProvider = {
      verifyAccessToken: async () => {
        throw new Error("vendor unreachable");
      },
    };
    const { app, logs } = testServer({ auth: down });
    const res = await rawPost(app, { authorization: "Bearer anything" });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("www-authenticate"), null);
    assert.equal(logs[0]?.event, "mcp.auth_error");
    assert.ok(!JSON.stringify(logs).includes("anything"), "the token is never logged");
  });

  test("GET and DELETE are 405 (stateless: no server stream, no session), still behind auth", async () => {
    const { app } = testServer();
    for (const method of ["GET", "DELETE"]) {
      const anon = await app.request(`${BASE_URL}/mcp`, { method });
      assert.equal(anon.status, 401);
      const authed = await app.request(`${BASE_URL}/mcp`, { method, headers: { authorization: `Bearer ${fakeTokenFor("dev")}` } });
      assert.equal(authed.status, 405);
      assert.equal(authed.headers.get("allow"), "POST");
    }
  });

  test("malformed JSON-RPC from an authenticated client is a JSON-RPC error, not a crash", async () => {
    const { app } = testServer();
    const res = await app.request(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${fakeTokenFor("dev")}` },
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });
});

describe("GET /.well-known/oauth-protected-resource", () => {
  test("publishes the resource and the configured authorization servers", async () => {
    const { app } = testServer({ authorizationServers: ["https://auth.example.test/", "https://auth2.example.test"] });
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await app.request(`${BASE_URL}${path}`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        resource: `${BASE_URL}/mcp`,
        authorization_servers: ["https://auth.example.test", "https://auth2.example.test"],
        bearer_methods_supported: ["header"],
        resource_name: "evalprop",
      });
    }
  });

  test("is public (no token needed) and omits authorization_servers until one is configured", async () => {
    const { app } = testServer({ authorizationServers: [] });
    const res = await app.request(`${BASE_URL}/.well-known/oauth-protected-resource`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body["resource"], `${BASE_URL}/mcp`);
    assert.equal("authorization_servers" in body, false);
  });

  test("a base URL with a trailing slash is normalized", async () => {
    const { app } = testServer({ baseUrl: `${BASE_URL}/` });
    const res = await rawPost(app, {});
    assert.equal(res.headers.get("www-authenticate"), `Bearer resource_metadata="${METADATA}"`);
  });

  test("createApp() with no options still works and has no /mcp", async () => {
    const app = createApp();
    assert.equal((await app.request("/health")).status, 200);
    assert.equal((await app.request("/mcp", { method: "POST" })).status, 404);
  });
});

describe("over a real socket", () => {
  test("boots the server on an ephemeral port and calls it with the SDK's HTTP client", async () => {
    const app = createApp({
      mcp: { auth: new FakeAuthProvider(), pipelineRuntime: createLocalPipelineRuntime(), baseUrl: "http://127.0.0.1", logger: () => {} },
    });
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
    try {
      // No token: the real server answers 401 with the challenge.
      const anon = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.equal(anon.status, 401);
      assert.match(anon.headers.get("www-authenticate") ?? "", /^Bearer resource_metadata="http:\/\/127\.0\.0\.1\/\.well-known\/oauth-protected-resource"$/);

      const client = new Client({ name: "evalprop-socket-test", version: "0.0.0" });
      await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${fakeTokenFor("dev")}` } } }));
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ["analyze_property", "what_if"]);
      const result = await client.callTool({ name: "analyze_property", arguments: { address: ADDR.condo } });
      assert.notEqual(result.isError, true);
      const out = AnalyzePropertyOutputSchema.parse(result.structuredContent);
      assert.equal(out.card.address, ADDR.condo);
      await client.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

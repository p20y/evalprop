import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createLocalWiring } from "./mcp/index.ts";

const port = Number(process.env["PORT"] ?? 8787);
// Local dev wiring: fake auth (Bearer test-token-<uid>), fixture providers, in-memory repo unless
// EVALPROP_REPO=firestore. Production wiring (real auth, providers, Firestore) replaces this in S11/S15.
const { mcp, reports, analyses } = await createLocalWiring(process.env, port);
serve({ fetch: createApp({ mcp, reports, analyses }).fetch, port }, (info) => {
  console.log(`evalprop server listening on http://localhost:${info.port} (MCP at /mcp, token: test-token-dev)`);
});

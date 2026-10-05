# evalprop

A paid connector that lets an investor share a US property in an AI assistant (ChatGPT first; Meta Muse and any MCP client next) and get back a trustworthy rental-investment verdict and a client-ready report in seconds.

Share a Redfin/Zillow link or an address. evalprop looks up rent and sale comparables (nearest and most similar first), schools, taxes, and insurance estimates; runs a deterministic financial engine; and returns a verdict, a **max allowable offer**, break-even and hold-period analysis, and a shareable report (web page and PDF). Follow-ups like "what if I offer $215k at 6.5%?" re-run the exact numbers and show before/after.

The assistant explains and converses. **All numbers come from our engine**, never from the model, and every figure says whether it was provided, looked up (source and date), or assumed.

## Status

Design complete; building. Done: the monorepo skeleton and shared contracts (S00) and the calculation engine (S01). The calculation engine (S01) lives in `packages/engine`: tested, versioned, with hand-verified golden cases. The live board is in [docs/STORIES.md](docs/STORIES.md).

## How it works

```
Assistant (ChatGPT / Muse / MCP client)
        │  tool call: analyze_property(address, listing?, assumptions?)
        ▼
Cloud Run: evalprop server ──► data gateway (cached) ──► licensed data APIs
        │                          rent comps · sale comps · schools · tax
        ├─► comp selection (0.5 → 1 → 2 miles, same size first)
        ├─► calculation engine (deterministic, versioned)
        ├─► saved analysis (Firestore)
        ▼
card (inline in chat) + report link (web page, PDF)
```

The full design is in [ARCHITECTURE.md](ARCHITECTURE.md). The product definition (personas, stories, comp rules) is in [docs/PRODUCT.md](docs/PRODUCT.md).

## Repository layout

| Path | What |
|---|---|
| `packages/engine/` | Pure calculation engine |
| `packages/comps/` | Comp selection logic |
| `packages/data/` | Provider interfaces, gateway, adapters, fixtures |
| `packages/report/` | Report renderer |
| `packages/shared/` | zod schemas and types (the contracts) |
| `apps/server/` | Cloud Run service (MCP, pipeline, reports, billing) |
| `apps/pdf-worker/` · `apps/widget/` | PDF renderer · inline chat card |
| `docs/` | PRODUCT.md, STORIES.md (backlog), SETUP.md |

## Try the MCP server locally

`node apps/server/src/index.ts` starts the server on `http://localhost:8787` with fake auth, the recorded fixture provider and an in-memory repo (set `EVALPROP_REPO=firestore` with the emulator from `pnpm dev` to persist). The MCP endpoint is `POST /mcp` (Streamable HTTP, stateless); sign in with the bearer token `test-token-<anything>`, e.g. `test-token-dev`.

```bash
# MCP Inspector (UI): choose "Streamable HTTP", URL http://localhost:8787/mcp,
# header Authorization: Bearer test-token-dev
npx @modelcontextprotocol/inspector

# or one JSON-RPC call (fixture addresses: "2415 Maple Test Dr, Sampleton, OH 43017",
# "100 Sample Tower Ln Unit 4B, Testville, TX 78701")
curl -s localhost:8787/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer test-token-dev' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"analyze_property","arguments":{"address":"2415 Maple Test Dr, Sampleton, OH 43017"}}}'
```

Without a token the endpoint answers `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.

## Working on it

Read [AGENTS.md](AGENTS.md). One story at a time, one PR per story.

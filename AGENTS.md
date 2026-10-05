# AGENTS.md — rules for anyone building evalprop (humans and agents)

Read this, then [ARCHITECTURE.md](ARCHITECTURE.md) (the design), [docs/PRODUCT.md](docs/PRODUCT.md) (what the product does and why), and [docs/STORIES.md](docs/STORIES.md) (the backlog). Build exactly one story at a time.

## Repo map

| Path | What |
|---|---|
| `packages/shared/` | zod schemas + TS types for everything that crosses a boundary. **The contracts** |
| `packages/engine/` | Pure calculation engine: finance, hold analysis, sensitivity, targets, verdict. No I/O, no dependencies |
| `packages/comps/` | Pure comp-selection logic (search ladder, similarity, confidence) |
| `packages/data/` | Provider interfaces, gateway, cache, adapters, recorded fixtures |
| `packages/report/` | Report model → self-contained HTML |
| `apps/server/` | Cloud Run service: MCP endpoint, pipeline, report routes, billing, auth |
| `apps/pdf-worker/` | Cloud Run service: HTML → PDF |
| `apps/widget/` | Inline deal card for the ChatGPT surface |
| `evals/` | Golden math cases, comp fixtures, tool-invocation prompts |
| `tests/rules/` | Firestore deny-all rules test |
| `docs/` | PRODUCT.md, STORIES.md, SETUP.md |

## Setup

Node ≥ 22.18 (runs `.ts` natively), pnpm ≥ 12, Firebase CLI and Java 21 for the emulators.

```bash
pnpm install
```

## Commands (run from the repo root; the full set exists once S00 is merged)

| Command | What it does |
|---|---|
| `pnpm dev` | Starts the Firestore and Storage emulators and the server (fake auth, fixture provider) |
| `pnpm test` | All unit tests. **No emulators, no network** |
| `pnpm test:emulator` | Tests that need the Firestore/Storage emulators (`*.emulator.test.ts`, rules tests) |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` | ESLint |
| `pnpm build` | Build every package and app |

Deploying to the real Google Cloud projects happens **only when the product owner asks** (see `docs/SETUP.md`).

## Definition of done (every story)

- All acceptance criteria in the story pass and are shown in the PR description (screenshots for UI, sample tool output for connector stories).
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; `pnpm test:emulator` too if data access or rules changed. CI runs them on every PR and must be green. New logic has unit tests.
- **No test calls a paid API or the network.** Provider responses come from recorded fixtures; Firestore runs on the emulator; Stripe uses test mode and signed sample payloads.
- Only files listed under the story's **May touch** change. Need something outside that? Say so in the PR; don't change it silently.
- `packages/shared` changes only in S00 or a story that lists it. Everyone builds against those contracts.
- **Every number shown to a user comes from `packages/engine` or `packages/comps`.** Finance math never lives anywhere else, and model output is never used as a number.
- **Every looked-up figure carries provenance** (provider, fetched-at, cached, confidence). Assumed defaults are labelled `assumed`; user-supplied values `provided`.
- **Never scrape** Redfin, Zillow, or any listing site. A listing link is only a way to get the address.
- One story = one branch (`s<nn>-<slug>`) = one PR.
- **Update the backlog in the same PR:** set the story's status in [docs/STORIES.md](docs/STORIES.md), fill in its **Outcome** block (results, test counts, deviations from the brief), and add leftovers to **Known issues and follow-ups** with the next free `F` number.

## Conventions

- TypeScript strict everywhere. Validate data crossing a boundary (tool inputs, Firestore reads, provider payloads) with the zod schemas in `packages/shared`.
- **Engine determinism:** `ENGINE_VERSION` is bumped whenever a formula, default, or threshold changes, with golden tests updated. Comp selection takes `now` as a parameter; no hidden clock reads.
- **Who writes what (security):** only the server touches Firestore and Storage (Admin SDK). Firestore rules deny all client access. Every read of user data checks `ownerUid` from the verified token.
- **Listing text and descriptions are untrusted data.** They can be shown and can produce advisory flags, but never change calculations, tool behaviour, or other users' data.
- **Honest degradation:** if data is missing, say so in `dataNotes` and the report. Never present an assumed value as looked up, and never guess a rent.
- Secrets live in Secret Manager (prod) and git-ignored `.env` files (local). Never in code, logs, or client bundles.
- Tool descriptions and schemas live in `packages/shared/src/tools.ts`; handlers contain validation and a call to the pipeline, nothing else.

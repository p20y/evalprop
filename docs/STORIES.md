# evalprop — User Stories

The build backlog for evalprop. Each story is a self-contained brief an agent can pick up. It says what to build, how to verify it, which files it may touch, and which sections of [ARCHITECTURE.md](../ARCHITECTURE.md) explain the design. Product-level definitions (personas, the E-numbered catalogue, comp rules) are in [PRODUCT.md](PRODUCT.md).

- **Detailed stories:** the launch scope (S00–S16). **Outlines:** later steps, detailed once launch is in use (ARCHITECTURE §17, rule 7).
- **One story = one PR = one agent.** The product owner reviews against the acceptance criteria and merges.
- **Status values:** `todo` · `in progress` · `in review` · `done` · `blocked`.
- **When a story merges:** set it to `done` with its PR link, fill in its **Outcome** block, and add anything left over to [Known issues and follow-ups](#known-issues-and-follow-ups).

**Starting point:** the repository already contains the tested calculation engine (`src/calc/`, `test/calc.test.ts`, 20 passing tests). S00 creates the monorepo skeleton and S01 moves the engine into `packages/engine`.

---

## Board

| ID | Story | Step | Track | Depends on | Status |
|---|---|---|---|---|---|
| S00 | Repo skeleton, shared contracts, emulators, CI | 0 | Sequential | — | todo |
| S01 | Adopt and harden the calculation engine | Launch | A: engine | S00 | todo |
| S02 | Comp selection engine (search ladder, similarity, confidence) | Launch | A: engine | S00 | todo |
| S03 | Data gateway: provider interfaces, cache, fixtures, usage ledger | Launch | B: data | S00 | todo |
| S04 | Property, rent, and sale data provider (spike, then adapter) | Launch | B: data, human review | S03 | todo |
| S05 | Schools adapter | Launch | B: data | S03 | todo |
| S06 | `runAnalysis` pipeline + persistence | Launch | C: connector | S01, S02, S03 | todo |
| S07 | MCP server: `analyze_property`, `what_if` | Launch | C: connector | S06 | todo |
| S08 | Hosted report page + share links | Launch | D: report | S01, S06 | todo |
| S09 | Inline deal card widget (ChatGPT) | Launch | D: report | S07 | todo |
| S10 | PDF export worker | Launch | D: report | S08 | todo |
| S11 | OAuth sign-in for the connector (spike, then implement) | Launch | E: account, human review | S07 | todo |
| S12 | Plans, quotas, usage metering, Stripe subscription | Launch | E: account | S11 | todo |
| S13 | Tool descriptions + invocation evals | Launch | Sequential, human review | S07, S09 | todo |
| S14 | Integration, degraded states, latency measurement | Launch | Sequential | S04, S05, S08, S10, S12 | todo |
| S15 | Deploy to Google Cloud, observability, cost controls | Launch | Sequential | S14 | todo |
| S16 | Directory submission and Muse adapter | Launch | Sequential | S15, Muse docs | todo |

```mermaid
flowchart LR
  S00 --> S01
  S00 --> S02
  S00 --> S03 --> S04
  S03 --> S05
  S01 --> S06
  S02 --> S06
  S03 --> S06
  S06 --> S07 --> S09
  S06 --> S08 --> S10
  S07 --> S11 --> S12
  S07 --> S13
  S09 --> S13
  S04 --> S14
  S05 --> S14
  S08 --> S14
  S10 --> S14
  S12 --> S14
  S14 --> S15 --> S16
```

After S00 is accepted, tracks **A (engine, comps), B (data)** run in parallel. S06 joins them. After S07, **D (report), E (account)** run in parallel. S13 and S14 join everything.

---

## Definition of done (every story)

- All acceptance criteria pass and are demonstrated in the PR description (screenshots for UI stories, sample tool output for connector stories).
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass. New logic has unit tests.
- **No test calls a paid API or the network.** Provider responses come from recorded fixtures; Firestore runs on the emulator; Stripe uses test mode and signed sample payloads.
- Only files listed under **May touch** are changed. A needed change outside that list is raised in the PR, not made silently.
- Shared contracts in `packages/shared` change only in S00, or in a story that explicitly lists them.
- **Every number shown to a user comes from `packages/engine` or `packages/comps`.** No story computes finance math anywhere else, and no model output is ever used as a number.
- **Every looked-up figure carries provenance** (provider, fetched-at, cached, confidence). Assumed defaults are labelled `assumed`; user-supplied values `provided`.
- Nothing scrapes Redfin, Zillow, or any listing site.
- Secrets are never committed, logged, or placed in client code.

---

## Step 0: Foundations

### S00 · Repo skeleton, shared contracts, emulators, CI
**As a** developer (human or agent) **I want** a working monorepo with frozen shared contracts and a local backend **so that** parallel stories build against the same interfaces.

**Architecture refs:** §3 Tech stack, §4 Repository layout, §5.1 Tool surface, §6 Data model and rules, §10.1 Provider interface, §17 rules 1 and 5
**Product refs:** E12.1, E12.5

**Acceptance criteria**
- Given a fresh clone, when I run `pnpm install && pnpm test`, then all packages' tests pass without network or emulators.
- Given the repo, then it is a pnpm workspace with `packages/{shared,engine,comps,data,report}` and `apps/{server,pdf-worker,widget}`, each building and type-checking (apps and packages may be near-empty stubs).
- Given `packages/shared`, then it exports zod schemas and TS types for: `PropertyFacts`, `Assumptions`, `ResolvedAssumption` (with `source: provided | listing | lookup | assumed`), `Provenance`, `Resolved<T>`, `RentListing`, `SaleListing`, `Comp` (with `matchReason`, `matchClass: same-building | same-size | different-size`), `CompResult`, `School`, `Evaluation` (re-exported from the engine's types), `Analysis`, `ReportModel`, `CardModel`, all four tool inputs/outputs from ARCHITECTURE §5.1, the tool error codes, and `plans.ts` (`free`, `pro` with placeholder limits).
- Given `packages/data`, then it declares the provider interfaces from §10.1 (no implementations yet).
- Given `firestore.rules`, then it denies all client reads and writes, with a rules unit test against the emulator.
- Given `pnpm dev`, then the Firestore and Storage emulators start and `apps/server` serves `GET /health` returning `{ ok: true, engineVersion }`.
- Given `.github/workflows/ci.yml`, then lint, typecheck, and test run on every PR.
- Given `AGENTS.md`, `CLAUDE.md`, and `README.md` at the repo root, then they are present and accurate (they are committed with this backlog and updated here if commands change).
- Given the existing `src/calc` and `test/calc.test.ts`, then they are left in place for S01 to move.

**May touch:** everything (this is the bootstrap story), except `src/calc` and `test/calc.test.ts` (S01 owns the move)
**Must not touch:** `ARCHITECTURE.md` and `docs/PRODUCT.md` (raise changes in the PR)

**Test plan:** schema round-trip test per shared type; rules test (`@firebase/rules-unit-testing`); a `/health` handler test.

**Out of scope:** any business logic, provider code, tool handlers, report rendering.

**Outcome:** _(filled in when merged)_

---

## Launch scope

### S01 · Adopt and harden the calculation engine
**As an** investor **I want** the financial math to be exact, versioned, and state-aware **so that** I can trust every figure in the report.

**Architecture refs:** §8 Calculation engine, §13 Quality
**Product refs:** E2.1, E2.4, E2.6, E3.1, E3.2, E3.4, E3.5, E3.6

**Acceptance criteria**
- Given the existing engine, when moved to `packages/engine`, then all 20 existing tests pass unchanged (only import paths change) and the public API in ARCHITECTURE §8 is exported from the package root.
- Given `ENGINE_VERSION` (semver), then it is exported and covered by a test that fails if formulas change without a version bump (a golden-output snapshot of three reference deals).
- Given a purchase in a state that reassesses property tax on sale (at minimum CA, and the states listed in the story's table file `property-tax-reassessment.ts`, each with a source comment), when the user does not supply property tax, then tax defaults to the state's rate × **purchase price**, and the assumption record says why. Other states use the previous default.
- Given `evals/golden/`, then it holds at least five hand-verified cases (all-cash, leveraged, negative cash flow, high rate, 15-year loan) plus a standalone script that recomputes them independently and a test that compares.
- Given a `PropertyInput` with `offerPrice`, then the engine treats it as the purchase price and reports the discount versus `listPrice` when supplied.
- Given invalid inputs, then `InputError` names the field; zero rent or zero price never yields `NaN`/`Infinity` in the output.
- Given the verdict, then each check returns `actual` and `threshold` strings suitable for display.

**May touch:** `packages/engine/**`, `evals/golden/**`, root `package.json` scripts
**Must not touch:** `packages/shared` (re-export types only; request changes in the PR), `apps/**`

**Test plan:** existing tests; golden cases with an independent recompute script; state tax table tests; property tests for monotonicity (higher rate never increases cash flow, higher rent never decreases it).

**Out of scope:** financing types beyond fixed-rate (1.1), stress case (1.1), after-tax view (later), any I/O.

**Outcome:** _(filled in when merged)_

---

### S02 · Comp selection engine
**As an** investor **I want** rent and sale comps chosen like an experienced investor would **so that** the rent estimate is credible and explainable.

**Architecture refs:** §9 Comparable selection
**Product refs:** E4.1, E4.9, E4.10, E4.11, E4.13 · PRODUCT §4 (rules)

**Acceptance criteria**
- Given a subject profile and a list of candidate listings with distance, type, beds, baths, sqft, date, and kind (asking | leased), when I call `selectRentComps`, then it follows the ladder in §9 exactly: same building first, then strict matches at 0.5, 1, and 2 miles, then relaxed matches (sqft ±30% or adjacent bed count, size-adjusted by rent per sqft), then "insufficient".
- Given ≥ 5 strict comps within 0.5 mile, then the result stops at that step and contains no farther comps.
- Given a building where every unit is a 1-bed of 700–760 sqft, when 1-beds of similar size exist within 1 mile, then no 2-bed comp appears in the result.
- Given no strict comps at any radius, then adjacent-size comps are returned with `matchClass: 'different-size'`, an adjusted rent per sqft estimate, and confidence capped at `low` or `medium` per the rules.
- Given any result, then it includes `estimate { low, median, high }` (25th/50th/75th percentile after outlier trimming), `stepReached`, `radiusUsedMiles`, `confidence`, and per-comp `matchReason` text.
- Given duplicate listings of the same unit, then only the most recent is kept; given comps older than the recency window, then they are excluded unless needed, and the result says so.
- Given the same input, then the output is identical (deterministic, no randomness, no clock reads: `now` is a parameter).
- Given `selectSaleComps`, then it returns the nearest-first comps with price per sqft and a flag when the list price differs from the comps' median by more than a configurable percent.

**May touch:** `packages/comps/**`
**Must not touch:** `packages/shared` (request changes in the PR), any I/O or provider code

**Test plan:** fixture tables for: uniform 1-bed building; sparse suburb needing the 2-mile step; relaxed fallback with size adjustment; insufficient comps; outliers; duplicates; stale listings; tie-breaking. Thresholds live in one `config.ts` so tuning does not touch logic.

**Out of scope:** fetching data, density-based radius (open question 6; leave a config hook), asking-vs-leased price adjustments.

**Outcome:** _(filled in when merged)_

---

### S03 · Data gateway: provider interfaces, cache, fixtures, usage ledger
**As the** owner **I want** all external data to flow through one gateway with caching, timeouts, and cost tracking **so that** providers are swappable and every report's data cost is visible.

**Architecture refs:** §10 Data layer, §6.2 (`cache`, `usage`), §7.3 Degradation
**Product refs:** E11.1, E11.2, E11.3

**Acceptance criteria**
- Given a provider call through the gateway, then it applies a per-call timeout, one retry for idempotent requests, and returns `Resolved<T>` with provenance (`provider`, `fetchedAt`, `cached`).
- Given a repeat request within its TTL, then the result comes from the Firestore cache (`cached: true`) with no provider call; TTLs are configurable per endpoint and default to ARCHITECTURE §10.4.
- Given each call, then a usage record is produced (provider, endpoint, ms, cached, `costCents` from config) for the pipeline to persist.
- Given a `FixtureProvider`, then it serves recorded responses from `packages/data/fixtures/` for property, rent, sales, and schools and is the default in dev and tests.
- Given a `FakeProvider` configured to time out, error, or return empty, then the gateway returns a typed failure the pipeline can degrade on (never throws an unhandled error).
- Given two concurrent identical requests, then only one provider call is made (in-flight de-duplication).
- Given the gateway, then it never logs request bodies containing user-supplied listing text.

**May touch:** `packages/data/**`, `firestore.indexes.json`
**Must not touch:** `packages/shared` (request changes), `apps/**`

**Test plan:** gateway unit tests with fake clocks; cache tests on the Firestore emulator; concurrency de-duplication test; failure-mode tests.

**Out of scope:** any real provider (S04, S05), pipeline logic.

**Outcome:** _(filled in when merged)_

---

### S04 · Property, rent, and sale data provider (spike, then adapter)
**As the** owner **I want** a licensed data source chosen on evidence **so that** comps and facts are accurate, legal to use, and affordable.

**Architecture refs:** §10.2, §10.5, §9
**Product refs:** E4.1, E4.2, E4.9–E4.11, PRODUCT §6 risks 1–3

**Part 1: spike (product owner reviews before Part 2 starts)**
- Deliver `docs/provider-comparison.md`: at least three candidate providers compared on: address → facts, **radius rental-listing search with bed/bath/sqft filters**, sale comps, rent estimate, tax history, asking vs leased data, coverage, price per call and per month, rate limits, license terms for display/caching/redistribution, and attribution requirements. Include a recorded sample response for each tested call using three real addresses (a condo in a multi-unit building, a suburban house, a sparse/rural address).
- End with a recommendation and the license constraints to record in `docs/SETUP.md`.

**Part 2: adapter (after product owner approves the choice)**

**Acceptance criteria**
- Given the chosen provider, then `PropertyProvider`, `RentProvider`, and `SalesProvider` adapters implement the interfaces from S03, normalizing into the shared types (including `kind: asking | leased`, distance in miles, `date`).
- Given an address, then the adapter returns facts and coordinates, or a typed `AMBIGUOUS` result with candidates, or `NOT_FOUND`.
- Given the three spike addresses, then recorded responses are committed as fixtures and adapter tests run entirely from them.
- Given the provider's license terms, then attribution and caching limits are enforced in code (TTL caps) and listed in `docs/SETUP.md`.
- Given API errors, rate limits, and empty results, then the adapter returns typed failures (no exceptions leaking).
- Given the key, then it is read from configuration; an adapter integration test is **skipped unless** `RUN_LIVE=1` and is never part of `pnpm test`.

**May touch:** `packages/data/src/adapters/<provider>/**`, `packages/data/fixtures/**`, `docs/provider-comparison.md`, `docs/SETUP.md`
**Must not touch:** pipeline, engine, comps, `packages/shared`

**Test plan:** adapter normalization tests from fixtures; one opt-in live smoke script.

**Out of scope:** schools (S05), crime/insurance/flood (1.1), multiple providers at once.

**Outcome:** _(filled in when merged)_

---

### S05 · Schools adapter
**As an** investor **I want** the schools that serve a property **so that** I can judge family-rental demand.

**Architecture refs:** §10.3, §12 (fair housing)
**Product refs:** E4.5

**Acceptance criteria**
- Given a location, then the adapter returns assigned elementary, middle, and high schools (by attendance zone where the provider supports it) with name, level, rating, distance, and provenance; plus other schools within 1–2 miles.
- Given a provider that cannot return zone assignment, then results are labelled "nearby, not confirmed as assigned".
- Given display, then the returned object carries the attribution text required by the provider's license.
- Given no data, then the result is a typed `UNAVAILABLE` and the pipeline omits the section with a note.
- Given fixtures for three locations (urban, suburban, rural), then tests pass offline.

**May touch:** `packages/data/src/adapters/schools/**`, `packages/data/fixtures/schools/**`, `docs/SETUP.md`
**Must not touch:** everything else

**Test plan:** normalization tests from fixtures; attribution presence test.

**Out of scope:** crime, growth, flood, insurance, demographics.

**Outcome:** _(filled in when merged)_

---

### S06 · `runAnalysis` pipeline + persistence
**As the** system **I want** one orchestration from address to saved analysis **so that** every tool and the report share exactly the same logic.

**Architecture refs:** §7 Analysis pipeline, §6.2, §5.1 rule 2, §7.3 degradation, §7.4 latency
**Product refs:** E1.1–E1.3, E1.5, E2.2, E2.3, E3.2, E3.5, E7.1, E11.1, E11.2, E12.5

**Acceptance criteria**
- Given a request (address + optional listing + assumptions), then stages 1–8 run in order with stage 3 in parallel, and the result is a saved `Analysis` (immutable) containing facts, resolved assumptions with sources, the engine `Evaluation`, market data (comps, schools, provenance, confidence), advisory flags, `engineVersion`, `pipelineVersion`, `inputHash`, and `dataNotes`.
- Given assumption precedence **user-provided > listing-provided > looked-up > assumed default**, then each field's `source` is correct; tests cover every precedence pair.
- Given provider failures, timeouts, or empty data, then the pipeline degrades per ARCHITECTURE §7.3 (table-driven tests for each row) and always records what degraded in `dataNotes`.
- Given no usable rent from any source and none supplied, then the verdict is withheld with a clear `NEEDS_RENT` result (never a guessed number).
- Given an ambiguous address, then it returns candidates (`AMBIGUOUS_ADDRESS`) and creates nothing.
- Given the same `(uid, inputHash)` within 10 minutes, then the existing analysis is returned (idempotent, no second usage event).
- Given `what_if(baseAnalysisId, overrides)`, then it loads the owner's analysis, reuses its market data, re-runs stages 5–8, saves a new analysis with `baseAnalysisId`, and returns before/after rows for cash flow, cash-on-cash, DSCR, break-even, IRR; a different owner gets `NOT_FOUND`.
- Given listing text/description supplied by the assistant, then it is stored and displayed but never influences any calculation (test with an adversarial description).
- Given a run, then a usage event with provider calls and stage timings is written in the same transaction as the analysis.

**May touch:** `apps/server/src/pipeline/**`, `apps/server/src/repos/**`, `packages/shared` (only to add fields listed in the PR for approval)
**Must not touch:** engine and comps internals, MCP/transport code, report rendering

**Test plan:** pipeline tests against `FixtureProvider`/`FakeProvider` and the Firestore emulator; precedence matrix; degradation table; idempotency; owner isolation; adversarial listing text.

**Out of scope:** MCP wiring (S07), quotas and plans (S12), PDF.

**Outcome:** _(filled in when merged)_

---

### S07 · MCP server: `analyze_property` and `what_if`
**As an** investor **I want** to ask in chat and get an analysis **so that** I never leave the assistant.

**Architecture refs:** §5.1, §5.2, §6.1
**Product refs:** E1.1, E7.1, E7.3, E7.4, E12.1

**Acceptance criteria**
- Given a standard MCP client over Streamable HTTP, then `/mcp` lists `analyze_property` and `what_if` with the descriptions and input schemas from `packages/shared`, and calls them.
- Given a valid `analyze_property` call, then the response has `structuredContent` (the `CardModel`), a short text summary (verdict, the lever that matters, any data caveat), the report URL, and `_meta` with the full evaluation and provenance.
- Given invalid or ambiguous input, then the MCP tool error carries the stable codes from §5.1 (`NEEDS_ADDRESS`, `AMBIGUOUS_ADDRESS` with candidates, `INVALID_ASSUMPTION` naming the field).
- Given `what_if`, then the response includes before/after rows and the new report URL.
- Given `AuthProvider` (interface only here, `FakeAuthProvider` implemented), then every call requires a bearer token and resolves a `uid`; calls without one are rejected.
- Given handlers, then they contain only validation and a call to `runAnalysis`; no business logic.
- Given a summary text, then every number in it is generated from the saved analysis (a test asserts that numbers in the text equal numbers in the structured content).

**May touch:** `apps/server/src/mcp/**`, `apps/server/src/auth/interface.ts`, `apps/server/src/auth/fake.ts`
**Must not touch:** pipeline internals, engine, comps, `packages/shared` (read-only)

**Test plan:** contract tests through an in-process MCP client; error-code tests; summary/number consistency test; auth-required test.

**Out of scope:** real OAuth (S11), `compare_properties` and `create_report` (outlined below; `create_report` basics land with S08).

**Outcome:** _(filled in when merged)_

---

### S08 · Hosted report page + share links
**As an** investor **I want** a rich, professional report I can forward **so that** partners, lenders, and clients can read it without an account.

**Architecture refs:** §11 Report, §5.7, §6.2 (`reports`), §12
**Product refs:** E6.1, E6.4, E6.5, E3.1, E3.2, E3.4–E3.6, E4.1, E4.2, E4.5, E11.1

**Design input:** `docs/PRODUCT.md` §4 and the chat/comps mockups discussed during design (verdict banner, four KPIs, scorecard, max offer, income/expenses, returns with rules of thumb, hold chart with break-even, sensitivity heat grids, comps with match reasons, schools, assumptions table with source badges, disclaimer). The product owner reviews the rendered report visually.

**Acceptance criteria**
- Given a saved analysis, when `renderReport(model)` runs, then it returns one self-contained HTML document with every section in ARCHITECTURE §11, inline CSS and inline SVG charts (no external requests), and a hover tooltip on the hold chart.
- Given the executive summary, then every sentence is generated from engine/comps output (no free text from a model); a test checks each numeric token against the analysis.
- Given sensitivity grids, then cells carry their numbers (color is never the only signal) and the base case is marked; the hold chart has a legend, direct labels, and a table view of the same figures.
- Given status indicators (pass/fail, confidence), then each has an icon and a text label.
- Given the assumptions table, then each value shows `Provided`, `From listing`, `Looked up (source, date)`, or `Assumed default`.
- Given the comps section, then each comp row shows distance, size, rent, asking/leased, and its `matchReason`, and the section states the ladder step and confidence; fallback (different-size) comps are visibly tagged.
- Given `create_report` (core only), then it creates a `reports` document with a 128-bit random token (only its hash stored), returns the `/r/:token` URL, supports `revokedAt` and optional expiry, and `GET /r/:token` serves the page with `noindex` or 404/410 when revoked or expired.
- Given a 375px-wide viewport, then there is no horizontal page scroll; given print, then page breaks are sensible and nothing is cut off.
- Given missing sections (e.g. no schools), then the report omits them and shows the data note rather than empty boxes.
- Given the free tier flag, then a watermark option renders (plan logic arrives in S12).

**May touch:** `packages/report/**`, `apps/server/src/routes/report.ts`, `apps/server/src/mcp/create-report.ts`, `evals/report-fixtures/**`
**Must not touch:** engine, comps, pipeline, `packages/shared` (read-only)

**Test plan:** snapshot test of the rendered HTML for three fixture analyses (strong, marginal, degraded data); numeric-token consistency test; token hashing and revocation tests; an accessibility pass (contrast, labels); screenshots at 375px and desktop attached to the PR.

**Out of scope:** PDF (S10), branding (1.1), client-side recalculation (1.2), `compare_properties`.

**Outcome:** _(filled in when merged)_

---

### S09 · Inline deal card widget (ChatGPT)
**As an** investor **I want** a compact card in the chat **so that** I see the verdict and key numbers at a glance.

**Architecture refs:** §5.3, §5.1 (output shape)
**Product refs:** E7.4, E12.3 (pulled forward for ChatGPT)

**Acceptance criteria**
- Given a `CardModel`, then the widget renders: address, verdict pill (icon + label), four metric tiles (cash flow, cash-on-cash, cap rate, DSCR), max offer, break-even, 10-year IRR, comps confidence, and buttons "Open full report" and "Change assumptions".
- Given a what-if result, then the widget renders a before/after comparison table.
- Given the widget, then it is a pure function of `structuredContent`, holds no secrets, and makes no network calls.
- Given light and dark themes and a narrow width, then the layout holds without overflow.
- Before building, the implementer **re-reads OpenAI's current developer documentation** for widget registration, supported metadata, and sandbox limits, and records the exact mechanism and doc links at the top of the PR description.

**May touch:** `apps/widget/**`, `apps/server/src/mcp/widget-registration.ts`
**Must not touch:** pipeline, engine, report package

**Test plan:** component tests with fixture card models (strong, marginal, weak, degraded); visual screenshots in the PR.

**Out of scope:** Muse card (S16), compare view, editing assumptions inside the card (button hands back to the conversation).

**Outcome:** _(filled in when merged)_

---

### S10 · PDF export worker
**As an** investor **I want** a PDF that looks as good as the web report **so that** I can email or print it.

**Architecture refs:** §11, §14 (pdf-worker), §6.2
**Product refs:** E6.2

**Acceptance criteria**
- Given a report ID, when `create_report` is called, then a Cloud Task is enqueued and the worker renders the report HTML to PDF with headless Chromium and stores it in the private bucket; `GET /r/:token/pdf` redirects to a short-lived signed URL.
- Given the PDF, then charts and tables are intact, page breaks avoid splitting a section's heading from its content, and the footer carries the disclaimer and page numbers.
- Given the worker fails or times out, then the web report is unaffected, the PDF link shows "preparing" and the task retries with backoff; the failure is logged with the report ID.
- Given the worker endpoint, then it accepts only authenticated service-to-service calls.
- Locally, a script renders a fixture report to `./out/sample.pdf` without Cloud Tasks.

**May touch:** `apps/pdf-worker/**`, `apps/server/src/jobs/pdf.ts`
**Must not touch:** `packages/report` (request changes in the PR)

**Test plan:** worker handler tests with a stub renderer; a local render smoke script; signed-URL expiry test.

**Out of scope:** branded covers, multi-report bundles.

**Outcome:** _(filled in when merged)_

---

### S11 · OAuth sign-in for the connector (spike, then implement)
**As an** investor **I want** to connect my account once inside the assistant **so that** my analyses and plan follow me.

**Architecture refs:** §5.5, §12
**Product refs:** E10.2

**Part 1: spike (product owner reviews)**
- Deliver `docs/auth-comparison.md`: compare at least three managed auth vendors on MCP-style OAuth (protected-resource metadata, authorization-server discovery, dynamic client registration, PKCE), tested by connecting a real MCP client and ChatGPT's connector flow where available. Include price, social login, and migration risk. Recommend one.

**Part 2: implement**

**Acceptance criteria**
- Given the chosen vendor, then `/.well-known/oauth-protected-resource` is published and an MCP client completes the OAuth flow end to end against a dev tenant.
- Given a valid token, then `AuthProvider.verifyAccessToken` returns `{ uid, email }`; expired, malformed, wrong-audience, and revoked tokens are rejected with the correct challenge.
- Given a first successful call, then `users/{uid}` is created with `plan: 'free'`.
- Given `FakeAuthProvider`, then local development and tests still work unchanged.
- Given logs, then no tokens or emails appear.

**May touch:** `apps/server/src/auth/**`, `docs/auth-comparison.md`, `docs/SETUP.md`
**Must not touch:** pipeline, tools' handler logic

**Test plan:** token verification tests with signed test tokens; an end-to-end OAuth walkthrough recorded in the PR.

**Out of scope:** an account web page, team seats, password management (the vendor owns them).

**Outcome:** _(filled in when merged)_

---

### S12 · Plans, quotas, usage metering, Stripe subscription
**As the** owner **I want** a free tier and a paid plan that are enforced automatically **so that** the product can earn revenue without manual work.

**Architecture refs:** §5.6, §6.2, §14 (cost controls)
**Product refs:** E10.1, E10.3, E10.4, E10.7

**Acceptance criteria**
- Given `packages/shared/plans.ts`, then `free` and `pro` define monthly analysis and what-if allowances, report watermark, and the numbers are product-owner-editable in that one file.
- Given a billable call, then the monthly counter on `users/{uid}` is incremented in a transaction **before** provider calls, rolled back if the pipeline fails, and `QUOTA_EXCEEDED` (with upgrade link and remaining/limit) is returned before any provider cost is incurred.
- Given a free-tier analysis, then the report is watermarked per the plan; given `pro`, no watermark.
- Given Stripe Checkout (test mode), when a user subscribes, then the `/webhooks/stripe` handler (signature-verified, idempotent via `stripeEvents`) sets `plan: 'pro'`; cancellation or failed payment reverts per the subscription state.
- Given each tool response, then it includes usage (used / limit for the period).
- Given an internal admin script (`pnpm admin:usage`), then it prints per-user usage and data cost per report from the ledger.

**May touch:** `apps/server/src/billing/**`, `apps/server/src/quota/**`, `packages/shared/src/plans.ts`, `scripts/admin-usage.ts`
**Must not touch:** engine, comps, pipeline internals (the quota hook is a documented call in `runAnalysis`; add only that hook)

**Test plan:** transaction tests on the emulator (concurrent calls cannot exceed the limit); webhook tests with signed sample payloads incl. duplicates; rollback test.

**Out of scope:** annual plans, coupons, agent plan and branding, team seats.

**Outcome:** _(filled in when merged)_

---

### S13 · Tool descriptions + invocation evals
**As the** owner **I want** the assistant to call the tool at the right moments **so that** users never need to say "use evalprop".

**Architecture refs:** §5.2, §13
**Product refs:** E7.3, E12.2

**Acceptance criteria**
- Given `evals/invocation/prompts.json` with at least 40 labelled prompts (should call `analyze_property`; should call `what_if`; should not call; ambiguous), then a runner script reports precision/recall per tool.
- Given real runs against ChatGPT (and any other available MCP client), then results are recorded in the PR with the model/version and date.
- Given misses, then tool names/descriptions in `packages/shared/src/tools.ts` are revised and the set is re-run until the targets are met: ≥ 90% correct on should-call, ≤ 5% false positives. If targets cannot be met, the PR explains why.
- Given the descriptions, then they state when to use and when not to, and include one worked example call.

**May touch:** `evals/invocation/**`, tool descriptions in `packages/shared/src/tools.ts`
**Must not touch:** schemas (only description strings)

**Test plan:** the eval itself; a unit test that descriptions stay within length limits.

**Out of scope:** automated nightly runs against paid assistants.

**Outcome:** _(filled in when merged)_

---

### S14 · Integration, degraded states, latency measurement
**As the** owner **I want** the whole flow proven end to end **so that** launch is safe and the speed claims are real.

**Architecture refs:** §7.3, §7.4, §13
**Product refs:** E11.2, E11.3, E11.4

**Acceptance criteria**
- Given the real provider (paid, manual run) and five addresses (condo in a multi-unit building, suburban house, sparse area, ambiguous address, address with no data), then an end-to-end script runs `analyze_property` → `what_if` → `create_report` and records per-stage timings, provider cost, cache behaviour, and the comps ladder step reached.
- Given the recorded timings, then p95 cold and warm results are compared with the §7.4 budget in `docs/performance.md`; any stage over budget gets a follow-up in Known issues.
- Given forced provider failures (fake provider), then every row of §7.3 is demonstrated end to end and each produces a clear, honest message in chat and in the report.
- Given three reports (strong, marginal, weak deals), then the product owner reviews the rendered output and the chat summaries for tone and accuracy.
- Given the checklist in PRODUCT §6 (risks), then each item has a recorded status.

**May touch:** `scripts/e2e/**`, `docs/performance.md`, bug fixes anywhere listed in the PR (each fix explained)
**Must not touch:** nothing off-limits, but changes outside the listed areas are called out

**Test plan:** the e2e script (manual, paid); automated degraded-state tests (offline).

**Out of scope:** load testing beyond a handful of concurrent users.

**Outcome:** _(filled in when merged)_

---

### S15 · Deploy to Google Cloud, observability, cost controls
**As the** owner **I want** a repeatable, monitored deployment **so that** I can launch and operate with confidence.

**Architecture refs:** §14
**Product refs:** E10.7, E11.6, E11.5

**Acceptance criteria**
- Given `docs/SETUP.md`, then it lists exactly what the product owner provides (GCP projects and billing, provider key, auth vendor tenant, Stripe account) and the one-time setup commands.
- Given a merge to `main`, then GitHub Actions builds the images, pushes to Artifact Registry, and deploys to `dev`; `prod` deploys only on manual approval.
- Given the deployment, then `evalprop-server` runs with min 1 instance and CPU boost; the PDF worker scales to zero; secrets come from Secret Manager; the bucket is private.
- Given monitoring, then a dashboard shows p95 latency, error rate, cache hit rate, and data cost per report; an uptime check hits `/health`; Error Reporting is enabled.
- Given cost controls, then a budget alert and a billing kill-switch are configured and tested in `dev`.
- Given privacy, then a documented **delete my data** path removes a user's analyses, reports, and PDFs on request.
- Given launch gates, then the checklist records: legal review of disclaimers and fair-housing framing complete; Terms and Privacy pages published.
- **Deploying to the real prod project happens only when the product owner asks.**

**May touch:** `.github/workflows/**`, `infra/**`, `Dockerfile`s, `docs/SETUP.md`, `apps/server/src/observability/**`
**Must not touch:** product logic

**Test plan:** deploy to `dev`, run the S14 e2e script against it, attach results.

**Out of scope:** multi-region, autoscaling tuning beyond defaults.

**Outcome:** _(filled in when merged)_

---

### S16 · Directory submission and Muse adapter
**As the** owner **I want** the connector listed in ChatGPT and available in Muse **so that** users can find and use it.

**Architecture refs:** §5.3, §5.4, §12
**Product refs:** E12.4

**Acceptance criteria**
- Given OpenAI's current submission requirements (re-read at build time), then all required assets, policies, test accounts, and demo prompts are prepared and the submission checklist is complete.
- Given Meta Muse's developer documentation (**provided by the product owner; this story is blocked until it is**), then a design note states what Muse supports (tool protocol, UI, auth, billing policy) and the adapter is built accordingly as a thin layer over `runAnalysis`/the MCP endpoint.
- Given either platform, then no engine, pipeline, or data code changes for the adapter.

**May touch:** `apps/server/src/adapters/**`, `docs/**`
**Must not touch:** engine, comps, pipeline

**Test plan:** adapter contract tests; a recorded walkthrough on each platform.

**Out of scope:** platforms other than ChatGPT and Muse.

**Outcome:** _(filled in when merged)_

---

## Later steps (outlines only, detailed after launch)

- **Step 1.1: sticky and agent-ready.** `compare_properties` (E7.2); saved deals and shortlist (E8.1–8.2); investor criteria profile (E3.3); stress case (E3.7); financing types (E2.5); neighborhood context: crime, rental demand, growth, insurance, flood, local rules (E4.3, E4.4, E4.6–E4.8, E4.12); advisory flags and suggested adjustments (E5.1–E5.2); branding and client-ready sharing, section toggles, notes (E6.3, E6.6, E10.5); report refresh/versions (E6.8); Excel/Google Sheets export with live formulas (E6.9); multi-unit input (E1.6); listing-provided income/expenses (E1.4).
- **Step 1.2: more strategies.** Mid-term, short-term rental, value-add/BRRRR and rehab modelling (E9.1–E9.3, E2.7); interactive client scenarios on shared reports (E6.7); questions to ask the seller (E5.3).
- **Later.** Portfolio tracking and hold/sell/refi (E8.3–8.4); alerts (E8.5); after-tax view (E2.8); house hack and flip (E9.4–9.5); team seats (E10.6).

---

## Known issues and follow-ups

| # | Item | Raised in | Status |
|---|---|---|---|
| F1 | Verdict thresholds (cash flow > 0, CoC ≥ 8%, cap ≥ 6%, DSCR ≥ 1.25) are the author's defaults; product owner to confirm or replace before launch | Design | open |
| F2 | Default rate (6.75%) and expense defaults are placeholders; revisit with current market data before launch and on a schedule | Design | open |
| F3 | Open questions 1–8 in ARCHITECTURE §15 (auth vendor, data provider, pricing, Muse docs, comp ladder order, rural radius, short-term rental, GCP ownership) | Design | open |
| F4 | A draft report renderer was prototyped locally during design but is intentionally not part of the repo; S08 builds the report from the spec and approved mockups | Design | open |

_Next free follow-up number: F5._

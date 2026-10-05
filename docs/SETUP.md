# Setup: what the product owner provides

Local development needs none of this: it runs on emulators, a fake auth provider, and recorded provider fixtures. These are needed to run against real services.

## Accounts and keys

| Item | Needed by | Notes |
|---|---|---|
| Google Cloud projects `evalprop-dev` and `evalprop-prod` (names provisional) with billing | S15 | Region `us-central1`. Enable Cloud Run, Firestore (native), Cloud Storage, Cloud Tasks, Secret Manager, Artifact Registry |
| Data provider account and API key | S04, S05 | Chosen after the S04 comparison. Record the license terms (display, caching, redistribution, attribution) below |
| Auth vendor tenant (MCP-capable OAuth) | S11 | Chosen after the S11 comparison |
| Stripe account (test and live keys), a `pro` product and price | S12 | Webhook secret per environment |
| OpenAI developer account for the ChatGPT app | S09, S16 | Re-read the current docs at build time |
| Meta Muse developer documentation | S16 | Blocks the Muse adapter only |
| Domain name for report links | S15 | Cloud Run custom domain with managed TLS |

## Provider license terms

_(filled in by S04 and S05: display and attribution rules, cache TTL limits, redistribution limits.)_

### PROPOSED provider licence constraints (S04 part 1; not final)

> **Proposed, not final.** Drawn from public pages read on 2026-10-04 (see [provider-comparison.md](provider-comparison.md) for sources and evidence tags). Nothing here is confirmed by the provider in writing. Replace with the signed or confirmed terms once the product owner picks a provider, and have counsel read the full terms.

| Constraint | RentCast (recommended property/rent/sales provider) |
|---|---|
| Display to end users and inside reports | Permitted ("display ... to third parties") |
| Caching / storage | Permitted as necessary in our systems; no TTL stated. The gateway TTLs in ARCHITECTURE §10.4 (facts 30 d, rent listings 24 h, sale comps 7 d, estimates 7 d) appear allowed |
| Share links / redistribution | Permitted ("sublicense, disclose, display, resell and distribute" to third parties) |
| Attribution | None required; RentCast logo optional; no use of its trademarks without consent |
| Rent kind | Asking rents only. Label `kind: asking` everywhere; never present as leased |
| Prohibited | Scraping through our app, automated unsolicited queries, reverse engineering, circumventing security, building a competing service from non-public information, violating consumer-reporting or marketing laws |
| Rate limit | 20 requests/second per key; 429 on excess. Only HTTP 200 responses are billed |
| Still to confirm in writing | Display inside third-party AI assistants; retention of report snapshots behind share links; whether the free Developer plan has the same terms; section 3.3 (third-party content); committing recorded fixtures to the repository |

Schools (only if used; TTL caps must be per provider in the gateway, not the global 90-day default):

| Source | Max cache | Third-party sharing | Attribution | Other |
|---|---|---|---|---|
| GreatSchools NearbySchools (self-serve) | 0 (no caching) | Prohibited | Logo, copyright notice, links to profile pages | No generative-AI training or enhancement; no assigned schools or 1-10 ratings in this API |
| SchoolDigger | 24 hours, then purge | Display only to end users via our app | None found | Application must add significant value; daily query limits possible |
| ATTOM (trial terms) | 24 hours | Not permitted | Not public | Production terms by order form |
| NCES EDGE | None stated | None stated | None required | Public domain per EDGE documents; confirm the "statistical purposes only" usage agreement does not apply |

Rules for us regardless of provider:
- No scraping of Redfin, Zillow, Realtor.com or any listing site; no third-party "Zillow API" that scrapes.
- Never use provider data to train or fine-tune a model.
- Provider keys live in Secret Manager (prod) or a git-ignored `.env`; never in code, logs, fixtures, or client bundles.
- Every looked-up figure carries provenance (provider, fetched-at, cached).

## Real-environment setup

_(filled in by S15: one-time `gcloud` commands, secrets to create, CI deploy service account, budget alert and kill-switch.)_

## Never

- Commit keys or `.env` files.
- Deploy to `evalprop-prod` unless the product owner asks.

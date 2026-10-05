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

## Real-environment setup

_(filled in by S15: one-time `gcloud` commands, secrets to create, CI deploy service account, budget alert and kill-switch.)_

## Never

- Commit keys or `.env` files.
- Deploy to `evalprop-prod` unless the product owner asks.

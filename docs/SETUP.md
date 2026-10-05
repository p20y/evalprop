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

### PDF export (S10; applied during S15)

The PDF path has three parts: a Cloud Tasks queue, the `evalprop-pdf-worker` Cloud Run service, and a private Cloud Storage bucket. Nothing below has been run; S15 owns deployment. Names are provisional.

```bash
# Private bucket for PDFs: uniform access, no public access, objects are only reachable through signed URLs.
gcloud storage buckets create gs://evalprop-dev-pdfs --location=us-central1 \
  --uniform-bucket-level-access --public-access-prevention

# Queue. Retries with exponential backoff: 5 attempts, 10 s doubling to 5 min, give up after 1 h.
# One report renders at a time per instance (the worker runs at concurrency 1), so keep dispatch modest.
gcloud tasks queues create pdf-render --location=us-central1 \
  --max-attempts=5 --min-backoff=10s --max-backoff=300s --max-doublings=4 --max-retry-duration=3600s \
  --max-dispatches-per-second=5 --max-concurrent-dispatches=10

# Service accounts: the server enqueues (and signs URLs); Cloud Tasks calls the worker as the invoker account.
gcloud iam service-accounts create pdf-invoker
gcloud run services add-iam-policy-binding evalprop-pdf-worker --region=us-central1 \
  --member=serviceAccount:pdf-invoker@PROJECT.iam.gserviceaccount.com --role=roles/run.invoker
gcloud tasks queues add-iam-policy-binding pdf-render --location=us-central1 \
  --member=serviceAccount:SERVER_SA@PROJECT.iam.gserviceaccount.com --role=roles/cloudtasks.enqueuer
# The server must be allowed to create tasks that run as pdf-invoker:
gcloud iam service-accounts add-iam-policy-binding pdf-invoker@PROJECT.iam.gserviceaccount.com \
  --member=serviceAccount:SERVER_SA@PROJECT.iam.gserviceaccount.com --role=roles/iam.serviceAccountUser
# The worker writes PDFs; the server only reads (signs). V4 signing on Cloud Run goes through the IAM Credentials API, so the
# server's account must be able to sign as itself:
gcloud storage buckets add-iam-policy-binding gs://evalprop-dev-pdfs \
  --member=serviceAccount:WORKER_SA@PROJECT.iam.gserviceaccount.com --role=roles/storage.objectAdmin
gcloud storage buckets add-iam-policy-binding gs://evalprop-dev-pdfs \
  --member=serviceAccount:SERVER_SA@PROJECT.iam.gserviceaccount.com --role=roles/storage.objectViewer
gcloud iam service-accounts add-iam-policy-binding SERVER_SA@PROJECT.iam.gserviceaccount.com \
  --member=serviceAccount:SERVER_SA@PROJECT.iam.gserviceaccount.com --role=roles/iam.serviceAccountTokenCreator
```

Worker service (`apps/pdf-worker/Dockerfile`, built from the repository root): no unauthenticated access, concurrency 1, min instances 0, at least 1 GiB memory (2 GiB is safer), request timeout 120 s. Environment:

| Variable | Value |
|---|---|
| `PDF_BUCKET` | the bucket above |
| `OIDC_AUDIENCE` | the worker's own base URL (what Cloud Tasks puts in the token) |
| `OIDC_INVOKER_EMAILS` | `pdf-invoker@PROJECT.iam.gserviceaccount.com` |
| `CHROME_PATH`, `CHROMIUM_NO_SANDBOX` | set by the image (`/usr/bin/chromium`, `1`); never set the sandbox flag outside the container |
| `RENDER_TIMEOUT_MS` | optional, default 30000 |

Server environment for `create_report` and `GET /r/:token/pdf`: `GCP_PROJECT`, `TASKS_LOCATION` (default `us-central1`), `PDF_TASKS_QUEUE=pdf-render`, `PDF_WORKER_URL`, `PDF_WORKER_INVOKER_SA`, and the same bucket name for the signed-URL provider. With none of the queue variables set the server skips PDFs (`pdfUrl` is null).

Local development: `INTERNAL_AUTH_TOKEN` (16+ characters) replaces the OIDC pair, and `pnpm --filter @evalprop/pdf-worker render:sample` renders a fixture to `apps/pdf-worker/out/sample.pdf` without any of the above. Needs Chrome or Chromium (`CHROME_PATH` if it is not in a standard location).

## Never

- Commit keys or `.env` files.
- Deploy to `evalprop-prod` unless the product owner asks.

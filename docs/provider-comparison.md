# Data provider comparison (S04, part 1)

**Status:** research only, for product owner review. No code, no API key, no account, and no authenticated or paid call was used. Everything below comes from public web pages.
**Date researched:** 2026-10-04 (all "accessed" dates below are this day).
**Decision needed from the product owner:** choose the property/rent/sales provider and the schools source (section 4), and answer the open questions in section 7.

## 0. How to read this document

Evidence tags used throughout:

| Tag | Meaning |
|---|---|
| **[V]** | Verified: read on the provider's own public page (URL given). |
| **[S]** | Secondary: seen only in a search-result excerpt or a third-party article. Treat as unconfirmed. |
| **[?]** | Could not confirm from a public source. |
| **not published** | The provider's public pages do not list it. Not guessed. |

Method limits you should know about:

- Pages were read through a fetch tool that returns a model-written summary of the page, not raw HTML. Where a summary says something about licence terms, **have the full terms read by a person (ideally counsel) before signing**. Where a summary and a search excerpt disagreed, this document says so.
- Some pages could not be fetched (HTTP 403/404 or blocked): Zillow Group's Public Data Terms, Bridge Interactive, Realtor.com, SchoolDigger documentation, Rentometer terms of service. These are marked.
- Many "Zillow API" and "Realtor API" vendors that appear in search results are scrapers of Zillow/Realtor.com/Redfin. They break the no-scraping rule (AGENTS.md, ARCHITECTURE §10.5) and are excluded.
- **S04 acceptance gap:** the story asks for a recorded sample response for each tested call on three real addresses. That needs a key, so it is **not delivered in part 1**. Section 5 is the plan for producing them on a free trial key (a few dozen requests).

## 1. Bottom line

- **Property, rent, sales: RentCast** is the only candidate where public pages confirm every launch need: address → facts and tax history, **radius rental-listing search with bed/bath/sqft filters**, a rent estimate with its comps, a sale-value estimate with comps, published self-serve prices, and a licence that permits display, storage and redistribution without attribution. Its limits: rents are **asking rents only** (stated explicitly), and its terms were only read through a summary.
- **Schools: no candidate fits all constraints cleanly.** The self-serve school APIs restrict caching and third-party sharing, and the GreatSchools self-serve API has neither assigned schools nor 1–10 ratings. Section 4.2 recommends a conditional path and a free fallback.
- **ATTOM** is the credible second provider (sales, tax, AVM, schools by attendance zone), but it has no verified rental-listing radius search, publishes no prices, and its trial licence caps caching at 24 hours.
- **Zillow/Bridge, Realtor.com, Cotality (CoreLogic)** have no self-serve public data access. **Estated** is being absorbed into ATTOM and is no longer sold to new customers.

## 2. Comparison tables

### 2.1 Property, rent and sales providers: capabilities

| Criterion | RentCast | ATTOM | HouseCanary | Rentometer | Zillow Group (Bridge) | Realtor.com | Cotality (CoreLogic) | Estated |
|---|---|---|---|---|---|---|---|---|
| Self-serve key without sales call | Yes [V] | Free 30-day trial [V]; production by agreement | Yes, test and production keys on a paid plan [V] | Yes, with Pro plan [V] | No, invite-only, 10+ business days review [V/S] | No public API [S] | No [V: sales contact only] | Legacy only; not marketed to new customers [V] |
| Address → facts (beds, baths, sqft, year built, coords) | Yes [V] | Yes (`/property`) [V] | Yes (`property/details`) [S] | Not a property-facts API [V] | Public Records API (parcel, assessment, transactions) [V] | n/a | Yes, enterprise [S] | Yes [S] |
| Tax history (assessments and taxes by year) | Yes, by year [V] | Yes (`/assessment`, `/assessmenthistory`) [V] | [?] | No | Assessment data [V] | n/a | Yes, enterprise [S] | Yes [S] |
| **Radius search of rental listings with bed/bath/sqft filters** | **Yes**: `latitude`, `longitude`, `radius` (max 100 mi), `bedrooms`, `bathrooms`, `squareFootage`, `propertyType`, `status`, `daysOld`, `limit` up to 500 [V] | **Not found**; only Rental AVM [V] | **Not found**; only `rental_value` estimate [S] | Nearby rent comps endpoint [V], but no filters documented | Rentals APIs are feed-in (landlords to Zillow), not data-out [S] | No | MLS listings via Trestle, rentals not specifically covered [V] | No |
| Same-building / unit-level | `addressLine2` carries unit number [V]; whether condo units are populated consistently: **[?], test** | `/property` has unit data [?] | [?] | No | [?] | n/a | [?] | [?] |
| Sale comps (sold and active) | Active and inactive sale listings [V]; **no sold filter** on the listings endpoint [V]. Value AVM returns comps mixing Active and Inactive [V]. Property records filter by "days since last sale" with radius, giving recent sold records [V], **to test** | `/salescomparables` with radius, bed/bath/sqft ranges, sale date range [V/S]; `/sale`, `/saleshistory` [V] | `property/comps` [S] | No | MLS Listings API, invite-only [V] | n/a | Via MLS agreements [V] | No |
| Rent estimate | Yes, with comps, range, correlation score [V] | Rental AVM: value, min, max; no comps documented; updated monthly; 72M properties [V] | `property/rental_value` with bounds [S] | Statistics: mean, median, percentiles, sample size, radius [V] | Zestimates API incl. rental valuations, ~100M properties, invite-only [V] | n/a | Rental AVM [S] | No |
| Asking vs leased | **Asking only.** Docs say no private or landlord-submitted lease data is used [V] | Rental AVM based on listed rents [V] | [?] | Not disclosed [V] | [?] | n/a | [?] | n/a |
| Coverage claim | 150M+ properties; listing coverage **target** of 96% residential, 90% for 5+ unit; "targets", not audited [V] | 160M+ properties [V] | 100M+ properties [S] | "United States" [V] | ~100M properties [V] | n/a | ~99% of US residential [S] | n/a |
| Rate limits | 20 requests/second per key, all plans [V] | not published [V: none disclosed] | 250 components/min on self-serve analytics API [S] | not published | n/a | n/a | n/a | n/a |
| Failed calls billed? | No, only HTTP 200 [V] | No, only 200 responses count [V] | "successful call" pricing [V] | [?] | n/a | n/a | n/a | n/a |

### 2.2 Property, rent and sales providers: price and licence

| Criterion | RentCast | ATTOM | HouseCanary | Rentometer | Zillow Group (Bridge) |
|---|---|---|---|---|---|
| Published price | Developer $0 (50 req/mo, $0.20 over). Foundation $74 (1,000, $0.06 over). Growth $199 (5,000, $0.03 over). Scale $449 (25,000, $0.015 over). Enterprise on request [V] | **not published.** Free 30-day trial [V]. Third-party articles quote "$95/mo" or "$1k+/mo" [S, unverified]. The $499/year Property Navigator is a different, non-API product [V] | Plans: Basic $19/mo, Pro $79/mo, Teams $199/mo; API on Pro and up. Per successful call: basic $0.30-$0.50, premium $2.50-$4, premium plus $4-$6, depending on plan [V]. Which endpoints are in which tier: not published on the pricing page | Pro $29/mo or $199/yr [V]; one credit per call; 500 credits/mo monthly, 5,000 on annual [V from API page; the pricing page says "10 Rent Reports with Comps", so the two pages disagree] | not published |
| Per-call cost at plan rate | Foundation $0.074, Growth $0.040, Scale $0.018 when the allowance is fully used (plan price ÷ requests) | n/a | $0.30-$6.00 | about $0.04-$0.06 per credit (derived) | n/a |
| Display to end users | Allowed; "display ... to third parties" is in the licence grant [V] | Trial: evaluation only, no commercial use [V]. Production: by order form, not public | Per separate product terms, not public [V] | Allowed with attribution [V: addendum s.5] | Public Records terms: pass to end users "immediately upon receipt" [S] |
| Caching / storage | Permitted "as necessary" in your systems; **no TTL stated**; may keep lawfully obtained data after termination unless law requires deletion [V] | Trial terms: **no storing for more than 24 hours** [V]. Production: not public | Not public | Not stated in the pages read [?] | **Effectively none**: direct calls and immediate distribution only [S] |
| Redistribution / sharing report links to clients | Licence grant expressly includes sublicense, disclose, display, resell, distribute API Data to third parties [V] | Trial: no third-party use, no downloadable formats [V]. Production: not public | Not public. General site terms bar reselling site content [S] | No bulk redistribution; stand-alone API access may not be passed on [V] | Not to third parties other than app end users [S] |
| Attribution | **None required**; RentCast logo optional; use of its trademarks needs consent [V] | Not public | Not public | **Required**: prominent attribution "in a form acceptable to" Rentometer [V] | [?] |
| AI / LLM use stated | Not mentioned either way [V: no AI clause found] | Not public (ATTOM markets an MCP server) [V] | Not public (HouseCanary markets an MCP server) [S] | Not mentioned in pages read | [?] |
| Prohibited uses worth noting | Scraping through your app, automated unsolicited queries, reverse engineering, circumventing security, building a competing service from non-public information, violating consumer reporting or marketing laws [V] | See licence | See contract | Bulk download, scraping | Scraping barred in site terms [S] |

### 2.3 Schools sources

| Criterion | GreatSchools NearbySchools API | SchoolDigger API | ATTOM school endpoints | NCES EDGE (free, federal) |
|---|---|---|---|---|
| Self-serve | Yes, 14-day free trial [V] | Yes [V] | Via ATTOM licence | Yes, download and GIS web services [V] |
| Assigned schools (attendance zone) | **No.** The API has no assignment boundary data; it is a licensed dataset (sales contact) [V] | Not confirmed. Pages mention lat/long search and district-by-property-address (Enterprise); documentation page returned 404 [?] | Yes in principle: `detailwithschools` package returns schools in the property's attendance zone [S]; attendance boundary data ~95% of US [S] | SABS boundaries exist but the latest cycle is **2015-16**; operations closed [V]. Sources disagree on coverage ("600 largest districts" vs 94% of qualifying districts) [V/S] |
| Ratings | Self-serve Essentials: none. Quality plan: **rating bands** (below average / average / above average). **1-10 ratings are not in the API**, only in the Enterprise licence [V] | Own rankings and test-score metrics; depth by plan [V] | `schoolRating` field present, source not stated [V] | None |
| Nearby schools by lat/long | Yes [V] | Pro plan and up "advanced search with lat/long" [V] | Yes, `/school` [V] | Locations geocoded, annual files (2024-25 current) [V] |
| Price | School Essentials $52.50/mo incl. 15,000 calls, $0.003 over (cap 300,000). School Quality $97.50/mo, $0.006 over [V]. Enterprise licence: not published | Basic $19.90/mo, Pro $89/mo, Enterprise $189/mo, each incl. 2,000 calls; overage $0.0025-$0.01 by tier [V] | not published | Free |
| Rate limits | 10 req/s sustained, 20 burst, 300,000/mo [V] | Daily query limits may apply; not published [V] | not published | n/a |
| Caching | **Not allowed** ("cache or retain ... for later access") [V: ToS effective 2024-09-04] | **Up to 24 hours, then purge** [V] | Trial 24 h [V]; production not public | Public domain, per EDGE documents [S]; see open question 9 |
| Sharing with third parties | **Prohibited**; keys confidential, third parties must register themselves [V] | Display "only to End Users" through your app; no distribution to third parties [V] | Not public | Public domain [S] |
| Attribution | **Required**: GreatSchools logo, copyright notice, links to school profile pages, on the registered product [V] | Not found in terms read; SchoolDigger may list you as a customer [V] | Not public | Credit not required [S] |
| AI / LLM | Bars using the data for training or enhancing generative AI models [V] | No clause found [V] | Not public | n/a |

## 3. Per-provider notes

### 3.1 RentCast (recommended)

Sources (all accessed 2026-10-04):
- Pricing and coverage claims: https://www.rentcast.io/api [V]
- Rate limits: https://developers.rentcast.io/reference/rate-limits [V] (20 requests per second per key, every plan; 429 when exceeded)
- Billing: https://developers.rentcast.io/reference/billing-and-pricing [V] (only HTTP 200 counts; each request is one unit regardless of size; unused requests do not roll over; billing date is the plan activation day)
- Rental listings endpoint: https://developers.rentcast.io/reference/rental-listings-long-term [V]
- Sale listings endpoint: https://developers.rentcast.io/reference/sale-listings [V]
- Property records: https://developers.rentcast.io/reference/property-records [V]
- Rent estimate: https://developers.rentcast.io/reference/rent-estimate-long-term [V]
- Value estimate: https://developers.rentcast.io/reference/value-estimate [V]
- How estimates are built: https://developers.rentcast.io/reference/property-valuation [V]
- Listing data sources and coverage targets: https://developers.rentcast.io/reference/property-listings [V]
- Terms: https://www.rentcast.io/terms-api [V via summary, undated]
- Licence overview: https://developers.rentcast.io/reference/introduction and https://help.rentcast.io/en/articles/7992900-rentcast-property-data-api [V]
- Rental data quality: https://help.rentcast.io/en/articles/5535860-rental-data-sources-and-quality [V]

What was read:

- **Endpoints.** Property records (facts, tax assessments and property taxes by year, sale history, owner, features; lat/long and radius up to 100 miles; filter by sale date range, which can serve as a sold-comps search). Rental and sale listings (radius search, bed/bath/sqft/type/price/age filters, `limit` up to 500, listing history, MLS name and number when available). Rent estimate and value estimate (radius, `compCount` 5-25, similarity `correlation`, `distance`, `daysOld`, a range, and the comps used). Market statistics by ZIP.
- **Asking vs leased.** The docs state they do not use private, customer-contributed or landlord-submitted lease data; comps come from public listings and property records. So every rent figure is an **asking rent** and must be labelled `kind: asking`. No leased data from this provider.
- **Sources and freshness.** Listings come from "public sources", not directly from MLS, aiming for comparable coverage; listings refresh at least daily, new ones appear in 12-24 hours. Property records update weekly (third-party summary [S]). Coverage figures (96% residential, 90% for 5+ units) are stated as targets, not measured.
- **Sold comps.** The sale-listings endpoint accepts only Active or Inactive. Sold prices appear in property records (last sale, sale history) and the value estimate's comps include Inactive listings. A real "closed sales within X miles" query is therefore an approximation (property records filtered by recent sale date). Needs testing.
- **Unit level.** `addressLine2` carries an apartment or unit number "optionally". Whether it is populated reliably for condo and apartment listings is unknown. This decides ARCHITECTURE §9 step 1 (same building) and follow-up F10.
- **Licence.** Section 1 grants a revocable, non-exclusive, non-transferable, limited right to: create derivative works in your systems; internal research and analytics; lawful direct marketing; **sublicense, disclose, display, resell and distribute API Data to third parties**; and store the data in your systems as needed for those uses. No attribution or branding required. No clause on AI or machine-learning use was found, and no cache time limit. Section 3.3 refers to third-party content and was not summarised in detail. RentCast may throttle or limit call frequency. The terms carry no effective date.
- **Rural.** Third-party reviewers report soft estimates where few rentals exist [S]. RentCast's own docs say accuracy improves when subject attributes are supplied.
- **Other.** RentCast hosts an MCP server for its documentation and API (https://developers.rentcast.io/mcp) [S]; not needed for us (we call the REST API from `packages/data`). No SLA or uptime commitment was found. No contract term is required [V: launch blog, 2023-06-02].

Not confirmed:
- Whether the terms apply the same way to the free Developer plan.
- Whether showing data inside a third-party AI assistant (ChatGPT, Muse) is covered by "display to third parties". It reads as covered, but nothing says so explicitly. Ask in writing.
- Whether a stored snapshot behind a share link kept for years is "necessary to perform the permitted uses". It reads as permitted. Ask in writing.
- Real accuracy and coverage on our three address types.

### 3.2 ATTOM (second provider; not sufficient alone)

Sources:
- API endpoint list and radius rules: https://api.developer.attomdata.com/docs [V] (location search by lat/long needs a radius; default 5 mi, max 20 mi; only HTTP 200 responses count toward allowances)
- Product page: https://www.attomdata.com/solutions/property-data-api/ and FAQ https://www.attomdata.com/solutions/property-data-api/faqs/ [V] (160M+ properties; free 30-day trial; "only charged for the transactions you make"; no prices, caching or display terms on the page)
- Trial/licence terms: https://api.developer.attomdata.com/legal [V via summary]
- Rental AVM: https://cloud-help.attomdata.com/article/501-rental-avm [V]
- Sales comparables defaults (radius, bedroomsRange, sqFeetRange, saleDateRange): search-result excerpt of the API docs [S]
- School Profile V4: https://cloud-help.attomdata.com/article/618-upgrading-to-school-profile-v4 [V]; attendance-zone package and ~95% boundary coverage [S]
- Estated: https://cloud-help.attomdata.com/article/661-is-estated-api-being-replaced [V]; acquisition announcement https://www.attomdata.com/news/company-news/attom-company-announcement-10/ [S]; https://estated.com/ says it is now part of ATTOM [S]

Findings:
- Strong on property facts, tax assessments and history (10 years of sales history), AVM, sales comparables with radius and bed/bath/sqft ranges, and schools.
- **No rental-listing search found.** Only Rental AVM: estimated, min, max, calculated once a month (28th-31st), covering 72M properties, no comps documented. S02's ladder needs rent comps, so ATTOM cannot be the rent source alone.
- **Pricing not published.** Free trial then paid by "transaction" or order form.
- **Licence.** The public terms are trial terms: evaluation only, no commercial exploitation, **no caching beyond 24 hours**, no downloadable formats, no third-party use, all trial data destroyed at expiry. Production licence terms (display, caching, redistribution, attribution) are negotiated in an order form. Anything better than 24 hours would need to be confirmed in writing.
- **Estated** (acquired by ATTOM in 2022 [S]): the Estated API is still operated, but ATTOM does not market it to new customers, the Estated account portal is slated to stop being maintained in 2026, and functionality is being rebuilt inside the ATTOM API [S]. ATTOM promised at least six months' notice before deprecating it [V, article last updated 2023-06-13]. Estated returns property records, taxes and AVM, not rental listings. **Do not start a new integration on it.**

### 3.3 HouseCanary

Sources: https://www.housecanary.com/pricing [V]; https://www.housecanary.com/blog/real-estate-data-api-for-developers [V]; https://www.housecanary.com/legal/terms-of-use [V]; docs front page https://api-docs.housecanary.com/ (content too thin to confirm endpoints) .

Findings:
- Self-serve: Pro $79/mo gives API access with usage charges. Up to three test keys and three production keys per user. `{level}/{target}` endpoints at property, block, ZIP, MSA, state level; includes `property/value`, `property/rental_value` (monthly market rent with bounds), forecasts, rental price index [V].
- Per successful call: basic $0.30-$0.50, premium $2.50-$4, premium plus $4-$6, by plan. Several valuation, forecast and rental endpoints are priced separately from the standard set [V]. A search excerpt puts Pro at $0.40 / $3.00 / $5.00 [S]. The list of which endpoint is in which tier is not published on the pricing page.
- **Rental estimate only.** No radius search of rental listings was found, so it cannot supply the comp candidates S02 needs.
- Licence terms are in separate product agreements that are not public [V]. Cannot assess display, caching, redistribution or attribution.
- Cost at 6 calls per analysis would be at least $1.80 if every call were a basic endpoint, and more with valuation or rental endpoints. Not a fit for a small-budget launch.

### 3.4 Rentometer

Sources: https://www.rentometer.com/rentometer-api [V]; https://www.rentometer.com/pricing [V]; https://www.rentometer.com/api-technical-specifications-and-information [V]; licence addendum within https://www.rentometer.com/terms-of-use [V via summary]. `/terms-of-service` and `/developers/api_docs` content was not retrievable.

Findings:
- Endpoints: rent estimate statistics (mean, median, percentiles, sample size, radius searched), nearby rent comps (distance, rent, beds, baths, sqft), and a Pro report. Required inputs are address or lat/long and bedrooms 1-4. Source of the rents (asking vs leased) is not disclosed.
- API is bundled with Pro ($29/mo or $199/yr). One credit per call; credit allowances differ between pages (500 monthly / 5,000 annual on the API page; "10 Rent Reports with Comps" on the pricing page). Price of extra credits not published. Rate limits not published.
- Licence addendum: **prominent attribution required**; no bulk distribution; stand-alone API access may not be passed on; reasonable efforts against scraping. Caching limits not found. Content users make public may be retained and re-used by Rentometer [V].
- Useful at most as a **cross-check rent estimate**; it has no radius listing search with bed/bath/sqft filters, so it cannot feed the comp ladder.

### 3.5 Zillow Group (Bridge Interactive) and Realtor.com

Sources: https://www.zillowgroup.com/developers/ [V]; https://www.zillowgroup.com/developers/api/zestimate/zestimates-api/ [V]; https://www.zillowgroup.com/developers/api/public-data/public-records-api/ [V]; Public Records Data Terms of Use https://www.zillow.com/corp/PublicDataTerms.htm (fetch returned 403; wording below is from a search-result excerpt) [S]; Realtor.com article via https://www.realtyapi.io/blog/realtor-api [S, third-party vendor]; realtor.com itself could not be fetched.

Findings:
- Zillow Group lists ~20 APIs, among them Zestimates (property, rental and foreclosure valuations, ~100M properties), Public Records (parcel, assessment, transactions, ~15 years), MLS Listings, and Rentals feed integrations. Access is by request form describing the company and use case, for commercial use. Public Records and MLS Listings are **"currently invite only"** [V]; review takes 10+ business days [S].
- Zestimates and public records are served through Bridge (bridgedataoutput.com). The Public Records terms, as quoted in a search excerpt, limit the licence to direct server calls and distributing the data to end users **immediately upon receipt**, with no licensing to third parties. That reads as **no caching and no shared report links** [S]. This clashes with our model and was not verified on the primary page.
- Zillow's Rentals APIs push listings in; they do not return rental comps [S].
- Realtor.com: no public developer portal found; its APIs are for lead delivery and listing syndication under commercial licences [S]. Not available to us.
- **Verdict:** not usable at launch. Revisit only if Zillow grants access and the terms permit caching and shared reports.

### 3.6 Cotality (formerly CoreLogic)

Sources: https://www.cotality.com/products/trestle [V]; US property-API page returned 404; other results concerned Australia and are ignored.

Findings: Trestle distributes **MLS listing**, property and location data to MLOs, brokers, technology providers and aggregators; pricing and access are by sales contact (phone, demo request); the page does not mention rentals and offers no self-serve route [V]. Using MLS data needs the participating MLS's approval. Pricing not published. Not feasible at launch budget; no verified rental-listing search.

### 3.7 Others considered

- **BatchData** (https://batchdata.io/pricing [V]): plans start at **$1,000/month** for 100,000 records; listing data and comparable properties are paid add-ons; no prices for them on the page. Over budget.
- **HUD Fair Market Rent API** (https://www.huduser.gov/portal/dataset/fmr-api.html; page body would not load, details from search excerpts [S]): free bearer token; FMR by bedroom count for metro/county/ZIP. Not market comps, but a free, defensible **sanity band** for rent. Worth considering as an `assumed`-labelled fallback; licence to be checked.
- **Zillow/Redfin/Realtor scraper APIs** (many vendors): excluded, prohibited.

### 3.8 Schools

**GreatSchools** (https://www.greatschools.org/api/ [V]; ToS https://www.greatschools.org/gk/about/api-terms-of-service/ , effective 2024-09-04 [V via summary]; FAQ https://www.greatschools.org/gk/about/api-developer-resources/ [V]; licensing https://solutions.greatschools.org/k12-data-solutions/enterprise-data-license [V]):
- NearbySchools API: directory data (names, addresses, grades, type, NCES/state IDs, profile links) by proximity; Quality plan adds three rating bands. **No attendance-zone assignment and no 1-10 ratings** in the API; those are in the Enterprise data licence ("School Assignment & District Boundaries" and "1-10 School Ratings"), price not published, contact sales [V].
- ToS: licence limited to making calls and distributing data to your users immediately on receipt; no caching or retention; no disclosure or transfer of the data to third parties; must display GreatSchools brand, copyright, logo and links to profiles on the registered product; no use for training or enhancing generative AI; remove everything at termination [V]. The FAQ gives rate limits of 10 req/s sustained and 20 burst [V].
- Mismatch with us: stored reports, shared client links, and showing results inside an AI assistant that is not our registered product are all unlikely to be allowed under the self-serve terms. Written confirmation from GreatSchools (api-support@greatschools.org) is needed before relying on it.

**SchoolDigger** (https://developer.schooldigger.com/ [V]; ToS https://developer.schooldigger.com/termsofservice [V via summary]):
- Basic $19.90, Pro $89 and Enterprise $189 per month, 2,000 calls each, overage $0.0025-$0.01; 130,000+ schools, 18,500 districts; lat/long search from Pro; property-address district lookup on Enterprise. Documentation page was 404, so response fields and any attendance-zone support are unconfirmed.
- Terms: cache up to **24 hours**, then purge; data displayed only to End Users through the developer application; no copying, storing, archiving or distributing database portions to third parties; the application must be a "significant value enhancement" and predominantly your own functionality; query limits per day may apply. No attribution clause found, no AI clause found.
- Mismatch: 24-hour cap conflicts with the 90-day schools TTL in ARCHITECTURE §10.4; sharing via report links is a grey area.

**ATTOM schools**: School Profile V4 returns `schoolRating`, enrollment, test scores and district; the property detail-with-schools package returns schools in the property's attendance zone; boundary data ~95% of the US [S]. Source of the rating is not stated. Licence and price: negotiated.

**NCES EDGE** (https://nces.ed.gov/programs/edge/Geographic/SchoolLocations [V]; SABS FAQ https://nces.ed.gov/programs/edge/SABS/FAQs [V]; public-domain statement from EDGE documents [S]; data usage agreement https://nces.ed.gov/ncesglobal/data_usage_agreement.asp?link=true [V]):
- Free, annual school location files (2024-25 current) and GIS web services. Attendance boundaries (SABS) exist for 2013-14 and 2015-16 only; collection ended after 2015-16, so boundaries are about ten years old. Excludes magnet, charter and virtual schools.
- EDGE documents say materials are in the public domain. NCES's separate data usage agreement says "statistical purposes only" for public-use data, and the page does not say whether it covers EDGE. Counsel should clear this (open question 9).
- No ratings.

## 4. Recommendation

### 4.1 Property, rent and sales: RentCast

**Why**
1. Only candidate with a verified radius search of rental listings with bed/bath/sqft filters (S04's hard requirement), plus a rent estimate with comps, value estimate with comps, property records with tax history, and unit-number field.
2. Prices are published and the entry cost fits the budget: Growth at $199/month covers 5,000 requests (about 830 cold analyses).
3. The licence, as read, explicitly allows display, storage and distribution to third parties with no attribution and no stated TTL, which matches reports, share links and cached results (ARCHITECTURE §10.4 TTLs).
4. Failed requests are not billed, which suits typed-failure handling.
5. No contract or sales call is needed to start, so the spike on the free tier costs nothing.

**Risks**
1. **Asking rents only.** Every rent figure is asking, never leased. The product already labels this (PRODUCT §4), but it affects how conservative the verdict can be.
2. **No true sold-comps search.** Sale comps come from active/inactive listings, the value-estimate comps, and recent-sale filtering of property records. Quality is untested.
3. **Listings are not a direct MLS feed.** Coverage and freshness are claims ("targets"), not audited. Rural and thin markets will return few comps; the S02 ladder will report Low confidence there, which is the intended behaviour.
4. **Unit-level data may be missing** for condos and apartments, so "same building" (ladder step 1) could silently degrade. Test explicitly.
5. **Terms read only through a summary, undated, and silent on AI assistants and on very long retention.** Get written answers before launch (section 7).
6. **Vendor concentration:** one provider for facts, rent and sales. No SLA found. The `PropertyProvider`/`RentProvider`/`SalesProvider` interfaces (ARCHITECTURE §10.1) keep ATTOM available as a later second source for sales, tax and schools.

**Cost per analysis (RentCast only)**

Assumed cold-cache calls (6): (1) property record by address, (2) rent estimate, (3) rental listings in a 2-mile radius (the ladder narrows to 0.5/1 mile in `packages/comps` from one result set, so one call), (4) active sale listings in radius, (5) value estimate with comps or recent-sale property records, (6) one spare for a widened radius or same-building lookup. Warm cache is about 0 calls. Each call is one request.

| Plan | Cost per 1,000 cold analyses/mo (6,000 requests) | Per analysis | Cost at 200 cold analyses/mo (1,200 requests) |
|---|---|---|---|
| Developer ($0, 50 free, $0.20 over) | $1,190 | $1.19 | $230 |
| Foundation ($74, 1,000 incl., $0.06 over) | $374 | $0.37 | $86 |
| **Growth ($199, 5,000 incl., $0.03 over)** | **$229** | **$0.23** | $199 (fixed) |
| Scale ($449, 25,000 incl., $0.015 over) | $449 | $0.45 | $449 (fixed) |

Reading the table:
- Cheapest for 1,000 cold analyses a month is **Growth, $229**. Below about 510 cold analyses a month Foundation is cheaper (its $74 plus $0.06 overage stays under $199).
- At full plan usage the effective price per request is Foundation $0.074, Growth $0.040, Scale $0.018, so 6 calls cost $0.44, $0.24, $0.11 per analysis respectively.
- Cache hits are free, so with a 50% warm rate, 1,000 analyses a month needs about 3,000 requests, which fits inside Growth at the flat $199 (about $0.20 per analysis); Foundation would be about $194 at that volume, so the two are close.
- Marginal cost of one extra cold analysis on Growth beyond the allowance is 6 × $0.03 = $0.18.

### 4.2 Schools

There is no option that is clean against all constraints (cached, shared by link, shown in AI responses, small budget, ratings, assigned schools). Recommended path, in order:

1. **Ship S05 at launch with the free path first.** NCES EDGE school locations for "nearby, not confirmed as assigned" schools (the S05 label for providers without zone data), no ratings, no licence cost. Subject to open question 9 (NCES terms) and to the fact that EDGE gives locations and identifiers, not ratings. This avoids any licence conflict.
2. **For ratings, pursue SchoolDigger Pro ($89/mo), conditional.** It is the only self-serve source whose caching limit (24 hours, then purge) is a number we can design to and which has no attribution or AI clause. It must first confirm in writing: (a) report snapshots and share links to clients count as "End Users" display, (b) display inside AI assistants is allowed, (c) response includes assigned-zone or district data (docs unverified), (d) what the ratings represent and any required credit. If it declines, fall back to step 1 only.
3. **GreatSchools** is the recognised brand and the data buyers expect, but the self-serve API (a) has no assigned schools or 1-10 ratings, (b) forbids caching, (c) forbids passing data to third parties, and (d) requires its logo and links on the registered product. Only the Enterprise licence might fit; price not published. Ask for a quote if ratings matter to launch, but do not plan on the self-serve tier.
4. **ATTOM schools** (attendance-zone package) is the best technical path to *assigned* schools; revisit if ATTOM is added later and its production licence allows more than 24-hour caching.

**Design consequence for S03/S05:** the gateway default of 90 days for schools (ARCHITECTURE §10.4) must become a per-provider cap, not a global default. SchoolDigger and ATTOM-trial are 24 hours; GreatSchools self-serve is 0.

**Cost per analysis (schools)**: assume 2 calls cold (assigned/nearby), about 0 warm.

| Source | Cost per analysis | Per 1,000 cold analyses (2,000 calls) | Notes |
|---|---|---|---|
| NCES EDGE | $0 | $0 | Needs our own ingest of annual files or the GIS web service; engineering time, not a fee |
| SchoolDigger Pro | about $0.09 at full use of the 2,000-call allowance | **$89** | 1,000 analyses uses exactly the allowance; overage $0.0025-$0.01 per call [V] |
| GreatSchools School Quality | $0.012 marginal; plan floor $97.50 | $97.50 (within 15,000 calls) | Not recommended: terms |

Combined cost estimate at 1,000 cold analyses a month: RentCast Growth $229 plus SchoolDigger Pro $89 = **about $318/month, $0.32 per analysis**; with RentCast only and NCES for schools, **$229**. Both fit "a few hundred dollars a month". Warm-cache hits lower the per-call part but not the plan floors.

## 5. What to verify with a trial key before committing

RentCast's Developer plan gives 50 free requests a month, enough for the three-address test (about 18-20 calls). **The product owner (not an agent) creates the account and key.** Use the three addresses the product owner supplies for the S04 story: (A) a condo in a multi-unit building, (B) a suburban house, (C) a sparse or rural address. Save every response as a fixture candidate (see open question 8 on repository licensing).

Checklist (run for each address unless noted):

1. **Address resolution.** Does `address` match exactly, return a typed ambiguity, or return nothing? Does it return `addressLine2`/unit for A? What happens with a typo or a missing unit?
2. **Facts.** Beds, baths, sqft, year built, lot size, coordinates, property type, tax assessments and property taxes by year, last sale. Check sqft against a county record or a listing the product owner can see. Note nulls.
3. **Rental listings, radius search.** For A: radius 0.1, 0.5, 1 mile with `bedrooms`, `bathrooms`, `squareFootage` ranges (confirm ranges work), `status=Active` and `Inactive`, `daysOld`. Count results, check `distance` or compute it from coordinates, check duplicates, check `listedDate`/`removedDate`/`lastSeenDate`, `listingType`, whether inactive rentals are kept and how long.
4. **Same-building (A).** Are other units of the same building returned, with unit numbers in `addressLine2`? If not, does a tiny radius around the building find them? This decides ladder step 1 and F10 (dedupe key).
5. **Suburban (B).** Are there at least 5 strict comps in 1 mile? How many at 2 miles? Are comps mostly single-family?
6. **Rural (C).** How many comps at 2, 5, 10, 25 miles? Does the rent estimate return a range and a low correlation, or fail? Does it return an error that is billed? (Docs say only 200 responses are billed.)
7. **Rent estimate.** Compare `rent`, `rentRangeLow/High` and its comps with the listings found in step 3. Do comps include inactive listings? Do `distance` and `correlation` look sensible?
8. **Sale side.** Active sale listings in radius (price, MLS number, dates). Value estimate comps: how many are Inactive and do they carry a sold price or just a last list price? Property records filtered by recent sale date in radius: do they return `lastSalePrice` and `lastSaleDate`, enough for sold comps?
9. **Billing.** After the run, compare the dashboard count to the number of calls made. Confirm empty results (200 with no rows) count as billed requests.
10. **Rate limit and errors.** Trigger a 429 at a controlled rate; record the error body and headers. Record the shape of 4xx errors, for typed failures.
11. **Terms on the free tier.** Does the Developer plan carry the same terms as paid plans? Is anything different about storing or displaying data?
12. **Written answers from RentCast support** (email, kept in the repo docs, not code): the questions in section 7, items 3-5.

Pass criteria for committing to RentCast: step 3 works with all three filters; step 4 returns units for A (or a documented workaround); step 5 reaches Medium or High confidence for B on current data; step 6 degrades gracefully; step 11 and 12 raise no licence blockers.

For schools (separate trial, free): GreatSchools (14-day trial) and SchoolDigger (check for a free tier or request a trial), same three addresses. Look at: is the assigned or the nearest school returned, are ratings present, response fields needed for attribution, and what each provider's support says about caching, report links and AI display.

## 6. Licence constraints to record in `docs/SETUP.md`

A proposed section has been added to `docs/SETUP.md` ("Proposed provider licence constraints (S04 part 1, not final)"). Summary of what it records:

- RentCast: display, store, sublicense and distribute to third parties permitted; no attribution; no stated TTL; throttling allowed; scraping through the app barred; written confirmation outstanding for AI-assistant display, long-term snapshot retention, and free-tier terms.
- Per-provider TTL cap table for the gateway (schools especially).
- Attribution requirements per provider that would apply if chosen.
- Rules for ourselves: asking-rent labelling, no scraping, no use of a provider's data to train a model, secrets handling.

## 7. Open questions for the product owner

1. **Provider choice.** Approve RentCast for property, rent and sales, or ask for a different shortlist? Is a single provider acceptable at launch (vendor concentration)?
2. **Budget.** Is about $230-$320/month at 1,000 cold analyses acceptable at launch? Is the data cost per report (about $0.23-$0.32) consistent with the planned price per plan?
3. **Written licence clarification.** Will you email RentCast (and any schools vendor) the following and keep the reply: may we (a) display data inside third-party AI assistants such as ChatGPT or Muse, (b) keep stored report snapshots and serve them through public share links for as long as a user keeps the report, (c) cache for days, (d) apply the Developer-plan terms to a spike? Who sends it?
4. **Asking-rent-only.** Is a rent figure that is always an asking rent (never leased) acceptable for the verdict? PRODUCT §4 already says labelled; confirm the verdict thresholds (F1) are comfortable with that.
5. **Schools at launch.** Is schools a launch must-have? If yes, which trade-off: free NCES data without ratings, a conditional SchoolDigger plan, or a negotiated GreatSchools Enterprise licence (price not published)? Fair-housing legal review (PRODUCT §6 risk 6) still applies.
6. **Test addresses.** Which three real addresses (condo in a multi-unit building, suburban house, sparse or rural) should the trial use? Preferably addresses you can verify independently.
7. **Who creates the trial account and key?** An agent must not. The key goes in Secret Manager or a git-ignored `.env`, never the repo.
8. **Committing fixtures.** The adapter tests need recorded provider responses in git. Is the repository private? If it is ever public, committed fixtures would redistribute the provider's data. Ask the provider, or use redacted or synthetic fixtures derived from the recorded shapes.
9. **NCES terms.** EDGE materials say public domain, while a separate NCES usage agreement says "statistical purposes only" for public-use data. Who confirms that EDGE school locations may be used for a commercial product?
10. **Second provider.** Do you want ATTOM kept on the roadmap as a second source (sales and tax history, attendance-zone schools) and the production licence terms requested now, so the choice is informed?
11. **Rural radius.** The ladder stops at 2 miles (open question 8 in PRODUCT §7). RentCast allows up to 100 miles in one call. Do you want density-based widening with a visible note? Test C will show how often it matters.

## 8. Reference list

RentCast: https://www.rentcast.io/api, https://developers.rentcast.io/reference/introduction, /rate-limits, /billing-and-pricing, /rental-listings-long-term, /sale-listings, /property-records, /rent-estimate-long-term, /value-estimate, /property-valuation, /property-listings, https://www.rentcast.io/terms-api, https://help.rentcast.io/en/articles/7992900-rentcast-property-data-api, https://help.rentcast.io/en/articles/5535860-rental-data-sources-and-quality, https://www.rentcast.io/blog/introducing-rentcast-real-estate-api.
ATTOM: https://api.developer.attomdata.com/docs, /docs/guides, /legal, https://www.attomdata.com/solutions/property-data-api/, /faqs/, https://cloud-help.attomdata.com/article/501-rental-avm, /618-upgrading-to-school-profile-v4, /661-is-estated-api-being-replaced, https://www.attomdata.com/solutions/property-navigator/pricing/.
HouseCanary: https://www.housecanary.com/pricing, /blog/real-estate-data-api-for-developers, /legal/terms-of-use.
Rentometer: https://www.rentometer.com/rentometer-api, /pricing, /api-technical-specifications-and-information, /terms-of-use.
Zillow Group: https://www.zillowgroup.com/developers/, /api/zestimate/zestimates-api/, /api/public-data/public-records-api/.
Cotality: https://www.cotality.com/products/trestle.
BatchData: https://batchdata.io/pricing.
GreatSchools: https://www.greatschools.org/api/, /gk/about/api-terms-of-service/, /gk/about/api-developer-resources/, https://solutions.greatschools.org/k12-data-solutions/enterprise-data-license.
SchoolDigger: https://developer.schooldigger.com/, /termsofservice.
NCES: https://nces.ed.gov/programs/edge/Geographic/SchoolLocations, https://nces.ed.gov/programs/edge/SABS/FAQs, https://nces.ed.gov/ncesglobal/data_usage_agreement.asp?link=true.
HUD: https://www.huduser.gov/portal/dataset/fmr-api.html.

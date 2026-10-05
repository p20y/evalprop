# evalprop — Product definition

A paid connector that lets an investor share a US property (Redfin/Zillow link, address, or pasted listing) inside an AI assistant (ChatGPT, Meta Muse, any MCP client) and get back a trustworthy verdict and a client-ready report in seconds.

This document defines **what the product does and why**: personas, principles, the story catalogue (E-numbers), comp rules, and open decisions. The **build backlog** that agents pick up is [STORIES.md](STORIES.md), and the design is [../ARCHITECTURE.md](../ARCHITECTURE.md). Story IDs here (E1.1, E4.9, …) are referenced from the build stories as *Product refs*.

---

## 1. Who it's for

| Persona | Job to be done | Why they pay |
|---|---|---|
| **Maya — individual buy-and-hold investor** (primary) | Screen many listings fast, make offers with confidence, avoid bad deals | Saves hours per deal; a wrong buy costs tens of thousands |
| **Dan — investor-focused agent / buyer's agent** | Send clients a professional analysis; win listings and buyers | A branded report is a sales tool; billable to their client relationship |
| **Priya — small portfolio owner** (later) | Compare a new deal against what she owns; decide hold/sell/refi | Ongoing value, higher retention |

Launch focus: **Maya first, Dan second.** Dan's needs (branding, sharing) are cheap to add on top of Maya's and probably carry the higher price tier.

## 2. Product principles

1. **Numbers come from code, not the model.** The AI explains and converses; the engine calculates. Same inputs always give the same outputs.
2. **Every figure shows where it came from:** provided by you, looked up (with source and date), or assumed default.
3. **Fast first, deep on request.** A verdict in a few seconds from minimal input; richer data and scenarios layer on.
4. **Never fail silently.** Missing data degrades the report gracefully and says so.
5. **Report is the product.** Something an investor would forward to a partner, lender, or client without apologizing for it.
6. **Max offer and what-if are the hero.** The most valuable moment is "what do I offer, and what happens if rates or price change?", not the first set of numbers. Chat answers lead with the verdict, the max offer, and a way to try scenarios.

### Core experience (agreed from the mockups)

1. User shares a link or address in the assistant.
2. The assistant shows its progress ("found property, pulled comps, ran underwriting"), then an **inline deal card**: verdict, four headline metrics, max offer, break-even, 10-year IRR, and a link to the full report.
3. A short plain-language read of the result, including what lever matters (price, rent, or rate).
4. Follow-ups ("offer $215k at 6.5%") return a **before/after comparison**, not a new wall of text.
5. "Make a report for my client" produces a branded, shareable link and a PDF.

### Tool surface (four tools)

| Tool | Purpose |
|---|---|
| `analyze_property` | Address plus whatever the assistant extracted from the listing → enrichment, calculations, saved analysis with an ID, and report link in one call |
| `what_if` | Analysis ID plus overrides → new result and a before/after comparison |
| `compare_properties` | Several analysis IDs → side-by-side ranking |
| `create_report` | Analysis ID plus branding, note, and scenario → hosted report, PDF, share link |

---

## 3. Epics and stories

Release tags: **L** = launch (paid beta), **1.1**, **1.2**, **Later**.

### E1 — Capture a deal

| ID | Story | Acceptance criteria | Rel |
|---|---|---|---|
| E1.1 | As Maya, I paste a Redfin/Zillow link or an address in chat and the assistant starts the analysis. | Accepts URL, street address, or MLS number; resolves to one property or asks which of several matches; works without me leaving the chat. | L |
| E1.2 | As Maya, I can paste listing text (or a screenshot the assistant reads) when no link works. | Price, beds/baths, taxes, HOA, and description extracted; extracted values read back to me before analysis. | L |
| E1.3 | As Maya, I see what the tool understood about the property and can correct it. | Shows address, price, beds/baths/sqft, taxes, HOA, year built; any correction re-runs the analysis. | L |
| E1.4 | As Maya, if the listing already contains income/expense info (multifamily, existing tenants), it is used. | Actual rent, lease end, and listed expenses override estimates and are labelled "from listing". | 1.1 |
| E1.5 | As Maya, I can analyze a property that is off-market or not listed yet by giving address and my target price. | Works with an offer price instead of list price. | L |
| E1.6 | As Maya, I can analyze multi-unit properties (2–4 units, rents per unit). | Per-unit rent entry; combined and per-unit metrics. | 1.1 |

### E2 — Underwrite (long-term rental)

| ID | Story | Acceptance criteria | Rel |
|---|---|---|---|
| E2.1 | As Maya, I get monthly cash flow, NOI, cap rate, cash-on-cash, DSCR, GRM, and the 1% and 50% rules. | All metrics shown with plain-English meaning and a benchmark. | L |
| E2.2 | As Maya, I don't have to supply anything beyond the property; sensible local defaults fill the gaps. | Rent estimate from comps; taxes and insurance estimated for the property's state/county; every default is flagged "assumed". | L |
| E2.3 | As Maya, I can override any assumption in plain language ("20% down, 7.25%, 10% vacancy") and the whole report updates. | Overrides tracked as "provided"; changes never silently reset. | L |
| E2.4 | As Maya, property tax is modeled realistically, including reassessment on sale in states where it applies. | Tax shown on purchase-price basis where required (e.g. CA Prop 13); the assumption is explained. | L |
| E2.5 | As Maya, I can model financing types: conventional, DSCR loan, cash, seller finance, interest-only. | Rate, points, term, and amortization/IO reflected in cash flow and break-even. | 1.1 |
| E2.6 | As Maya, I see my first-year cash vs. stabilized year-three numbers (rent growth, expense growth). | Year-by-year table, 30 years. | L |
| E2.7 | As Maya, I can include rehab, a renovation timeline, and the rent change after rehab. | Holding-cost and vacancy during rehab; after-repair value and rent. | 1.2 |
| E2.8 | As Maya, I can include tax effects (depreciation, mortgage interest, marginal rate) for an after-tax view. | Clearly marked as an estimate, not tax advice. | Later |

### E3 — Verdict, max offer, and long-term outlook

| ID | Story | Acceptance criteria | Rel |
|---|---|---|---|
| E3.1 | As Maya, I get a clear go / caution / no-go with the reasons. | Verdict comes from visible checks with thresholds I can see; never an unexplained score. | L |
| E3.2 | As Maya, I get a **max allowable offer** to hit my target return. | Solves price for target cash-on-cash (and optionally target cap rate or DSCR); shows discount vs. list. | L |
| E3.3 | As Maya, I can set my own criteria ("I need 10% CoC and positive cash flow") and the verdict follows them. | Saved investor profile used on every analysis. | 1.1 |
| E3.4 | As Maya, I see when I break even and when I'm paid back. | Cash payback month and total break-even month (incl. equity, after selling costs); IRR and equity multiple at 5/10/20/30 years. | L |
| E3.5 | As Maya, I see "what would make this work": the rent needed, the price needed, the rate needed. | Each shown as a single number with the trade-off. | L |
| E3.6 | As Maya, I can see how sensitive the deal is (price × rate, rent × vacancy, appreciation × hold). | Heat grids with the base case marked; every cell shows its number. | L |
| E3.7 | As Maya, I see a downside case (higher vacancy, lower rent, higher expenses) alongside the base case. | Stress case shown by default; deal flagged "fragile" if it fails under it. | 1.1 |

### E4 — Market and risk context

| ID | Story | Acceptance criteria | Rel |
|---|---|---|---|
| E4.1 | As Maya, I see rent comps behind the rent estimate, chosen by the rules in section 4. | Low / median / high rent; each comp shows address, distance, beds/baths/sqft, date, asking-vs-leased, and why it was chosen; overall confidence (high/medium/low) with the reason. | L |
| E4.9 | As Maya, comps are searched nearest-first: within 0.5 mile, then 1 mile, then up to 2 miles, stopping as soon as there are enough good matches. | The report states which radius was used and why; never mixes in farther comps when closer ones suffice. | L |
| E4.10 | As Maya, comps match the subject's actual unit type. If every unit in the building is a 1-bed of about 730 sqft, I see 1-beds of similar size, not a mix. | Unit mix inferred from the building (listings, records, same-building units); same-building comps ranked first; size within a tight band before relaxing. | L |
| E4.11 | As Maya, if no similar-size units exist in range, I still see the next-best option (e.g. 2-beds), clearly labelled and size-adjusted. | Adjacent-size comps shown with a "different size" tag, adjusted by rent per sqft, and confidence lowered. | L |
| E4.12 | As Maya, I see what's currently available nearby: active rentals (vacancy and competition) and active for-sale listings (price cuts, days on market). | Counts, median asking, days on market, and how fast comparable units lease; same radius rules. | 1.1 |
| E4.13 | As Maya, when there aren't enough comps at any radius, the tool says so and falls back to a labelled automated estimate, never a silent guess. | "Insufficient comps" state; estimate marked low confidence; I can enter my own rent. | L |
| E4.2 | As Maya, I see recent nearby sales and price per square foot. | Sale comps with date and distance; flag if list price is far above/below comps. | L |
| E4.3 | As Maya, I see rental demand signals (vacancy, days on market for rentals, population/job trends). | Indicator with a plain-language read. | 1.1 |
| E4.4 | As Maya, I see crime and safety context for the area. | Rating relative to city/national; source and date; clear about granularity limits. | 1.1 |
| E4.5 | As Maya, I see the schools that serve the property (elementary, middle, high) plus others within 1–2 miles. | Assigned schools shown first (attendance zone, not just nearest); ratings with source and attribution; "verify with the district" note; labelled as a demand driver, not a guarantee. | L |
| E4.6 | As Maya, I see price and rent growth history for the zip/metro. | 1/3/5-year; compared with my appreciation assumption (warn if mine is far higher). | 1.1 |
| E4.7 | As Maya, I see an insurance estimate and flood/climate risk. | Range, not a point; flood zone flagged; premium impact reflected in cash flow. | 1.1 |
| E4.8 | As Maya, I get a flag on local rules: HOA rental caps, rent control, rental registration, short-term rental restrictions. | Flagged where known; "unverified, confirm locally" where not. | 1.1 |

### E5 — Advisory layer (the assistant reads between the lines)

| ID | Story | Acceptance criteria | Rel |
|---|---|---|---|
| E5.1 | As Maya, the listing description is scanned for signals ("tenant-occupied", "new roof", "as-is", "needs TLC", "motivated seller"). | Each signal listed with the quote and why it matters; shown as advisory, never fed silently into the math. | 1.1 |
| E5.2 | As Maya, advisory signals can suggest an adjustment I approve ("new roof → lower CapEx reserve"). | I accept or reject; accepted changes become labelled overrides. | 1.1 |
| E5.3 | As Maya, I get a short list of questions to ask the agent or seller, and things to verify at inspection. | Tailored to this property. | 1.2 |

### E6 — The report (this is the product)

| ID | Story | Acceptance criteria | Rel |
|---|---|---|---|
| E6.1 | As Maya, I get a rich, professional report from the chat with one link. | Sections: verdict and summary, scorecard, max offer, income and expenses, returns, hold-period chart and table, sensitivity, market context, assumptions. | L |
| E6.2 | As Maya, I can download a PDF that looks as good as the web version. | Print-ready, charts included, page breaks sensible. | L |
| E6.3 | As Dan, I can add my name, logo, brand color, and contact details to the reports I send. | Branding applied to web and PDF; stored in my profile. | 1.1 |
| E6.4 | As Dan, I can send a link to a client who has no account, and they can view it. | Private unguessable link; revocable; optional expiry. | L |
| E6.5 | As a client, I can open the report on my phone and read it comfortably. | Responsive; no horizontal page scroll. | L |
| E6.6 | As Dan, I can hide sections or add my own note for a client. | Toggle sections; free-text note at top. | 1.1 |
| E6.7 | As Dan, a client can play with a few assumptions (rate, down payment) on the shared report. | Interactive recalculation in-page, clearly labelled "your scenario". | 1.2 |
| E6.8 | As Maya, a report stays valid as a snapshot; I can re-run it later with fresh data. | Each report is dated and versioned; "refresh" creates a new version and shows what changed. | 1.1 |
| E6.9 | As Maya, I can export to Excel/Google Sheets with live formulas. | Inputs editable, outputs recalculate; matches the report's numbers. | 1.1 |

### E7 — Conversation and what-if

| ID | Story | Acceptance criteria | Rel |
|---|---|---|---|
| E7.1 | As Maya, I can ask follow-ups and the assistant re-runs the numbers ("what if rates drop to 6%?", "what if I put 30% down?"). | Calls the engine; never does arithmetic itself; answer cites the changed assumption. | L |
| E7.2 | As Maya, I can compare two or more properties side by side. | One table with the same metrics; a clear winner per metric and overall. | 1.1 |
| E7.3 | As Maya, the assistant knows when to use the tool and doesn't need me to say "use evalprop". | Triggers on listing links, addresses, and investment questions; doesn't trigger on unrelated real-estate chat. | L |
| E7.4 | As Maya, I get a short chat summary first and can open the full report if I want it. | Chat answer: verdict, 3–4 numbers, one link. | L |

### E8 — Saved deals and portfolio

| ID | Story | Acceptance criteria | Rel |
|---|---|---|---|
| E8.1 | As Maya, my analyses are saved and I can find them again. | List with address, verdict, date; searchable. | 1.1 |
| E8.2 | As Maya, I can shortlist and rank saved deals against my criteria. | Sort by any metric; filter by verdict. | 1.1 |
| E8.3 | As Priya, I can add properties I own (actual rent, loan, expenses) and see portfolio totals. | Cash flow, equity, DSCR, and concentration by market. | Later |
| E8.4 | As Priya, I get a hold/sell/refinance read on a property I own. | Equity trapped, return on equity, refi scenarios. | Later |
| E8.5 | As Maya, I get alerted when a saved property drops in price or a new listing meets my criteria. | Opt-in notifications. | Later |

### E9 — More strategies

| ID | Story | Acceptance criteria | Rel |
|---|---|---|---|
| E9.1 | As Maya, I can compare long-term vs. mid-term rental (furnished, 1–6 month stays) for the same property. | Rent premium, vacancy, furnishing cost, and utilities modeled; side-by-side. | 1.2 |
| E9.2 | As Maya, I can model short-term rental (nightly rate, occupancy, seasonality, platform and cleaning fees, regulation risk). | Uses market data; regulation flag prominent. Possibly a higher plan tier. | 1.2 |
| E9.3 | As Maya, I can model value-add: rehab, ADU, or conversion, with after-repair value and refinance (BRRRR). | Cash left in deal, post-refi cash flow, infinite-return case handled. | 1.2 |
| E9.4 | As Maya, I can model house hacking (live in one unit). | Owner-occupied financing and reduced housing cost. | Later |
| E9.5 | As Maya, I can model a flip. | Profit, ARV, holding costs, 70% rule. | Later |

### E10 — Account, plans, and billing

| ID | Story | Acceptance criteria | Rel |
|---|---|---|---|
| E10.1 | As Maya, I can try it free without a credit card. | Limited analyses per month, full verdict, report with watermark or reduced sections. | L |
| E10.2 | As Maya, I connect my account from inside the assistant (sign-in once). | OAuth through the connector; works across devices. | L |
| E10.3 | As Maya, I subscribe and my plan limits apply automatically. | Subscription billing; clear limits. | L |
| E10.4 | As Maya, I understand what I've used and what's left. | Usage in the connector response and on a simple account page. | L |
| E10.5 | As Dan, I can pay for a plan that includes branding and a higher report volume. | Separate plan tier. | 1.1 |
| E10.6 | As Dan, I can invite team members under one plan. | Seats; shared branding. | Later |
| E10.7 | As an admin (the founder), I can see usage, costs per report, and failures. | Internal dashboard; per-report data cost visible. | L |

### E11 — Trust, quality, and compliance

| ID | Story | Acceptance criteria | Rel |
|---|---|---|---|
| E11.1 | As Maya, I can see the source and freshness of every looked-up number. | Source, date, confidence on each; "assumed" never disguised as "looked up". | L |
| E11.2 | As Maya, a report is still produced when a data source is down or slow. | Timeouts; partial report with a visible "data unavailable" note; never blocks the verdict. | L |
| E11.3 | As Maya, I get an answer fast. | Target: verdict in chat in a few seconds; full report link in under ~10 seconds (to be confirmed with real data providers). | L |
| E11.4 | As the owner, I can prove the math is right. | Test suite against hand-verified cases and independent references; engine versioned; each report records the engine version. | L |
| E11.5 | As the owner, reports carry appropriate disclaimers (not investment/tax/legal advice) and avoid fair-housing pitfalls (e.g. no demographic steering in neighborhood content). | Legal review before launch. | L |
| E11.6 | As Maya, my data is private. | Reports unlisted by default; I can delete any analysis; clear data policy. | L |

### E12 — Platform and distribution

| ID | Story | Acceptance criteria | Rel |
|---|---|---|---|
| E12.1 | As the owner, one backend serves ChatGPT, Muse, and any MCP client. | Single tool surface; thin adapter per platform. | L |
| E12.2 | As the owner, the tool description makes the assistant call it at the right moments. | Evaluated with a set of sample prompts (should trigger / should not). | L |
| E12.5 | As the owner, every analysis has an ID so what-ifs, comparisons, reports, saved deals, and usage billing all refer to the same record. | Stateful backend; IDs are unguessable; engine version stored with each analysis. | L |
| E12.3 | As Maya, the connector shows a compact inline card (key numbers, verdict) plus the report link. | Where the platform supports rich widgets. | 1.1 |
| E12.4 | As the owner, I can list the connector in each platform's directory. | Meets each platform's review and policy requirements. | L |

---

## 4. Comparable selection rules (draft, to confirm)

Rent comps drive the biggest input in the model, so the selection logic is a product feature in its own right.

**Subject profile.** Property type (house, condo, apartment unit, 2–4 unit), beds, baths, sqft, year built, and, for a unit in a larger building, the building's unit mix.

**Search ladder (proposed order).** Similarity beats distance, within reason:

| Step | Radius | Match | Use when |
|---|---|---|---|
| 1 | Same building | Same unit type | Subject is in a multi-unit building |
| 2 | 0.5 mile | Strict: same type, same beds, baths ±1, sqft ±15% | Enough matches (target 5, minimum 3) |
| 3 | 1 mile | Strict | Step 2 found too few |
| 4 | Up to 2 miles | Strict | Step 3 found too few |
| 5 | 0.5 → 2 miles | Relaxed: sqft ±30%, or adjacent bed count (e.g. 2-bed for a 1-bed), size-adjusted by rent per sqft | Strict search found too few at every radius |
| 6 | — | "Insufficient comps": labelled automated estimate or user's own rent | Nothing usable |

A same-size unit 1.5 miles away is better evidence than a different-size unit next door, which is why strict matching is exhausted across all radii before relaxing the match. **Decision for you:** keep this order, or prefer "closest first" even if that means a different unit size?

**Quality rules.**
- Stop at the first step that yields enough comps; don't pad with farther ones.
- Use recent data (leased or listed in the last ~90–180 days); weight newer comps more.
- Trim outliers; report low / median / high (25th / 50th / 75th percentile) and use the median.
- Label asking rent vs. leased rent. Most public data is asking rent, so the report says so.
- Confidence: **High** (5+ strict comps within 1 mile), **Medium** (3–4 strict, or relaxed within 1 mile), **Low** (anything else).
- Always show why each comp was chosen and which step of the ladder produced the result.

**Open question for rural areas:** 2 miles may be too tight outside metros. Options: widen the ladder by density (e.g. up to 5 miles in low-density areas) with a visible note.

---

## 5. Suggested release slices

**Launch (paid beta)** — the smallest thing someone would pay for:
paste a link/address → verdict, max allowable offer, break-even and hold analysis, rent/sale comps, hosted report + PDF, what-if in chat, free tier plus one paid plan, trust basics.
*(E1.1–1.3, 1.5; E2.1–2.4, 2.6; E3.1, 3.2, 3.4–3.6; E4.1–4.2, 4.5, 4.9–4.11, 4.13; E6.1, 6.2, 6.4, 6.5; E7.1, 7.3, 7.4; E10.1–10.4, 10.7; E11.1–11.4, 11.5–11.6; E12.1–12.2, 12.4)*

**1.1 — "makes it sticky and sells to agents":**
area context (demand, crime, schools, growth, insurance, local rules), advisory flags, branding and client-ready sharing, compare deals, saved deals, investor criteria profile, Sheets/Excel export, financing types, stress case.

**1.2 — "more strategies":**
mid-term, short-term, value-add/BRRRR, rehab modeling, interactive shared reports.

**Later:** portfolio tracking, alerts, tax view, house hack, flip, team seats.

---

## 6. Risks to settle before launch

1. **Comp data coverage.** The radius-and-similarity search needs a provider that supports location, radius, bed/size filters, and rental listings. Leased (achieved) rents are rarely public, so most comps will be asking rents. Confirm with the provider before promising this.
2. **Listing data rights.** Scraping Redfin or Zillow pages breaks their terms of service, and MLS data has redistribution rules. Proposal: treat the link as a way to get the **address**, then pull property facts, rent estimates, and comps from licensed providers. Anything the user pastes is their own input.
3. **Unit economics.** Each report costs data-provider calls. Need a per-report cost target before setting prices (cache aggressively by address).
4. **Accuracy and liability.** Rent and insurance estimates are the weakest inputs. Show ranges and confidence, and keep disclaimers prominent.
5. **Platform dependence.** Connector capabilities, auth, and payments differ between ChatGPT and Muse. I haven't seen Muse's developer docs yet, so that adapter's scope is unknown.
6. **Fair housing.** Neighborhood content (crime, schools, demographics) needs careful framing; get a legal read.

## 7. Decisions I need from you

1. **Primary buyer at launch:** individual investors, agents, or both from day one? (I recommend investors first, agent features in 1.1.)
2. **Data budget:** are you comfortable with one paid data provider (a few hundred dollars a month at low volume) for rent estimates, comps and property facts?
3. **Pricing shape:** free tier + one paid plan at launch, or paid-only with a trial? Any price point in mind?
4. **Launch strategies:** is long-term rental alone enough for launch, or is short-term rental a must-have for your target users?
5. **Muse:** do you have a link to its connector/developer docs and its policy on paid apps?
6. **Stack:** any objection to keeping everything in TypeScript (the engine is already written and tested that way)?
7. **Comp ladder order (section 4):** exhaust same-size matches out to 2 miles before relaxing size (my recommendation), or prefer the closest comps even when the size differs?
8. **Rural areas:** widen the search radius by population density, or keep the 2-mile cap everywhere?

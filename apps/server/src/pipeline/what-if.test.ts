import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluate } from "@evalprop/engine";
import { AnalysisSchema, ComparisonRowSchema } from "@evalprop/shared";
import { ADDR, assertOk, harness, recordingQuota, variantScenario } from "./test-helpers.ts";

const field = (a: { assumptions: Array<{ field: string; value: number; source: string; note?: string }> }, f: string) =>
  a.assumptions.find((x) => x.field === f);

describe("what_if", () => {
  test("new analysis with baseAnalysisId, reused market data, overrides as provided, and zero provider calls", async () => {
    const h = harness();
    const base = await h.analyze({ address: ADDR.condo });
    assertOk(base);
    const callsBefore = h.provider.callCount;
    const eventsBefore = h.events.length;

    const next = await h.whatIf({ analysisId: base.analysis.id, overrides: { offerPrice: 250000, interestRatePct: 6.5 } });
    assertOk(next);

    // No provider was touched (the gateway cache is not even consulted).
    assert.equal(h.provider.callCount, callsBefore);
    assert.ok(!h.events.slice(eventsBefore).some((e) => e.startsWith("provider:")));

    const a = next.analysis;
    assert.notEqual(a.id, base.analysis.id);
    assert.equal(a.baseAnalysisId, base.analysis.id);
    assert.equal(next.baseAnalysisId, base.analysis.id);
    assert.equal(a.ownerUid, "user_a");
    assert.deepEqual(a.market, base.analysis.market, "stored market data is reused as is");
    assert.deepEqual(a.property, base.analysis.property);
    assert.deepEqual(a.advisoryFlags, base.analysis.advisoryFlags);
    assert.equal(a.targetCashOnCashPct, base.analysis.targetCashOnCashPct);
    assert.deepEqual([field(a, "offerPrice")?.source, field(a, "offerPrice")?.value], ["provided", 250000]);
    assert.deepEqual([field(a, "interestRatePct")?.source, field(a, "interestRatePct")?.value], ["provided", 6.5]);
    // What was not overridden keeps its value and source, including the looked-up rent with its provenance.
    assert.deepEqual(field(a, "monthlyRent"), field(base.analysis, "monthlyRent"));
    assert.deepEqual(field(a, "propertyTaxAnnual"), field(base.analysis, "propertyTaxAnnual"));
    assert.deepEqual(field(a, "hoaMonthly"), field(base.analysis, "hoaMonthly"));
    // The engine ran on the new inputs, and the list price comparison reflects the lower offer.
    assert.equal(
      a.evaluation.yearOne.monthlyCashFlow,
      evaluate({ purchasePrice: 250000, listPrice: 289000, monthlyRent: base.card.monthlyRent, interestRatePct: 6.5, propertyTaxAnnual: 5200, hoaMonthly: 410, state: "TX" }).yearOne.monthlyCashFlow,
    );
    assert.equal(a.evaluation.listPriceComparison?.purchasePrice, 250000);
    assert.ok(AnalysisSchema.safeParse(await h.repo.get(a.id, "user_a")).success);
    assert.equal(next.card.analyzedPrice, 250000);
    assert.equal(next.card.reportUrl, `https://reports.example.test/${a.id}`);
  });

  test("before/after rows: cash flow, cash-on-cash, DSCR, break-even month, 10-year IRR, cash invested", async () => {
    const h = harness();
    const base = await h.analyze({ address: ADDR.condo });
    assertOk(base);
    const next = await h.whatIf({ analysisId: base.analysis.id, overrides: { offerPrice: 250000, downPaymentPct: 20 } });
    assertOk(next);

    assert.deepEqual(
      next.rows.map((r) => r.metric),
      ["monthlyCashFlow", "cashOnCashPct", "dscr", "breakEvenMonth", "irr10Pct", "cashInvested"],
    );
    for (const row of next.rows) assert.ok(ComparisonRowSchema.safeParse(row).success);
    const r = (m: string) => next.rows.find((x) => x.metric === m);
    const b = base.analysis.evaluation;
    const a = next.analysis.evaluation;
    assert.equal(r("monthlyCashFlow")?.before, Math.round(b.yearOne.monthlyCashFlow * 100) / 100);
    assert.equal(r("monthlyCashFlow")?.after, Math.round(a.yearOne.monthlyCashFlow * 100) / 100);
    assert.equal(r("cashOnCashPct")?.after, Math.round(a.yearOne.cashOnCashPct * 100) / 100);
    assert.equal(r("dscr")?.before, Math.round((b.yearOne.dscr as number) * 100) / 100);
    assert.equal(r("breakEvenMonth")?.before, b.hold.breakEvenMonth);
    assert.equal(r("breakEvenMonth")?.after, a.hold.breakEvenMonth);
    assert.equal(r("irr10Pct")?.before, Math.round((b.hold.horizons.find((x) => x.years === 10)?.irrPct as number) * 100) / 100);
    assert.equal(r("cashInvested")?.before, Math.round(b.yearOne.cashInvested * 100) / 100);
    assert.equal(r("cashInvested")?.after, Math.round(a.yearOne.cashInvested * 100) / 100);
    assert.ok((r("cashInvested")?.after as number) < (r("cashInvested")?.before as number));
  });

  test("a different owner gets NOT_FOUND, identical to a missing id, and creates nothing", async () => {
    const h = harness();
    const base = await h.analyze({ address: ADDR.house });
    assertOk(base);
    const stranger = await h.whatIf({ analysisId: base.analysis.id, overrides: { vacancyPct: 5 } }, "user_b");
    const missing = await h.whatIf({ analysisId: "an_nope", overrides: { vacancyPct: 5 } }, "user_b");
    assert.ok(!stranger.ok && !missing.ok);
    assert.equal(stranger.error.code, "NOT_FOUND");
    assert.deepEqual(stranger.error, missing.error);
    assert.equal((await h.repo.listUsage("user_b")).length, 0);
    assert.equal(h.quota.reservations, 1, "no quota is reserved for someone else's analysis");
  });

  test("ids that are not valid document ids are NOT_FOUND, not an exception", async () => {
    const h = harness();
    for (const id of ["../users/x", "a/b", "."]) {
      const r = await h.whatIf({ analysisId: id, overrides: { vacancyPct: 5 } });
      assert.ok(!r.ok);
      assert.equal(r.error.code, "NOT_FOUND");
    }
  });

  test("a what-if writes a usage event of type what_if with no provider calls, and reserves what_if quota", async () => {
    const h = harness();
    const base = await h.analyze({ address: ADDR.house });
    assertOk(base);
    const next = await h.whatIf({ analysisId: base.analysis.id, overrides: { interestRatePct: 6 } });
    assertOk(next);
    const events = await h.repo.listUsage("user_a");
    const event = events.find((e) => e.analysisId === next.analysis.id);
    assert.equal(event?.type, "what_if");
    assert.deepEqual(event?.providerCalls, []);
    assert.equal(event?.costCents, 0);
    assert.deepEqual(h.events.filter((e) => e.startsWith("reserve")), ["reserve:analysis", "reserve:what_if"]);
  });

  test("quota: exceeded -> QUOTA_EXCEEDED, nothing saved; failure -> released; retry -> not reserved", async () => {
    const h = harness({ quota: (events) => recordingQuota(events, (kind) => (kind === "what_if" ? { ok: false, code: "QUOTA_EXCEEDED", limit: 10, used: 10 } : { ok: true, reservationId: "r" })) });
    const base = await h.analyze({ address: ADDR.house });
    assertOk(base);
    const denied = await h.whatIf({ analysisId: base.analysis.id, overrides: { vacancyPct: 3 } });
    assert.ok(!denied.ok);
    assert.equal(denied.error.code, "QUOTA_EXCEEDED");
    assert.equal((await h.repo.listUsage("user_a")).length, 1);

    const h2 = harness();
    const base2 = await h2.analyze({ address: ADDR.house });
    assertOk(base2);
    const bad = await h2.whatIf({ analysisId: base2.analysis.id, overrides: { monthlyRent: 2_000_000 } });
    assert.ok(!bad.ok);
    assert.equal(bad.error.code, "INVALID_ASSUMPTION");
    assert.equal(bad.error.field, "monthlyRent");
    assert.equal(h2.quota.releases, 1);

    const first = await h2.whatIf({ analysisId: base2.analysis.id, overrides: { vacancyPct: 3 } });
    assertOk(first);
    const reservations = h2.quota.reservations;
    const retry = await h2.whatIf({ analysisId: base2.analysis.id, overrides: { vacancyPct: 3 } });
    assertOk(retry);
    assert.equal(retry.reused, true);
    assert.equal(retry.analysis.id, first.analysis.id);
    assert.equal(h2.quota.reservations, reservations);
    assert.equal((await h2.repo.listUsage("user_a")).filter((e) => e.type === "what_if").length, 1);
  });

  test("invalid or empty overrides are INVALID_ASSUMPTION", async () => {
    const h = harness();
    const base = await h.analyze({ address: ADDR.house });
    assertOk(base);
    const empty = await h.whatIf({ analysisId: base.analysis.id, overrides: {} });
    assert.ok(!empty.ok);
    assert.equal(empty.error.code, "INVALID_ASSUMPTION");
    const bad = await h.whatIf({ analysisId: base.analysis.id, overrides: { downPaymentPct: 250 } });
    assert.ok(!bad.ok);
    assert.equal(bad.error.field, "downPaymentPct");
  });

  test("what-ifs chain: a second what-if keeps the first one's overrides as provided and points at its parent", async () => {
    const h = harness();
    const base = await h.analyze({ address: ADDR.house });
    assertOk(base);
    const one = await h.whatIf({ analysisId: base.analysis.id, overrides: { offerPrice: 320000 } });
    assertOk(one);
    const two = await h.whatIf({ analysisId: one.analysis.id, overrides: { interestRatePct: 6 } });
    assertOk(two);
    assert.equal(two.analysis.baseAnalysisId, one.analysis.id);
    assert.deepEqual([field(two.analysis, "offerPrice")?.source, field(two.analysis, "offerPrice")?.value], ["provided", 320000]);
    assert.equal(field(two.analysis, "interestRatePct")?.source, "provided");
    // Before/after compares against the analysis it was based on, not the original.
    assert.equal(two.rows[0]?.before, Math.round(one.analysis.evaluation.yearOne.monthlyCashFlow * 100) / 100);
    assert.equal(h.provider.calls.filter((c) => c.endpoint === "property.resolve").length, 1);
  });

  test("rent override replaces the looked-up rent, and a stale 'rent estimate' warning is dropped", async () => {
    const h = harness({ behavior: ({ endpoint }) => (endpoint === "rent.candidates" ? "error" : "ok") });
    const base = await h.analyze({ address: ADDR.condo });
    assertOk(base);
    assert.ok(base.analysis.dataNotes.some((n) => n.section === "rent" && n.severity === "warning"));
    const next = await h.whatIf({ analysisId: base.analysis.id, overrides: { monthlyRent: 1900 } });
    assertOk(next);
    assert.deepEqual([next.card.monthlyRent, next.card.rentSource], [1900, "provided"]);
    assert.ok(!next.analysis.dataNotes.some((n) => n.section === "rent"));
    // Comp-related notes from the base run are kept: that data was unavailable then and the market data is reused.
    assert.ok(next.analysis.dataNotes.some((n) => n.section === "rentComps" && n.severity === "warning"));
  });
});

describe("what_if: property tax when the offer price changes (states that reassess on sale)", () => {
  const caNoTax = variantScenario("suburban-house", "ca-no-tax", "1 Reassess Way, Sacramento, CA 95814", "CA", (f) => {
    delete f["taxesAnnual"];
  });
  const caTax = variantScenario("suburban-house", "ca-tax", "2 Reassess Way, Sacramento, CA 95814", "CA");

  test("assumed tax is re-derived on the new price (1.2% of price in CA)", async () => {
    const h = harness({ scenarios: [caNoTax] });
    const base = await h.analyze({ address: caNoTax.addresses[0] as string, assumptions: { offerPrice: 500000 } });
    assertOk(base);
    assert.equal(field(base.analysis, "propertyTaxAnnual")?.value, 6000);
    const next = await h.whatIf({ analysisId: base.analysis.id, overrides: { offerPrice: 400000 } });
    assertOk(next);
    const tax = field(next.analysis, "propertyTaxAnnual");
    assert.equal(tax?.source, "assumed");
    assert.equal(tax?.value, 4800);
    assert.match(tax?.note ?? "", /reassess/i);
  });

  test("user-provided tax is never re-derived", async () => {
    const h = harness({ scenarios: [caNoTax] });
    const base = await h.analyze({ address: caNoTax.addresses[0] as string, assumptions: { offerPrice: 500000, propertyTaxAnnual: 7777 } });
    assertOk(base);
    const next = await h.whatIf({ analysisId: base.analysis.id, overrides: { offerPrice: 400000 } });
    assertOk(next);
    assert.deepEqual([field(next.analysis, "propertyTaxAnnual")?.source, field(next.analysis, "propertyTaxAnnual")?.value], ["provided", 7777]);
  });

  test("a tax from the property record is the seller's bill: replaced by the reassessed estimate when the price changes, with a note", async () => {
    const h = harness({ scenarios: [caTax] });
    const base = await h.analyze({ address: caTax.addresses[0] as string });
    assertOk(base);
    assert.equal(field(base.analysis, "propertyTaxAnnual")?.source, "lookup");
    const next = await h.whatIf({ analysisId: base.analysis.id, overrides: { offerPrice: 300000 } });
    assertOk(next);
    const tax = field(next.analysis, "propertyTaxAnnual");
    assert.equal(tax?.source, "assumed");
    assert.equal(tax?.value, 3600); // 1.2% of 300,000
    assert.ok(next.analysis.dataNotes.some((n) => n.section === "assumptions" && /replaced by the engine's estimate/.test(n.message)));
  });

  test("an explicit tax override in the same what-if wins over all of it", async () => {
    const h = harness({ scenarios: [caTax] });
    const base = await h.analyze({ address: caTax.addresses[0] as string });
    assertOk(base);
    const next = await h.whatIf({ analysisId: base.analysis.id, overrides: { offerPrice: 300000, propertyTaxAnnual: 4100 } });
    assertOk(next);
    assert.deepEqual([field(next.analysis, "propertyTaxAnnual")?.source, field(next.analysis, "propertyTaxAnnual")?.value], ["provided", 4100]);
  });

  test("a non-reassessing state keeps the recorded tax when the price changes", async () => {
    const h = harness();
    const base = await h.analyze({ address: ADDR.house });
    assertOk(base);
    const next = await h.whatIf({ analysisId: base.analysis.id, overrides: { offerPrice: 300000 } });
    assertOk(next);
    assert.deepEqual([field(next.analysis, "propertyTaxAnnual")?.source, field(next.analysis, "propertyTaxAnnual")?.value], ["lookup", 5480]);
  });

  test("a rate-only what-if in a reassessing state leaves the recorded tax alone", async () => {
    const h = harness({ scenarios: [caTax] });
    const base = await h.analyze({ address: caTax.addresses[0] as string });
    assertOk(base);
    const next = await h.whatIf({ analysisId: base.analysis.id, overrides: { interestRatePct: 6 } });
    assertOk(next);
    assert.equal(field(next.analysis, "propertyTaxAnnual")?.source, "lookup");
  });
});

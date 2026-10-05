import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FakeBehavior } from "@evalprop/data";
import type { Analysis } from "@evalprop/shared";
import { ADDR, assertOk, harness, variantScenario } from "./test-helpers.ts";

/**
 * ARCHITECTURE §7.3, one table per row of the degradation table. Each case states what the user sees:
 * the analysis still completes, the affected section is marked unavailable in `dataNotes`, fields fall
 * back to labelled defaults, and nothing assumed is ever presented as looked up.
 *
 * Row 6 (quota exceeded before any provider call) is covered in run-analysis.test.ts ("quota hook").
 */

const FAILURES: FakeBehavior[] = ["timeout", "error", "rate-limited", "not-found", "throw"];
const failing = (endpoints: string[], behavior: FakeBehavior) => ({ endpoint }: { endpoint: string }): FakeBehavior =>
  endpoints.includes(endpoint) ? behavior : "ok";

const noteFor = (a: Analysis, section: string, severity?: "info" | "warning") =>
  a.dataNotes.find((n) => n.section === section && (severity === undefined || n.severity === severity));

describe("row 1: a provider times out or errors -> continue, mark the section unavailable, label fallbacks", () => {
  for (const behavior of FAILURES) {
    describe(`provider ${behavior}`, () => {
      test("rent comps fail: rent falls back to the provider's estimate, flagged low confidence", async () => {
        const h = harness({ behavior: failing(["rent.candidates"], behavior) });
        const r = await h.analyze({ address: ADDR.condo });
        assertOk(r);
        assert.equal(r.analysis.market.rentComps, null);
        assert.equal(r.analysis.market.provenance["rentComps"], undefined);
        assert.ok(noteFor(r.analysis, "rentComps", "warning"), "warning that rent comps are unavailable");
        const rent = r.analysis.assumptions.find((a) => a.field === "monthlyRent");
        assert.equal(rent?.source, "lookup");
        assert.equal(rent?.value, 1685); // the fixture's provider estimate
        assert.equal(rent?.provenance?.confidence, "low");
        assert.ok(noteFor(r.analysis, "rent", "warning"));
        assert.equal(r.card.compsConfidence, null);
        assert.ok(r.card.dataNotes.length >= 2);
      });

      test("sale comps fail: section is null with a warning; the verdict and every number are unchanged", async () => {
        const baseline = await harness().analyze({ address: ADDR.condo });
        assertOk(baseline);
        const h = harness({ behavior: failing(["sales.candidates"], behavior) });
        const r = await h.analyze({ address: ADDR.condo });
        assertOk(r);
        assert.equal(r.analysis.market.saleComps, null);
        assert.ok(noteFor(r.analysis, "saleComps", "warning"));
        assert.deepEqual(r.analysis.evaluation, baseline.analysis.evaluation);
        assert.equal(r.analysis.maxOfferPrice, baseline.analysis.maxOfferPrice);
      });

      test("schools fail entirely: section omitted with a note; verdict unaffected", async () => {
        const baseline = await harness().analyze({ address: ADDR.condo });
        assertOk(baseline);
        const h = harness({ behavior: failing(["schools.assigned", "schools.nearby"], behavior) });
        const r = await h.analyze({ address: ADDR.condo });
        assertOk(r);
        assert.equal(r.analysis.market.schools, null);
        assert.equal(r.analysis.market.provenance["schools"], undefined);
        assert.ok(noteFor(r.analysis, "schools", "warning"));
        assert.deepEqual(r.analysis.evaluation, baseline.analysis.evaluation);
      });

      test("assigned schools fail but nearby work: nearby are shown and none is claimed as assigned", async () => {
        const h = harness({ behavior: failing(["schools.assigned"], behavior) });
        const r = await h.analyze({ address: ADDR.condo });
        assertOk(r);
        assert.ok((r.analysis.market.schools?.length ?? 0) > 0);
        assert.ok(noteFor(r.analysis, "schools", "info"));
      });

      test("the rent estimate fails but comps are fine: rent is unchanged, the failure is noted", async () => {
        const baseline = await harness().analyze({ address: ADDR.condo });
        assertOk(baseline);
        const h = harness({ behavior: failing(["rent.estimate"], behavior) });
        const r = await h.analyze({ address: ADDR.condo });
        assertOk(r);
        assert.equal(r.card.monthlyRent, baseline.card.monthlyRent);
        assert.equal(r.analysis.market.provenance["rentEstimate"], undefined);
        assert.ok(noteFor(r.analysis, "rentEstimate"));
      });

      test("property lookup fails: continues from what the user supplied, says comps were not searched, and calls nothing else", async () => {
        const h = harness({ behavior: failing(["property.resolve"], behavior) });
        const r = await h.analyze({
          address: ADDR.house,
          listing: { price: 340000, beds: 3, sqft: 1800, taxesAnnual: 5000 },
          assumptions: { monthlyRent: 2100 },
        });
        assertOk(r);
        assert.equal(r.analysis.property.city, "Sampleton");
        assert.equal(r.analysis.property.state, "OH");
        assert.equal(r.analysis.property.latitude, undefined);
        assert.equal(r.analysis.market.rentComps, null);
        assert.equal(r.analysis.market.saleComps, null);
        assert.equal(r.analysis.market.schools, null);
        assert.deepEqual(r.analysis.market.provenance, {}, "nothing was looked up, so no provenance is claimed");
        assert.ok(noteFor(r.analysis, "property", "warning"));
        assert.ok(h.provider.calls.every((c) => c.endpoint === "property.resolve"));
        assert.equal(r.analysis.assumptions.find((a) => a.field === "propertyTaxAnnual")?.source, "listing");
      });
    });
  }

  test("a failing call is retried once by the gateway (the pipeline itself never retries)", async () => {
    const h = harness({ behavior: failing(["rent.candidates"], "error") });
    assertOk(await h.analyze({ address: ADDR.condo }));
    assert.equal(h.provider.calls.filter((c) => c.endpoint === "rent.candidates").length, 2);
  });

  test("the usage event still lists the failed calls, so a failed source is visible in the ledger", async () => {
    const h = harness({ behavior: failing(["sales.candidates"], "error") });
    const r = await h.analyze({ address: ADDR.condo });
    assertOk(r);
    const [event] = await h.repo.listUsage("user_a");
    const call = event?.providerCalls.find((c) => c.endpoint === "sales.candidates");
    assert.equal(call?.outcome, "ERROR");
    assert.equal(call?.costCents, 0);
  });
});

describe("row 2: no rent comps pass the ladder -> low confidence, provider estimate, else require the user's rent", () => {
  const rural = variantScenario("rural-sparse", "rural-with-estimate", "5 Estimate Rd, Quietfield, MT 59999", "MT", () => {}, (s) => {
    s.rent.estimate = { monthlyRent: 1350, low: 1200, high: 1500 };
  });

  test("comps empty (provider returns nothing) and an estimate exists: estimate, low confidence, warned", async () => {
    const h = harness({ behavior: failing(["rent.candidates"], "empty") });
    const r = await h.analyze({ address: ADDR.condo });
    assertOk(r);
    assert.equal(r.analysis.market.rentComps?.stepReached, "insufficient");
    assert.equal(r.analysis.market.rentComps?.estimate, null);
    assert.equal(r.analysis.market.rentComps?.confidence, "low");
    assert.equal(r.card.monthlyRent, 1685);
    assert.equal(r.analysis.assumptions.find((a) => a.field === "monthlyRent")?.provenance?.confidence, "low");
    assert.ok(noteFor(r.analysis, "rentComps", "warning"));
    assert.ok(noteFor(r.analysis, "rent", "warning"));
  });

  test("comps out of range, estimate available: estimate", async () => {
    const h = harness({ scenarios: [rural] });
    const r = await h.analyze({ address: rural.addresses[0] as string });
    assertOk(r);
    assert.equal(r.card.monthlyRent, 1350);
    assert.equal(r.analysis.market.rentComps?.confidence, "low");
  });

  test("no comps and no estimate: NEEDS_RENT and the verdict is withheld", async () => {
    const h = harness();
    const r = await h.analyze({ address: ADDR.rural });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "NEEDS_RENT");
    assert.equal((await h.repo.listUsage("user_a")).length, 0);
  });

  test("comps provider down AND estimate down: NEEDS_RENT (never a guessed rent)", async () => {
    const h = harness({ behavior: failing(["rent.candidates", "rent.estimate"], "error") });
    const r = await h.analyze({ address: ADDR.condo });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "NEEDS_RENT");
    assert.ok(r.dataNotes.some((n) => n.section === "rentComps" && n.severity === "warning"));
  });

  test("the user's own rent resolves it, as 'provided', with the comps failure still noted", async () => {
    const h = harness({ behavior: failing(["rent.candidates", "rent.estimate"], "error") });
    const r = await h.analyze({ address: ADDR.condo, assumptions: { monthlyRent: 1700 } });
    assertOk(r);
    assert.equal(r.card.rentSource, "provided");
    assert.ok(noteFor(r.analysis, "rentComps", "warning"));
  });
});

describe("row 3: property facts missing (beds, sqft) -> use what the user supplied; comp matching relaxes and says so", () => {
  const sparse = variantScenario("suburban-house", "house-no-beds-sqft", "9 Sparse Facts Dr, Sampleton, OH 43017", "OH", (f) => {
    delete f["beds"];
    delete f["sqft"];
    delete f["baths"];
  });

  test("beds and sqft unknown: comps are matched without them, confidence is capped, and a note says why", async () => {
    const h = harness({ scenarios: [sparse] });
    const r = await h.analyze({ address: sparse.addresses[0] as string });
    assertOk(r);
    assert.ok(noteFor(r.analysis, "rentComps", "info"));
    assert.match(noteFor(r.analysis, "rentComps", "info")?.message ?? "", /bedrooms and square footage is unknown/);
    assert.notEqual(r.analysis.market.rentComps?.confidence, "high");
    assert.ok((r.analysis.market.rentComps?.notes ?? []).some((n) => /unknown/.test(n)));
  });

  test("the user's beds and sqft fill the gap and the comps use them", async () => {
    const h = harness({ scenarios: [sparse] });
    const r = await h.analyze({ address: sparse.addresses[0] as string, listing: { beds: 3, sqft: 1850, baths: 2 } });
    assertOk(r);
    assert.equal(r.analysis.property.beds, 3);
    assert.ok(!noteFor(r.analysis, "rentComps", "info"));
    assert.ok(r.analysis.dataNotes.some((n) => n.section === "property" && /you supplied/.test(n.message)));
  });
});

describe("row 4: schools unavailable -> omitted with a note, verdict unaffected", () => {
  test("covered per failure type above; here: an empty answer is 'none found', not 'unavailable'", async () => {
    const h = harness({ behavior: failing(["schools.assigned", "schools.nearby"], "empty") });
    const r = await h.analyze({ address: ADDR.condo });
    assertOk(r);
    assert.deepEqual(r.analysis.market.schools, []);
    assert.ok(!noteFor(r.analysis, "schools", "warning"));
  });
});

describe("row 5: everything unavailable -> still an engine result from the user's numbers plus labelled defaults", () => {
  for (const behavior of FAILURES) {
    test(`every provider ${behavior}`, async () => {
      const h = harness({ behavior });
      const r = await h.analyze({
        address: ADDR.house,
        listing: { price: 300000, beds: 3, baths: 2, sqft: 1700 },
        assumptions: { monthlyRent: 2000, interestRatePct: 7 },
      });
      assertOk(r);
      const a = r.analysis;
      assert.deepEqual([a.market.rentComps, a.market.saleComps, a.market.schools], [null, null, null]);
      assert.deepEqual(a.market.provenance, {});
      // Every field is the user's, the listing's, or a labelled default. Nothing is "lookup".
      assert.equal(a.assumptions.filter((x) => x.source === "lookup").length, 0);
      assert.equal(a.assumptions.find((x) => x.field === "offerPrice")?.source, "listing");
      assert.equal(a.assumptions.find((x) => x.field === "monthlyRent")?.source, "provided");
      assert.equal(a.assumptions.find((x) => x.field === "interestRatePct")?.source, "provided");
      assert.equal(a.assumptions.find((x) => x.field === "propertyTaxAnnual")?.source, "assumed");
      assert.equal(a.assumptions.find((x) => x.field === "vacancyPct")?.source, "assumed");
      assert.ok(a.evaluation.verdict);
      assert.ok(r.card.dataNotes.length > 0);
      assert.equal(r.card.compsConfidence, null);
    });
  }

  test("nothing from the user and nothing from providers: the missing price is named, not guessed", async () => {
    const h = harness({ behavior: "error" });
    const r = await h.analyze({ address: ADDR.house });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "INVALID_ASSUMPTION");
    assert.equal(r.error.field, "offerPrice");
    assert.ok(r.dataNotes.some((n) => n.section === "property" && n.severity === "warning"));
  });

  test("property lookup down and the address has no city or state: INTERNAL with a retry hint (we cannot even pick a state)", async () => {
    const h = harness({ behavior: "timeout" });
    const r = await h.analyze({ address: "12 Imaginary Lane", listing: { price: 200000 } });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "INTERNAL");
    assert.match(r.error.message, /temporarily unavailable/);
    assert.equal(h.quota.releases, 1);
  });
});

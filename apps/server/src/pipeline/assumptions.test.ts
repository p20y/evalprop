import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AnalyzePropertyInput, CompResult, PropertyFacts, Provenance, Source } from "@evalprop/shared";
import {
  candidatesForAnalysis,
  chooseAll,
  pickByPrecedence,
  type AssumptionField,
  type Candidate,
  type RentMarket,
} from "./assumptions.ts";
import { DEFAULT_PIPELINE_CONFIG } from "./config.ts";
import { ADDR, assertOk, harness, variantScenario } from "./test-helpers.ts";

const SOURCES = ["provided", "listing", "lookup"] as const;
const cand = (source: Candidate["source"], value: number): Candidate => ({ value, source });

describe("pickByPrecedence: provided > listing > lookup", () => {
  // Every ordered pair of distinct sources, in both array orders: the higher source always wins.
  const rank = { provided: 0, listing: 1, lookup: 2 } as const;
  for (const a of SOURCES) {
    for (const b of SOURCES) {
      if (a === b) continue;
      const winner = rank[a] < rank[b] ? a : b;
      test(`${a} vs ${b} -> ${winner}`, () => {
        assert.equal(pickByPrecedence([cand(a, 1), cand(b, 2)])?.source, winner);
        assert.equal(pickByPrecedence([cand(b, 2), cand(a, 1)])?.source, winner);
      });
    }
  }

  test("equal sources: the earlier candidate wins (rent: comps before the provider's estimate)", () => {
    assert.equal(pickByPrecedence([cand("lookup", 1), cand("lookup", 2)])?.value, 1);
  });

  test("no candidates: undefined, so the engine's labelled default applies", () => {
    assert.equal(pickByPrecedence([]), undefined);
  });

  test("a single candidate wins whatever its source", () => {
    for (const s of SOURCES) assert.equal(pickByPrecedence([cand(s, 7)])?.source, s);
  });
});

const prov: Provenance = { provider: "fixture", fetchedAt: "2026-09-01T00:00:00.000Z", cached: false, confidence: "high" };
const facts = (over: Partial<PropertyFacts>): PropertyFacts => ({
  formattedAddress: "1 A St, B, TX 78701",
  line1: "1 A St",
  city: "B",
  state: "TX",
  zip: "78701",
  ...over,
});
const noRentMarket: RentMarket = { comps: null, compsProvenance: undefined, estimate: null };
const comps = (median: number, confidence: CompResult["confidence"], n = 5): CompResult => ({
  estimate: { low: median - 100, median, high: median + 100 },
  comps: Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    address: `${i} X St`,
    distanceMiles: 0.3,
    amount: median,
    kind: "asking" as const,
    date: "2026-09-01",
    matchClass: "same-size" as const,
    matchReason: "Same size, 0.3 mi",
  })),
  stepReached: "strict-0.5mi",
  radiusUsedMiles: 0.5,
  confidence,
  notes: [],
});

/** Layers a field can come from, as flags. */
interface Layers {
  provided: boolean;
  listing: boolean;
  lookup: boolean;
}
const SUBSETS: Layers[] = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ provided: (n & 1) !== 0, listing: (n & 2) !== 0, lookup: (n & 4) !== 0 }));
const expected = (l: Layers): Source => (l.provided ? "provided" : l.listing ? "listing" : l.lookup ? "lookup" : "assumed");

interface FieldCase {
  field: AssumptionField;
  build(l: Layers): { input: AnalyzePropertyInput; lookedUp: PropertyFacts };
  values: { provided: number; listing: number; lookup: number };
}

const base = { targetCashOnCashPct: 8 };
const FIELD_CASES: FieldCase[] = [
  {
    field: "offerPrice",
    values: { provided: 111000, listing: 222000, lookup: 333000 },
    build: (l) => ({
      input: { ...base, address: "x", assumptions: l.provided ? { offerPrice: 111000 } : undefined, listing: l.listing ? { price: 222000 } : undefined },
      lookedUp: facts(l.lookup ? { listPrice: 333000 } : {}),
    }),
  },
  {
    field: "propertyTaxAnnual",
    values: { provided: 1111, listing: 2222, lookup: 3333 },
    build: (l) => ({
      input: { ...base, address: "x", assumptions: l.provided ? { propertyTaxAnnual: 1111 } : undefined, listing: l.listing ? { taxesAnnual: 2222 } : undefined },
      lookedUp: facts(l.lookup ? { taxesAnnual: 3333 } : {}),
    }),
  },
  {
    field: "hoaMonthly",
    values: { provided: 111, listing: 222, lookup: 333 },
    build: (l) => ({
      input: { ...base, address: "x", assumptions: l.provided ? { hoaMonthly: 111 } : undefined, listing: l.listing ? { hoaMonthly: 222 } : undefined },
      lookedUp: facts(l.lookup ? { hoaMonthly: 333 } : {}),
    }),
  },
  {
    field: "monthlyRent",
    values: { provided: 1111, listing: 2222, lookup: 3333 },
    build: (l) => ({
      input: { ...base, address: "x", assumptions: l.provided ? { monthlyRent: 1111 } : undefined, listing: l.listing ? { monthlyRentActual: 2222 } : undefined },
      lookedUp: facts({}),
    }),
  },
];

describe("field precedence matrix: every subset of provided / listing / lookup", () => {
  for (const fc of FIELD_CASES) {
    for (const layers of SUBSETS) {
      const label = `${fc.field}: ${["provided", "listing", "lookup"].filter((k) => layers[k as keyof Layers]).join(" + ") || "nothing"}`;
      test(label, () => {
        const { input, lookedUp } = fc.build(layers);
        const rent: RentMarket =
          fc.field === "monthlyRent" && layers.lookup
            ? { comps: comps(fc.values.lookup, "high"), compsProvenance: prov, estimate: null }
            : noRentMarket;
        const { candidates } = candidatesForAnalysis({ input, lookedUp, lookupProvenance: prov, rent, config: DEFAULT_PIPELINE_CONFIG });
        const picked = chooseAll(candidates)[fc.field];
        const want = expected(layers);
        if (want === "assumed") {
          assert.equal(picked, undefined, "nothing supplied it, so it stays undefined and the engine labels its default 'assumed'");
        } else {
          assert.equal(picked?.source, want);
          assert.equal(picked?.value, fc.values[want]);
        }
      });
    }
  }
});

describe("rent has two lookup tiers: comps median, then the provider estimate", () => {
  const estimate = { value: { monthlyRent: 1999 }, provenance: prov };
  const input: AnalyzePropertyInput = { ...base, address: "x" };
  const run = (market: RentMarket) => chooseAll(candidatesForAnalysis({ input, lookedUp: null, lookupProvenance: null, rent: market, config: DEFAULT_PIPELINE_CONFIG }).candidates).monthlyRent;

  test("comps beat the estimate", () => {
    const r = run({ comps: comps(2400, "high"), compsProvenance: prov, estimate });
    assert.equal(r?.value, 2400);
    assert.equal(r?.tag, "comps");
  });

  test("no usable comps: the estimate, flagged low confidence", () => {
    const r = run({ comps: comps(2400, "high"), compsProvenance: prov, estimate });
    assert.ok(r);
    const none = run({ comps: { ...comps(2400, "high"), estimate: null, comps: [] }, compsProvenance: prov, estimate });
    assert.equal(none?.value, 1999);
    assert.equal(none?.tag, "estimate");
    assert.equal(none?.provenance?.confidence, "low");
  });

  test("low-confidence comps are still used when enough of them back the median", () => {
    assert.equal(run({ comps: comps(2400, "low", 3), compsProvenance: prov, estimate })?.tag, "comps");
  });

  test("low-confidence comps below the count threshold lose to the estimate", () => {
    const thin = run({ comps: comps(2400, "low", 2), compsProvenance: prov, estimate });
    assert.equal(thin?.tag, "estimate");
  });

  test("nothing at all: no rent candidate", () => {
    assert.equal(run(noRentMarket), undefined);
  });

  test("a listing rent of zero (vacant) is ignored with a note", () => {
    const r = candidatesForAnalysis({
      input: { ...base, address: "x", listing: { monthlyRentActual: 0 } },
      lookedUp: null,
      lookupProvenance: null,
      rent: noRentMarket,
      config: DEFAULT_PIPELINE_CONFIG,
    });
    assert.equal(chooseAll(r.candidates).monthlyRent, undefined);
    assert.match(r.notes[0]?.message ?? "", /vacant/);
  });
});

describe("precedence end to end through runAnalysis (fixture: list price, tax, HOA and rent comps are all 'lookup')", () => {
  test("lookup only: every layered field is looked up, with provenance", async () => {
    const h = harness();
    const r = await h.analyze({ address: ADDR.condo });
    assertOk(r);
    const by = Object.fromEntries(r.analysis.assumptions.map((a) => [a.field, a]));
    for (const f of ["offerPrice", "monthlyRent", "propertyTaxAnnual", "hoaMonthly"]) {
      assert.equal(by[f]?.source, "lookup", f);
      assert.equal(by[f]?.provenance?.provider, "fixture", f);
      assert.equal(by[f]?.provenance?.cached, false, f);
    }
    assert.equal(by["offerPrice"]?.value, 289000);
    assert.equal(by["propertyTaxAnnual"]?.value, 5200);
    assert.equal(by["hoaMonthly"]?.value, 410);
    assert.equal(by["insuranceAnnual"]?.source, "assumed");
    assert.equal(by["interestRatePct"]?.source, "assumed");
  });

  test("listing beats lookup; provided beats listing and lookup", async () => {
    const h = harness();
    const listing = await h.analyze({
      address: ADDR.condo,
      listing: { price: 280000, taxesAnnual: 4800, hoaMonthly: 380, monthlyRentActual: 1800 },
    });
    assertOk(listing);
    const l = Object.fromEntries(listing.analysis.assumptions.map((a) => [a.field, a]));
    assert.deepEqual(
      ["offerPrice", "propertyTaxAnnual", "hoaMonthly", "monthlyRent"].map((f) => [l[f]?.source, l[f]?.value]),
      [["listing", 280000], ["listing", 4800], ["listing", 380], ["listing", 1800]],
    );

    const provided = await h.analyze({
      address: ADDR.condo,
      listing: { price: 280000, taxesAnnual: 4800, hoaMonthly: 380, monthlyRentActual: 1800 },
      assumptions: { offerPrice: 265000, propertyTaxAnnual: 4000, hoaMonthly: 350, monthlyRent: 1900 },
    });
    assertOk(provided);
    const p = Object.fromEntries(provided.analysis.assumptions.map((a) => [a.field, a]));
    assert.deepEqual(
      ["offerPrice", "propertyTaxAnnual", "hoaMonthly", "monthlyRent"].map((f) => [p[f]?.source, p[f]?.value]),
      [["provided", 265000], ["provided", 4000], ["provided", 350], ["provided", 1900]],
    );
    // The list price used for the discount comparison is the listing's price, not the offer.
    assert.equal(provided.analysis.evaluation.listPriceComparison?.listPrice, 280000);
    assert.equal(provided.analysis.evaluation.listPriceComparison?.purchasePrice, 265000);
  });

  test("assumed: with no source for tax, HOA and the rest, the engine default is labelled assumed (with its note)", async () => {
    const h = harness();
    const r = await h.analyze({ address: ADDR.empty, listing: { price: 150000 }, assumptions: { monthlyRent: 1500 } });
    assertOk(r);
    const by = Object.fromEntries(r.analysis.assumptions.map((a) => [a.field, a]));
    assert.equal(by["propertyTaxAnnual"]?.source, "assumed");
    assert.ok(by["propertyTaxAnnual"]?.note);
    assert.equal(by["hoaMonthly"]?.source, "assumed");
    assert.equal(by["offerPrice"]?.source, "listing");
    assert.equal(by["monthlyRent"]?.source, "provided");
    assert.ok(r.analysis.assumptions.filter((a) => a.source === "assumed").length >= 14);
  });

  test("rent: provided > listing > comps > provider estimate (the estimate is flagged low confidence)", async () => {
    // A subject too unusual for comps (rural fixture has none in range) but with a provider estimate.
    const scenario = variantScenario("rural-sparse", "rural-with-estimate", "5 Estimate Rd, Quietfield, MT 59999", "MT", () => {}, (s) => {
      s.rent.estimate = { monthlyRent: 1350, low: 1200, high: 1500 };
    });
    const h = harness({ scenarios: [scenario] });
    const est = await h.analyze({ address: scenario.addresses[0] as string });
    assertOk(est);
    const rent = est.analysis.assumptions.find((a) => a.field === "monthlyRent");
    assert.equal(rent?.source, "lookup");
    assert.equal(rent?.value, 1350);
    assert.equal(rent?.provenance?.confidence, "low");
    assert.ok(est.analysis.dataNotes.some((n) => n.section === "rent" && n.severity === "warning" && /estimate/i.test(n.message)));
    assert.equal(est.card.rentSource, "lookup");

    const listing = await h.analyze({ address: scenario.addresses[0] as string, listing: { monthlyRentActual: 1400 } });
    assertOk(listing);
    assert.equal(listing.card.monthlyRent, 1400);
    assert.equal(listing.card.rentSource, "listing");

    const provided = await h.analyze({ address: scenario.addresses[0] as string, listing: { monthlyRentActual: 1400 }, assumptions: { monthlyRent: 1500 } });
    assertOk(provided);
    assert.equal(provided.card.monthlyRent, 1500);
    assert.equal(provided.card.rentSource, "provided");
  });
});

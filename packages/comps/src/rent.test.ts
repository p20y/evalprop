import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RentListing } from "@evalprop/shared";
import { selectRentComps, type RentSubject } from "./index.ts";
import { NOW, assertValidCompResult, permute, rent } from "./test-helpers.ts";

const opts = { now: NOW };
const subject1bd: RentSubject = { propertyType: "condo", beds: 1, baths: 1, sqft: 730 };

function run(subject: RentSubject, candidates: RentListing[], config?: Parameters<typeof selectRentComps>[2]["config"]) {
  const result = selectRentComps(subject, candidates, config ? { now: NOW, config } : opts);
  assertValidCompResult(result);
  return result;
}

describe("uniform 1-bed building (E4.10)", () => {
  const building: RentSubject = { ...subject1bd, unitsInBuilding: 40 };
  const sameBuilding1bd = [2000, 2020, 2040, 2060, 2080, 2100].map((r, i) =>
    rent(`sb${i}`, { rent: r, distance: 0, sqft: 700 + i * 12, sameBuilding: true, address: `1 Tower Pl Unit ${i}` }),
  );
  const twoBeds = [0, 1, 2].map((i) =>
    rent(`two${i}`, { beds: 2, baths: 2, sqft: 1100, rent: 2900, distance: i === 0 ? 0 : 0.1, sameBuilding: i === 0, address: `1 Tower Pl Unit 2${i}` }),
  );

  it("same-building comps come first and win; no 2-bed appears", () => {
    const r = run(building, [...twoBeds, ...sameBuilding1bd, rent("nearby", { distance: 0.2 })]);
    assert.equal(r.stepReached, "same-building");
    assert.equal(r.radiusUsedMiles, 0);
    assert.equal(r.confidence, "high");
    assert.equal(r.comps.length, 6);
    assert.ok(r.comps.every((c) => c.beds === 1 && c.matchClass === "same-building" && c.matchReason === "Same building"));
    // 6 equal-weight points: 25th = 2020, median = 2050, 75th = 2080
    assert.deepEqual(r.estimate, { low: 2020, median: 2050, high: 2080 });
  });

  it("with no same-building comps, 1-beds of similar size within 1 mile beat nearer 2-beds", () => {
    const oneBeds = [0, 1, 2, 3, 4].map((i) => rent(`ob${i}`, { distance: 0.7 + i * 0.05, sqft: 700 + i * 15, rent: 1950 + i * 25 }));
    const nearTwoBeds = [0, 1, 2, 3, 4, 5].map((i) => rent(`nt${i}`, { beds: 2, sqft: 1000, rent: 2700, distance: 0.05 + i * 0.05 }));
    const r = run(building, [...nearTwoBeds, ...oneBeds]);
    assert.equal(r.stepReached, "strict-1mi");
    assert.equal(r.confidence, "high");
    assert.ok(r.comps.length === 5 && r.comps.every((c) => c.beds === 1));
    assert.ok(r.notes.some((n) => n.includes("multi-unit")));
  });

  it("uses a tight (10%) size band for a unit in a multi-unit building", () => {
    // 835 sqft is +14.4%: inside the normal strict band (15%), outside the multi-unit band (10%)
    const tooBig = [0, 1, 2, 3, 4].map((i) => rent(`big${i}`, { sqft: 835, distance: 0.2 }));
    const loose = run(subject1bd, tooBig);
    assert.equal(loose.stepReached, "strict-0.5mi");
    const tight = run(building, tooBig);
    assert.equal(tight.stepReached, "relaxed");
    assert.ok(tight.comps.every((c) => c.matchClass === "different-size"));
  });
});

describe("ladder order", () => {
  it("stops at 0.5 mi with >= 5 strict comps and adds nothing farther", () => {
    const near = [2000, 2060, 2100, 2140, 2200].map((r, i) => rent(`n${i}`, { rent: r, distance: 0.3 + i * 0.04 }));
    const far = [0, 1, 2, 3].map((i) => rent(`f${i}`, { distance: 0.8 + i * 0.4, rent: 2100 }));
    const r = run(subject1bd, [...far, ...near]);
    assert.equal(r.stepReached, "strict-0.5mi");
    assert.equal(r.radiusUsedMiles, 0.5);
    assert.equal(r.confidence, "high");
    assert.deepEqual(r.comps.map((c) => c.id), ["n0", "n1", "n2", "n3", "n4"]);
    assert.ok(r.comps.every((c) => c.distanceMiles <= 0.5));
    // positions .1 .3 .5 .7 .9 -> q25 = 2000 + .75*60, median 2100, q75 = 2140 + .25*60
    assert.deepEqual(r.estimate, { low: 2045, median: 2100, high: 2155 });
    assert.deepEqual(r.comps[0]?.matchReason, "Same size, 0.3 mi");
  });

  it("widens to 1 mi when 0.5 mi has too few, keeping the nearer comps", () => {
    const cands = [
      rent("a", { distance: 0.2 }),
      rent("b", { distance: 0.4 }),
      ...[0, 1, 2, 3].map((i) => rent(`m${i}`, { distance: 0.6 + i * 0.1 })),
    ];
    const r = run(subject1bd, cands);
    assert.equal(r.stepReached, "strict-1mi");
    assert.equal(r.comps.length, 6);
    assert.equal(r.confidence, "high");
  });

  it("sparse suburb: needs the 2-mile step, confidence medium", () => {
    const cands = [
      rent("a", { distance: 0.4, beds: 3, baths: 2, sqft: 1500, type: "single_family", rent: 2400 }),
      rent("b", { distance: 0.9, beds: 3, baths: 2, sqft: 1480, type: "single_family", rent: 2450 }),
      ...[0, 1, 2, 3].map((i) => rent(`m${i}`, { distance: 1.5 + i * 0.1, beds: 3, baths: 2, sqft: 1550, type: "single_family", rent: 2500 })),
      rent("twoBedClose", { distance: 0.1, beds: 2, baths: 1, sqft: 1100, type: "single_family", rent: 1800 }),
    ];
    const r = run({ propertyType: "single_family", beds: 3, baths: 2, sqft: 1500 }, cands);
    assert.equal(r.stepReached, "strict-2mi");
    assert.equal(r.radiusUsedMiles, 2);
    assert.equal(r.comps.length, 6);
    assert.equal(r.confidence, "medium");
    assert.ok(!r.comps.some((c) => c.id === "twoBedClose"));
  });

  it("3-4 strict comps are acceptable only when no wider step reaches 5: uses the narrowest", () => {
    const cands = [
      ...[0, 1, 2].map((i) => rent(`c${i}`, { distance: 0.2 + i * 0.1 })),
      rent("w", { distance: 1.8 }),
    ];
    const r = run(subject1bd, cands);
    assert.equal(r.stepReached, "strict-0.5mi");
    assert.equal(r.comps.length, 3);
    assert.equal(r.confidence, "medium");
    assert.ok(r.notes.some((n) => n.includes("No step reached 5")));
  });

  it("3-4 strict comps near are superseded when a wider strict step reaches 5", () => {
    const cands = [
      ...[0, 1, 2].map((i) => rent(`c${i}`, { distance: 0.2 + i * 0.1 })),
      ...[0, 1, 2].map((i) => rent(`w${i}`, { distance: 1.2 + i * 0.2 })),
    ];
    const r = run(subject1bd, cands);
    assert.equal(r.stepReached, "strict-2mi");
    assert.equal(r.comps.length, 6);
    assert.equal(r.confidence, "medium");
  });

  it("exhausts strict matching across all radii before relaxing size", () => {
    const farStrict = [0, 1, 2].map((i) => rent(`s${i}`, { distance: 1.7 + i * 0.1 }));
    const nearBigger = [0, 1, 2, 3, 4, 5].map((i) => rent(`d${i}`, { beds: 2, sqft: 1000, rent: 2700, distance: 0.1 + i * 0.05 }));
    const r = run(subject1bd, [...nearBigger, ...farStrict]);
    assert.equal(r.stepReached, "strict-2mi");
    assert.equal(r.confidence, "medium");
    assert.deepEqual(r.comps.map((c) => c.id), ["s0", "s1", "s2"]);
    assert.ok(r.comps.every((c) => c.matchClass === "same-size"));
  });

  it("requires same property type; condo and apartment_unit are equivalent", () => {
    const houses = [0, 1, 2, 3, 4].map((i) => rent(`h${i}`, { type: "single_family", distance: 0.2 }));
    const insufficient = run(subject1bd, houses);
    assert.equal(insufficient.stepReached, "insufficient");
    const apts = [0, 1, 2, 3, 4].map((i) => rent(`a${i}`, { type: "apartment_unit", distance: 0.2 }));
    assert.equal(run(subject1bd, apts).stepReached, "strict-0.5mi");
  });

  it("strict baths allow +/-1 but not 2 apart", () => {
    const cands = [
      rent("b1", { baths: 2 }),
      rent("b2", { baths: 1.5 }),
      rent("b3", { baths: 1 }),
      rent("b4", { baths: 3 }),
    ];
    const r = run(subject1bd, cands);
    assert.deepEqual(r.comps.map((c) => c.id).sort(), ["b1", "b2", "b3"]);
  });
});

describe("relaxed fallback with size adjustment (E4.11)", () => {
  const twoBeds = [2000, 2100, 2200, 2300].map((r, i) =>
    rent(`t${i}`, { beds: 2, baths: 1, sqft: 1000, rent: r, distance: 0.6 + i * 0.1 }),
  );
  const oneStrict = rent("s0", { distance: 0.3, rent: 1500 });

  it("returns adjacent-size comps labelled different-size with an adjusted amount", () => {
    const r = run(subject1bd, [...twoBeds, oneStrict]);
    assert.equal(r.stepReached, "relaxed");
    assert.equal(r.radiusUsedMiles, 1);
    assert.equal(r.confidence, "medium");
    const diff = r.comps.filter((c) => c.matchClass === "different-size");
    assert.equal(diff.length, 4);
    assert.deepEqual(diff.map((c) => c.adjustedAmount), [1460, 1533, 1606, 1679]);
    assert.equal(diff[0]?.matchReason, "Different size (2 bd), adjusted to 730 sqft, 0.6 mi");
    // same-size comps sort ahead of different-size ones
    assert.equal(r.comps[0]?.id, "s0");
    assert.equal(r.comps[0]?.adjustedAmount, undefined);
    // values 1460 1500 1533 1606 1679 -> q25 1490, median 1533, q75 1606 + .25*73
    assert.deepEqual(r.estimate, { low: 1490, median: 1533, high: 1624 });
  });

  it("is capped at low confidence when the relaxed step needs more than 1 mile", () => {
    const farTwoBeds = twoBeds.map((c, i) => ({ ...c, distanceMiles: 1.4 + i * 0.1 }));
    const r = run(subject1bd, [...farTwoBeds, oneStrict]);
    assert.equal(r.stepReached, "relaxed");
    assert.equal(r.radiusUsedMiles, 2);
    assert.equal(r.confidence, "low");
  });

  it("includes same-bed comps outside the strict band when they are within 30% sqft", () => {
    const r = run(subject1bd, [0, 1, 2].map((i) => rent(`x${i}`, { sqft: 880, rent: 2200 })));
    assert.equal(r.stepReached, "relaxed");
    assert.ok(r.comps.every((c) => c.matchClass === "different-size" && c.adjustedAmount === Math.round((2200 / 880) * 730)));
  });

  it("without the subject's size, relaxed matching is not attempted", () => {
    const r = run({ propertyType: "condo", beds: 1, baths: 1 }, [
      ...[0, 1].map((i) => rent(`p${i}`, { sqft: 730 })),
      ...twoBeds,
    ]);
    // beds unknown size => strict can match by beds; only 2 strict-by-beds exist => insufficient w/ explanation
    assert.equal(r.stepReached, "insufficient");
    assert.ok(r.notes.some((n) => n.includes("needs the subject's size")));
  });
});

describe("insufficient comps (E4.13)", () => {
  it("returns a null estimate, low confidence and a note", () => {
    const r = run(subject1bd, [rent("a"), rent("b"), rent("far", { distance: 5 }), rent("c", { beds: 4, sqft: 2000 })]);
    assert.equal(r.stepReached, "insufficient");
    assert.equal(r.estimate, null);
    assert.equal(r.radiusUsedMiles, null);
    assert.equal(r.confidence, "low");
    assert.deepEqual(r.comps, []);
    assert.ok(r.notes.some((n) => n.startsWith("Insufficient comps") && n.includes("enter your own rent")));
  });

  it("handles an empty candidate list", () => {
    const r = run(subject1bd, []);
    assert.equal(r.stepReached, "insufficient");
    assert.equal(r.estimate, null);
  });
});

describe("outliers", () => {
  it("trims values outside the IQR fence before percentiles", () => {
    const base = [2000, 2020, 2040, 2060, 2080, 2100].map((r, i) => rent(`ok${i}`, { rent: r }));
    const r = run(subject1bd, [...base, rent("hi", { rent: 5200 }), rent("lo", { rent: 700 })]);
    assert.equal(r.comps.length, 6);
    assert.ok(!r.comps.some((c) => c.id === "hi" || c.id === "lo"));
    assert.deepEqual(r.estimate, { low: 2020, median: 2050, high: 2080 });
    assert.ok(r.notes.some((n) => n.includes("2 outliers")));
  });

  it("outliers do not count toward 'enough'", () => {
    const four = [2000, 2020, 2040, 2060].map((r, i) => rent(`ok${i}`, { rent: r, distance: 0.2 }));
    const r = run(subject1bd, [...four, rent("hi", { rent: 5000, distance: 0.2 })]);
    assert.equal(r.comps.length, 4);
    assert.equal(r.confidence, "medium");
  });
});

describe("duplicates", () => {
  it("keeps only the most recent listing of the same unit (address, beds, sqft)", () => {
    const dupes = [
      rent("old", { address: "100 Main St, Apt 2", age: 120, rent: 1800 }),
      rent("new", { address: "100 main st apt 2", age: 10, rent: 2000 }),
      rent("mid", { address: "100 Main St Apt 2", age: 60, rent: 1900 }),
    ];
    const others = [rent("u1", { rent: 2010 }), rent("u2", { rent: 2020 })];
    const r = run(subject1bd, [...dupes, ...others]);
    assert.equal(r.comps.length, 3);
    assert.ok(r.comps.some((c) => c.id === "new") && !r.comps.some((c) => c.id === "old" || c.id === "mid"));
    // 3 unique units, not 5: medium, never high
    assert.equal(r.confidence, "medium");
    assert.ok(r.notes.some((n) => n.includes("Removed 2 duplicate")));
  });

  it("units with different sqft or beds at one address are different units", () => {
    const r = run(subject1bd, [
      rent("a", { address: "9 Elm St", sqft: 720 }),
      rent("b", { address: "9 Elm St", sqft: 740 }),
      rent("c", { address: "9 Elm St", sqft: 730 }),
    ]);
    assert.equal(r.comps.length, 3);
  });
});

describe("stale listings", () => {
  const recent = [0, 1, 2, 3, 4].map((i) => rent(`r${i}`, { age: 20 + i * 10 }));

  it("excludes listings older than the recency window and says so", () => {
    const r = run(subject1bd, [...recent, rent("old", { age: 200 }), rent("older", { age: 300 })]);
    assert.equal(r.comps.length, 5);
    assert.ok(!r.comps.some((c) => c.id === "old"));
    assert.ok(r.notes.some((n) => n.includes("Excluded 2 listings older than 180 days")));
    assert.equal(r.confidence, "high");
  });

  it("includes older listings only when needed, with a note and lower confidence", () => {
    const stale = [0, 1, 2].map((i) => rent(`s${i}`, { age: 250 + i * 10 }));
    const r = run(subject1bd, [rent("r0", { age: 10 }), rent("r1", { age: 20 }), ...stale]);
    assert.equal(r.stepReached, "strict-0.5mi");
    assert.equal(r.comps.length, 5);
    assert.equal(r.confidence, "medium"); // would be high; demoted one level
    assert.ok(r.notes[0]?.includes("up to 365 days old"));
  });

  it("never uses listings beyond the stale fallback limit", () => {
    const r = run(subject1bd, [rent("a", { age: 10 }), rent("b", { age: 400 }), rent("c", { age: 500 }), rent("d", { age: 600 })]);
    assert.equal(r.stepReached, "insufficient");
  });

  it("weights newer comps more when computing percentiles", () => {
    const r = run(subject1bd, [
      rent("old", { rent: 1800, age: 170 }),
      rent("n1", { rent: 2000, age: 5 }),
      rent("n2", { rent: 2200, age: 5 }),
    ]);
    // equal weights would give a median of 2000; recency weighting pulls it up to ~2072
    assert.ok((r.estimate?.median ?? 0) > 2060 && (r.estimate?.median ?? 0) < 2090);
  });

  it("ignores listings with unreadable dates", () => {
    const bad: RentListing = { ...rent("bad"), date: "not-a-date" };
    const r = run(subject1bd, [...recent, bad]);
    assert.equal(r.comps.length, 5);
    assert.ok(r.notes.some((n) => n.includes("unreadable date")));
  });
});

describe("labels and reasons", () => {
  it("labels asking vs leased on each comp and notes asking rents", () => {
    const r = run(subject1bd, [
      rent("a", { kind: "asking" }),
      rent("b", { kind: "leased" }),
      rent("c", { kind: "asking" }),
    ]);
    assert.deepEqual(r.comps.map((c) => c.kind).sort(), ["asking", "asking", "leased"]);
    assert.ok(r.notes.some((n) => n.includes("2 of 3 comps are asking rents")));
  });

  it("shows sub-0.1 mile distances readably", () => {
    const r = run(subject1bd, [rent("a", { distance: 0.02 }), rent("b"), rent("c")]);
    assert.equal(r.comps[0]?.matchReason, "Same size, <0.1 mi");
  });
});

describe("missing subject facts", () => {
  it("relaxes matching on unknown fields, says so, and caps confidence at medium", () => {
    const cands = [0, 1, 2, 3, 4].map((i) => rent(`c${i}`, { distance: 0.2 }));
    const r = run({ propertyType: "condo" }, cands);
    assert.equal(r.stepReached, "strict-0.5mi");
    assert.equal(r.confidence, "medium");
    assert.ok(r.notes.some((n) => n.includes("bedroom count unknown")));
    assert.ok(r.notes.some((n) => n.includes("size unknown")));
  });
});

describe("determinism", () => {
  const cands = [
    // exact ties on distance and date, differing ids; also a same-distance tie broken by age
    ...["e", "c", "a", "d", "b"].map((id) => rent(`tie-${id}`, { distance: 0.25, age: 30, rent: 2000 + id.charCodeAt(0) })),
    rent("x1", { distance: 0.25, age: 10 }),
    rent("x2", { distance: 0.1 }),
    rent("far", { distance: 1.5 }),
    rent("two", { beds: 2, sqft: 1000 }),
  ];

  it("the same input gives identical output, including order", () => {
    const a = run(subject1bd, cands);
    const b = run(subject1bd, cands);
    assert.deepEqual(a, b);
  });

  it("input order does not matter; ties break by distance, recency, then id", () => {
    const base = run(subject1bd, cands);
    for (const seed of [1, 2, 3, 99]) {
      assert.deepEqual(run(subject1bd, permute(cands, seed)), base);
    }
    assert.deepEqual(run(subject1bd, [...cands].reverse()), base);
    assert.deepEqual(base.comps.map((c) => c.id), ["x2", "x1", "tie-a", "tie-b", "tie-c", "tie-d", "tie-e"]);
  });

  it("does not mutate its inputs", () => {
    const frozen = Object.freeze(cands.map((c) => Object.freeze({ ...c })));
    assert.doesNotThrow(() => selectRentComps(Object.freeze({ ...subject1bd }), frozen, opts));
  });
});

describe("config overrides", () => {
  const cands = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rent(`c${i}`, { distance: 0.1 + i * 0.05 }));

  it("targetComps changes where the ladder stops and the confidence", () => {
    const four = [0, 1, 2, 3].map((i) => rent(`f${i}`, { distance: 0.2 + i * 0.05 }));
    const dflt = run(subject1bd, four);
    assert.equal(dflt.stepReached, "strict-0.5mi");
    assert.equal(dflt.confidence, "medium"); // 4 < target 5
    assert.equal(run(subject1bd, four, { targetComps: 4 }).confidence, "high");
    assert.equal(run(subject1bd, four, { minComps: 5 }).stepReached, "insufficient");
  });

  it("maxComps caps the list, nearest first", () => {
    const r = run(subject1bd, cands, { maxComps: 6 });
    assert.equal(r.comps.length, 6);
    assert.deepEqual(r.comps.map((c) => c.id), ["c0", "c1", "c2", "c3", "c4", "c5"]);
    assert.ok(r.notes.some((n) => n.includes("2 more matched")));
  });

  it("recencyDays and strict tolerances are tunable per call", () => {
    const stale = [0, 1, 2, 3, 4].map((i) => rent(`s${i}`, { age: 100 }));
    assert.equal(run(subject1bd, stale, { recencyDays: 90, staleFallbackDays: 0 }).stepReached, "insufficient");
    const big = [0, 1, 2, 3, 4].map((i) => rent(`b${i}`, { sqft: 840 }));
    assert.equal(run(subject1bd, big, { strictSqftTolerancePct: 10 }).stepReached, "relaxed");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SaleListing } from "@evalprop/shared";
import { selectSaleComps, type SaleSubject } from "./index.ts";
import { NOW, assertValidCompResult, permute, sale } from "./test-helpers.ts";

const subject: SaleSubject = { propertyType: "single_family", beds: 3, sqft: 1000, listPrice: 400_000 };

function run(s: SaleSubject, candidates: SaleListing[], config?: Parameters<typeof selectSaleComps>[2]["config"]) {
  const result = selectSaleComps(s, candidates, config ? { now: NOW, config } : { now: NOW });
  assertValidCompResult(result);
  return result;
}

const five = [300_000, 310_000, 320_000, 330_000, 340_000].map((p, i) =>
  sale(`s${i}`, { price: p, distance: 0.1 + i * 0.08 }),
);

describe("selectSaleComps", () => {
  it("returns nearest-first comps with price per sqft and a median-based implied value", () => {
    const r = run(subject, [...five].reverse());
    assert.equal(r.stepReached, "strict-0.5mi");
    assert.equal(r.radiusUsedMiles, 0.5);
    assert.equal(r.confidence, "high");
    assert.deepEqual(r.comps.map((c) => c.id), ["s0", "s1", "s2", "s3", "s4"]);
    assert.deepEqual(r.pricePerSqft, { s0: 300, s1: 310, s2: 320, s3: 330, s4: 340 });
    assert.equal(r.medianPricePerSqft, 320);
    // $/sqft 300..340 at positions .1 .3 .5 .7 .9: q25 = 307.5, median 320, q75 = 332.5; times 1000 sqft
    assert.deepEqual(r.estimate, { low: 307_500, median: 320_000, high: 332_500 });
    assert.equal(r.comps[0]?.matchReason, "Similar size, $300/sqft, 0.1 mi");
    assert.equal(r.comps[0]?.kind, "sold");
  });

  it("flags a list price more than the threshold above the comps", () => {
    const r = run(subject, five); // list 400k vs 320k implied: +25%
    assert.equal(r.listPriceCheck?.flagged, true);
    assert.equal(r.listPriceCheck?.direction, "above");
    assert.equal(r.listPriceCheck?.differencePct, 25);
    assert.equal(r.listPriceCheck?.impliedValue, 320_000);
    assert.ok(r.notes.some((n) => n.includes("25% above")));
  });

  it("flags a list price far below the comps", () => {
    const r = run({ ...subject, listPrice: 250_000 }, five);
    assert.equal(r.listPriceCheck?.direction, "below");
    assert.equal(r.listPriceCheck?.flagged, true);
  });

  it("does not flag a list price within the threshold; threshold is configurable", () => {
    const inLine = run({ ...subject, listPrice: 330_000 }, five);
    assert.equal(inLine.listPriceCheck?.flagged, false);
    assert.equal(inLine.listPriceCheck?.direction, "in-line");
    assert.equal(inLine.listPriceCheck?.differencePct, 3.13);
    assert.ok(!inLine.notes.some((n) => n.includes("List price")));
    const strict = run({ ...subject, listPrice: 330_000 }, five, { sale: { listPriceFlagPct: 2 } });
    assert.equal(strict.listPriceCheck?.flagged, true);
    const lenient = run(subject, five, { sale: { listPriceFlagPct: 30 } });
    assert.equal(lenient.listPriceCheck?.flagged, false);
  });

  it("has no list-price check without a list price or without the subject's size", () => {
    assert.equal(run({ ...subject, listPrice: undefined }, five).listPriceCheck, null);
    const noSize = run({ propertyType: "single_family", beds: 3, listPrice: 400_000 }, five);
    assert.equal(noSize.estimate, null);
    assert.equal(noSize.listPriceCheck, null);
    assert.equal(noSize.medianPricePerSqft, 320);
    assert.equal(noSize.confidence, "medium");
  });

  it("weights newer sales more in the median price per sqft", () => {
    const r = run(subject, [
      sale("old", { price: 260_000, age: 340 }),
      sale("n1", { price: 320_000, age: 10 }),
      sale("n2", { price: 340_000, age: 10 }),
    ]);
    // equal weights would put the median at 320; weighting the 340-day-old $260 down moves it up
    assert.ok((r.medianPricePerSqft ?? 0) > 320 && (r.medianPricePerSqft ?? 0) < 340);
  });

  it("widens the radius only when the nearer step has too few sales", () => {
    const cands = [
      sale("a", { distance: 0.2 }),
      sale("b", { distance: 0.4 }),
      ...[0, 1, 2, 3].map((i) => sale(`m${i}`, { distance: 0.9 + i * 0.2 })),
    ];
    const r = run(subject, cands);
    assert.equal(r.stepReached, "strict-2mi");
    assert.equal(r.confidence, "medium");
    assert.equal(r.comps.length, 6);
    const near = run(subject, [...five, sale("far", { distance: 1.5 })]);
    assert.ok(near.comps.every((c) => c.distanceMiles <= 0.5));
  });

  it("excludes active and pending listings by default; they can be allowed", () => {
    const withActive = [...five.slice(0, 2), sale("act", { status: "active" }), sale("pend", { status: "pending" })];
    const r = run(subject, withActive);
    assert.equal(r.stepReached, "insufficient");
    const allowed = run(subject, withActive, { sale: { statuses: ["sold", "active", "pending"] } });
    assert.equal(allowed.comps.length, 4);
    assert.ok(allowed.notes.some((n) => n.includes("2 of 4 comps are active or pending")));
  });

  it("filters by type, beds, and the sqft band", () => {
    const r = run(subject, [
      ...five,
      sale("condo", { type: "condo" }),
      sale("beds5", { beds: 5 }),
      sale("huge", { sqft: 1500, price: 480_000 }),
      sale("tiny", { sqft: 700, price: 224_000 }),
    ]);
    assert.deepEqual(r.comps.map((c) => c.id), ["s0", "s1", "s2", "s3", "s4"]);
  });

  it("trims price-per-sqft outliers and drops stale, size-less and duplicate records", () => {
    const noSize: SaleListing = { ...sale("nosize") };
    delete noSize.sqft;
    const r = run(subject, [
      ...five,
      sale("lux", { price: 900_000 }),
      sale("stale", { age: 400 }),
      noSize,
      sale("dupe-old", { address: "5 Oak Ave", age: 200, price: 310_000 }),
      sale("dupe-new", { address: "5 oak ave", age: 20, price: 315_000 }),
    ]);
    assert.ok(!r.comps.some((c) => ["lux", "stale", "nosize", "dupe-old"].includes(c.id)));
    assert.ok(r.comps.some((c) => c.id === "dupe-new"));
    assert.ok(r.notes.some((n) => n.includes("outlier")));
    assert.ok(r.notes.some((n) => n.includes("older than 365 days")));
    assert.ok(r.notes.some((n) => n.includes("no size")));
    assert.ok(r.notes.some((n) => n.includes("duplicate")));
  });

  it("is insufficient with fewer than the minimum comps", () => {
    const r = run(subject, five.slice(0, 2));
    assert.equal(r.stepReached, "insufficient");
    assert.equal(r.estimate, null);
    assert.equal(r.medianPricePerSqft, null);
    assert.equal(r.listPriceCheck, null);
    assert.equal(r.confidence, "low");
    assert.deepEqual(r.comps, []);
  });

  it("is deterministic regardless of input order", () => {
    const cands = [...five, sale("tieA", { distance: 0.1, price: 305_000 }), sale("tieB", { distance: 0.1, price: 305_000 })];
    const base = run(subject, cands);
    for (const seed of [1, 7, 42]) assert.deepEqual(run(subject, permute(cands, seed)), base);
    assert.deepEqual(base.comps.slice(0, 3).map((c) => c.id), ["s0", "tieA", "tieB"]);
  });
});

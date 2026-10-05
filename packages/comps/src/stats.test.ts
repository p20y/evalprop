import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickTier } from "./ladder.ts";
import { quantile, recencyWeight, trimOutliers, weightedQuantile } from "./stats.ts";

describe("quantile", () => {
  it("interpolates linearly", () => {
    assert.equal(quantile([10, 20, 30, 40, 50], 0.5), 30);
    assert.equal(quantile([10, 20, 30, 40], 0.25), 17.5);
    assert.equal(quantile([7], 0.9), 7);
  });
});

describe("weightedQuantile", () => {
  const eq = (vs: number[]) => vs.map((value) => ({ value, weight: 1 }));
  it("with equal weights places points at band midpoints", () => {
    assert.equal(weightedQuantile(eq([100, 200, 300]), 0.25), 125);
    assert.equal(weightedQuantile(eq([100, 200, 300]), 0.5), 200);
    assert.equal(weightedQuantile(eq([100, 200, 300]), 0.75), 275);
    assert.equal(weightedQuantile(eq([100, 200, 300]), 0), 100);
    assert.equal(weightedQuantile(eq([100, 200, 300]), 1), 300);
  });
  it("does not depend on input order", () => {
    assert.equal(weightedQuantile(eq([300, 100, 200]), 0.25), 125);
  });
  it("moves the median toward heavier points", () => {
    const heavyHigh = weightedQuantile(
      [
        { value: 100, weight: 1 },
        { value: 200, weight: 1 },
        { value: 300, weight: 4 },
      ],
      0.5,
    );
    assert.ok(heavyHigh > 200 && heavyHigh <= 300);
  });
});

describe("recencyWeight", () => {
  it("halves at one half-life and is 1 today", () => {
    assert.equal(recencyWeight(0, 90), 1);
    assert.equal(recencyWeight(90, 90), 0.5);
    assert.equal(recencyWeight(180, 90), 0.25);
    assert.equal(recencyWeight(-5, 90), 1);
  });
});

describe("trimOutliers", () => {
  const opts = { iqrMultiplier: 1.5, minFencePct: 15, minSamples: 4 };
  it("drops points outside the IQR fence, keeps order", () => {
    const { kept, removed } = trimOutliers([2000, 2020, 700, 2040, 2060, 5200, 2080], (x) => x, opts);
    assert.deepEqual(kept, [2000, 2020, 2040, 2060, 2080]);
    assert.deepEqual(removed, [700, 5200]);
  });
  it("does not trim small samples", () => {
    const { kept, removed } = trimOutliers([1, 1000, 2000], (x) => x, opts);
    assert.equal(kept.length, 3);
    assert.equal(removed.length, 0);
  });
  it("the minimum fence stops a tight cluster rejecting ordinary variation", () => {
    const { removed } = trimOutliers([2000, 2000, 2000, 2000, 2100], (x) => x, opts);
    assert.deepEqual(removed, []);
  });
});

describe("pickTier", () => {
  it("takes the first step with enough comps", () => {
    assert.equal(pickTier([0, 5, 7, 9], 5, 3), 1);
    assert.equal(pickTier([0, 3, 6, 6], 5, 3), 2);
  });
  it("falls back to the narrowest acceptable step when none reaches the target", () => {
    assert.equal(pickTier([0, 3, 4, 4], 5, 3), 1);
    assert.equal(pickTier([0, 2, 3, 4], 5, 3), 2);
  });
  it("returns null when no step reaches the minimum", () => {
    assert.equal(pickTier([0, 1, 2, 2], 5, 3), null);
  });
});

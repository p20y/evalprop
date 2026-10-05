import assert from "node:assert/strict";
import { test } from "node:test";
import { breakEvenRent, evaluate, maxPriceForCashOnCash } from "@evalprop/engine";
import type { Analysis } from "@evalprop/shared";
import { degradedAnalysis, marginalAnalysis, strongAnalysis } from "./fixtures.ts";
import { analyzedPriceOf, assumptionValue, engineInputFromAnalysis, monthlyRentOf, reconstructEngineInput } from "./input.ts";

const clone = <T>(x: T): T => structuredClone(x);
const fixtures = (): Array<[string, Analysis]> => [
  ["strong", strongAnalysis()],
  ["marginal", marginalAnalysis()],
  ["degraded", degradedAnalysis()],
];

for (const [name, a] of fixtures()) {
  test(`engineInputFromAnalysis (${name}): re-running the engine reproduces the saved evaluation exactly`, () => {
    const rec = reconstructEngineInput(a);
    assert.ok(rec);
    assert.equal(rec.reproduces, true);
    const e = evaluate(rec.input);
    assert.deepEqual(e.yearOne, a.evaluation.yearOne);
    assert.equal(e.hold.breakEvenMonth, a.evaluation.hold.breakEvenMonth);
    assert.equal(e.verdict, a.evaluation.verdict);
  });

  test(`engineInputFromAnalysis (${name}): max offer and break-even rent come out the same as the analysis stored`, () => {
    const input = engineInputFromAnalysis(a);
    assert.equal(maxPriceForCashOnCash(input, a.targetCashOnCashPct), a.maxOfferPrice);
    assert.equal(breakEvenRent(input), a.breakEvenRent);
  });
}

test("price, rent, and assumption helpers read the resolved values", () => {
  const a = strongAnalysis();
  assert.equal(analyzedPriceOf(a), 135000);
  assert.equal(monthlyRentOf(a), 1650);
  assert.equal(assumptionValue(a, "interestRatePct"), 6.75);
  assert.equal(assumptionValue(a, "nonexistent"), null);
});

test("provided, listing, and lookup values become overrides; defaults are left to the engine so price-scaled defaults keep scaling", () => {
  const input = engineInputFromAnalysis(strongAnalysis());
  assert.equal(input.interestRatePct, 6.75); // provided
  assert.equal(input.propertyTaxAnnual, 1380); // from listing
  assert.equal(input.insuranceAnnual, undefined); // assumed default: not pinned
  assert.equal(input.vacancyPct, undefined);
  assert.equal(input.state, "IN");
  assert.equal(input.listPrice, 142000);
  const lowerPrice = evaluate({ ...input, purchasePrice: 100000 }).yearOne.operatingExpenses.insurance;
  assert.equal(lowerPrice, 500, "insurance default scales with price (0.5%)");
});

test("falls back to the engine's list-price comparison and gross rent when the price and rent assumptions are missing", () => {
  const a = marginalAnalysis();
  a.assumptions = a.assumptions.filter((r) => r.field !== "purchasePrice" && r.field !== "monthlyRent");
  assert.equal(analyzedPriceOf(a), 165000); // from evaluation.listPriceComparison.purchasePrice
  assert.equal(monthlyRentOf(a), 1850); // grossAnnualRent / 12
  const rec = reconstructEngineInput(a);
  assert.ok(rec);
  assert.equal(rec.reproduces, true);
});

test("uses the list price when nothing else says what price was analyzed", () => {
  const a = strongAnalysis();
  a.assumptions = a.assumptions.filter((r) => r.field !== "purchasePrice");
  delete a.evaluation.listPriceComparison;
  assert.equal(analyzedPriceOf(a), 142000);
  // 142000 is not the price the evaluation was run at, so the result is flagged as not reproducing.
  assert.equal(reconstructEngineInput(a)?.reproduces, false);
});

test("returns null (and engineInputFromAnalysis throws) when no price can be determined", () => {
  const a = degradedAnalysis();
  a.assumptions = a.assumptions.filter((r) => r.field !== "purchasePrice");
  delete a.evaluation.listPriceComparison;
  assert.equal(a.property.listPrice, undefined);
  assert.equal(reconstructEngineInput(a), null);
  assert.throws(() => engineInputFromAnalysis(a), /no purchase price/);
});

test("pins resolved defaults when the engine's current defaults no longer reproduce the saved numbers", () => {
  const base = strongAnalysis();
  const input = engineInputFromAnalysis(base);
  const changed = evaluate({ ...input, insuranceAnnual: 999 }); // as if an older engine defaulted insurance to $999
  const a = clone(base);
  a.evaluation = { ...changed, listPriceComparison: base.evaluation.listPriceComparison! };
  a.assumptions = a.assumptions.map((r) => (r.field === "insuranceAnnual" ? { ...r, value: 999 } : r));
  const rec = reconstructEngineInput(a);
  assert.ok(rec);
  assert.equal(rec.reproduces, true);
  assert.equal(rec.input.insuranceAnnual, 999);
});

test("reports reproduces=false when the saved numbers cannot be matched", () => {
  const a = strongAnalysis();
  a.evaluation.yearOne.noi += 5000;
  assert.equal(reconstructEngineInput(a)?.reproduces, false);
});

test("invalid stored values never throw out of the reconstruction", () => {
  const a = strongAnalysis();
  a.assumptions = a.assumptions.map((r) => (r.field === "interestRatePct" ? { ...r, value: 999 } : r));
  assert.equal(reconstructEngineInput(a)?.reproduces, false);
});

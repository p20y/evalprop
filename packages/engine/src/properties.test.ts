import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "./index.ts";
import type { PropertyInput } from "./index.ts";

/** mulberry32: small seeded PRNG so a failing case is reproducible from its seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand: () => number, lo: number, hi: number) => lo + rand() * (hi - lo);

/** A random but realistic deal. Percentage costs are kept below 100% in total so more rent always helps. */
function randomDeal(rand: () => number): PropertyInput {
  return {
    purchasePrice: Math.round(between(rand, 50_000, 2_000_000)),
    monthlyRent: Math.round(between(rand, 500, 12_000)),
    downPaymentPct: between(rand, 0, 100),
    interestRatePct: between(rand, 0, 15),
    loanTermYears: Math.ceil(between(rand, 5, 40)),
    closingCostPct: between(rand, 0, 8),
    rehabCost: Math.round(between(rand, 0, 100_000)),
    hoaMonthly: Math.round(between(rand, 0, 600)),
    vacancyPct: between(rand, 0, 30),
    maintenancePct: between(rand, 0, 15),
    capexPct: between(rand, 0, 15),
    managementPct: between(rand, 0, 15),
    holdYears: Math.ceil(between(rand, 1, 30)),
  };
}

const ITERATIONS = 300;

test("property: a higher interest rate never increases monthly cash flow", () => {
  const rand = prng(20260401);
  for (let n = 0; n < ITERATIONS; n++) {
    const deal = randomDeal(rand);
    const low = between(rand, 0, 14);
    const high = low + between(rand, 0, 5);
    const cfLow = evaluate({ ...deal, interestRatePct: low }).yearOne.monthlyCashFlow;
    const cfHigh = evaluate({ ...deal, interestRatePct: Math.min(high, 30) }).yearOne.monthlyCashFlow;
    assert.ok(cfHigh <= cfLow + 1e-9, `case ${n}: rate ${low} -> ${high} raised cash flow ${cfLow} -> ${cfHigh}`);
  }
});

test("property: higher rent never decreases monthly cash flow", () => {
  const rand = prng(20260402);
  for (let n = 0; n < ITERATIONS; n++) {
    const deal = randomDeal(rand);
    const low = Math.round(between(rand, 0, 10_000));
    const high = low + Math.round(between(rand, 0, 3_000));
    const cfLow = evaluate({ ...deal, monthlyRent: low }).yearOne.monthlyCashFlow;
    const cfHigh = evaluate({ ...deal, monthlyRent: high }).yearOne.monthlyCashFlow;
    assert.ok(cfHigh >= cfLow - 1e-9, `case ${n}: rent ${low} -> ${high} lowered cash flow ${cfLow} -> ${cfHigh}`);
  }
});

test("property: a higher price never increases annual cash flow when everything else is fixed", () => {
  const rand = prng(20260403);
  for (let n = 0; n < ITERATIONS; n++) {
    // Fix tax and insurance so price only affects the loan and cash invested.
    const deal = { ...randomDeal(rand), propertyTaxAnnual: 3_000, insuranceAnnual: 1_200, downPaymentPct: between(rand, 5, 40) };
    const lowPrice = Math.round(between(rand, 60_000, 800_000));
    const highPrice = lowPrice + Math.round(between(rand, 0, 200_000));
    const base = evaluate({ ...deal, purchasePrice: lowPrice }).yearOne;
    const more = evaluate({ ...deal, purchasePrice: highPrice }).yearOne;
    assert.ok(more.annualCashFlow <= base.annualCashFlow + 1e-9, `case ${n}: price ${lowPrice} -> ${highPrice} raised cash flow`);
  }
});

test("property: every random evaluation is finite and internally consistent", () => {
  const rand = prng(20260404);
  for (let n = 0; n < 100; n++) {
    const deal = randomDeal(rand);
    const e = evaluate(deal);
    const y = e.yearOne;
    for (const v of [y.noi, y.annualCashFlow, y.cashInvested, y.capRatePct, y.cashOnCashPct, y.breakEvenOccupancyPct]) {
      assert.ok(Number.isFinite(v), `case ${n}: non-finite year-one value`);
    }
    assert.ok(Math.abs(y.monthlyCashFlow * 12 - y.annualCashFlow) < 1e-6);
    assert.ok(Math.abs(y.noi - y.annualDebtService - y.annualCashFlow) < 1e-6);
    assert.equal(e.hold.years.length, deal.holdYears);
    const first = e.hold.years[0];
    assert.ok(first && Math.abs(first.cashFlow - y.annualCashFlow) < 1e-6, `case ${n}: hold year 1 must equal year-one cash flow`);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, InputError, irr, monthlyPayment, balanceAfter, sensitivity, breakEvenRent, maxPriceForCashOnCash } from "../src/calc/index.ts";

const near = (actual: number, expected: number, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${actual} ≈ ${expected}`);

// All-cash, no growth, no percentage costs: every figure is checkable by hand.
const simple = {
  purchasePrice: 200_000,
  monthlyRent: 2_000,
  downPaymentPct: 100,
  closingCostPct: 0,
  propertyTaxAnnual: 2_400,
  insuranceAnnual: 1_200,
  hoaMonthly: 0,
  vacancyPct: 0,
  maintenancePct: 0,
  capexPct: 0,
  managementPct: 0,
  rentGrowthPct: 0,
  expenseGrowthPct: 0,
  appreciationPct: 0,
  sellingCostPct: 0,
};

test("mortgage payment matches the standard amortization formula", () => {
  near(monthlyPayment(225_000, 6, 30), 1348.99);
  near(monthlyPayment(120_000, 0, 10), 1000);
  assert.equal(monthlyPayment(0, 6, 30), 0);
});

test("loan balance starts at principal and reaches zero at term end", () => {
  near(balanceAfter(225_000, 6, 30, 0), 225_000);
  near(balanceAfter(225_000, 6, 30, 360), 0);
  near(balanceAfter(225_000, 6, 30, 120), 188_292.88);
});

test("irr solves a known simple case and returns null with no sign change", () => {
  near(irr([-100, 110])!, 0.1, 1e-6);
  assert.equal(irr([100, 100]), null);
});

test("year-one metrics for the all-cash case", () => {
  const { yearOne: y } = evaluate(simple);
  assert.equal(y.noi, 20_400);
  near(y.capRatePct, 10.2);
  near(y.cashOnCashPct, 10.2);
  assert.equal(y.dscr, null);
  near(y.grossRentMultiplier, 8.333, 0.001);
  near(y.rentToPricePct, 1);
  near(y.breakEvenOccupancyPct, 15);
  near(y.monthlyCashFlow, 1_700);
});

test("leveraged case: debt service, cash flow and DSCR", () => {
  const e = evaluate({ ...simple, downPaymentPct: 25, interestRatePct: 6, loanTermYears: 30 });
  const y = e.yearOne;
  near(y.loanAmount, 150_000);
  near(y.monthlyPrincipalAndInterest, 899.33);
  near(y.annualCashFlow, 20_400 - 899.33 * 12, 0.5);
  near(y.cashInvested, 50_000);
  near(y.dscr!, 20_400 / (899.33 * 12), 0.001);
});

test("hold analysis: cash payback month for the all-cash case", () => {
  const { hold } = evaluate(simple);
  // 200,000 / 1,700 per month = 117.6 -> month 118
  assert.equal(hold.cashPaybackMonth, 118);
  assert.equal(hold.years.length, 30);
  near(hold.years[0].cashFlow, 20_400);
});

test("break-even counts sale proceeds: immediate with no selling costs, after recovering them otherwise", () => {
  assert.equal(evaluate(simple).hold.breakEvenMonth, 1);
  // 6% selling costs = 12,000 to recover at 1,700/month = 7.06 -> month 8
  assert.equal(evaluate({ ...simple, sellingCostPct: 6 }).hold.breakEvenMonth, 8);
});

test("appreciation and amortization pull break-even earlier than cash payback", () => {
  const { hold } = evaluate({ ...simple, downPaymentPct: 25, appreciationPct: 4, sellingCostPct: 6 });
  assert.ok(hold.breakEvenMonth !== null);
  assert.ok(hold.cashPaybackMonth === null || hold.breakEvenMonth! < hold.cashPaybackMonth);
});

test("rent growth raises later-year cash flow", () => {
  const { hold } = evaluate({ ...simple, rentGrowthPct: 3, expenseGrowthPct: 3 });
  assert.ok(hold.years[9].cashFlow > hold.years[0].cashFlow);
});

test("loan ends within the hold period: debt service drops to zero", () => {
  const { hold } = evaluate({ ...simple, downPaymentPct: 20, loanTermYears: 15 });
  assert.ok(hold.years[14].debtService > 0);
  assert.equal(hold.years[15].debtService, 0);
  near(hold.years[14].loanBalance, 0, 0.01);
});

test("horizons include 5, 10, 20 and the full hold, with IRR", () => {
  const { hold } = evaluate(simple);
  assert.deepEqual(hold.horizons.map((h) => h.years), [5, 10, 20, 30]);
  assert.ok(hold.horizons.every((h) => h.irrPct !== null));
  // 10 years of 20,400 on 200,000 with property returned at cost
  const h10 = hold.horizons.find((h) => h.years === 10)!;
  near(h10.totalProfit, 204_000 - 0, 0.5);
});

test("defaults are flagged as assumed; provided values as provided", () => {
  const e = evaluate({ purchasePrice: 300_000, monthlyRent: 2_500, interestRatePct: 7 });
  const by = Object.fromEntries(e.assumptions.map((a) => [a.field, a]));
  assert.equal(by.interestRatePct.source, "provided");
  assert.equal(by.downPaymentPct.source, "assumed");
  near(by.propertyTaxAnnual.value, 3_300);
  near(by.insuranceAnnual.value, 1_500);
});

test("verdict reflects how many checks pass", () => {
  assert.equal(evaluate(simple).verdict, "strong");
  const weak = evaluate({ purchasePrice: 500_000, monthlyRent: 2_000 });
  assert.equal(weak.verdict, "weak");
  assert.equal(weak.checks.length, 4);
});

test("invalid input is rejected with a clear error", () => {
  assert.throws(() => evaluate({ purchasePrice: 0, monthlyRent: 1000 }), InputError);
  assert.throws(() => evaluate({ purchasePrice: 1e5, monthlyRent: -5 }), InputError);
  assert.throws(() => evaluate({ purchasePrice: 1e5, monthlyRent: 1000, downPaymentPct: 120 }), /downPaymentPct/);
  assert.throws(() => evaluate({ purchasePrice: NaN, monthlyRent: 1000 }), InputError);
  assert.throws(() => evaluate({ purchasePrice: 1e5, monthlyRent: 1000, holdYears: 2.5 }), InputError);
});

test("zero rent does not produce NaN or throw", () => {
  const e = evaluate({ purchasePrice: 200_000, monthlyRent: 0 });
  assert.equal(e.yearOne.breakEvenOccupancyPct, 999);
  assert.ok(Number.isFinite(e.yearOne.capRatePct));
  assert.equal(e.verdict, "weak");
});

test("evaluation is fast", () => {
  const start = performance.now();
  for (let i = 0; i < 50; i++) evaluate({ purchasePrice: 400_000, monthlyRent: 3_000 });
  assert.ok((performance.now() - start) / 50 < 25, "each evaluation should take well under 25ms");
});

test("50% rule cash flow is half of rent minus P&I", () => {
  const e = evaluate({ ...simple, downPaymentPct: 25, interestRatePct: 6, loanTermYears: 30 });
  near(e.yearOne.fiftyPercentRuleMonthlyCashFlow, 1_000 - 899.33);
});

test("breakEvenRent returns the rent that zeroes cash flow", () => {
  const base = { purchasePrice: 300_000, monthlyRent: 1_500 };
  const rent = breakEvenRent(base)!;
  near(evaluate({ ...base, monthlyRent: rent }).yearOne.monthlyCashFlow, 0, 0.01);
});

test("maxPriceForCashOnCash returns a price that hits the target", () => {
  const base = { purchasePrice: 400_000, monthlyRent: 3_000 };
  const price = maxPriceForCashOnCash(base, 8)!;
  near(evaluate({ ...base, purchasePrice: price }).yearOne.cashOnCashPct, 8, 0.01);
  assert.equal(maxPriceForCashOnCash({ purchasePrice: 400_000, monthlyRent: 0 }, 8), null);
});

test("sensitivity grid has the right shape and the base cell matches evaluate", () => {
  const base = { purchasePrice: 300_000, monthlyRent: 2_500, interestRatePct: 7 };
  const g = sensitivity(base, "interestRatePct", [6, 7, 8], "purchasePrice", [280_000, 300_000], (e) => e.yearOne.monthlyCashFlow);
  assert.equal(g.cells.length, 2);
  assert.equal(g.cells[0].length, 3);
  near(g.cells[1][1], evaluate(base).yearOne.monthlyCashFlow, 1e-9);
  assert.ok(g.cells[0][0] > g.cells[0][2], "higher rates reduce cash flow");
});

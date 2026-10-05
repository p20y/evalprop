import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PROPERTY_TAX_RATE_PCT,
  ENGINE_VERSION,
  InputError,
  PROPERTY_TAX_REASSESSMENT,
  balanceAfter,
  breakEvenRent,
  defaultPropertyTax,
  evaluate,
  maxPriceForCashOnCash,
  monthlyPayment,
  sensitivity,
} from "./index.ts";
import type { Evaluation } from "./index.ts";

const near = (actual: number, expected: number, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${actual} ≈ ${expected}`);

const taxAssumption = (e: Evaluation) => {
  const a = e.assumptions.find((x) => x.field === "propertyTaxAnnual");
  assert.ok(a, "propertyTaxAnnual assumption present");
  return a;
};

function assertAllFinite(value: unknown, path = "evaluation"): void {
  if (typeof value === "number") assert.ok(Number.isFinite(value), `${path} is not finite (${value})`);
  else if (Array.isArray(value)) value.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) assertAllFinite(v, `${path}.${k}`);
}

// ---- state property-tax reassessment ----------------------------------------------------------------------

test("every state in the reassessment table documents its rule and is a two-letter code", () => {
  assert.ok("CA" in PROPERTY_TAX_REASSESSMENT, "California must be covered");
  for (const [code, rule] of Object.entries(PROPERTY_TAX_REASSESSMENT)) {
    assert.match(code, /^[A-Z]{2}$/);
    assert.ok(rule.source.length > 20, `${code} needs a source`);
    assert.ok(rule.ratePct > 0 && rule.ratePct < 5, `${code} rate looks wrong`);
  }
});

test("California defaults tax to 1.2% of the PURCHASE price and the assumption says why", () => {
  const e = evaluate({ purchasePrice: 800_000, monthlyRent: 4_000, state: "CA" });
  const tax = taxAssumption(e);
  near(tax.value, 9_600);
  assert.equal(tax.source, "assumed");
  assert.match(tax.note ?? "", /California/);
  assert.match(tax.note ?? "", /Prop 13/);
  assert.match(tax.note ?? "", /purchase price/);
  // The tax is carried into the metrics.
  near(e.yearOne.operatingExpenses.propertyTax, 9_600);
});

test("state code is case-insensitive", () => {
  const lower = evaluate({ purchasePrice: 500_000, monthlyRent: 3_000, state: "ca" });
  const upper = evaluate({ purchasePrice: 500_000, monthlyRent: 3_000, state: "CA" });
  assert.deepEqual(lower.assumptions, upper.assumptions);
});

test("tax follows the purchase price (offer), not the list price", () => {
  const e = evaluate({ offerPrice: 600_000, listPrice: 700_000, state: "CA", monthlyRent: 3_500 });
  near(taxAssumption(e).value, 7_200);
});

test("states without a reassessment rule keep the 1.1% default, with an explanatory note", () => {
  for (const input of [{ state: "TX" }, {}]) {
    const e = evaluate({ purchasePrice: 300_000, monthlyRent: 2_500, ...input });
    const tax = taxAssumption(e);
    near(tax.value, 3_300);
    assert.equal(tax.source, "assumed");
    assert.match(tax.note ?? "", /no state-specific reassessment/i);
  }
  assert.equal(DEFAULT_PROPERTY_TAX_RATE_PCT, 1.1);
});

test("user-supplied property tax always wins over the state default", () => {
  const e = evaluate({ purchasePrice: 800_000, monthlyRent: 4_000, state: "CA", propertyTaxAnnual: 5_000 });
  const tax = taxAssumption(e);
  assert.equal(tax.value, 5_000);
  assert.equal(tax.source, "provided");
  assert.equal(tax.note, undefined);
});

test("defaultPropertyTax is pure and exposes whether a state rule applied", () => {
  assert.equal(defaultPropertyTax(100_000, "CA").reassessed, true);
  assert.equal(defaultPropertyTax(100_000, "ZZ").reassessed, false);
  assert.equal(defaultPropertyTax(100_000).annual, 1_100);
});

test("state must be a two-letter code", () => {
  for (const state of ["California", "C", "1A", ""]) {
    assert.throws(
      () => evaluate({ purchasePrice: 300_000, monthlyRent: 2_500, state }),
      (err: unknown) => err instanceof InputError && err.field === "state",
    );
  }
});

// ---- offer price and list price ---------------------------------------------------------------------------

test("offerPrice is the purchase price", () => {
  const viaOffer = evaluate({ offerPrice: 250_000, monthlyRent: 2_200 });
  const viaPurchase = evaluate({ purchasePrice: 250_000, monthlyRent: 2_200 });
  assert.deepEqual(viaOffer, viaPurchase);
});

test("discount versus list is reported only when listPrice is supplied", () => {
  const e = evaluate({ offerPrice: 240_000, listPrice: 250_000, monthlyRent: 2_200 });
  assert.deepEqual(e.listPriceComparison, {
    listPrice: 250_000,
    purchasePrice: 240_000,
    discountAmount: 10_000,
    discountPct: 4,
  });
  assert.equal(evaluate({ offerPrice: 240_000, monthlyRent: 2_200 }).listPriceComparison, undefined);
});

test("an offer above list reports a negative discount", () => {
  const e = evaluate({ purchasePrice: 275_000, listPrice: 250_000, monthlyRent: 2_200 });
  assert.equal(e.listPriceComparison?.discountAmount, -25_000);
  near(e.listPriceComparison?.discountPct ?? 0, -10);
});

test("conflicting purchasePrice and offerPrice are rejected; equal values are fine", () => {
  assert.throws(() => evaluate({ purchasePrice: 200_000, offerPrice: 190_000, monthlyRent: 1_500 }), InputError);
  assert.doesNotThrow(() => evaluate({ purchasePrice: 200_000, offerPrice: 200_000, monthlyRent: 1_500 }));
});

test("a missing price is rejected naming the field", () => {
  assert.throws(
    () => evaluate({ monthlyRent: 1_500 } as unknown as Parameters<typeof evaluate>[0]),
    (err: unknown) => err instanceof InputError && err.field === "purchasePrice",
  );
});

test("targets and sensitivity accept offerPrice inputs and overrides", () => {
  const base = { offerPrice: 400_000, monthlyRent: 3_000 };
  const price = maxPriceForCashOnCash(base, 8);
  assert.ok(price !== null);
  near(evaluate({ purchasePrice: price, monthlyRent: 3_000 }).yearOne.cashOnCashPct, 8, 0.01);
  assert.ok(breakEvenRent(base) !== null);
  const g = sensitivity(base, "offerPrice", [380_000, 400_000], "interestRatePct", [6, 7], (e) => e.yearOne.monthlyCashFlow);
  near(g.cells[1]?.[1] ?? NaN, evaluate({ ...base, interestRatePct: 7 }).yearOne.monthlyCashFlow, 1e-9);
  assert.ok((g.cells[0]?.[0] ?? NaN) > (g.cells[0]?.[1] ?? NaN), "lower price improves cash flow");
});

// ---- invalid input and non-finite output ------------------------------------------------------------------

test("InputError names the offending field", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ purchasePrice: 0, monthlyRent: 1_000 }, "purchasePrice"],
    [{ purchasePrice: 1e5, monthlyRent: -5 }, "monthlyRent"],
    [{ purchasePrice: 1e5, monthlyRent: 1_000, downPaymentPct: 120 }, "downPaymentPct"],
    [{ purchasePrice: 1e5, monthlyRent: 1_000, interestRatePct: Number.NaN }, "interestRatePct"],
    [{ purchasePrice: 1e5, monthlyRent: 1_000, holdYears: 2.5 }, "holdYears"],
    [{ purchasePrice: 1e5, monthlyRent: 1_000, loanTermYears: 0 }, "loanTermYears"],
    [{ purchasePrice: 1e5, monthlyRent: 1_000, listPrice: -1 }, "listPrice"],
    [{ offerPrice: Infinity, monthlyRent: 1_000 }, "offerPrice"],
  ];
  for (const [input, field] of cases) {
    assert.throws(
      () => evaluate(input as unknown as Parameters<typeof evaluate>[0]),
      (err: unknown) => err instanceof InputError && err.field === field && err.message.includes(field),
      `expected InputError for ${field}`,
    );
  }
});

test("zero rent: grossRentMultiplier is null (never Infinity) and nothing is NaN or Infinity", () => {
  const e = evaluate({ purchasePrice: 200_000, monthlyRent: 0 });
  assert.equal(e.yearOne.grossRentMultiplier, null);
  assertAllFinite(e);
  assert.equal(JSON.parse(JSON.stringify(e)).yearOne.grossRentMultiplier, null);
});

test("extreme but valid inputs stay finite", () => {
  assertAllFinite(evaluate({ purchasePrice: 1, monthlyRent: 0, interestRatePct: 0, downPaymentPct: 0 }));
  assertAllFinite(evaluate({ purchasePrice: 5e8, monthlyRent: 1e6, interestRatePct: 30, holdYears: 50, loanTermYears: 50 }));
  assertAllFinite(evaluate({ purchasePrice: 200_000, monthlyRent: 1_500, downPaymentPct: 100, closingCostPct: 0 }));
});

test("grossRentMultiplier is a number when rent is positive", () => {
  near(evaluate({ purchasePrice: 240_000, monthlyRent: 2_000 }).yearOne.grossRentMultiplier ?? NaN, 10, 1e-9);
});

// ---- verdict checks ---------------------------------------------------------------------------------------

test("each verdict check returns display strings for actual and threshold", () => {
  const e = evaluate({ purchasePrice: 300_000, monthlyRent: 2_500 });
  assert.equal(e.checks.length, 4);
  for (const c of e.checks) {
    assert.equal(typeof c.name, "string");
    assert.equal(typeof c.passed, "boolean");
    assert.ok(c.actual.length > 0 && c.threshold.length > 0);
  }
  const byName = Object.fromEntries(e.checks.map((c) => [c.name, c]));
  assert.match(byName["Positive monthly cash flow"]?.actual ?? "", /^-?\$[\d,]+\/mo$/);
  assert.equal(byName["Positive monthly cash flow"]?.threshold, "> $0");
  assert.match(byName["Cash-on-cash return"]?.actual ?? "", /^-?\d+\.\d%$/);
  assert.equal(byName["Cap rate"]?.threshold, ">= 6%");
  assert.equal(byName["Debt service coverage"]?.threshold, ">= 1.25");
});

test("the DSCR check says 'no loan' for an all-cash deal and passes", () => {
  const e = evaluate({ purchasePrice: 200_000, monthlyRent: 2_000, downPaymentPct: 100 });
  const dscr = e.checks.find((c) => c.name === "Debt service coverage");
  assert.equal(dscr?.actual, "no loan");
  assert.equal(dscr?.passed, true);
});

// ---- amortization cross-check by iteration (ARCHITECTURE section 8, rule 4) -------------------------------

test("closed-form loan balance agrees with iterating the amortization schedule", () => {
  for (const [loan, rate, years] of [
    [240_000, 6.5, 30],
    [196_000, 6, 15],
    [187_500, 10.5, 30],
    [100_000, 0, 10],
  ] as const) {
    const pmt = monthlyPayment(loan, rate, years);
    const i = rate / 100 / 12;
    let balance: number = loan;
    for (let month = 1; month <= years * 12; month++) {
      balance = balance * (1 + i) - pmt;
      if (month % 12 === 0 || month === years * 12) {
        near(balanceAfter(loan, rate, years, month), month === years * 12 ? 0 : balance, 0.01);
      }
    }
    near(balance, 0, 0.01);
  }
});

test("ENGINE_VERSION is exported from the package root", () => {
  assert.equal(typeof ENGINE_VERSION, "string");
});

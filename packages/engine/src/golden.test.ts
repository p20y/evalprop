import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { evaluate } from "./index.ts";
import type { Evaluation, PropertyInput } from "./index.ts";

const goldenDir = new URL("../../../evals/golden/", import.meta.url);

interface GoldenCase {
  name: string;
  input: PropertyInput;
  expected: Record<string, number | string | null>;
}

const { cases } = JSON.parse(readFileSync(new URL("cases.json", goldenDir), "utf8")) as { cases: GoldenCase[] };

/** Map an engine evaluation onto the keys used in evals/golden/cases.json. */
function summarize(e: Evaluation): Record<string, number | string | null> {
  const y = e.yearOne;
  const last = e.hold.horizons.at(-1);
  const row5 = e.hold.years[4];
  const tax = e.assumptions.find((a) => a.field === "propertyTaxAnnual");
  const out: Record<string, number | string | null> = {
    verdict: e.verdict,
    propertyTaxAnnual: tax?.value ?? null,
    loanAmount: y.loanAmount,
    monthlyPrincipalAndInterest: y.monthlyPrincipalAndInterest,
    annualDebtService: y.annualDebtService,
    noi: y.noi,
    annualCashFlow: y.annualCashFlow,
    monthlyCashFlow: y.monthlyCashFlow,
    cashInvested: y.cashInvested,
    capRatePct: y.capRatePct,
    cashOnCashPct: y.cashOnCashPct,
    dscr: y.dscr,
    grossRentMultiplier: y.grossRentMultiplier,
    breakEvenOccupancyPct: y.breakEvenOccupancyPct,
    year1CashFlow: e.hold.years[0]?.cashFlow ?? null,
    loanBalanceAfterYear5: row5?.loanBalance ?? null,
    cashPaybackMonth: e.hold.cashPaybackMonth,
    breakEvenMonth: e.hold.breakEvenMonth,
    holdYears: e.hold.years.length,
    holdTotalProfit: last?.totalProfit ?? null,
    holdIrrPct: last?.irrPct ?? null,
  };
  if (e.listPriceComparison) {
    out.listDiscountAmount = e.listPriceComparison.discountAmount;
    out.listDiscountPct = e.listPriceComparison.discountPct;
  }
  return out;
}

test("golden cases: at least five, covering the required scenarios", () => {
  assert.ok(cases.length >= 5);
  const names = cases.map((c) => c.name).join(" | ");
  for (const needle of ["all-cash", "leveraged", "negative cash flow", "high rate", "15-year"]) {
    assert.ok(names.includes(needle), `missing golden case: ${needle}`);
  }
});

for (const c of cases) {
  test(`golden: ${c.name}`, () => {
    const actual = summarize(evaluate(c.input));
    for (const [key, want] of Object.entries(c.expected)) {
      const got = actual[key];
      if (typeof want === "number" && typeof got === "number") {
        const tol = /Pct$|^dscr$|^grossRentMultiplier$/.test(key) ? 1e-4 : 0.005;
        assert.ok(Math.abs(got - want) <= tol, `${c.name}: ${key} expected ${want}, engine gave ${got}`);
      } else {
        assert.equal(got, want, `${c.name}: ${key}`);
      }
    }
  });
}

test("golden cases are also recomputed by the standalone script, independent of the engine", () => {
  const script = fileURLToPath(new URL("recompute.mjs", goldenDir));
  // Throws (non-zero exit) if any expectation disagrees with the independent recomputation.
  const output = execFileSync(process.execPath, [script], { encoding: "utf8" });
  assert.match(output, /all match/);
});

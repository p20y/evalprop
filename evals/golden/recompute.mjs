#!/usr/bin/env node
// Independent recomputation of the golden cases in cases.json.
//
// This file deliberately does NOT import packages/engine. It re-derives every figure from the documented
// formulas using different code paths (closed-form amortisation, Newton/secant IRR, a plain month loop), so a bug
// in the engine cannot also hide here. Plain Node, no dependencies, no network.
//
//   node evals/golden/recompute.mjs           check cases.json expectations (exit 1 on any mismatch)
//   node evals/golden/recompute.mjs --print   print recomputed expectations as JSON (for authoring new cases)
//
// Conventions (ARCHITECTURE section 8): defaults 25% down, 6.75% rate, 30 years, 3% closing, 0 rehab, tax 1.1% of
// price (CA: 1.2%, FL: 1.5%), insurance 0.5% of price, 8% vacancy, 8% maintenance, 5% capex, 8% management,
// 3% rent/expense growth, 3% appreciation, 6% selling costs, 30-year hold. Maintenance and capex are % of
// potential rent; management is % of collected rent. Fixed costs (tax, insurance, HOA) grow with expense growth.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STATE_TAX_RATE = { CA: 0.012, FL: 0.015 };
const r2 = (n) => Math.round(n * 100) / 100;

function resolve(input) {
  const price = input.purchasePrice ?? input.offerPrice;
  const taxRate = STATE_TAX_RATE[(input.state ?? "").toUpperCase()] ?? 0.011;
  return {
    price,
    rent: input.monthlyRent,
    down: (input.downPaymentPct ?? 25) / 100,
    rate: (input.interestRatePct ?? 6.75) / 100,
    term: input.loanTermYears ?? 30,
    closing: (input.closingCostPct ?? 3) / 100,
    rehab: input.rehabCost ?? 0,
    tax: input.propertyTaxAnnual ?? r2(price * taxRate),
    ins: input.insuranceAnnual ?? r2(price * 0.005),
    hoa: input.hoaMonthly ?? 0,
    vac: (input.vacancyPct ?? 8) / 100,
    maint: (input.maintenancePct ?? 8) / 100,
    capex: (input.capexPct ?? 5) / 100,
    mgmt: (input.managementPct ?? 8) / 100,
    rentG: (input.rentGrowthPct ?? 3) / 100,
    expG: (input.expenseGrowthPct ?? 3) / 100,
    apprec: (input.appreciationPct ?? 3) / 100,
    sell: (input.sellingCostPct ?? 6) / 100,
    hold: input.holdYears ?? 30,
    listPrice: input.listPrice,
  };
}

/** Level monthly payment, written as the annuity formula P*i / (1-(1+i)^-n). */
function payment(loan, annualRate, years) {
  const n = years * 12;
  if (loan <= 0) return 0;
  if (annualRate === 0) return loan / n;
  const i = annualRate / 12;
  return (loan * i) / (1 - (1 + i) ** -n);
}

/** Balance after k payments, written as P*(1+i)^k - pmt*((1+i)^k-1)/i. */
function balance(loan, annualRate, years, k) {
  const n = years * 12;
  if (loan <= 0 || k >= n) return 0;
  if (annualRate === 0) return loan * (1 - k / n);
  const i = annualRate / 12;
  const g = (1 + i) ** k;
  return loan * g - payment(loan, annualRate, years) * ((g - 1) / i);
}

/** Annual IRR by Newton's method with a bisection fallback (the engine uses bisection only). */
function irr(flows) {
  const npv = (x) => flows.reduce((s, cf, t) => s + cf / (1 + x) ** t, 0);
  const d = (x) => flows.reduce((s, cf, t) => s - (t * cf) / (1 + x) ** (t + 1), 0);
  let x = 0.1;
  for (let k = 0; k < 100; k++) {
    const f = npv(x);
    if (Math.abs(f) < 1e-9) return x;
    const slope = d(x);
    if (slope === 0) break;
    const nx = x - f / slope;
    if (!Number.isFinite(nx) || nx <= -0.99) break;
    x = nx;
  }
  let lo = -0.99;
  let hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let k = 0; k < 300; k++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function recompute(input) {
  const c = resolve(input);
  const grossRent = c.rent * 12;
  const collected = grossRent * (1 - c.vac);
  const fixedCosts = c.tax + c.ins + c.hoa * 12;
  const opex = fixedCosts + grossRent * (c.maint + c.capex) + collected * c.mgmt;
  const noi = collected - opex;

  const loan = c.price * (1 - c.down);
  const pmt = payment(loan, c.rate, c.term);
  const debt = pmt * 12;
  const cashFlow = noi - debt;
  const invested = c.price * c.down + c.price * c.closing + c.rehab;

  // Break-even occupancy: collected rent per unit of occupancy is grossRent*(1-mgmt).
  const perOcc = grossRent * (1 - c.mgmt);
  const beOcc = perOcc > 0 ? Math.min(999, ((fixedCosts + grossRent * (c.maint + c.capex) + debt) / perOcc) * 100) : 999;

  // Month-by-month hold simulation.
  let cum = 0;
  let payback = null;
  let breakEven = null;
  let yearsRows = [];
  const flows = [-invested];
  for (let y = 0; y < c.hold; y++) {
    const rentY = grossRent * (1 + c.rentG) ** y;
    const collectedY = rentY * (1 - c.vac);
    const opexY = fixedCosts * (1 + c.expG) ** y + rentY * (c.maint + c.capex) + collectedY * c.mgmt;
    const noiY = collectedY - opexY;
    let cfY = 0;
    for (let m = y * 12 + 1; m <= (y + 1) * 12; m++) {
      const dsvc = m <= c.term * 12 ? pmt : 0;
      const cf = noiY / 12 - dsvc;
      cfY += cf;
      cum += cf;
      const value = c.price * (1 + c.apprec) ** (m / 12);
      const net = value * (1 - c.sell) - balance(loan, c.rate, c.term, m);
      if (payback === null && cum >= invested) payback = m;
      if (breakEven === null && cum + net - invested >= 0) breakEven = m;
    }
    const endValue = c.price * (1 + c.apprec) ** (y + 1);
    const endBal = balance(loan, c.rate, c.term, (y + 1) * 12);
    const endNet = endValue * (1 - c.sell) - endBal;
    yearsRows.push({ cfY, cum, endBal, endNet });
    flows.push(cfY);
  }
  const last = yearsRows[yearsRows.length - 1];
  flows[flows.length - 1] += last.endNet;
  const holdProfit = last.cum + last.endNet - invested;
  const holdIrr = irr(flows);

  const out = {
    verdict: null,
    propertyTaxAnnual: round(c.tax),
    loanAmount: round(loan),
    monthlyPrincipalAndInterest: round(pmt),
    annualDebtService: round(debt),
    noi: round(noi),
    annualCashFlow: round(cashFlow),
    monthlyCashFlow: round(cashFlow / 12),
    cashInvested: round(invested),
    capRatePct: round((noi / c.price) * 100),
    cashOnCashPct: invested > 0 ? round((cashFlow / invested) * 100) : 0,
    dscr: debt > 0 ? round(noi / debt) : null,
    grossRentMultiplier: grossRent > 0 ? round(c.price / grossRent) : null,
    breakEvenOccupancyPct: round(beOcc),
    year1CashFlow: round(yearsRows[0].cfY),
    loanBalanceAfterYear5: c.hold >= 5 ? round(yearsRows[4].endBal) : null,
    cashPaybackMonth: payback,
    breakEvenMonth: breakEven,
    holdYears: c.hold,
    holdTotalProfit: round(holdProfit),
    holdIrrPct: holdIrr === null ? null : round(holdIrr * 100),
  };

  // Verdict: count of four checks passed (cash flow > 0, CoC >= 8, cap >= 6, DSCR >= 1.25 or no loan).
  const passed =
    (cashFlow / 12 > 0) + ((invested > 0 ? (cashFlow / invested) * 100 : 0) >= 8) + ((noi / c.price) * 100 >= 6) + (debt === 0 || noi / debt >= 1.25);
  out.verdict = ["weak", "weak", "marginal", "good", "strong"][passed];

  if (c.listPrice !== undefined) {
    out.listDiscountAmount = round(c.listPrice - c.price);
    out.listDiscountPct = round(((c.listPrice - c.price) / c.listPrice) * 100);
  }
  return out;
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

/** Compare recomputed values against expectations: dollars to half a cent, percentages and ratios to 1e-4. */
export function compare(expected, actual) {
  const problems = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = actual[key];
    if (typeof want === "number" && typeof got === "number") {
      const ratio = /Pct$|^dscr$|^grossRentMultiplier$/.test(key);
      if (Math.abs(got - want) > (ratio ? 1e-4 : 0.005)) problems.push(`${key}: expected ${want}, got ${got}`);
    } else if (want !== got) {
      problems.push(`${key}: expected ${want}, got ${got}`);
    }
  }
  return problems;
}

export function loadCases() {
  const file = fileURLToPath(new URL("./cases.json", import.meta.url));
  return JSON.parse(readFileSync(file, "utf8")).cases;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cases = loadCases();
  if (process.argv.includes("--print")) {
    console.log(JSON.stringify(cases.map((c) => ({ name: c.name, expected: recompute(c.input) })), null, 2));
  } else {
    let failures = 0;
    for (const c of cases) {
      const problems = compare(c.expected, recompute(c.input));
      console.log(`${problems.length ? "FAIL" : "ok  "} ${c.name}`);
      for (const p of problems) console.log(`       ${p}`);
      failures += problems.length;
    }
    if (failures) {
      console.error(`${failures} mismatch(es)`);
      process.exit(1);
    }
    console.log(`${cases.length} golden cases recomputed independently: all match`);
  }
}

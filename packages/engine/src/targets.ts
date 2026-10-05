import { normalizeInput } from "./defaults.ts";
import { evaluate } from "./evaluate.ts";
import type { PropertyInput } from "./types.ts";

const monthlyCashFlow = (input: PropertyInput) => evaluate(input).yearOne.monthlyCashFlow;

/**
 * Monthly rent at which year-one cash flow is exactly zero. Cash flow is linear in rent
 * (every rent-driven cost is a percentage), so two evaluations are enough.
 * Returns null if extra rent never improves cash flow (e.g. costs eat 100% of each dollar).
 */
export function breakEvenRent(rawInput: PropertyInput): number | null {
  const input = normalizeInput(rawInput);
  const at = (rent: number) => monthlyCashFlow({ ...input, monthlyRent: rent });
  const f0 = at(0);
  const f1 = at(1000);
  const slope = (f1 - f0) / 1000;
  if (slope <= 0) return null;
  return Math.max(0, -f0 / slope);
}

/**
 * Highest purchase price that still reaches `targetPct` year-one cash-on-cash, by bisection.
 * Returns null if even a very low price cannot reach the target.
 */
export function maxPriceForCashOnCash(rawInput: PropertyInput, targetPct: number): number | null {
  const input = normalizeInput(rawInput);
  const coc = (price: number) => evaluate({ ...input, purchasePrice: price }).yearOne.cashOnCashPct;
  let lo = 1_000;
  let hi = Math.max(input.purchasePrice * 3, 1_000_000);
  if (coc(lo) < targetPct) return null;
  if (coc(hi) >= targetPct) return hi;
  for (let n = 0; n < 60; n++) {
    const mid = (lo + hi) / 2;
    if (coc(mid) >= targetPct) lo = mid;
    else hi = mid;
  }
  return lo;
}

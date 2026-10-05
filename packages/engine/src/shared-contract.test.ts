import assert from "node:assert/strict";
import { test } from "node:test";
import { EvaluationSchema } from "@evalprop/shared";
import { evaluate } from "./index.ts";
import { REFERENCE_DEALS } from "./reference-deals.ts";

test("engine output round-trips through EvaluationSchema unchanged (nothing is stripped)", () => {
  const inputs = [
    ...REFERENCE_DEALS.map((d) => d.input),
    { purchasePrice: 200_000, monthlyRent: 0 }, // grossRentMultiplier null
    { purchasePrice: 200_000, monthlyRent: 2_000, downPaymentPct: 100 }, // dscr null
    { purchasePrice: 215_000, listPrice: 239_000, monthlyRent: 2_250 }, // listPriceComparison
    { purchasePrice: 500_000, monthlyRent: 3_000, state: "CA" }, // assumption note
  ];
  for (const input of inputs) {
    const e = evaluate(input);
    const parsed = EvaluationSchema.parse(e);
    assert.deepEqual(parsed, e);
  }
});

test("zero rent serialises grossRentMultiplier as null and still parses", () => {
  const e = evaluate({ purchasePrice: 200_000, monthlyRent: 0 });
  const roundTripped = JSON.parse(JSON.stringify(e));
  assert.equal(roundTripped.yearOne.grossRentMultiplier, null);
  assert.ok(EvaluationSchema.safeParse(roundTripped).success);
});

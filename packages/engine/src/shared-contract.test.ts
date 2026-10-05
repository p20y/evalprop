import assert from "node:assert/strict";
import { test } from "node:test";
import { EvaluationSchema } from "@evalprop/shared";
import { evaluate } from "./index.ts";
import { REFERENCE_DEALS } from "./reference-deals.ts";
import type { Evaluation } from "./index.ts";

/** What the shared schema does not describe yet (zod strips unknown keys on parse). */
function withoutKnownExtras(e: Evaluation): unknown {
  const copy = structuredClone(e) as Partial<Evaluation>;
  delete copy.listPriceComparison;
  return { ...copy, assumptions: e.assumptions.map(({ field, value, source }) => ({ field, value, source })) };
}

test("engine output parses against EvaluationSchema; only the known optional extras are not in the schema", () => {
  const inputs = [
    ...REFERENCE_DEALS.map((d) => d.input),
    { purchasePrice: 200_000, monthlyRent: 0 }, // grossRentMultiplier null
    { purchasePrice: 200_000, monthlyRent: 2_000, downPaymentPct: 100 }, // dscr null
  ];
  for (const input of inputs) {
    const e = evaluate(input);
    const parsed = EvaluationSchema.parse(e);
    assert.deepEqual(parsed, withoutKnownExtras(e));
  }
});

test("zero rent serialises grossRentMultiplier as null and still parses", () => {
  const e = evaluate({ purchasePrice: 200_000, monthlyRent: 0 });
  const roundTripped = JSON.parse(JSON.stringify(e));
  assert.equal(roundTripped.yearOne.grossRentMultiplier, null);
  assert.ok(EvaluationSchema.safeParse(roundTripped).success);
});

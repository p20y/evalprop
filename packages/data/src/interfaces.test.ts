import assert from "node:assert/strict";
import { test } from "node:test";
import type { PropertyProvider, ProviderResult } from "./index.ts";
import { sampleAnalysis, sampleProvenance } from "@evalprop/shared";

test("a provider can return data with provenance or a typed failure", async () => {
  const ok: PropertyProvider = {
    resolve: async (): Promise<ProviderResult<typeof sampleAnalysis.property>> => ({
      ok: true,
      data: sampleAnalysis.property,
      provenance: sampleProvenance,
    }),
  };
  const failing: PropertyProvider = {
    resolve: async () => ({ ok: false, code: "AMBIGUOUS", message: "two matches", candidates: ["a", "b"] }),
  };
  const good = await ok.resolve("x");
  assert.ok(good.ok && good.provenance.provider === "fixture");
  const bad = await failing.resolve("x");
  assert.ok(!bad.ok && bad.code === "AMBIGUOUS" && bad.candidates.length === 2);
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addressKey, canonicalJson, normalizeAnalyze, normalizeWhatIf, standardizeAddress } from "./normalize.ts";

describe("standardizeAddress", () => {
  test("collapses whitespace, fixes comma spacing, drops trailing punctuation, keeps case", () => {
    assert.equal(standardizeAddress("  123   Main St ,Springfield ,  IL   62704. "), "123 Main St, Springfield, IL 62704");
    assert.equal(standardizeAddress("123 Main St,\nSpringfield,IL 62704,"), "123 Main St, Springfield, IL 62704");
  });

  test("addressKey ignores case and punctuation", () => {
    assert.equal(addressKey("100 Sample Tower Ln, Unit 4B!"), addressKey("100 SAMPLE TOWER LN UNIT 4b"));
  });
});

describe("canonicalJson", () => {
  test("key order and undefined do not matter", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: undefined } }), canonicalJson({ a: { d: 2 }, b: 1 }));
  });
});

describe("normalizeAnalyze", () => {
  test("applies the default target and standardizes the address", () => {
    const r = normalizeAnalyze({ address: "  1 A St ,  B , TX 78701 " });
    assert.ok(r.ok);
    assert.equal(r.value.address, "1 A St, B, TX 78701");
    assert.equal(r.value.input.targetCashOnCashPct, 8);
  });

  test("the hash ignores key order, address case and spacing, but not content", () => {
    const a = normalizeAnalyze({ address: "1 A St, B, TX 78701", listing: { price: 100000, beds: 3 }, assumptions: { vacancyPct: 5 } });
    const b = normalizeAnalyze({ assumptions: { vacancyPct: 5 }, listing: { beds: 3, price: 100000 }, address: "1 a st,  b,tx 78701." });
    const c = normalizeAnalyze({ address: "1 A St, B, TX 78701", listing: { price: 100001, beds: 3 }, assumptions: { vacancyPct: 5 } });
    const d = normalizeAnalyze({ address: "1 A St, B, TX 78701", listing: { price: 100000, beds: 3 }, assumptions: { vacancyPct: 5 }, targetCashOnCashPct: 10 });
    assert.ok(a.ok && b.ok && c.ok && d.ok);
    assert.equal(a.value.inputHash, b.value.inputHash);
    assert.notEqual(a.value.inputHash, c.value.inputHash);
    assert.notEqual(a.value.inputHash, d.value.inputHash);
    assert.match(a.value.inputHash, /^[0-9a-f]{64}$/);
  });

  test("a missing or blank address is NEEDS_ADDRESS; a link alone explains why", () => {
    for (const raw of [undefined, {}, { address: "" }, { address: "   " }, { address: ",," }]) {
      const r = normalizeAnalyze(raw);
      assert.ok(!r.ok);
      assert.equal(r.error.code, "NEEDS_ADDRESS");
    }
    const withUrl = normalizeAnalyze({ listing: { url: "https://example.test/listing/1" } });
    assert.ok(!withUrl.ok);
    assert.equal(withUrl.error.code, "NEEDS_ADDRESS");
    assert.match(withUrl.error.message, /never read|not enough/i);
  });

  test("an invalid assumption names the field", () => {
    const r = normalizeAnalyze({ address: "1 A St, B, TX 78701", assumptions: { downPaymentPct: 140 } });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "INVALID_ASSUMPTION");
    assert.equal(r.error.field, "downPaymentPct");
    const t = normalizeAnalyze({ address: "1 A St, B, TX 78701", assumptions: { offerPrice: -5 } });
    assert.ok(!t.ok);
    assert.equal(t.error.field, "offerPrice");
    const l = normalizeAnalyze({ address: "1 A St, B, TX 78701", listing: { beds: -1 } });
    assert.ok(!l.ok);
    assert.equal(l.error.field, "listing.beds");
  });
});

describe("normalizeWhatIf", () => {
  test("requires an analysis id and at least one override, and hashes both", () => {
    assert.ok(!normalizeWhatIf({ overrides: { vacancyPct: 5 } }).ok);
    const empty = normalizeWhatIf({ analysisId: "an_1", overrides: {} });
    assert.ok(!empty.ok);
    assert.equal(empty.error.code, "INVALID_ASSUMPTION");
    const bad = normalizeWhatIf({ analysisId: "an_1", overrides: { interestRatePct: 99 } });
    assert.ok(!bad.ok);
    assert.equal(bad.error.field, "interestRatePct");
    const a = normalizeWhatIf({ analysisId: "an_1", overrides: { vacancyPct: 5, offerPrice: 200000 } });
    const b = normalizeWhatIf({ analysisId: "an_1", overrides: { offerPrice: 200000, vacancyPct: 5 } });
    const c = normalizeWhatIf({ analysisId: "an_2", overrides: { offerPrice: 200000, vacancyPct: 5 } });
    assert.ok(a.ok && b.ok && c.ok);
    assert.equal(a.value.inputHash, b.value.inputHash);
    assert.notEqual(a.value.inputHash, c.value.inputHash);
  });
});

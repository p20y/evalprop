import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Analysis, CardModel, ComparisonRow } from "@evalprop/shared";
import { buildCard, buildSummary, buildWhatIfSummary } from "./card.ts";
import { pct, usd } from "./format.ts";
import { ADDR, assertOk, harness, variantScenario } from "./test-helpers.ts";

/**
 * "Every number is generated from the saved analysis": every number in the summary text must be equal
 * (to the precision it is displayed at) to a number in the structured data, and the headline numbers in
 * the structured data must all appear in the text.
 */

interface Token {
  value: number;
  /** Allowed rounding error given how the token was displayed. */
  tolerance: number;
  text: string;
}

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(/(-?)(\$?)(\d[\d,]*(?:\.\d+)?)(%?)/g)) {
    const [raw, neg, dollar, digits, percent] = m;
    const decimals = digits?.includes(".") ? (digits.split(".")[1] as string).length : 0;
    const value = Number((digits as string).replace(/,/g, "")) * (neg === "-" ? -1 : 1);
    const tolerance = dollar === "$" ? 0.5 : percent === "%" ? 0.5 * Math.pow(10, -decimals) : 0.5 * Math.pow(10, -decimals);
    out.push({ value, tolerance, text: raw as string });
  }
  return out;
}

/** Every number that appears anywhere in the saved analysis data the summary may draw from. */
function structuredNumbers(analysis: Analysis, card: CardModel, extra: Array<number | null> = []): number[] {
  const pool: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) pool.push(v);
    else if (typeof v === "string") for (const t of tokens(v)) pool.push(t.value);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
  };
  const { analysisId: _id, address: _address, reportUrl: _url, ...cardData } = card;
  walk(cardData);
  walk(analysis.assumptions.map((a) => a.value));
  walk([analysis.maxOfferPrice, analysis.breakEvenRent, analysis.targetCashOnCashPct, analysis.evaluation.listPriceComparison]);
  walk(extra);
  return pool;
}

function assertNumbersTraceable(text: string, card: CardModel, pool: number[]) {
  const withoutAddress = text.split(card.address).join("");
  for (const t of tokens(withoutAddress)) {
    const hit = pool.some((p) => Math.abs(Math.abs(p) - Math.abs(t.value)) <= t.tolerance + 1e-9);
    assert.ok(hit, `number "${t.text}" in the summary matches nothing in the structured data.\n${text}`);
  }
}

function assertHeadlinesPresent(text: string, card: CardModel) {
  const have = tokens(text.split(card.address).join(""));
  const present = (n: number, tolerance: number) => have.some((t) => Math.abs(Math.abs(t.value) - Math.abs(n)) <= Math.max(t.tolerance, tolerance) + 1e-9);
  assert.ok(present(card.analyzedPrice, 0.5), "analyzed price");
  assert.ok(present(card.monthlyRent, 0.5), "rent");
  assert.ok(present(card.metrics.monthlyCashFlow, 0.5), "cash flow");
  assert.ok(present(card.metrics.cashOnCashPct, 0.05), "cash-on-cash");
  assert.ok(present(card.metrics.capRatePct, 0.05), "cap rate");
  if (card.metrics.dscr !== null) assert.ok(present(card.metrics.dscr, 0.005), "dscr");
  if (card.maxOffer !== null) assert.ok(present(card.maxOffer.price, 0.5), "max offer");
  if (card.breakEvenMonth !== null) assert.ok(present(card.breakEvenMonth, 0), "break-even month");
  if (card.irr10Pct !== null) assert.ok(present(card.irr10Pct, 0.05), "ten-year IRR");
  assert.ok(text.includes(card.verdictLabel), "verdict");
}

const caNoTax = variantScenario("suburban-house", "ca-sum", "1 Reassess Way, Sacramento, CA 95814", "CA", (f) => {
  delete f["taxesAnnual"];
});

describe("analysis summary: every number comes from the saved analysis", () => {
  const cases: Array<{ name: string; address: string; input?: Record<string, unknown>; scenarios?: Parameters<typeof harness>[0] }> = [
    { name: "condo, all defaults", address: ADDR.condo },
    { name: "house at a discount to list", address: ADDR.house, input: { assumptions: { offerPrice: 300000 } } },
    { name: "house above list with provided terms", address: ADDR.house, input: { assumptions: { offerPrice: 360000, interestRatePct: 6.25, downPaymentPct: 20, monthlyRent: 2600 } } },
    { name: "cash flow positive, with room to the max offer", address: ADDR.house, input: { assumptions: { offerPrice: 150000, monthlyRent: 2600 } } },
    { name: "max offer unreachable", address: ADDR.condo, input: { assumptions: { monthlyRent: 100 } } },
    { name: "no loan (100% down)", address: ADDR.house, input: { assumptions: { downPaymentPct: 100 } } },
    { name: "hold shorter than ten years (no ten-year IRR)", address: ADDR.house, input: { assumptions: { holdYears: 7 } } },
    { name: "degraded data adds caveats", address: ADDR.condo, input: { assumptions: { monthlyRent: 1700 } }, scenarios: { behavior: ({ endpoint }) => (endpoint === "sales.candidates" ? "error" : "ok") } },
    { name: "state with reassessment", address: caNoTax.addresses[0] as string, scenarios: { scenarios: [caNoTax] } },
  ];

  for (const c of cases) {
    test(c.name, async () => {
      const h = harness(c.scenarios);
      const r = await h.analyze({ address: c.address, ...(c.input ?? {}) });
      assertOk(r);
      // Rebuilding card and summary from the saved analysis alone gives the same text: nothing else feeds it.
      const stored = await h.repo.get(r.analysis.id, "user_a");
      assert.ok(stored);
      const card = buildCard(stored, r.card.reportUrl);
      assert.deepEqual(card, r.card);
      assert.equal(buildSummary(stored, card), r.summary);
      assertNumbersTraceable(r.summary, card, structuredNumbers(stored, card));
      assertHeadlinesPresent(r.summary, card);
    });
  }

  test("the summary reads in plain language: verdict, the lever that matters, any data caveat, a disclaimer", async () => {
    const h = harness({ behavior: ({ endpoint }) => (endpoint === "sales.candidates" ? "error" : "ok") });
    const r = await h.analyze({ address: ADDR.condo, assumptions: { monthlyRent: 1700 } });
    assertOk(r);
    assert.match(r.summary, /Verdict for .+: Weak deal\./);
    assert.match(r.summary, /most to pay is \$/);
    assert.match(r.summary, /Monthly rent would need to reach about \$/);
    assert.match(r.summary, /Data caveats: Sale comparables/);
    assert.match(r.summary, /not investment, tax, or legal advice/);
  });

  test("the card's rent source and numbers are the saved analysis's", async () => {
    const h = harness();
    const r = await h.analyze({ address: ADDR.house, listing: { monthlyRentActual: 2300 } });
    assertOk(r);
    assert.equal(r.card.rentSource, "listing");
    assert.match(r.summary, /the actual rent from the listing/);
    assert.equal(r.card.monthlyRent, 2300);
  });

  test("the checker has teeth: a doctored number is caught", async () => {
    const h = harness();
    const r = await h.analyze({ address: ADDR.house });
    assertOk(r);
    const pool = structuredNumbers(r.analysis, r.card);
    const doctored = r.summary.replace(usd(r.card.metrics.monthlyCashFlow), usd(r.card.metrics.monthlyCashFlow + 25));
    assert.notEqual(doctored, r.summary);
    assert.throws(() => assertNumbersTraceable(doctored, r.card, pool));
    assert.throws(() => assertHeadlinesPresent(doctored, r.card));
  });

  test("formatters: signed whole dollars, trimmed percentages", () => {
    assert.equal(usd(-1168.18), "-$1,168");
    assert.equal(usd(-0.2), "$0");
    assert.equal(usd(289000), "$289,000");
    assert.equal(pct(8), "8%");
    assert.equal(pct(7.25), "7.3%");
    assert.equal(pct(-0.02), "0%");
    assert.equal(pct(100), "100%");
  });
});

describe("what-if summary: every number comes from the two saved analyses and the rows", () => {
  test("changed assumptions, before/after, new max offer", async () => {
    const h = harness();
    const base = await h.analyze({ address: ADDR.house });
    assertOk(base);
    const next = await h.whatIf({ analysisId: base.analysis.id, overrides: { offerPrice: 320000, interestRatePct: 6.25, holdYears: 15 } });
    assertOk(next);
    const rowNumbers = next.rows.flatMap((r: ComparisonRow) => [r.before, r.after]);
    const pool = [...structuredNumbers(next.analysis, next.card, rowNumbers), ...structuredNumbers(base.analysis, next.card)];
    assertNumbersTraceable(next.summary, next.card, pool);
    assert.match(next.summary, /Changed: offer price to \$320,000, interest rate to 6\.25%, hold period to 15 years\./);
    assert.match(next.summary, /Monthly cash flow goes from -?\$[\d,]+ to -?\$[\d,]+/);
    for (const row of next.rows) {
      for (const v of [row.before, row.after]) {
        if (v === null) continue;
        const shown = tokens(next.summary).some((t) => Math.abs(Math.abs(t.value) - Math.abs(v)) <= Math.max(t.tolerance, row.metric === "dscr" ? 0.005 : row.metric === "breakEvenMonth" ? 0 : 0.05) + 1e-9);
        assert.ok(shown, `${row.metric} ${v} is in the text`);
      }
    }
  });

  test("a what-if where nothing changed says so", async () => {
    const h = harness();
    const base = await h.analyze({ address: ADDR.house, assumptions: { interestRatePct: 7 } });
    assertOk(base);
    const next = await h.whatIf({ analysisId: base.analysis.id, overrides: { interestRatePct: 7 } });
    assertOk(next);
    assert.match(next.summary, /None of the overrides changed a value/);
    assert.equal(buildWhatIfSummary(base.analysis, next.analysis, next.rows, next.card), next.summary);
  });
});

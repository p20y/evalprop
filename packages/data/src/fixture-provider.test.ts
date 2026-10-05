import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { PropertyFactsSchema, RentListingSchema, SaleListingSchema, SchoolSchema } from "@evalprop/shared";
import { FIXTURES_DIR, FixtureProvider, loadFixtureScenarios, type FixtureScenario } from "./fixture-provider.ts";

describe("fixture files", () => {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));

  test("there is a fixture for each required scenario", () => {
    assert.deepEqual(files.sort(), [
      "ambiguous-main-st.json",
      "condo-multiunit.json",
      "no-data.json",
      "rural-sparse.json",
      "suburban-house.json",
    ]);
  });

  for (const file of files) {
    test(`${file} validates against the shared zod schemas`, () => {
      const s = JSON.parse(readFileSync(`${FIXTURES_DIR}/${file}`, "utf8")) as FixtureScenario;
      assert.ok(s.id && s.description && s.addresses.length > 0 && !Number.isNaN(Date.parse(s.recordedAt)));
      if ("facts" in s.property) PropertyFactsSchema.parse(s.property.facts);
      else assert.ok(s.property.failure.code);
      RentListingSchema.array().parse(s.rent.candidates);
      SaleListingSchema.array().parse(s.sales);
      SchoolSchema.array().parse(s.schools.assigned);
      SchoolSchema.array().parse(s.schools.nearby);
      const ids = [...s.rent.candidates, ...s.sales].map((c) => c.id);
      assert.equal(new Set(ids).size, ids.length, "ids are unique");
    });

    test(`${file} uses only clearly fictional data`, () => {
      const text = readFileSync(`${FIXTURES_DIR}/${file}`, "utf8");
      assert.ok(!/redfin|zillow|realtor\.com/i.test(text), "no listing-site content in fixtures");
    });
  }

  test("loadFixtureScenarios loads and validates all of them", () => {
    assert.equal(loadFixtureScenarios().length, 5);
  });
});

describe("FixtureProvider", () => {
  const fx = new FixtureProvider();
  const condoAddress = "100 Sample Tower Ln Unit 4B, Testville, TX 78701";

  async function subjectFor(address: string) {
    const r = await fx.resolve(address);
    assert.ok(r.ok, `resolves ${address}`);
    return { facts: r.data, subject: { latitude: r.data.latitude!, longitude: r.data.longitude!, beds: r.data.beds, sqft: r.data.sqft } };
  }

  test("resolves an address regardless of case and punctuation, with fixture provenance", async () => {
    const alias = await fx.resolve("100 SAMPLE TOWER LN #4B, testville tx");
    assert.ok(alias.ok);
    const guess = await fx.resolve("100 Sample Tower Ln Unit 5B, Testville, TX 78701");
    assert.equal(guess.ok, false, "an unknown unit is not guessed at");
    const ok = await fx.resolve("100 sample tower ln unit 4b testville tx 78701");
    assert.ok(ok.ok);
    assert.equal(ok.provenance.provider, "fixture");
    assert.equal(ok.provenance.cached, false);
    assert.equal(ok.provenance.fetchedAt, "2026-09-20T15:04:00.000Z");
    assert.equal(ok.data.unitsInBuilding, 120);
  });

  test("condo in a multi-unit building: same-building comps are all 1-bed, plus a few other sizes further out", async () => {
    const { subject } = await subjectFor(condoAddress);
    const rent = await fx.rentCandidates(subject, 2);
    assert.ok(rent.ok);
    const same = rent.data.filter((c) => c.sameBuilding);
    assert.ok(same.length >= 5);
    assert.ok(same.every((c) => c.beds === 1 && c.distanceMiles === 0));
    assert.ok(rent.data.some((c) => c.beds !== 1), "includes different-size listings to test relaxation");
    assert.ok(rent.data.some((c) => c.kind === "leased") && rent.data.some((c) => c.kind === "asking"));
    const est = await fx.rentEstimate(subject);
    assert.ok(est.ok && est.data.monthlyRent === 1685);
  });

  test("radius filters like a real search", async () => {
    const { subject } = await subjectFor(condoAddress);
    const half = await fx.rentCandidates(subject, 0.5);
    const two = await fx.rentCandidates(subject, 2);
    assert.ok(half.ok && two.ok);
    assert.ok(half.data.length < two.data.length);
    assert.ok(half.data.every((c) => c.distanceMiles <= 0.5));
    const sales = await fx.saleCandidates(subject, 0.5);
    assert.ok(sales.ok && sales.data.every((c) => c.distanceMiles <= 0.5) && sales.data.length > 0);
  });

  test("suburban house has a healthy comp set within 1 mile", async () => {
    const { facts, subject } = await subjectFor("2415 Maple Test Dr, Sampleton, OH 43017");
    assert.equal(facts.propertyType, "single_family");
    const rent = await fx.rentCandidates(subject, 1);
    assert.ok(rent.ok && rent.data.filter((c) => c.beds === 3 && c.baths !== undefined && c.baths >= 2).length >= 5);
    const assigned = await fx.assignedSchools(subject);
    assert.ok(assigned.ok && assigned.data.map((s) => s.level).join() === "elementary,middle,high");
  });

  test("rural address is sparse: nothing inside the first rungs, no estimate, 'unknown' school assignment", async () => {
    const { subject } = await subjectFor("88 County Road 12, Quietfield, MT 59999");
    const near = await fx.rentCandidates(subject, 2);
    assert.ok(near.ok && near.data.length === 0);
    const far = await fx.rentCandidates(subject, 15);
    assert.ok(far.ok && far.data.length === 2);
    const est = await fx.rentEstimate(subject);
    assert.ok(!est.ok && est.code === "NOT_FOUND");
    assert.equal(far.ok && far.provenance.confidence, "low");
    const schools = await fx.nearbySchools(subject, 10);
    assert.ok(schools.ok && schools.data[0]?.assigned === "unknown");
  });

  test("ambiguous address returns AMBIGUOUS with candidates", async () => {
    const r = await fx.resolve("500 Main St");
    assert.ok(!r.ok && r.code === "AMBIGUOUS");
    assert.ok(r.code === "AMBIGUOUS" && r.candidates.length >= 2);
  });

  test("no-data address resolves with bare facts and every other lookup is empty or NOT_FOUND", async () => {
    const { facts, subject } = await subjectFor("7 Placeholder Way, Emptyburg, NE 68001");
    assert.equal(facts.beds, undefined);
    assert.equal(facts.sqft, undefined);
    const rent = await fx.rentCandidates(subject, 50);
    const sales = await fx.saleCandidates(subject, 50);
    const schools = await fx.nearbySchools(subject, 50);
    assert.ok(rent.ok && rent.data.length === 0 && sales.ok && sales.data.length === 0 && schools.ok && schools.data.length === 0);
    const est = await fx.rentEstimate(subject);
    assert.ok(!est.ok && est.code === "NOT_FOUND");
  });

  test("unknown address or location is NOT_FOUND, never an exception", async () => {
    const r = await fx.resolve("1 Nonexistent Rd");
    assert.ok(!r.ok && r.code === "NOT_FOUND");
    const rent = await fx.rentCandidates({ latitude: 0, longitude: 0 }, 1);
    assert.ok(!rent.ok && rent.code === "NOT_FOUND");
  });

  test("returned data is a copy: mutating it does not alter later responses", async () => {
    const { subject } = await subjectFor(condoAddress);
    const a = await fx.rentCandidates(subject, 2);
    assert.ok(a.ok);
    a.data.length = 0;
    const b = await fx.rentCandidates(subject, 2);
    assert.ok(b.ok && b.data.length > 0);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { failFirst, FakeProvider } from "./fake-provider.ts";
import { FixtureProvider } from "./fixture-provider.ts";

const subject = { latitude: 30.26721, longitude: -97.74312 };

describe("FakeProvider", () => {
  test("ok returns canned data across all four interfaces", async () => {
    const f = new FakeProvider();
    assert.ok((await f.resolve("x")).ok);
    assert.ok((await f.rentCandidates(subject, 1)).ok);
    assert.ok((await f.rentEstimate(subject)).ok);
    assert.ok((await f.saleCandidates(subject, 1)).ok);
    assert.ok((await f.assignedSchools(subject)).ok);
    assert.ok((await f.nearbySchools(subject, 1)).ok);
    assert.equal(f.callCount, 6);
  });

  test("typed-failure behaviors", async () => {
    const codes = { timeout: "TIMEOUT", error: "ERROR", "rate-limited": "RATE_LIMITED", "not-found": "NOT_FOUND" } as const;
    for (const [behavior, code] of Object.entries(codes)) {
      const r = await new FakeProvider({ behavior: behavior as keyof typeof codes }).resolve("x");
      assert.ok(!r.ok && r.code === code, behavior);
    }
  });

  test("empty: lists are [], single values are NOT_FOUND", async () => {
    const f = new FakeProvider({ behavior: "empty" });
    const list = await f.rentCandidates(subject, 1);
    assert.ok(list.ok && list.data.length === 0);
    const one = await f.resolve("x");
    assert.ok(!one.ok && one.code === "NOT_FOUND");
  });

  test("throw rejects, hang stays pending until aborted", async () => {
    await assert.rejects(new FakeProvider({ behavior: "throw" }).resolve("x"));
    const f = new FakeProvider({ behavior: "hang" });
    const ac = new AbortController();
    let settled = false;
    const p = f.resolve("x", { signal: ac.signal }).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(settled, false);
    ac.abort();
    const r = await p;
    assert.ok(!r.ok && r.code === "TIMEOUT");
    assert.equal(f.abortedCalls, 1);
  });

  test("a behavior function sees the call number; failFirst fails then recovers", async () => {
    const f = new FakeProvider({ behavior: failFirst(2, "error") });
    assert.ok(!(await f.resolve("x")).ok);
    assert.ok(!(await f.resolve("x")).ok);
    assert.ok((await f.resolve("x")).ok);
    assert.deepEqual(f.calls.map((c) => c.behavior), ["error", "error", "ok"]);
  });

  test("ok can delegate to an inner provider", async () => {
    const f = new FakeProvider({ inner: new FixtureProvider() });
    const r = await f.resolve("2415 Maple Test Dr, Sampleton, OH 43017");
    assert.ok(r.ok && r.data.city === "Sampleton");
  });
});

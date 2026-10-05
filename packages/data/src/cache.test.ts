import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cacheKey, MemoryCacheStore, stableStringify, type CacheEntry } from "./cache.ts";

describe("stableStringify and cacheKey", () => {
  test("object key order does not matter, at any depth", () => {
    assert.equal(stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), stableStringify({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
  });

  test("undefined fields are dropped, array order is kept", () => {
    assert.equal(stableStringify({ a: 1, b: undefined }), stableStringify({ a: 1 }));
    assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
  });

  test("keys are 64-char hex and depend on provider, endpoint, and request", () => {
    const k = cacheKey("p", "rent.candidates", { r: 1, a: "x" });
    assert.match(k, /^[0-9a-f]{64}$/);
    assert.equal(k, cacheKey("p", "rent.candidates", { a: "x", r: 1 }));
    assert.notEqual(k, cacheKey("q", "rent.candidates", { r: 1, a: "x" }));
    assert.notEqual(k, cacheKey("p", "rent.estimate", { r: 1, a: "x" }));
    assert.notEqual(k, cacheKey("p", "rent.candidates", { r: 2, a: "x" }));
  });

  test("provider and endpoint cannot be confused with request content", () => {
    assert.notEqual(cacheKey("a", "b", "c"), cacheKey("a", "bc", ""));
  });
});

describe("MemoryCacheStore", () => {
  const entry: CacheEntry = {
    provider: "p",
    endpoint: "rent.candidates",
    payload: [{ id: "1" }],
    fetchedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-02T00:00:00.000Z",
  };

  test("miss, set, hit", async () => {
    const store = new MemoryCacheStore();
    assert.equal(await store.get("k"), undefined);
    await store.set("k", entry);
    assert.deepEqual(await store.get("k"), entry);
  });

  test("stored entries are isolated from caller mutation", async () => {
    const store = new MemoryCacheStore();
    const e = structuredClone(entry);
    await store.set("k", e);
    (e.payload as Array<{ id: string }>)[0]!.id = "mutated";
    const got = await store.get("k");
    (got!.payload as Array<{ id: string }>)[0]!.id = "mutated again";
    assert.deepEqual((await store.get("k"))?.payload, [{ id: "1" }]);
  });
});

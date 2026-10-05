import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defineAnalysisRepoContract, makeAnalysis, makeUsage } from "./analysis-repo.contract.ts";
import { newId } from "./ids.ts";
import { InMemoryAnalysisRepo } from "./memory.ts";

defineAnalysisRepoContract("in memory", () => new InMemoryAnalysisRepo());

describe("newId", () => {
  test("prefix, url-safe, 144 bits, and unique", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = newId("an");
      assert.match(id, /^an_[A-Za-z0-9_-]{24}$/);
      ids.add(id);
    }
    assert.equal(ids.size, 2000);
  });
});

describe("in-memory repo isolation", () => {
  test("returned objects are copies: mutating them does not change what is stored", async () => {
    const repo = new InMemoryAnalysisRepo();
    const a = makeAnalysis();
    await repo.createIfNew(a, makeUsage(a), { reuseSince: "1970-01-01T00:00:00.000Z" });
    const read = await repo.get(a.id, a.ownerUid);
    assert.ok(read);
    read.dataNotes.length = 0;
    assert.equal((await repo.get(a.id, a.ownerUid))?.dataNotes.length, a.dataNotes.length);
  });
});

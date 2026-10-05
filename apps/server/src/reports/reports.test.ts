import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { sampleAnalysis } from "@evalprop/shared";
import { InMemoryAnalysisReader, InMemoryReportStore } from "./memory-store.ts";
import { runReportStoreContract } from "./store-contract.ts";
import { hashToken, isWellFormedToken, newId, newToken } from "./token.ts";

runReportStoreContract("InMemoryReportStore", () => new InMemoryReportStore());

test("tokens carry 128 random bits: 22 base64url characters, never repeated", () => {
  const tokens = new Set(Array.from({ length: 2000 }, () => newToken()));
  assert.equal(tokens.size, 2000);
  for (const t of tokens) {
    assert.match(t, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(Buffer.from(t, "base64url").length, 16);
    assert.ok(isWellFormedToken(t));
  }
});

test("hashToken is the lower-case hex SHA-256 of the token", () => {
  const t = newToken();
  assert.equal(hashToken(t), createHash("sha256").update(t).digest("hex"));
  assert.match(hashToken(t), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken(t), hashToken(newToken()));
});

test("isWellFormedToken rejects the wrong length, characters, and path tricks", () => {
  for (const bad of ["", "short", "a".repeat(21), "a".repeat(23), `${"a".repeat(21)}!`, `${"a".repeat(20)}/x`, `${"a".repeat(20)}..`, "a".repeat(21) + " "]) {
    assert.equal(isWellFormedToken(bad), false, JSON.stringify(bad));
  }
});

test("record ids are random and prefixed", () => {
  assert.match(newId("rpt"), /^rpt_[A-Za-z0-9_-]{16}$/);
  assert.notEqual(newId("rpt"), newId("rpt"));
});

test("InMemoryReportStore hands out copies, so callers cannot change stored state", async () => {
  const store = new InMemoryReportStore();
  const r = await store.create({ analysisId: "a", ownerUid: "u", tokenHash: hashToken("t"), options: { watermark: false }, version: 1, createdAt: "2026-10-04T00:00:00.000Z" });
  r.ownerUid = "attacker";
  assert.equal((await store.getByTokenHash(hashToken("t")))?.ownerUid, "u");
});

test("InMemoryAnalysisReader returns an analysis only to its owner", async () => {
  const reader = new InMemoryAnalysisReader([sampleAnalysis]);
  assert.equal((await reader.get(sampleAnalysis.id, sampleAnalysis.ownerUid))?.id, sampleAnalysis.id);
  assert.equal(await reader.get(sampleAnalysis.id, "someone_else"), null);
  assert.equal(await reader.get("missing", sampleAnalysis.ownerUid), null);
});

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { hashToken, newToken } from "./token.ts";
import type { NewReport, ReportStore } from "./types.ts";

/**
 * Behaviour every ReportStore must have. Run against the in-memory store (unit tests) and the Firestore store
 * (emulator tests), so the two cannot drift apart. Each test uses fresh owner uids, so no cleanup is needed.
 */
export function runReportStoreContract(name: string, makeStore: () => ReportStore | Promise<ReportStore>): void {
  const uid = () => `u_${randomBytes(6).toString("hex")}`;
  const draft = (ownerUid: string, over: Partial<NewReport> = {}): NewReport => ({
    analysisId: "an_1",
    ownerUid,
    tokenHash: hashToken(newToken()),
    options: { watermark: false },
    version: 1,
    createdAt: "2026-10-04T12:00:00.000Z",
    ...over,
  });

  test(`${name}: create assigns an id and returns what was stored; the hash finds it`, async () => {
    const store = await makeStore();
    const owner = uid();
    const input = draft(owner, { options: { watermark: true, recipientName: "Dana", sections: ["summary"] } });
    const created = await store.create(input);
    assert.ok(created.id.length > 0);
    assert.deepEqual({ ...created, id: undefined }, { ...input, id: undefined });
    assert.deepEqual(await store.getByTokenHash(input.tokenHash), created);
  });

  test(`${name}: an unknown hash finds nothing`, async () => {
    const store = await makeStore();
    assert.equal(await store.getByTokenHash(hashToken(newToken())), null);
  });

  test(`${name}: optional fields (expiresAt, pdfPath) round-trip and absent ones stay absent`, async () => {
    const store = await makeStore();
    const owner = uid();
    const withAll = await store.create(draft(owner, { expiresAt: "2026-11-04T12:00:00.000Z", pdfPath: "reports/x.pdf" }));
    assert.equal((await store.getByTokenHash(withAll.tokenHash))?.expiresAt, "2026-11-04T12:00:00.000Z");
    assert.equal((await store.getByTokenHash(withAll.tokenHash))?.pdfPath, "reports/x.pdf");
    const bare = await store.create(draft(owner));
    const read = await store.getByTokenHash(bare.tokenHash);
    assert.ok(read && !("expiresAt" in read) && !("revokedAt" in read) && !("pdfPath" in read));
  });

  test(`${name}: create refuses to overwrite an existing id`, async () => {
    const store = await makeStore();
    const owner = uid();
    const first = await store.create(draft(owner));
    await assert.rejects(store.create(draft(owner, { id: first.id })));
  });

  test(`${name}: revoke sets revokedAt, is idempotent, and keeps the first time`, async () => {
    const store = await makeStore();
    const owner = uid();
    const r = await store.create(draft(owner));
    assert.equal(await store.revoke(r.id, owner, "2026-10-05T00:00:00.000Z"), true);
    assert.equal(await store.revoke(r.id, owner, "2026-10-06T00:00:00.000Z"), true);
    assert.equal((await store.getByTokenHash(r.tokenHash))?.revokedAt, "2026-10-05T00:00:00.000Z");
  });

  test(`${name}: owner isolation: another user cannot revoke, and revoking a missing report is false`, async () => {
    const store = await makeStore();
    const owner = uid();
    const r = await store.create(draft(owner));
    assert.equal(await store.revoke(r.id, uid(), "2026-10-05T00:00:00.000Z"), false);
    assert.equal(await store.revoke("rpt_missing", owner, "2026-10-05T00:00:00.000Z"), false);
    assert.equal((await store.getByTokenHash(r.tokenHash))?.revokedAt, undefined);
  });

  test(`${name}: list returns only the owner's reports, newest first, optionally for one analysis`, async () => {
    const store = await makeStore();
    const owner = uid();
    const other = uid();
    const a = await store.create(draft(owner, { analysisId: "an_a", createdAt: "2026-10-01T00:00:00.000Z" }));
    const b = await store.create(draft(owner, { analysisId: "an_b", createdAt: "2026-10-03T00:00:00.000Z" }));
    const c = await store.create(draft(owner, { analysisId: "an_a", createdAt: "2026-10-02T00:00:00.000Z", version: 2 }));
    await store.create(draft(other, { analysisId: "an_a" }));
    assert.deepEqual((await store.list(owner)).map((r) => r.id), [b.id, c.id, a.id]);
    assert.deepEqual((await store.list(owner, { analysisId: "an_a" })).map((r) => r.id), [c.id, a.id]);
    assert.deepEqual(await store.list(uid()), []);
  });

  test(`${name}: only the token hash is stored, never the token`, async () => {
    const store = await makeStore();
    const owner = uid();
    const token = newToken();
    const r = await store.create(draft(owner, { tokenHash: hashToken(token) }));
    assert.notEqual(r.tokenHash, token);
    assert.equal(await store.getByTokenHash(token), null, "looking up by the raw token finds nothing");
    assert.ok(!JSON.stringify(r).includes(token));
  });
}

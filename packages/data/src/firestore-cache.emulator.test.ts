import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { cacheKey, type CacheEntry } from "./cache.ts";
import { FakeClock } from "./fake-clock.ts";
import { FakeProvider } from "./fake-provider.ts";
import { FirestoreCacheStore } from "./firestore-cache.ts";
import { createGateway } from "./gateway.ts";

// Run via `pnpm test:emulator` (firebase emulators:exec sets FIRESTORE_EMULATOR_HOST).
let app: App;
let db: Firestore;

before(() => {
  assert.ok(process.env["FIRESTORE_EMULATOR_HOST"], "FIRESTORE_EMULATOR_HOST must point at the Firestore emulator");
  app = initializeApp({ projectId: "demo-evalprop" }, `cache-test-${Date.now()}`);
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

const entry = (overrides: Partial<CacheEntry> = {}): CacheEntry => ({
  provider: "fixture",
  endpoint: "rent.candidates",
  payload: [
    { id: "r1", address: "1 Fake St", distanceMiles: 0.2, beds: 1, rent: 1500, kind: "asking", date: "2026-09-01", sameBuilding: true },
  ],
  fetchedAt: "2026-09-01T12:00:00.000Z",
  expiresAt: "2026-09-02T12:00:00.000Z",
  confidence: "high",
  note: "recorded fixture",
  ...overrides,
});

describe("FirestoreCacheStore on the emulator", () => {
  test("miss returns undefined", async () => {
    const store = new FirestoreCacheStore(db);
    assert.equal(await store.get(`missing-${Date.now()}`), undefined);
  });

  test("set then get round-trips every field", async () => {
    const store = new FirestoreCacheStore(db);
    const key = cacheKey("fixture", "rent.candidates", { t: "roundtrip" });
    await store.set(key, entry());
    assert.deepEqual(await store.get(key), entry());
  });

  test("the document matches ARCHITECTURE 6.2: cache/{key} with provider, endpoint, payload, fetchedAt, and a native expiresAt Timestamp", async () => {
    const store = new FirestoreCacheStore(db);
    const key = cacheKey("fixture", "rent.candidates", { t: "shape" });
    await store.set(key, entry());
    const snap = await db.collection("cache").doc(key).get();
    const d = snap.data()!;
    assert.equal(d["provider"], "fixture");
    assert.equal(d["endpoint"], "rent.candidates");
    assert.ok(Array.isArray(d["payload"]));
    assert.equal(d["fetchedAt"], "2026-09-01T12:00:00.000Z");
    assert.ok(d["expiresAt"] instanceof Timestamp, "expiresAt is a Timestamp so a Firestore TTL policy can use it");
    assert.equal(d["expiresAt"].toDate().toISOString(), "2026-09-02T12:00:00.000Z");
  });

  test("set overwrites, and undefined payload fields are dropped instead of rejected", async () => {
    const store = new FirestoreCacheStore(db);
    const key = cacheKey("fixture", "rent.candidates", { t: "overwrite" });
    await store.set(key, entry());
    await store.set(key, entry({ payload: [{ id: "r2", note: undefined }], confidence: undefined, note: undefined }));
    const got = await store.get(key);
    assert.deepEqual(got?.payload, [{ id: "r2" }]);
    assert.equal(got?.confidence, undefined);
    assert.equal(got?.note, undefined);
  });

  test("a malformed document is a miss, not a crash", async () => {
    const store = new FirestoreCacheStore(db);
    const key = cacheKey("fixture", "rent.candidates", { t: "malformed" });
    await db.collection("cache").doc(key).set({ provider: "fixture", payload: 1 });
    assert.equal(await store.get(key), undefined);
  });

  test("a custom collection name is honored", async () => {
    const store = new FirestoreCacheStore(db, { collection: "cache_custom" });
    const key = cacheKey("fixture", "rent.candidates", { t: "collection" });
    await store.set(key, entry());
    assert.ok((await db.collection("cache_custom").doc(key).get()).exists);
    assert.ok(!(await db.collection("cache").doc(key).get()).exists);
  });
});

describe("gateway with the Firestore cache", () => {
  test("a second gateway instance is served from Firestore: cached:true, original fetchedAt, no provider call", async () => {
    const store = new FirestoreCacheStore(db);
    const clock = new FakeClock();
    const subject = { latitude: 30.1, longitude: -97.1, beds: 2 };
    const radius = Date.now(); // unique request so reruns on a dirty emulator still miss first

    const first = new FakeProvider();
    const g1 = createGateway({ cache: store, clock, costCents: { "rent.candidates": 5 } });
    const r1 = await g1.rent("fake", first).rentCandidates(subject, radius);
    assert.ok(r1.ok && r1.provenance.cached === false);
    assert.equal(first.callCount, 1);

    // A new gateway (a new Cloud Run instance) sharing only Firestore.
    const second = new FakeProvider();
    const g2 = createGateway({ cache: new FirestoreCacheStore(db), clock });
    const scoped = g2.scope();
    const r2 = await scoped.rent("fake", second).rentCandidates(subject, radius);
    assert.equal(second.callCount, 0);
    assert.ok(r2.ok);
    assert.equal(r2.provenance.cached, true);
    assert.equal(r2.provenance.fetchedAt, r1.provenance.fetchedAt);
    assert.deepEqual(r2.data, r1.data);
    assert.deepEqual(
      scoped.usage().map((u) => ({ cached: u.cached, costCents: u.costCents })),
      [{ cached: true, costCents: 0 }],
    );
  });

  test("an expired Firestore entry is refetched", async () => {
    const store = new FirestoreCacheStore(db);
    const clock = new FakeClock();
    const subject = { latitude: 30.2, longitude: -97.2 };
    const radius = Date.now() + 1;
    const fake = new FakeProvider();
    const gateway = createGateway({ cache: store, clock });
    await gateway.rent("fake", fake).rentCandidates(subject, radius);
    await clock.advance(24 * 3_600_000 + 1);
    const r = await gateway.rent("fake", fake).rentCandidates(subject, radius);
    assert.equal(fake.callCount, 2);
    assert.ok(r.ok && r.provenance.cached === false);
  });
});

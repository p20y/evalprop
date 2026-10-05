import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PropertyFacts } from "@evalprop/shared";
import { cacheKey, DEFAULT_TTL_MS, MemoryCacheStore, type CacheStore } from "./cache.ts";
import { FakeClock } from "./fake-clock.ts";
import { failFirst, FakeProvider } from "./fake-provider.ts";
import { FixtureProvider } from "./fixture-provider.ts";
import { createGateway, type GatewayLogger, type LogFields, type UsageRecord } from "./gateway.ts";
import type { ProviderResult, PropertyProvider, SubjectProfile } from "./interfaces.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const subject: SubjectProfile = { latitude: 30.26721, longitude: -97.74312, beds: 1, baths: 1, sqft: 690 };

function setup(config: Parameters<typeof createGateway>[0] = {}) {
  const clock = new FakeClock();
  const cache = new MemoryCacheStore();
  const usage: UsageRecord[] = [];
  const gateway = createGateway({ clock, cache, onUsage: (r) => usage.push(r), ...config });
  return { clock, cache, usage, gateway };
}

/** Starts a call, then runs it to completion by advancing fake time in steps. */
async function settle<T>(clock: FakeClock, p: Promise<T>, totalMs = 20_000): Promise<T> {
  let done = false;
  let value!: T;
  void p.then((v) => {
    done = true;
    value = v;
  });
  for (let waited = 0; !done && waited <= totalMs; waited += 250) await clock.advance(250);
  assert.ok(done, "call did not settle");
  return value;
}

describe("success, provenance, usage", () => {
  test("a fresh call returns the provider result with cached:false and records usage with the configured cost", async () => {
    const { gateway, usage, clock } = setup({ costCents: { "rent.candidates": 7 } });
    const rent = gateway.rent("fake", new FakeProvider());
    const r = await rent.rentCandidates(subject, 1);
    assert.ok(r.ok);
    assert.equal(r.provenance.cached, false);
    assert.equal(r.provenance.provider, "fake");
    assert.equal(r.provenance.fetchedAt, "2026-09-01T00:00:00.000Z");
    assert.equal(usage.length, 1);
    assert.deepEqual(
      { provider: usage[0]?.provider, endpoint: usage[0]?.endpoint, cached: usage[0]?.cached, costCents: usage[0]?.costCents },
      { provider: "fake", endpoint: "rent.candidates", cached: false, costCents: 7 },
    );
    assert.equal(typeof usage[0]?.ms, "number");
    assert.equal(clock.pendingTimers, 0, "timeout timer must be cleaned up");
  });

  test("cost is looked up per provider/endpoint first, then per endpoint, default 0", async () => {
    const { gateway, usage } = setup({ costCents: { "fake/rent.estimate": 3, "rent.estimate": 9, "sales.candidates": 5 } });
    const p = new FakeProvider();
    await gateway.rent("fake", p).rentEstimate(subject);
    await gateway.sales("fake", p).saleCandidates(subject, 1);
    await gateway.schools("fake", p).assignedSchools(subject);
    assert.deepEqual(usage.map((u) => u.costCents), [3, 5, 0]);
  });

  test("scope() collects only its own usage while the root onUsage sees everything", async () => {
    const { gateway, usage } = setup();
    const p = new FakeProvider();
    const a = gateway.scope();
    const b = gateway.scope();
    await a.rent("fake", p).rentEstimate(subject);
    await b.sales("fake", p).saleCandidates(subject, 1);
    await b.schools("fake", p).assignedSchools(subject);
    assert.equal(a.usage().length, 1);
    assert.equal(b.usage().length, 2);
    assert.equal(usage.length, 3);
    assert.equal(gateway.usage().length, 0);
  });

  test("a throwing onUsage hook does not break the call", async () => {
    const { gateway } = setup({
      onUsage: () => {
        throw new Error("ledger down");
      },
    });
    const r = await gateway.rent("fake", new FakeProvider()).rentEstimate(subject);
    assert.ok(r.ok);
  });
});

describe("cache", () => {
  test("a repeat request within the TTL is served from cache: cached:true, original fetchedAt, no provider call, cost 0", async () => {
    const { gateway, usage, clock } = setup({ costCents: { "rent.candidates": 7 } });
    const fake = new FakeProvider();
    const rent = gateway.rent("fake", fake);
    const first = await rent.rentCandidates(subject, 1);
    await clock.advance(23 * HOUR);
    const second = await rent.rentCandidates(subject, 1);
    assert.equal(fake.callCount, 1);
    assert.ok(first.ok && second.ok);
    assert.equal(second.provenance.cached, true);
    assert.equal(second.provenance.fetchedAt, first.provenance.fetchedAt);
    assert.equal(second.provenance.confidence, "high");
    assert.deepEqual(second.data, first.data);
    assert.equal(usage[1]?.cached, true);
    assert.equal(usage[1]?.costCents, 0);
    assert.equal(usage[1]?.attempts, 0);
  });

  test("an expired entry is a miss and the provider is called again", async () => {
    const { gateway, clock } = setup();
    const fake = new FakeProvider();
    const rent = gateway.rent("fake", fake);
    await rent.rentCandidates(subject, 1);
    await clock.advance(24 * HOUR + 1);
    const again = await rent.rentCandidates(subject, 1);
    assert.equal(fake.callCount, 2);
    assert.ok(again.ok && again.provenance.cached === false);
  });

  test("default TTLs follow ARCHITECTURE 10.4 per endpoint", async () => {
    const { gateway, cache, clock } = setup();
    const p = new FakeProvider();
    await gateway.property("fake", p).resolve("1 Fake St");
    await gateway.rent("fake", p).rentCandidates(subject, 1);
    await gateway.rent("fake", p).rentEstimate(subject);
    await gateway.sales("fake", p).saleCandidates(subject, 1);
    await gateway.schools("fake", p).assignedSchools(subject);
    const expected: Record<string, number> = { "property.resolve": 30 * DAY, "rent.candidates": DAY, "rent.estimate": 7 * DAY, "sales.candidates": 7 * DAY, "schools.assigned": 90 * DAY };
    assert.deepEqual(
      { "property.resolve": DEFAULT_TTL_MS["property.resolve"], "rent.candidates": DEFAULT_TTL_MS["rent.candidates"], "rent.estimate": DEFAULT_TTL_MS["rent.estimate"], "sales.candidates": DEFAULT_TTL_MS["sales.candidates"], "schools.assigned": DEFAULT_TTL_MS["schools.assigned"] },
      expected,
    );
    const entries = cache.values();
    assert.equal(entries.length, 5);
    for (const e of entries) {
      assert.equal(Date.parse(e.expiresAt) - clock.now(), expected[e.endpoint], e.endpoint);
      assert.equal(e.provider, "fake");
    }
  });

  test("TTLs are configurable per endpoint and per provider/endpoint; 0 disables caching", async () => {
    const { gateway, clock } = setup({ ttlMs: { "rent.candidates": HOUR, "fake/rent.estimate": 0 } });
    const fake = new FakeProvider();
    await gateway.rent("fake", fake).rentCandidates(subject, 1);
    await clock.advance(HOUR + 1);
    await gateway.rent("fake", fake).rentCandidates(subject, 1);
    assert.equal(fake.callCount, 2, "1h TTL override expired");
    await gateway.rent("fake", fake).rentEstimate(subject);
    await gateway.rent("fake", fake).rentEstimate(subject);
    assert.equal(fake.callCount, 4, "ttl 0 means never cached");
  });

  test("typed failures are never cached", async () => {
    const { gateway, cache, clock } = setup();
    const fake = new FakeProvider({ behavior: failFirst(2, "error") });
    const rent = gateway.rent("fake", fake);
    const bad = await settle(clock, rent.rentCandidates(subject, 1));
    assert.ok(!bad.ok && bad.code === "ERROR");
    assert.equal(cache.size, 0);
    const good = await rent.rentCandidates(subject, 1);
    assert.ok(good.ok && good.provenance.cached === false, "the failure was not served from cache");
    assert.equal(cache.size, 1);
  });

  test("different providers, endpoints, and requests never share an entry", async () => {
    const { gateway } = setup();
    const a = new FakeProvider({ name: "a" });
    const b = new FakeProvider({ name: "b" });
    await gateway.rent("a", a).rentCandidates(subject, 1);
    await gateway.rent("b", b).rentCandidates(subject, 1);
    await gateway.rent("a", a).rentCandidates(subject, 2);
    assert.equal(a.callCount + b.callCount, 3);
  });

  test("requests that differ only in address case or whitespace share a cache entry", async () => {
    const { gateway } = setup();
    const fake = new FakeProvider();
    const property = gateway.property("fake", fake);
    await property.resolve("1 Fake St, Faketown");
    await property.resolve("  1 FAKE  st, faketown ");
    assert.equal(fake.callCount, 1);
  });

  test("a corrupted cache payload is treated as a miss, not trusted", async () => {
    const { gateway, cache } = setup();
    const fake = new FakeProvider();
    const property = gateway.property("fake", fake);
    await property.resolve("1 Fake St");
    const key = cacheKey("fake", "property.resolve", { address: "1 fake st" });
    const entry = await cache.get(key);
    assert.ok(entry);
    await cache.set(key, { ...entry, payload: { not: "property facts" } });
    const r = await property.resolve("1 Fake St");
    assert.equal(fake.callCount, 2);
    assert.ok(r.ok && r.provenance.cached === false);
  });

  test("a failing or hanging cache store degrades to a miss and never breaks the call", async () => {
    const broken: CacheStore = {
      get: async () => {
        throw new Error("firestore down");
      },
      set: async () => {
        throw new Error("firestore down");
      },
    };
    const warnings: string[] = [];
    const logger: GatewayLogger = { info: () => {}, warn: (m) => warnings.push(m) };
    const a = setup({ cache: broken, logger });
    const r = await a.gateway.rent("fake", new FakeProvider()).rentEstimate(subject);
    assert.ok(r.ok);
    assert.ok(warnings.includes("cache read failed") && warnings.includes("cache write failed"));

    const hanging: CacheStore = { get: () => new Promise(() => {}), set: () => new Promise(() => {}) };
    const b = setup({ cache: hanging, cacheTimeoutMs: 500 });
    const pending = b.gateway.rent("fake", new FakeProvider()).rentEstimate(subject);
    const hung = await settle(b.clock, pending, 5000);
    assert.ok(hung.ok);
    assert.equal(b.clock.pendingTimers, 0);
  });

  test("works through every wrapped interface with the fixture provider and caches each", async () => {
    const { gateway } = setup();
    const fx = new FixtureProvider();
    const property = gateway.property("fixture", fx);
    const rent = gateway.rent("fixture", fx);
    const sales = gateway.sales("fixture", fx);
    const schools = gateway.schools("fixture", fx);
    const facts = await property.resolve("100 Sample Tower Ln Unit 4B, Testville, TX 78701");
    assert.ok(facts.ok);
    const s: SubjectProfile = { latitude: facts.data.latitude!, longitude: facts.data.longitude! };
    const calls = [
      () => rent.rentCandidates(s, 1),
      () => rent.rentEstimate(s),
      () => sales.saleCandidates(s, 1),
      () => schools.assignedSchools(s),
      () => schools.nearbySchools(s, 2),
    ];
    for (const call of calls) {
      const first = await call();
      const second = await call();
      assert.ok(first.ok && second.ok);
      assert.equal(first.provenance.cached, false);
      assert.equal(second.provenance.cached, true);
      assert.equal(second.provenance.fetchedAt, first.provenance.fetchedAt);
      assert.deepEqual(second.data, first.data);
    }
  });
});

describe("timeout and retry", () => {
  test("a hung provider times out after timeoutMs, is retried once, then fails with a typed TIMEOUT; each attempt is aborted", async () => {
    const { gateway, clock, usage } = setup({ timeoutMs: 3500, retryDelayMs: 250 });
    const fake = new FakeProvider({ behavior: "hang" });
    const pending = gateway.rent("fake", fake).rentCandidates(subject, 1);
    let settled = false;
    void pending.then(() => (settled = true));
    await clock.advance(3499);
    assert.equal(fake.callCount, 1);
    assert.equal(settled, false);
    await clock.advance(1); // first attempt times out at 3500
    await clock.advance(250); // retry delay
    assert.equal(fake.callCount, 2, "exactly one retry");
    await clock.advance(3499);
    assert.equal(settled, false);
    await clock.advance(1);
    const r = await pending;
    assert.ok(!r.ok && r.code === "TIMEOUT");
    assert.equal(fake.callCount, 2);
    assert.equal(fake.abortedCalls, 2, "the provider's AbortSignal fires on each timeout");
    assert.equal(clock.pendingTimers, 0);
    assert.equal(usage[0]?.outcome, "TIMEOUT");
    assert.equal(usage[0]?.attempts, 2);
    assert.equal(usage[0]?.costCents, 0);
    assert.equal(usage[0]?.ms, 3500 + 250 + 3500);
  });

  test("per-endpoint timeout override", async () => {
    const { gateway, clock } = setup({ timeoutMs: 3500, timeoutOverridesMs: { "schools.nearby": 100 } });
    const fake = new FakeProvider({ behavior: "hang" });
    const pending = gateway.schools("fake", fake).nearbySchools(subject, 1);
    const r = await settle(clock, pending, 2000);
    assert.ok(!r.ok && r.code === "TIMEOUT");
    assert.equal(r.ok ? 0 : r.message.includes("100ms"), true);
  });

  for (const code of ["timeout", "error", "rate-limited"] as const) {
    test(`retries once on ${code} and returns the retry's success`, async () => {
      const { gateway, clock, usage } = setup({ costCents: { "rent.estimate": 4 } });
      const fake = new FakeProvider({ behavior: failFirst(1, code) });
      const r = await settle(clock, gateway.rent("fake", fake).rentEstimate(subject));
      assert.ok(r.ok);
      assert.equal(fake.callCount, 2);
      assert.equal(usage[0]?.attempts, 2);
      assert.equal(usage[0]?.costCents, 4, "a retried success is charged once");
    });

    test(`${code} on both attempts becomes a typed failure after exactly two calls`, async () => {
      const { gateway, clock } = setup();
      const fake = new FakeProvider({ behavior: code });
      const r = await settle(clock, gateway.rent("fake", fake).rentEstimate(subject));
      assert.ok(!r.ok);
      assert.equal(r.code, { timeout: "TIMEOUT", error: "ERROR", "rate-limited": "RATE_LIMITED" }[code]);
      assert.equal(fake.callCount, 2);
    });
  }

  test("no retry on NOT_FOUND", async () => {
    const { gateway } = setup();
    const fake = new FakeProvider({ behavior: "not-found" });
    const r = await gateway.property("fake", fake).resolve("nowhere");
    assert.ok(!r.ok && r.code === "NOT_FOUND");
    assert.equal(fake.callCount, 1);
  });

  test("no retry on AMBIGUOUS, and the candidates are preserved", async () => {
    const { gateway } = setup();
    const fx = new FixtureProvider();
    let calls = 0;
    const counting: PropertyProvider = {
      resolve: (a) => {
        calls++;
        return fx.resolve(a);
      },
    };
    const r = await gateway.property("fixture", counting).resolve("500 Main St");
    assert.ok(!r.ok && r.code === "AMBIGUOUS");
    assert.equal(r.code === "AMBIGUOUS" ? r.candidates.length : 0, 3);
    assert.equal(calls, 1);
  });

  test("no retry on UNAVAILABLE", async () => {
    const { gateway } = setup();
    let calls = 0;
    const p: PropertyProvider = {
      resolve: async () => {
        calls++;
        return { ok: false, code: "UNAVAILABLE", message: "provider disabled" };
      },
    };
    const r = await gateway.property("x", p).resolve("a");
    assert.ok(!r.ok && r.code === "UNAVAILABLE");
    assert.equal(calls, 1);
  });

  test("never throws: a provider that throws or returns garbage becomes a typed ERROR", async () => {
    const { gateway, clock } = setup();
    const thrower = new FakeProvider({ behavior: "throw" });
    const r = await settle(clock, gateway.rent("fake", thrower).rentEstimate(subject));
    assert.ok(!r.ok && r.code === "ERROR");
    assert.equal(thrower.callCount, 2, "thrown errors are retried once like any ERROR");

    const garbage = { resolve: async () => "not a result" } as unknown as PropertyProvider;
    const g = await settle(clock, gateway.property("garbage", garbage).resolve("a"));
    assert.ok(!g.ok && g.code === "ERROR");

    const syncThrow = {
      resolve: () => {
        throw new Error("sync boom");
      },
    } as unknown as PropertyProvider;
    const s = await settle(clock, gateway.property("sync", syncThrow).resolve("a"));
    assert.ok(!s.ok && s.code === "ERROR");
  });

  test("a non-idempotent call is not retried", async () => {
    const { gateway } = setup();
    let calls = 0;
    const r = await gateway.call({
      provider: "x",
      endpoint: "property.resolve",
      request: { a: 1 },
      idempotent: false,
      invoke: async (): Promise<ProviderResult<PropertyFacts>> => {
        calls++;
        return { ok: false, code: "ERROR", message: "boom" };
      },
    });
    assert.ok(!r.ok && r.code === "ERROR");
    assert.equal(calls, 1);
  });

  test("failing the empty cases: 'empty' lists succeed with [], 'empty' single values are NOT_FOUND", async () => {
    const { gateway } = setup();
    const fake = new FakeProvider({ behavior: "empty" });
    const list = await gateway.sales("fake", fake).saleCandidates(subject, 1);
    assert.ok(list.ok && list.data.length === 0);
    const single = await gateway.rent("fake", fake).rentEstimate(subject);
    assert.ok(!single.ok && single.code === "NOT_FOUND");
  });
});

describe("real clock", () => {
  test("with the default system clock a hung provider times out in real time (no fake clock)", async () => {
    const gateway = createGateway({ timeoutMs: 30, retryDelayMs: 5 });
    const fake = new FakeProvider({ behavior: "hang" });
    const t0 = Date.now();
    const r = await gateway.rent("fake", fake).rentEstimate(subject);
    assert.ok(!r.ok && r.code === "TIMEOUT");
    assert.equal(fake.callCount, 2);
    assert.ok(Date.now() - t0 < 2000);
  });
});

describe("in-flight de-duplication", () => {
  function deferredProvider() {
    let calls = 0;
    let release!: (r: ProviderResult<PropertyFacts>) => void;
    const provider: PropertyProvider = {
      resolve: () => {
        calls++;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    };
    return { provider, get calls() { return calls; }, release: (r: ProviderResult<PropertyFacts>) => release(r) };
  }
  const facts: PropertyFacts = { formattedAddress: "1 A St, B, TX 78701", line1: "1 A St", city: "B", state: "TX", zip: "78701" };
  const okResult: ProviderResult<PropertyFacts> = { ok: true, data: facts, provenance: { provider: "d", fetchedAt: "2026-09-01T00:00:00.000Z", cached: false } };

  test("two concurrent identical requests make exactly one provider call and both get the result", async () => {
    const { gateway, usage, clock } = setup({ costCents: { "property.resolve": 10 } });
    const d = deferredProvider();
    const property = gateway.property("d", d.provider);
    const p1 = property.resolve("1 A St");
    const p2 = property.resolve("1 a  st"); // same normalized request
    await clock.flush();
    assert.equal(d.calls, 1);
    d.release(okResult);
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.ok(r1.ok && r2.ok);
    assert.deepEqual(r1.data, r2.data);
    assert.notEqual(r1.data, r2.data, "joiners get their own copy");
    assert.equal(d.calls, 1);
    assert.equal(usage.length, 2, "each caller gets a usage record");
    const [owner, joiner] = [usage.find((u) => !u.coalesced), usage.find((u) => u.coalesced)];
    assert.equal(owner?.costCents, 10);
    assert.equal(joiner?.costCents, 0, "a coalesced call costs nothing");
    assert.equal(joiner?.attempts, 0);
  });

  test("concurrent failures are shared too, and a failure leaves no in-flight entry behind", async () => {
    const { gateway, clock } = setup();
    const d = deferredProvider();
    const property = gateway.property("d", d.provider);
    const p1 = property.resolve("1 A St");
    const p2 = property.resolve("1 A St");
    await clock.flush();
    d.release({ ok: false, code: "NOT_FOUND", message: "none" });
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.ok(!r1.ok && !r2.ok);
    assert.equal(d.calls, 1);
    const p3 = property.resolve("1 A St");
    await clock.flush();
    assert.equal(d.calls, 2, "a later request is a fresh call");
    d.release(okResult);
    await p3;
  });

  test("different requests are not de-duplicated", async () => {
    const { gateway, clock } = setup();
    const d = deferredProvider();
    const property = gateway.property("d", d.provider);
    void property.resolve("1 A St");
    void property.resolve("2 A St");
    await clock.flush();
    assert.equal(d.calls, 2);
    d.release(okResult);
  });

  test("de-duplication works across scopes", async () => {
    const { gateway, clock } = setup();
    const d = deferredProvider();
    const s1 = gateway.scope();
    const s2 = gateway.scope();
    const p1 = s1.property("d", d.provider).resolve("1 A St");
    const p2 = s2.property("d", d.provider).resolve("1 A St");
    await clock.flush();
    d.release(okResult);
    await Promise.all([p1, p2]);
    assert.equal(d.calls, 1);
    assert.equal(s1.usage().length, 1);
    assert.equal(s2.usage().length, 1);
  });
});

describe("logging", () => {
  test("the logger and usage records never receive listing text, requests, or provider messages", async () => {
    const SECRET = "ZZ-LISTING-TEXT-9d41 granite counters near the park";
    const logged: Array<{ level: string; message: string; fields: LogFields }> = [];
    const logger: GatewayLogger = {
      info: (message, fields) => logged.push({ level: "info", message, fields }),
      warn: (message, fields) => logged.push({ level: "warn", message, fields }),
    };
    const { gateway, clock, usage } = setup({ logger });

    // Success whose facts carry listing text in the description.
    const withDescription: PropertyProvider = {
      resolve: async () => ({
        ok: true,
        data: { formattedAddress: `1 A St ${SECRET}`, line1: "1 A St", city: "B", state: "TX", zip: "78701", description: SECRET },
        provenance: { provider: "x", fetchedAt: "2026-09-01T00:00:00.000Z", cached: false, note: SECRET },
      }),
    };
    await gateway.property("x", withDescription).resolve(`1 A St ${SECRET}`);
    await gateway.property("x", withDescription).resolve(`1 A St ${SECRET}`); // cache hit path

    // Failures whose messages echo the request, and a throw that does.
    const echoing: PropertyProvider = { resolve: async (a) => ({ ok: false, code: "ERROR", message: `bad request: ${a}` }) };
    await settle(clock, gateway.property("echo", echoing).resolve(`2 B St ${SECRET}`));
    const throwing: PropertyProvider = {
      resolve: async (a) => {
        throw new Error(`failed for ${a}`);
      },
    };
    await settle(clock, gateway.property("throw", throwing).resolve(`3 C St ${SECRET}`));
    const hanging = new FakeProvider({ behavior: "hang" });
    await settle(clock, gateway.property("hang", hanging).resolve(`4 D St ${SECRET}`));

    assert.ok(logged.length >= 6, "the gateway logs calls, retries, and failures");
    const everything = JSON.stringify({ logged, usage });
    assert.ok(!everything.includes("ZZ-LISTING-TEXT"), "no listing text in logs or usage");
    assert.ok(!everything.toLowerCase().includes("granite"));
    for (const entry of logged) {
      for (const v of Object.values(entry.fields)) {
        assert.ok(["string", "number", "boolean", "undefined"].includes(typeof v));
      }
      assert.ok(entry.fields["provider"] !== undefined && entry.fields["endpoint"] !== undefined);
    }
  });
});

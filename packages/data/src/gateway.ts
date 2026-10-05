import {
  PropertyFactsSchema,
  RentListingSchema,
  SaleListingSchema,
  SchoolSchema,
  type Provenance,
} from "@evalprop/shared";
import { cacheKey, DEFAULT_TTL_MS, MemoryCacheStore, type CacheStore, type Endpoint } from "./cache.ts";
import type {
  CallOptions,
  LatLng,
  PropertyProvider,
  ProviderFailure,
  ProviderResult,
  RentEstimate,
  RentProvider,
  SalesProvider,
  SchoolsProvider,
  SubjectProfile,
} from "./interfaces.ts";

/**
 * One record per gateway call (not per attempt). The pipeline (S06) persists these as
 * `users/{uid}/usage/{eventId}.providerCalls[]` (ARCHITECTURE §6.2) in the same transaction as the
 * analysis. The first five fields are the ledger shape; the rest are diagnostics.
 */
export interface UsageRecord {
  provider: string;
  endpoint: string;
  /** Wall-clock milliseconds the caller waited, including any retry. */
  ms: number;
  /** Served from the cache: no provider call was made. */
  cached: boolean;
  /**
   * Configured cost of the call. 0 for cache hits, failed calls (nothing usable was bought), and
   * calls coalesced onto another caller's in-flight request. A retried call that succeeds is charged once.
   */
  costCents: number;
  outcome: "ok" | ProviderFailure["code"];
  /** Provider attempts made (0 for cache hits and coalesced calls). */
  attempts: number;
  /** True when this caller shared another identical in-flight request instead of making its own. */
  coalesced: boolean;
}

/** Log fields are primitives only, and the gateway never passes requests or provider messages, so listing text cannot leak. */
export type LogFields = Record<string, string | number | boolean | undefined>;

export interface GatewayLogger {
  info(message: string, fields: LogFields): void;
  warn(message: string, fields: LogFields): void;
}

export const noopLogger: GatewayLogger = { info: () => {}, warn: () => {} };

/** Injectable clock: real by default, fake in tests. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface GatewayConfig {
  cache?: CacheStore;
  logger?: GatewayLogger;
  /** Called after every call with its usage record (also collected per scope, see `Gateway.scope`). */
  onUsage?: (record: UsageRecord) => void;
  clock?: Clock;
  /** Per-attempt provider timeout. ARCHITECTURE §7.4: 3.5 s per call. */
  timeoutMs?: number;
  /** Delay before the single retry. */
  retryDelayMs?: number;
  /** Cache operations are bounded too, so a slow Firestore never stalls a call. */
  cacheTimeoutMs?: number;
  /**
   * TTL overrides in ms. Keys are an endpoint (`"rent.candidates"`) or `"<provider>/<endpoint>"`
   * (more specific wins). Defaults: ARCHITECTURE §10.4. A TTL of 0 disables caching for that endpoint.
   */
  ttlMs?: Record<string, number>;
  /** Cost per call in cents, same key forms as `ttlMs`. Default 0. */
  costCents?: Record<string, number>;
  /** Timeout overrides in ms, same key forms as `ttlMs`. */
  timeoutOverridesMs?: Record<string, number>;
}

type Parser<T> = (payload: unknown) => T | undefined;

function fromSchema<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Parser<T> {
  return (p) => {
    const r = schema.safeParse(p);
    return r.success ? r.data : undefined;
  };
}

const parseRentEstimate: Parser<RentEstimate> = (p) => {
  if (typeof p !== "object" || p === null) return undefined;
  const o = p as Record<string, unknown>;
  const optNum = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v));
  return typeof o["monthlyRent"] === "number" && Number.isFinite(o["monthlyRent"]) && optNum(o["low"]) && optNum(o["high"])
    ? (p as RentEstimate)
    : undefined;
};

export interface CallSpec<T> {
  provider: string;
  endpoint: Endpoint;
  /** Normalized request: the cache key is derived from it. It is never logged. */
  request: unknown;
  invoke(options: CallOptions): Promise<ProviderResult<T>>;
  /** Validates a cached payload before it is trusted. A failed parse is treated as a miss. */
  parse?: Parser<T>;
  /** Defaults to true: every provider call is a read. Non-idempotent calls are never retried. */
  idempotent?: boolean;
}

/** What one underlying execution produced; shared by every caller coalesced onto it. */
interface Outcome<T> {
  result: ProviderResult<T>;
  cached: boolean;
  attempts: number;
}

const RETRYABLE = new Set<ProviderFailure["code"]>(["TIMEOUT", "ERROR", "RATE_LIMITED"]);

function failure(code: "TIMEOUT" | "ERROR", message: string): ProviderFailure {
  return { ok: false, code, message };
}

function isResult(v: unknown): v is ProviderResult<unknown> {
  return typeof v === "object" && v !== null && typeof (v as { ok?: unknown }).ok === "boolean";
}

/** Normalizes an address for cache keying only (the provider still receives the original string). */
export function normalizeAddress(address: string): string {
  return address.trim().replace(/\s+/g, " ").toLowerCase();
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

function normalizeSubject(s: SubjectProfile) {
  return {
    latitude: round5(s.latitude),
    longitude: round5(s.longitude),
    propertyType: s.propertyType,
    beds: s.beds,
    baths: s.baths,
    sqft: s.sqft,
    yearBuilt: s.yearBuilt,
  };
}

function lookup<V>(table: Record<string, V> | undefined, provider: string, endpoint: string): V | undefined {
  return table?.[`${provider}/${endpoint}`] ?? table?.[endpoint];
}

/** State shared by a gateway and all of its scopes: cache, clock, and the in-flight table. */
class Core {
  readonly cache: CacheStore;
  readonly logger: GatewayLogger;
  readonly clock: Clock;
  readonly inflight = new Map<string, Promise<Outcome<unknown>>>();
  readonly config: GatewayConfig;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.cache = config.cache ?? new MemoryCacheStore();
    this.logger = config.logger ?? noopLogger;
    this.clock = config.clock ?? systemClock;
  }

  /** Races `work` against a timer. The timer is always cleared; `onTimeout` produces the timeout value. */
  race<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
    let handle: unknown;
    const timer = new Promise<T>((resolve) => {
      handle = this.clock.setTimeout(() => resolve(onTimeout()), ms);
    });
    return Promise.race([work, timer]).finally(() => this.clock.clearTimeout(handle));
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.clock.setTimeout(resolve, ms);
    });
  }
}

export class Gateway {
  private readonly core: Core;
  private readonly sink: UsageRecord[] | undefined;

  constructor(core: Core, sink: UsageRecord[] | undefined) {
    this.core = core;
    this.sink = sink;
  }

  /**
   * A view of the gateway that also collects its own usage records, so one pipeline run can persist
   * exactly the calls it made even though the gateway (and its cache) is shared across requests:
   *
   *   const scope = gateway.scope();
   *   const property = scope.property("rentcast", provider);
   *   ...
   *   await persistAnalysis({ ..., providerCalls: scope.usage() });
   */
  scope(): Gateway {
    return new Gateway(this.core, []);
  }

  /** Usage records collected by this scope (always empty on the root gateway: use `onUsage` there). */
  usage(): readonly UsageRecord[] {
    return this.sink ?? [];
  }

  /** Wraps a PropertyProvider. `name` identifies the provider in cache keys, usage records, and logs. */
  property(name: string, p: PropertyProvider): PropertyProvider {
    return {
      resolve: (address) =>
        this.call({
          provider: name,
          endpoint: "property.resolve",
          request: { address: normalizeAddress(address) },
          invoke: (o) => p.resolve(address, o),
          parse: fromSchema(PropertyFactsSchema),
        }),
    };
  }

  rent(name: string, p: RentProvider): RentProvider {
    return {
      rentCandidates: (subject, radiusMiles) =>
        this.call({
          provider: name,
          endpoint: "rent.candidates",
          request: { subject: normalizeSubject(subject), radiusMiles },
          invoke: (o) => p.rentCandidates(subject, radiusMiles, o),
          parse: fromSchema(RentListingSchema.array()),
        }),
      rentEstimate: (subject) =>
        this.call({
          provider: name,
          endpoint: "rent.estimate",
          request: { subject: normalizeSubject(subject) },
          invoke: (o) => p.rentEstimate(subject, o),
          parse: parseRentEstimate,
        }),
    };
  }

  sales(name: string, p: SalesProvider): SalesProvider {
    return {
      saleCandidates: (subject, radiusMiles) =>
        this.call({
          provider: name,
          endpoint: "sales.candidates",
          request: { subject: normalizeSubject(subject), radiusMiles },
          invoke: (o) => p.saleCandidates(subject, radiusMiles, o),
          parse: fromSchema(SaleListingSchema.array()),
        }),
    };
  }

  schools(name: string, p: SchoolsProvider): SchoolsProvider {
    const loc = (l: LatLng) => ({ latitude: round5(l.latitude), longitude: round5(l.longitude) });
    return {
      assignedSchools: (location) =>
        this.call({
          provider: name,
          endpoint: "schools.assigned",
          request: { location: loc(location) },
          invoke: (o) => p.assignedSchools(location, o),
          parse: fromSchema(SchoolSchema.array()),
        }),
      nearbySchools: (location, radiusMiles) =>
        this.call({
          provider: name,
          endpoint: "schools.nearby",
          request: { location: loc(location), radiusMiles },
          invoke: (o) => p.nearbySchools(location, radiusMiles, o),
          parse: fromSchema(SchoolSchema.array()),
        }),
    };
  }

  /**
   * The one code path every provider call takes. Never throws: every failure is a typed
   * `ProviderFailure` the pipeline can degrade on (ARCHITECTURE §7.3).
   */
  async call<T>(spec: CallSpec<T>): Promise<ProviderResult<T>> {
    const { core } = this;
    const start = core.clock.now();
    const key = cacheKey(spec.provider, spec.endpoint, spec.request);
    const base = { provider: spec.provider, endpoint: spec.endpoint };

    const joined = core.inflight.get(key) as Promise<Outcome<T>> | undefined;
    if (joined !== undefined) {
      const { result } = await joined;
      this.record({
        ...base,
        ms: core.clock.now() - start,
        cached: false,
        costCents: 0,
        outcome: result.ok ? "ok" : result.code,
        attempts: 0,
        coalesced: true,
      });
      core.logger.info("provider call coalesced", { ...base, key: key.slice(0, 12) });
      return structuredClone(result);
    }

    const run = this.execute(spec, key);
    core.inflight.set(key, run);
    try {
      const { result, cached, attempts } = await run;
      this.record({
        ...base,
        ms: core.clock.now() - start,
        cached,
        costCents: result.ok && !cached ? (lookup(core.config.costCents, spec.provider, spec.endpoint) ?? 0) : 0,
        outcome: result.ok ? "ok" : result.code,
        attempts,
        coalesced: false,
      });
      return result;
    } finally {
      core.inflight.delete(key);
    }
  }

  private async execute<T>(spec: CallSpec<T>, key: string): Promise<Outcome<T>> {
    const { core } = this;
    const { provider, endpoint } = spec;
    const log = { provider, endpoint, key: key.slice(0, 12) };

    const hit = await this.readCache(spec, key, log);
    if (hit !== undefined) {
      core.logger.info("provider call", { ...log, cached: true, outcome: "ok" });
      return { result: hit, cached: true, attempts: 0 };
    }

    const timeoutMs = lookup(core.config.timeoutOverridesMs, provider, endpoint) ?? core.config.timeoutMs ?? 3500;
    const retryDelayMs = core.config.retryDelayMs ?? 250;
    const idempotent = spec.idempotent ?? true;

    let attempts = 1;
    let result = await this.attempt(spec, timeoutMs);
    if (!result.ok && idempotent && RETRYABLE.has(result.code)) {
      core.logger.warn("provider call failed, retrying", { ...log, outcome: result.code, attempt: attempts });
      await core.sleep(retryDelayMs);
      attempts += 1;
      result = await this.attempt(spec, timeoutMs);
    }

    if (!result.ok) {
      core.logger.warn("provider call failed", { ...log, outcome: result.code, attempts });
      return { result, cached: false, attempts };
    }

    const fresh: ProviderResult<T> = { ok: true, data: result.data, provenance: { ...result.provenance, cached: false } };
    await this.writeCache(spec, key, fresh, log);
    core.logger.info("provider call", { ...log, cached: false, outcome: "ok", attempts });
    return { result: fresh, cached: false, attempts };
  }

  private attempt<T>(spec: CallSpec<T>, timeoutMs: number): Promise<ProviderResult<T>> {
    const ac = new AbortController();
    const work = (async (): Promise<ProviderResult<T>> => {
      try {
        const r = await spec.invoke({ signal: ac.signal });
        return isResult(r) ? (r as ProviderResult<T>) : failure("ERROR", "provider returned a malformed result");
      } catch {
        // The thrown error's message is dropped: it may echo the request.
        return failure("ERROR", "provider call threw");
      }
    })();
    return this.core.race(work, timeoutMs, () => {
      ac.abort();
      return failure("TIMEOUT", `${spec.provider} ${spec.endpoint} timed out after ${timeoutMs}ms`);
    });
  }

  private async readCache<T>(spec: CallSpec<T>, key: string, log: LogFields): Promise<ProviderResult<T> | undefined> {
    const { core } = this;
    if (this.ttl(spec) <= 0) return undefined;
    try {
      const entry = await core.race(core.cache.get(key), core.config.cacheTimeoutMs ?? 1000, () => undefined);
      if (entry === undefined) return undefined;
      if (!(Date.parse(entry.expiresAt) > core.clock.now())) return undefined;
      const data = spec.parse ? spec.parse(entry.payload) : (entry.payload as T);
      if (data === undefined) {
        core.logger.warn("cache entry failed validation", log);
        return undefined;
      }
      const provenance: Provenance = {
        provider: entry.provider,
        fetchedAt: entry.fetchedAt,
        cached: true,
        ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
        ...(entry.note !== undefined ? { note: entry.note } : {}),
      };
      return { ok: true, data, provenance };
    } catch {
      core.logger.warn("cache read failed", log);
      return undefined;
    }
  }

  private async writeCache<T>(
    spec: CallSpec<T>,
    key: string,
    result: { ok: true; data: T; provenance: Provenance },
    log: LogFields,
  ): Promise<void> {
    const { core } = this;
    const ttl = this.ttl(spec);
    if (ttl <= 0) return;
    try {
      await core.race(
        core.cache.set(key, {
          provider: spec.provider,
          endpoint: spec.endpoint,
          payload: result.data,
          fetchedAt: result.provenance.fetchedAt,
          expiresAt: new Date(core.clock.now() + ttl).toISOString(),
          ...(result.provenance.confidence !== undefined ? { confidence: result.provenance.confidence } : {}),
          ...(result.provenance.note !== undefined ? { note: result.provenance.note } : {}),
        }),
        core.config.cacheTimeoutMs ?? 1000,
        () => undefined,
      );
    } catch {
      core.logger.warn("cache write failed", log);
    }
  }

  private ttl(spec: CallSpec<unknown>): number {
    return lookup(this.core.config.ttlMs, spec.provider, spec.endpoint) ?? DEFAULT_TTL_MS[spec.endpoint];
  }

  private record(r: UsageRecord): void {
    this.sink?.push(r);
    try {
      this.core.config.onUsage?.(r);
    } catch {
      // A broken usage hook must not break a data call.
    }
  }
}

export function createGateway(config: GatewayConfig = {}): Gateway {
  return new Gateway(new Core(config), undefined);
}

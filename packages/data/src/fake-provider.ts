import type { PropertyFacts, RentListing, SaleListing, School } from "@evalprop/shared";
import type {
  CallOptions,
  LatLng,
  PropertyProvider,
  ProviderResult,
  RentEstimate,
  RentProvider,
  SalesProvider,
  SchoolsProvider,
  SubjectProfile,
} from "./interfaces.ts";

/**
 * How a fake call behaves:
 * - `ok`: succeed with canned data (or the `inner` provider's)
 * - `hang`: never settle (a stuck upstream); the gateway's timeout is what ends the call
 * - `timeout` / `error` / `rate-limited` / `not-found`: return that typed failure immediately
 * - `throw`: throw, as a buggy adapter might
 * - `empty`: succeed with no data (`[]` for lists, NOT_FOUND for single values)
 */
export type FakeBehavior = "ok" | "hang" | "timeout" | "error" | "rate-limited" | "not-found" | "throw" | "empty";

export interface FakeCall {
  endpoint: string;
  /** 1-based count of calls to this fake across all endpoints. */
  callNumber: number;
  behavior: FakeBehavior;
}

export interface FakeProviderOptions {
  /** A fixed behavior, or a function of the call (e.g. `failFirst(1, "timeout")`). Default `ok`. */
  behavior?: FakeBehavior | ((call: { endpoint: string; callNumber: number }) => FakeBehavior);
  /** Where `ok` data comes from. Default: small canned data that ignores the request. */
  inner?: PropertyProvider & RentProvider & SalesProvider & SchoolsProvider;
  name?: string;
}

/** Behavior function: the first `n` calls use `behavior`, later calls succeed. For retry tests. */
export function failFirst(n: number, behavior: FakeBehavior): (call: { callNumber: number }) => FakeBehavior {
  return ({ callNumber }) => (callNumber <= n ? behavior : "ok");
}

const CANNED_PROPERTY: PropertyFacts = {
  formattedAddress: "1 Fake St, Faketown, TX 78701",
  line1: "1 Fake St",
  city: "Faketown",
  state: "TX",
  zip: "78701",
  latitude: 30.2672,
  longitude: -97.7431,
  propertyType: "single_family",
  beds: 3,
  baths: 2,
  sqft: 1500,
};
const CANNED_RENT: RentListing[] = [
  { id: "fake-r1", address: "2 Fake St, Faketown, TX 78701", distanceMiles: 0.2, beds: 3, baths: 2, sqft: 1480, rent: 2100, kind: "asking", date: "2026-09-01" },
];
const CANNED_SALES: SaleListing[] = [
  { id: "fake-s1", address: "3 Fake St, Faketown, TX 78701", distanceMiles: 0.3, beds: 3, baths: 2, sqft: 1520, price: 320000, status: "sold", date: "2026-08-01" },
];
const CANNED_SCHOOLS: School[] = [{ name: "Fake Elementary", level: "elementary", rating: 7, distanceMiles: 0.5, assigned: true }];

/**
 * A provider that fails on demand, so the pipeline (S06) and gateway tests can exercise every
 * degradation path without a network. Implements all four provider interfaces and records its calls.
 */
export class FakeProvider implements PropertyProvider, RentProvider, SalesProvider, SchoolsProvider {
  readonly name: string;
  readonly calls: FakeCall[] = [];
  /** How many calls were told to abort by the gateway (timeout) via their AbortSignal. */
  abortedCalls = 0;
  private readonly behaviorOf: NonNullable<FakeProviderOptions["behavior"]>;
  private readonly inner: FakeProviderOptions["inner"];

  constructor(options: FakeProviderOptions = {}) {
    this.name = options.name ?? "fake";
    this.behaviorOf = options.behavior ?? "ok";
    this.inner = options.inner;
  }

  get callCount(): number {
    return this.calls.length;
  }

  resolve(address: string, options?: CallOptions): Promise<ProviderResult<PropertyFacts>> {
    return this.run("property.resolve", options, "single", () => this.inner?.resolve(address) ?? this.ok({ ...CANNED_PROPERTY }));
  }

  rentCandidates(subject: SubjectProfile, radiusMiles: number, options?: CallOptions): Promise<ProviderResult<RentListing[]>> {
    return this.run("rent.candidates", options, "list", () => this.inner?.rentCandidates(subject, radiusMiles) ?? this.ok(structuredClone(CANNED_RENT)));
  }

  rentEstimate(subject: SubjectProfile, options?: CallOptions): Promise<ProviderResult<RentEstimate>> {
    return this.run("rent.estimate", options, "single", () => this.inner?.rentEstimate(subject) ?? this.ok({ monthlyRent: 2100, low: 1950, high: 2250 }));
  }

  saleCandidates(subject: SubjectProfile, radiusMiles: number, options?: CallOptions): Promise<ProviderResult<SaleListing[]>> {
    return this.run("sales.candidates", options, "list", () => this.inner?.saleCandidates(subject, radiusMiles) ?? this.ok(structuredClone(CANNED_SALES)));
  }

  assignedSchools(location: LatLng, options?: CallOptions): Promise<ProviderResult<School[]>> {
    return this.run("schools.assigned", options, "list", () => this.inner?.assignedSchools(location) ?? this.ok(structuredClone(CANNED_SCHOOLS)));
  }

  nearbySchools(location: LatLng, radiusMiles: number, options?: CallOptions): Promise<ProviderResult<School[]>> {
    return this.run("schools.nearby", options, "list", () => this.inner?.nearbySchools(location, radiusMiles) ?? this.ok(structuredClone(CANNED_SCHOOLS)));
  }

  private ok<T>(data: T): ProviderResult<T> {
    return { ok: true, data, provenance: { provider: this.name, fetchedAt: "2026-09-01T00:00:00.000Z", cached: false, confidence: "high" } };
  }

  private run<T>(
    endpoint: string,
    options: CallOptions | undefined,
    shape: "list" | "single",
    succeed: () => Promise<ProviderResult<T>> | ProviderResult<T>,
  ): Promise<ProviderResult<T>> {
    const callNumber = this.calls.length + 1;
    const behavior = typeof this.behaviorOf === "function" ? this.behaviorOf({ endpoint, callNumber }) : this.behaviorOf;
    this.calls.push({ endpoint, callNumber, behavior });

    switch (behavior) {
      case "ok":
        return Promise.resolve(succeed());
      case "hang":
        return new Promise<ProviderResult<T>>((resolve) => {
          options?.signal?.addEventListener("abort", () => {
            this.abortedCalls += 1;
            resolve({ ok: false, code: "TIMEOUT", message: "aborted" });
          });
        });
      case "timeout":
        return Promise.resolve({ ok: false, code: "TIMEOUT", message: "fake timeout" });
      case "error":
        return Promise.resolve({ ok: false, code: "ERROR", message: "fake upstream error" });
      case "rate-limited":
        return Promise.resolve({ ok: false, code: "RATE_LIMITED", message: "fake rate limit" });
      case "not-found":
        return Promise.resolve({ ok: false, code: "NOT_FOUND", message: "fake not found" });
      case "throw":
        return Promise.reject(new Error("fake adapter bug"));
      case "empty":
        return Promise.resolve(
          shape === "list" ? this.ok([] as unknown as T) : { ok: false, code: "NOT_FOUND", message: "fake: no data" },
        );
    }
  }
}

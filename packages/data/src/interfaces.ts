import type {
  PropertyFacts,
  Provenance,
  RentListing,
  Resolved,
  SaleListing,
  School,
} from "@evalprop/shared";

/** Typed failure so callers can degrade instead of catching exceptions (ARCHITECTURE §7.3). */
export type ProviderFailure =
  | { ok: false; code: "TIMEOUT" | "ERROR" | "RATE_LIMITED" | "NOT_FOUND" | "UNAVAILABLE"; message: string }
  | { ok: false; code: "AMBIGUOUS"; message: string; candidates: string[] };

export type ProviderResult<T> = ({ ok: true } & Resolved<T>) | ProviderFailure;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** What the comp search needs to know about the subject. */
export interface SubjectProfile extends LatLng {
  propertyType?: PropertyFacts["propertyType"];
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
}

export interface RentEstimate {
  monthlyRent: number;
  low?: number;
  high?: number;
}

/**
 * Optional per-call options. The gateway aborts `signal` when a call times out so an adapter can
 * cancel its HTTP request (`fetch(url, { signal })`). Adapters that ignore it still work: the gateway
 * stops waiting regardless.
 */
export interface CallOptions {
  signal?: AbortSignal;
}

export interface PropertyProvider {
  /** Address string → normalized facts and coordinates, or AMBIGUOUS with candidates, or NOT_FOUND. */
  resolve(address: string, options?: CallOptions): Promise<ProviderResult<PropertyFacts>>;
}

export interface RentProvider {
  /** Rental listings within `radiusMiles` of the subject, as normalized candidates (filtering is done by comp selection). */
  rentCandidates(subject: SubjectProfile, radiusMiles: number, options?: CallOptions): Promise<ProviderResult<RentListing[]>>;
  /** Provider's automated estimate; the fallback when comps are insufficient. */
  rentEstimate(subject: SubjectProfile, options?: CallOptions): Promise<ProviderResult<RentEstimate>>;
}

export interface SalesProvider {
  saleCandidates(subject: SubjectProfile, radiusMiles: number, options?: CallOptions): Promise<ProviderResult<SaleListing[]>>;
}

export interface SchoolsProvider {
  assignedSchools(location: LatLng, options?: CallOptions): Promise<ProviderResult<School[]>>;
  nearbySchools(location: LatLng, radiusMiles: number, options?: CallOptions): Promise<ProviderResult<School[]>>;
}

export type { Provenance };

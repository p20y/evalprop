import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PropertyFactsSchema,
  RentListingSchema,
  SaleListingSchema,
  SchoolSchema,
  type Confidence,
  type PropertyFacts,
  type Provenance,
  type RentListing,
  type SaleListing,
  type School,
} from "@evalprop/shared";
import type {
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
 * One recorded scenario (a JSON file in `packages/data/fixtures/`). All addresses are fictional.
 * `property` is either the resolved facts or a recorded failure (e.g. AMBIGUOUS). Comps, schools,
 * and the estimate are looked up by the subject's coordinates, so a pipeline test can resolve an
 * address and then ask for comps exactly as it would against a real provider.
 */
export interface FixtureScenario {
  id: string;
  description: string;
  /** ISO time the data was "recorded"; reported as `provenance.fetchedAt`. */
  recordedAt: string;
  confidence?: Confidence;
  /** Address strings that resolve to this scenario (matched case- and punctuation-insensitively). */
  addresses: string[];
  property: { facts: PropertyFacts } | { failure: { code: ProviderFailure["code"]; message: string; candidates?: string[] } };
  rent: { candidates: RentListing[]; estimate: RentEstimate | null };
  sales: SaleListing[];
  schools: { assigned: School[]; nearby: School[] };
}

export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Two coordinates are "the same place" when within ~50 m (0.0005 degrees). */
const SAME_PLACE_DEG = 0.0005;

/** Reads and validates every `*.json` scenario in a directory. Throws on a malformed fixture (a dev-time error). */
export function loadFixtureScenarios(dir: string = FIXTURES_DIR): FixtureScenario[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as FixtureScenario;
      if ("facts" in raw.property) PropertyFactsSchema.parse(raw.property.facts);
      RentListingSchema.array().parse(raw.rent.candidates);
      SaleListingSchema.array().parse(raw.sales);
      SchoolSchema.array().parse(raw.schools.assigned);
      SchoolSchema.array().parse(raw.schools.nearby);
      return raw;
    });
}

/**
 * Serves recorded responses for all four provider interfaces. Offline and deterministic: the default
 * provider in dev and tests. Distance filtering mirrors a real radius search (`distanceMiles <= radius`).
 */
export class FixtureProvider implements PropertyProvider, RentProvider, SalesProvider, SchoolsProvider {
  readonly name = "fixture";
  private readonly scenarios: FixtureScenario[];

  constructor(scenarios: FixtureScenario[] = loadFixtureScenarios()) {
    this.scenarios = scenarios;
  }

  /** Ids of the loaded scenarios, for tests and dev tooling. */
  get scenarioIds(): string[] {
    return this.scenarios.map((s) => s.id);
  }

  async resolve(address: string): Promise<ProviderResult<PropertyFacts>> {
    const key = normalize(address);
    const scenario = this.scenarios.find((s) => s.addresses.some((a) => normalize(a) === key));
    if (scenario === undefined) return { ok: false, code: "NOT_FOUND", message: "no fixture for this address" };
    if ("failure" in scenario.property) return { ok: false, ...scenario.property.failure } as ProviderFailure;
    return this.ok(scenario, structuredClone(scenario.property.facts));
  }

  async rentCandidates(subject: SubjectProfile, radiusMiles: number): Promise<ProviderResult<RentListing[]>> {
    const s = this.at(subject);
    if (s === undefined) return this.notFound();
    return this.ok(s, structuredClone(s.rent.candidates.filter((c) => c.distanceMiles <= radiusMiles)));
  }

  async rentEstimate(subject: SubjectProfile): Promise<ProviderResult<RentEstimate>> {
    const s = this.at(subject);
    if (s === undefined || s.rent.estimate === null) return this.notFound();
    return this.ok(s, { ...s.rent.estimate });
  }

  async saleCandidates(subject: SubjectProfile, radiusMiles: number): Promise<ProviderResult<SaleListing[]>> {
    const s = this.at(subject);
    if (s === undefined) return this.notFound();
    return this.ok(s, structuredClone(s.sales.filter((c) => c.distanceMiles <= radiusMiles)));
  }

  async assignedSchools(location: LatLng): Promise<ProviderResult<School[]>> {
    const s = this.at(location);
    if (s === undefined) return this.notFound();
    return this.ok(s, structuredClone(s.schools.assigned));
  }

  async nearbySchools(location: LatLng, radiusMiles: number): Promise<ProviderResult<School[]>> {
    const s = this.at(location);
    if (s === undefined) return this.notFound();
    return this.ok(s, structuredClone(s.schools.nearby.filter((c) => c.distanceMiles <= radiusMiles)));
  }

  private at(p: LatLng): FixtureScenario | undefined {
    return this.scenarios.find(
      (s) =>
        "facts" in s.property &&
        s.property.facts.latitude !== undefined &&
        s.property.facts.longitude !== undefined &&
        Math.abs(s.property.facts.latitude - p.latitude) <= SAME_PLACE_DEG &&
        Math.abs(s.property.facts.longitude - p.longitude) <= SAME_PLACE_DEG,
    );
  }

  private ok<T>(s: FixtureScenario, data: T): ProviderResult<T> {
    const provenance: Provenance = {
      provider: this.name,
      fetchedAt: s.recordedAt,
      cached: false,
      ...(s.confidence !== undefined ? { confidence: s.confidence } : {}),
      note: `recorded fixture: ${s.id}`,
    };
    return { ok: true, data, provenance };
  }

  private notFound<T>(): ProviderResult<T> {
    return { ok: false, code: "NOT_FOUND", message: "no fixture data for this location" };
  }
}

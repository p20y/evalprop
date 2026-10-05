/**
 * Realistic report fixtures built with the real engine and comp selection (no hand-typed results), so the
 * report is exercised against numbers shaped exactly like a saved analysis. Used by the report tests and by
 * `evals/report-fixtures`. Not exported from the package index.
 *
 * Everything is deterministic: a fixed "now", fixed candidate listings, no clock, no network.
 */
import { selectRentComps, selectSaleComps } from "@evalprop/comps";
import { breakEvenRent, ENGINE_VERSION, evaluate, maxPriceForCashOnCash } from "@evalprop/engine";
import type { PropertyInput } from "@evalprop/engine";
import {
  AnalysisSchema,
  CompResultSchema,
  type Analysis,
  type AdvisoryFlag,
  type DataNote,
  type PropertyFacts,
  type ReportModel,
  type ReportOptions,
  type RentListing,
  type ResolvedAssumption,
  type SaleListing,
  type School,
  type Provenance,
  type Source,
} from "@evalprop/shared";

export const FIXTURE_NOW = new Date("2026-10-04T12:00:00.000Z");
const FETCHED_AT = "2026-10-04T11:58:00.000Z";

const prov = (provider: string, confidence?: Provenance["confidence"], note?: string): Provenance => {
  const p: Provenance = { provider, fetchedAt: FETCHED_AT, cached: false };
  if (confidence) p.confidence = confidence;
  if (note) p.note = note;
  return p;
};

const daysAgo = (n: number) => new Date(FIXTURE_NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

interface Build {
  id: string;
  property: PropertyFacts;
  /** Overrides passed to the engine, keyed by field, with the source to record. */
  overrides: Partial<Record<string, { value: number; source: Source }>>;
  price: { value: number; source: Source };
  rent: { value: number; source: Source };
  rentComps: RentListing[] | null;
  saleComps: SaleListing[] | null;
  schools: School[] | null;
  advisoryFlags: AdvisoryFlag[];
  dataNotes: DataNote[];
  targetCashOnCashPct?: number;
}

function build(b: Build): Analysis {
  const input: PropertyInput = {
    purchasePrice: b.price.value,
    monthlyRent: b.rent.value,
    state: b.property.state,
    ...(b.property.listPrice !== undefined ? { listPrice: b.property.listPrice } : {}),
  };
  for (const [field, o] of Object.entries(b.overrides)) {
    if (o) (input as unknown as Record<string, number>)[field] = o.value;
  }
  const evaluation = evaluate(input);
  const target = b.targetCashOnCashPct ?? 8;

  const assumptions: ResolvedAssumption[] = [
    { field: "purchasePrice", value: b.price.value, source: b.price.source },
    {
      field: "monthlyRent",
      value: b.rent.value,
      source: b.rent.source,
      ...(b.rent.source === "lookup" ? { provenance: prov("fixture-provider", "high", "Median of nearby rent comps") } : {}),
    },
  ];
  for (const a of evaluation.assumptions) {
    const o = b.overrides[a.field];
    const r: ResolvedAssumption = { field: a.field, value: a.value, source: o ? o.source : a.source };
    if (a.note) r.note = a.note;
    if (o?.source === "lookup") r.provenance = prov("fixture-provider", "medium");
    assumptions.push(r);
  }

  const options = { now: FIXTURE_NOW };
  const rentComps = b.rentComps ? CompResultSchema.parse(selectRentComps(b.property, b.rentComps, options)) : null;
  const saleComps = b.saleComps ? CompResultSchema.parse(selectSaleComps(b.property, b.saleComps, options)) : null;

  const provenance: Record<string, Provenance> = {};
  if (rentComps) provenance.rentComps = prov("fixture-provider", rentComps.confidence);
  if (saleComps) provenance.saleComps = prov("fixture-provider", saleComps.confidence);
  if (b.schools) provenance.schools = prov("fixture-schools", undefined, "Ratings are advisory");

  return AnalysisSchema.parse({
    id: b.id,
    ownerUid: "user_fixture",
    createdAt: "2026-10-04T11:59:00.000Z",
    engineVersion: ENGINE_VERSION,
    pipelineVersion: "0.0.0-fixture",
    inputHash: `hash_${b.id}`,
    property: b.property,
    assumptions,
    evaluation,
    market: { rentComps, saleComps, schools: b.schools, provenance },
    advisoryFlags: b.advisoryFlags,
    dataNotes: b.dataNotes,
    targetCashOnCashPct: target,
    maxOfferPrice: maxPriceForCashOnCash(input, target),
    breakEvenRent: breakEvenRent(input),
  });
}

const rentL = (id: string, o: Partial<RentListing> & Pick<RentListing, "address" | "distanceMiles" | "rent" | "beds">): RentListing => ({
  id,
  propertyType: "single_family",
  baths: 2,
  sqft: 1350,
  kind: "leased",
  date: daysAgo(30),
  ...o,
});

const saleL = (id: string, o: Partial<SaleListing> & Pick<SaleListing, "address" | "distanceMiles" | "price">): SaleListing => ({
  id,
  propertyType: "single_family",
  beds: 3,
  baths: 2,
  sqft: 1350,
  status: "sold",
  date: daysAgo(60),
  ...o,
});

// ---------------------------------------------------------------------------------------------
// Strong: an inexpensive Midwest single-family with nearby strict comps, schools, and a flag.
// ---------------------------------------------------------------------------------------------
export function strongAnalysis(): Analysis {
  return build({
    id: "an_strong",
    property: {
      formattedAddress: "1820 Maple Grove Ln, Indianapolis, IN 46227",
      line1: "1820 Maple Grove Ln",
      city: "Indianapolis",
      state: "IN",
      zip: "46227",
      latitude: 39.69,
      longitude: -86.13,
      propertyType: "single_family",
      beds: 3,
      baths: 2,
      sqft: 1350,
      lotSqft: 7200,
      yearBuilt: 1962,
      listPrice: 142000,
      daysOnMarket: 41,
      taxesAnnual: 1380,
      description:
        "Solid brick ranch on a quiet street. New roof in 2023, updated kitchen, fenced yard. Currently tenant-occupied on a lease through next August.",
      listingUrl: "https://listing.example/1820-maple-grove",
    },
    price: { value: 135000, source: "provided" },
    rent: { value: 1650, source: "lookup" },
    overrides: {
      propertyTaxAnnual: { value: 1380, source: "listing" },
      interestRatePct: { value: 6.75, source: "provided" },
    },
    rentComps: [
      rentL("r1", { address: "1806 Maple Grove Ln", distanceMiles: 0.08, rent: 1675, beds: 3, sqft: 1320, date: daysAgo(18) }),
      rentL("r2", { address: "1914 Birch Ct", distanceMiles: 0.21, rent: 1625, beds: 3, sqft: 1400, kind: "asking", date: daysAgo(9) }),
      rentL("r3", { address: "2231 Hazel Dr", distanceMiles: 0.3, rent: 1700, beds: 3, sqft: 1380, date: daysAgo(44) }),
      rentL("r4", { address: "1702 Sycamore St", distanceMiles: 0.37, rent: 1600, beds: 3, sqft: 1290, date: daysAgo(63) }),
      rentL("r5", { address: "2008 Elm Pl", distanceMiles: 0.44, rent: 1650, beds: 3, sqft: 1360, kind: "asking", date: daysAgo(12) }),
      rentL("r6", { address: "1655 Cedar Way", distanceMiles: 0.48, rent: 1690, beds: 3, sqft: 1410, date: daysAgo(80) }),
    ],
    saleComps: [
      saleL("s1", { address: "1810 Maple Grove Ln", distanceMiles: 0.05, price: 139000, sqft: 1310, date: daysAgo(40) }),
      saleL("s2", { address: "1930 Birch Ct", distanceMiles: 0.22, price: 146500, sqft: 1420, date: daysAgo(75) }),
      saleL("s3", { address: "2240 Hazel Dr", distanceMiles: 0.33, price: 141000, sqft: 1365, date: daysAgo(120) }),
      saleL("s4", { address: "1711 Sycamore St", distanceMiles: 0.4, price: 137500, sqft: 1290, date: daysAgo(150) }),
      saleL("s5", { address: "2012 Elm Pl", distanceMiles: 0.47, price: 144000, sqft: 1380, date: daysAgo(30) }),
    ],
    schools: [
      { name: "Westview Elementary", level: "elementary", rating: 6, distanceMiles: 0.5, assigned: true, attribution: "School ratings by FixtureSchools, 2026. Ratings are one input; visit the schools." },
      { name: "Eastern Middle School", level: "middle", rating: 5, distanceMiles: 1.1, assigned: true, attribution: "School ratings by FixtureSchools, 2026. Ratings are one input; visit the schools." },
      { name: "Franklin High School", level: "high", rating: 7, distanceMiles: 1.8, assigned: "unknown", attribution: "School ratings by FixtureSchools, 2026. Ratings are one input; visit the schools." },
      { name: "St. Anne Academy", level: "other", distanceMiles: 0.9, assigned: false },
    ],
    advisoryFlags: [
      { title: "Tenant-occupied", detail: "The listing says a tenant is in place on a lease through next August. Confirm the lease terms and rent.", tone: "good" },
      { title: "New roof (2023)", detail: "Roof replaced in 2023 per the listing; maintenance and capex assumptions here are generic.", tone: "good" },
      { title: "Built in 1962", detail: "Older plumbing and electrical are worth a specific inspection.", tone: "ok" },
    ],
    dataNotes: [{ section: "schools", severity: "info", message: "Assigned-school status for Franklin High School could not be confirmed by the provider." }],
  });
}

// ---------------------------------------------------------------------------------------------
// Marginal: a condo with HOA, few strict comps, so the rent estimate falls back to different-size comps.
// ---------------------------------------------------------------------------------------------
export function marginalAnalysis(): Analysis {
  return build({
    id: "an_marginal",
    property: {
      formattedAddress: "4417 S Quincy Ave #12, Tulsa, OK 74105",
      line1: "4417 S Quincy Ave #12",
      city: "Tulsa",
      state: "OK",
      zip: "74105",
      latitude: 36.1,
      longitude: -95.97,
      propertyType: "condo",
      beds: 2,
      baths: 2,
      sqft: 980,
      yearBuilt: 1998,
      listPrice: 174900,
      daysOnMarket: 12,
      taxesAnnual: 1800,
      hoaMonthly: 180,
      unitsInBuilding: 24,
    },
    price: { value: 165000, source: "provided" },
    rent: { value: 1850, source: "lookup" },
    overrides: {
      propertyTaxAnnual: { value: 1800, source: "listing" },
      hoaMonthly: { value: 180, source: "listing" },
      interestRatePct: { value: 6.75, source: "provided" },
    },
    rentComps: [
      rentL("r1", { address: "4417 S Quincy Ave #4", distanceMiles: 0, propertyType: "condo", rent: 1825, beds: 2, baths: 2, sqft: 960, date: daysAgo(55), sameBuilding: true }),
      rentL("r2", { address: "4501 S Peoria Ave #210", distanceMiles: 0.35, propertyType: "condo", rent: 1580, beds: 1, baths: 1, sqft: 720, kind: "asking", date: daysAgo(10) }),
      rentL("r3", { address: "4380 S Yale Ave #33", distanceMiles: 0.6, propertyType: "condo", rent: 2000, beds: 3, baths: 2, sqft: 1220, date: daysAgo(35) }),
      rentL("r4", { address: "4620 S Utica Ave #8", distanceMiles: 0.85, propertyType: "condo", rent: 1810, beds: 2, baths: 2, sqft: 1100, date: daysAgo(90) }),
      rentL("r5", { address: "4100 E 45th St #5", distanceMiles: 1.3, propertyType: "condo", rent: 1495, beds: 1, baths: 1, sqft: 700, date: daysAgo(70) }),
    ],
    saleComps: [
      saleL("s1", { address: "4417 S Quincy Ave #9", distanceMiles: 0, propertyType: "condo", beds: 2, sqft: 970, price: 168000, date: daysAgo(95) }),
      saleL("s2", { address: "4501 S Peoria Ave #305", distanceMiles: 0.35, propertyType: "condo", beds: 2, sqft: 1010, price: 172500, date: daysAgo(140) }),
      saleL("s3", { address: "4380 S Yale Ave #12", distanceMiles: 0.6, propertyType: "condo", beds: 2, sqft: 940, price: 161000, date: daysAgo(210) }),
      saleL("s4", { address: "4620 S Utica Ave #14", distanceMiles: 0.88, propertyType: "condo", beds: 2, sqft: 1000, price: 176000, date: daysAgo(80) }),
    ],
    schools: [
      { name: "Lincoln Elementary", level: "elementary", rating: 7, distanceMiles: 0.4, assigned: "unknown", attribution: "School ratings by FixtureSchools, 2026." },
      { name: "Jefferson Middle School", level: "middle", rating: 4, distanceMiles: 1.2, assigned: "unknown", attribution: "School ratings by FixtureSchools, 2026." },
      { name: "Booker High School", level: "high", rating: 3, distanceMiles: 2.3, assigned: "unknown", attribution: "School ratings by FixtureSchools, 2026." },
    ],
    advisoryFlags: [
      { title: "HOA special assessment mentioned", detail: "The listing mentions a pending special assessment. It is not in the numbers; ask for the HOA minutes.", tone: "poor" },
      { title: "Rental restrictions", detail: "Some condo associations cap the share of rented units. Confirm before offering.", tone: "ok" },
    ],
    dataNotes: [
      { section: "rentComps", severity: "warning", message: "Fewer than three same-size rent comps were found nearby, so different-size listings were used and size-adjusted." },
      { section: "schools", severity: "info", message: "School assignment is not confirmed for any school; confirm with the district." },
    ],
  });
}

// ---------------------------------------------------------------------------------------------
// Degraded: the provider timed out. No rent comps, sale comps, or schools; rent was supplied by the user.
// ---------------------------------------------------------------------------------------------
export function degradedAnalysis(): Analysis {
  return build({
    id: "an_degraded",
    property: {
      formattedAddress: "77 County Road 14, Marquette, MI 49855",
      line1: "77 County Road 14",
      city: "Marquette",
      state: "MI",
      zip: "49855",
      propertyType: "single_family",
      beds: 3,
    },
    price: { value: 250000, source: "provided" },
    rent: { value: 1700, source: "provided" },
    overrides: {},
    rentComps: null,
    saleComps: null,
    schools: null,
    advisoryFlags: [],
    dataNotes: [
      { section: "rentComps", severity: "warning", message: "Rent comparables could not be loaded (provider timed out). The rent shown is the figure you supplied." },
      { section: "saleComps", severity: "warning", message: "Sale comparables could not be loaded, so the price was not checked against nearby sales." },
      { section: "schools", severity: "warning", message: "School data could not be loaded." },
      { section: "property", severity: "info", message: "Size, year built, and tax details were not available; property tax and insurance are estimated defaults." },
    ],
  });
}

export function modelFor(analysis: Analysis, options: Partial<ReportOptions> = {}): ReportModel {
  return { analysis, options: { watermark: false, ...options }, generatedAt: "2026-10-04T12:00:00.000Z", version: 1 };
}

export const fixtureModels = (): Record<"strong" | "marginal" | "degraded", ReportModel> => ({
  strong: modelFor(strongAnalysis(), { recipientName: "Dana Whitfield", preparedBy: "A. Investor", note: "Dana, here is the Indianapolis duplex-alternative we talked about. Happy to walk through the numbers." }),
  marginal: modelFor(marginalAnalysis()),
  degraded: modelFor(degradedAnalysis()),
});

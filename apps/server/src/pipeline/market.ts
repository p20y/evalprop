import type {
  CompResult,
  DataNote,
  MarketData,
  PropertyFacts,
  Provenance,
  School,
} from "@evalprop/shared";
import { selectRentComps, selectSaleComps, type SaleCompResult } from "@evalprop/comps";
import type { ProviderResult, RentEstimate } from "@evalprop/data";
import type { PipelineConfig } from "./config.ts";
import type { Gathered } from "./gather.ts";
import { failureReason, info, warn } from "./notes.ts";

/** Stage 4 (ARCHITECTURE §7.1): turn gathered candidates into comps, schools, and provenance. */

export interface MarketSelection {
  market: MarketData;
  /** The provider's automated rent estimate, with provenance, for the rent fallback. */
  estimate: { value: RentEstimate; provenance: Provenance } | null;
  notes: DataNote[];
}

/** Assigned schools first, then nearby ones not already listed, nearest first. */
export function mergeSchools(assigned: School[] | null, nearby: School[] | null): School[] | null {
  if (assigned === null && nearby === null) return null;
  const out: School[] = [...(assigned ?? [])];
  const seen = new Set(out.map((s) => `${s.name.toLowerCase()}|${s.level}`));
  for (const s of [...(nearby ?? [])].sort((a, b) => a.distanceMiles - b.distanceMiles)) {
    const key = `${s.name.toLowerCase()}|${s.level}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

const okOrNull = <T>(r: ProviderResult<T>): (ProviderResult<T> & { ok: true }) | null => (r.ok ? r : null);

/**
 * Comp selection is pure (`packages/comps`) and takes `now` as a parameter. A failed section is `null` in
 * the saved market data with a warning in `dataNotes`, never an empty list that looks like "looked up, nothing there".
 */
export function selectMarket(args: {
  facts: PropertyFacts;
  gathered: Gathered;
  lookupProvenance: Provenance | null;
  now: Date;
  config: PipelineConfig;
}): MarketSelection {
  const { facts, gathered, lookupProvenance, now, config } = args;
  const notes: DataNote[] = [];
  const provenance: Record<string, Provenance> = {};
  if (lookupProvenance !== null) provenance["property"] = lookupProvenance;

  // When there are no coordinates nothing was searched; the property note already explains it.
  const searched = facts.latitude !== undefined && facts.longitude !== undefined;
  const compsOptions = { now, ...(config.comps !== undefined ? { config: config.comps } : {}) };

  // ---- rent comps
  let rentComps: CompResult | null = null;
  const rentCands = okOrNull(gathered.rentCandidates);
  if (rentCands !== null) {
    rentComps = selectRentComps(facts, rentCands.data, compsOptions);
    provenance["rentComps"] = { ...rentCands.provenance, confidence: rentComps.confidence };
    if (rentComps.estimate === null) {
      notes.push(
        warn("rentComps", "Not enough comparable rentals nearby to estimate rent from comps (see the comps notes for the search steps tried)."),
      );
    } else if (rentComps.confidence === "low") {
      notes.push(warn("rentComps", "Rent comps are low confidence (few or distant matches, or older listings)."));
    }
    if (facts.beds === undefined || facts.sqft === undefined) {
      const missing = [facts.beds === undefined ? "bedrooms" : null, facts.sqft === undefined ? "square footage" : null].filter(Boolean);
      notes.push(info("rentComps", `The subject's ${missing.join(" and ")} is unknown, so comps were matched without it and confidence is capped at medium.`));
    }
  } else if (searched && !gathered.rentCandidates.ok) {
    notes.push(warn("rentComps", `Rental comparables ${failureReason(gathered.rentCandidates)}; data unavailable.`));
  }

  // ---- rent estimate (fallback)
  let estimate: MarketSelection["estimate"] = null;
  const est = okOrNull(gathered.rentEstimate);
  if (est !== null) {
    estimate = { value: est.data, provenance: est.provenance };
    provenance["rentEstimate"] = est.provenance;
  } else if (searched && !gathered.rentEstimate.ok) {
    notes.push(info("rentEstimate", `The provider's automated rent estimate ${failureReason(gathered.rentEstimate)}; data unavailable.`));
  }

  // ---- sale comps
  let saleComps: SaleCompResult | null = null;
  const saleCands = okOrNull(gathered.saleCandidates);
  if (saleCands !== null) {
    saleComps = selectSaleComps(facts, saleCands.data, compsOptions);
    provenance["saleComps"] = { ...saleCands.provenance, confidence: saleComps.confidence };
    if (saleComps.stepReached === "insufficient") {
      notes.push(info("saleComps", "Not enough recent nearby sales to check the list price against comps."));
    }
    const check = saleComps.listPriceCheck;
    if (check !== null && check.flagged) {
      notes.push(
        warn(
          "saleComps",
          `The list price of $${Math.round(check.listPrice).toLocaleString("en-US")} is ${Math.abs(check.differencePct)}% ${check.direction} the $${Math.round(check.impliedValue).toLocaleString("en-US")} implied by nearby sales.`,
        ),
      );
    }
  } else if (searched && !gathered.saleCandidates.ok) {
    notes.push(warn("saleComps", `Sale comparables ${failureReason(gathered.saleCandidates)}; the list price was not checked against nearby sales.`));
  }

  // ---- schools
  const assigned = okOrNull(gathered.assignedSchools);
  const nearby = okOrNull(gathered.nearbySchools);
  const schools = mergeSchools(assigned?.data ?? null, nearby?.data ?? null);
  const schoolsProvenance = assigned?.provenance ?? nearby?.provenance;
  if (schoolsProvenance !== undefined) provenance["schools"] = schoolsProvenance;
  if (schools === null && searched) {
    notes.push(warn("schools", "School data was unavailable, so the schools section is omitted. The verdict is not affected."));
  } else if (searched && assigned === null && nearby !== null) {
    notes.push(info("schools", "Assigned schools were unavailable; only nearby schools are shown, and none is confirmed as the assigned school."));
  }

  return { market: { rentComps, saleComps, schools, provenance }, estimate, notes };
}

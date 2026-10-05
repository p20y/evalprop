import type {
  AnalyzePropertyInput,
  Assumptions,
  CompResult,
  DataNote,
  PropertyFacts,
  Provenance,
  Source,
} from "@evalprop/shared";
import type { RentEstimate } from "@evalprop/data";
import type { PipelineConfig } from "./config.ts";

/**
 * Stage 5 (ARCHITECTURE §7.1): decide, per field, which value wins and where it came from.
 *
 * Precedence is **provided > listing > lookup > assumed default**:
 * - provided: the user's explicit `assumptions` (or a what-if override);
 * - listing: facts the assistant read from the listing (`listing.*`);
 * - lookup: what a data provider returned (property record, rent comps, the provider's rent estimate);
 * - assumed: nothing above had a value, so the engine's conservative default applies (the engine
 *   reports it as `assumed`, and this module never invents one).
 */

export type AssumptionField = keyof Assumptions;

export const ASSUMPTION_FIELDS = [
  "offerPrice",
  "monthlyRent",
  "downPaymentPct",
  "interestRatePct",
  "loanTermYears",
  "closingCostPct",
  "rehabCost",
  "propertyTaxAnnual",
  "insuranceAnnual",
  "hoaMonthly",
  "vacancyPct",
  "maintenancePct",
  "capexPct",
  "managementPct",
  "rentGrowthPct",
  "expenseGrowthPct",
  "appreciationPct",
  "sellingCostPct",
  "holdYears",
] as const satisfies readonly AssumptionField[];

/** A value some source offers for a field. `assumed` is never a candidate: it is what is left when there are none. */
export interface Candidate {
  value: number;
  source: Exclude<Source, "assumed">;
  note?: string;
  provenance?: Provenance;
  /** Marks where a rent came from so later stages can word notes ("estimate" = the provider's automated estimate). */
  tag?: "comps" | "estimate";
}

export type Candidates = Partial<Record<AssumptionField, Candidate[]>>;
export type Chosen = Partial<Record<AssumptionField, Candidate>>;

const PRECEDENCE: Record<Candidate["source"], number> = { provided: 0, listing: 1, lookup: 2 };

/**
 * The winning candidate: the best source wins; among equals the earlier one in the array wins (that is
 * how rent prefers the comps median over the provider's estimate, both "lookup").
 */
export function pickByPrecedence(candidates: readonly Candidate[]): Candidate | undefined {
  let best: Candidate | undefined;
  for (const c of candidates) {
    if (best === undefined || PRECEDENCE[c.source] < PRECEDENCE[best.source]) best = c;
  }
  return best;
}

export function chooseAll(candidates: Candidates): Chosen {
  const chosen: Chosen = {};
  for (const field of ASSUMPTION_FIELDS) {
    const picked = pickByPrecedence(candidates[field] ?? []);
    if (picked !== undefined) chosen[field] = picked;
  }
  return chosen;
}

export interface RentMarket {
  comps: CompResult | null;
  compsProvenance: Provenance | undefined;
  estimate: { value: RentEstimate; provenance: Provenance } | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Rent candidates from the market in the order the precedence ties break: comps median, then the provider's estimate. */
export function rentCandidatesFromMarket(market: RentMarket, config: PipelineConfig): Candidate[] {
  const candidates: Candidate[] = [];
  const { comps, estimate } = market;
  const rank = { low: 0, medium: 1, high: 2 } as const;

  if (comps !== null && comps.estimate !== null) {
    const trusted = rank[comps.confidence] >= rank[config.rentCompsMinConfidence] || comps.comps.length >= config.rentCompsMinCount;
    if (trusted) {
      candidates.push({
        value: comps.estimate.median,
        source: "lookup",
        tag: "comps",
        note: `Median of ${plural(comps.comps.length, "comparable rental")} (${comps.confidence} confidence).`,
        ...(market.compsProvenance !== undefined ? { provenance: market.compsProvenance } : {}),
      });
    }
  }
  if (estimate !== null) {
    candidates.push({
      value: estimate.value.monthlyRent,
      source: "lookup",
      tag: "estimate",
      note: "The data provider's automated rent estimate (low confidence); comparable rentals were not sufficient.",
      provenance: { ...estimate.provenance, confidence: "low" },
    });
  }
  return candidates;
}

/** Candidates for a fresh analysis, from what the user supplied and what the providers returned. */
export function candidatesForAnalysis(args: {
  input: AnalyzePropertyInput;
  lookedUp: PropertyFacts | null;
  lookupProvenance: Provenance | null;
  rent: RentMarket;
  config: PipelineConfig;
}): { candidates: Candidates; notes: DataNote[] } {
  const { input, lookedUp, lookupProvenance, rent, config } = args;
  const provided = input.assumptions ?? {};
  const listing = input.listing;
  const candidates: Candidates = {};
  const add = (field: AssumptionField, c: Candidate | undefined) => {
    if (c !== undefined) (candidates[field] ??= []).push(c);
  };
  const lookup = (value: number | undefined, note?: string): Candidate | undefined =>
    value === undefined
      ? undefined
      : { value, source: "lookup", ...(note !== undefined ? { note } : {}), ...(lookupProvenance !== null ? { provenance: lookupProvenance } : {}) };
  const fromListing = (value: number | undefined, note?: string): Candidate | undefined =>
    value === undefined ? undefined : { value, source: "listing", ...(note !== undefined ? { note } : {}) };

  // Every field the user can set: provided wins.
  for (const field of ASSUMPTION_FIELDS) {
    const v = provided[field];
    if (v !== undefined) add(field, { value: v, source: "provided" });
  }

  // Purchase price: offer, then the listing's price, then the provider's list price.
  add("offerPrice", fromListing(listing?.price, "The asking price from the listing."));
  add("offerPrice", lookup(lookedUp?.listPrice, "The provider's list price for this property."));

  // Taxes and HOA: the listing, then the property record.
  add("propertyTaxAnnual", fromListing(listing?.taxesAnnual, "Annual property tax from the listing."));
  add("propertyTaxAnnual", lookup(lookedUp?.taxesAnnual, "Annual property tax from the property record."));
  add("hoaMonthly", fromListing(listing?.hoaMonthly, "Monthly HOA from the listing."));
  add("hoaMonthly", lookup(lookedUp?.hoaMonthly, "Monthly HOA from the property record."));

  // Rent: the listing's actual rent (zero means vacant, not a rent), then the market.
  const notes: DataNote[] = [];
  add(
    "monthlyRent",
    listing?.monthlyRentActual !== undefined && listing.monthlyRentActual > 0
      ? { value: listing.monthlyRentActual, source: "listing", note: "The rent actually being collected, from the listing." }
      : undefined,
  );
  for (const c of rentCandidatesFromMarket(rent, config)) add("monthlyRent", c);
  if (listing?.monthlyRentActual === 0) {
    notes.push({ section: "rent", severity: "info", message: "The listing's actual rent of $0 was ignored (a vacant unit is not a rent); rent comes from comps or an estimate instead." });
  }
  return { candidates, notes };
}

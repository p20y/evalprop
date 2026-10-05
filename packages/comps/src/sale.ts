import type { Comp, CompResult, Confidence, LadderStep, PropertyFacts, SaleListing } from "@evalprop/shared";
import { type CompsOptions, resolveConfig } from "./config.ts";
import {
  type Base,
  type PoolItem,
  ageInDays,
  capConfidence,
  dedupeMostRecent,
  finalizePool,
  fmtMiles,
  money,
  normalizeAddress,
  pickTier,
  typeCompatible,
  withinPct,
} from "./ladder.ts";
import { recencyWeight, weightedQuantile } from "./stats.ts";

/** The subject facts sale-comp selection reads. A full `PropertyFacts` satisfies this. */
export type SaleSubject = Pick<PropertyFacts, "propertyType" | "beds" | "sqft" | "listPrice">;

export interface ListPriceCheck {
  listPrice: number;
  /** Median price per sqft of the comps times the subject's sqft. */
  impliedValue: number;
  /** (listPrice - impliedValue) / impliedValue, in percent. Positive means the list price is above the comps. */
  differencePct: number;
  /** True when |differencePct| exceeds `config.sale.listPriceFlagPct`. */
  flagged: boolean;
  direction: "above" | "below" | "in-line";
}

/** A `CompResult` (so it fits `Analysis.market.saleComps`) plus the sale-specific numbers. */
export interface SaleCompResult extends CompResult {
  /** Recency-weighted median price per sqft of the comps used; null when there are none. */
  medianPricePerSqft: number | null;
  /** Price per sqft of each returned comp, keyed by comp id (the shared `Comp` has no field for it). */
  pricePerSqft: Record<string, number>;
  /** Null when the subject has no list price or no size, or there are no comps. */
  listPriceCheck: ListPriceCheck | null;
}

const TIER_STEPS = ["strict-0.5mi", "strict-1mi", "strict-2mi"] as const satisfies readonly LadderStep[];

/**
 * Ranks sale comps for the "is the list price in line?" check (PRODUCT E4.2).
 * Same radii ladder as rent (0.5, 1, 2 mi; first step with >= targetComps, else the narrowest with
 * >= minComps), but a single size band (no relaxed step): same type, sqft within
 * `sale.sqftTolerancePct`, beds within `sale.bedDelta`. Comps are nearest first, each with price per
 * sqft; the estimate is the recency-weighted 25th/50th/75th percentile price per sqft times the
 * subject's sqft. Active and pending listings are excluded unless `sale.statuses` says otherwise.
 */
export function selectSaleComps(
  subject: SaleSubject,
  candidates: readonly SaleListing[],
  options: CompsOptions,
): SaleCompResult {
  const cfg = resolveConfig(options.config);
  const sc = cfg.sale;
  const notes: string[] = [];

  let unreadable = 0;
  let tooOld = 0;
  let noSize = 0;
  const fresh: Base<SaleListing>[] = [];
  for (const l of candidates) {
    if (!sc.statuses.includes(l.status)) continue;
    const age = ageInDays(options.now, l.date);
    if (age === null) unreadable++;
    else if (age > sc.recencyDays) tooOld++;
    else if (l.sqft === undefined) noSize++;
    else fresh.push({ src: l, id: l.id, address: l.address, distance: l.distanceMiles, ageDays: age });
  }
  const { kept: bases, removed: duplicates } = dedupeMostRecent(
    fresh,
    (b) => `${normalizeAddress(b.address)}|${b.src.beds ?? ""}|${b.src.sqft ?? ""}`,
  );

  const sSqft = subject.sqft;
  const sBeds = subject.beds;
  if (sSqft === undefined) notes.push("Subject size unknown; sale comps were not size-filtered and no implied value can be computed.");

  const items: PoolItem<SaleListing>[] = [];
  for (const b of bases) {
    const l = b.src;
    const sqft = l.sqft as number;
    if (!typeCompatible(subject.propertyType, l.propertyType, cfg)) continue;
    if (sBeds !== undefined && l.beds !== undefined && Math.abs(l.beds - sBeds) > sc.bedDelta) continue;
    if (sSqft !== undefined && !withinPct(sqft, sSqft, sc.sqftTolerancePct)) continue;
    items.push({ ...b, value: l.price / sqft, group: 1, cls: "same-size" });
  }
  const pools = cfg.radiiMiles.map((r) => finalizePool(items.filter((i) => i.distance <= r), cfg));
  const sizes = pools.map((p) => p.kept.length);
  const pick = pickTier(sizes, cfg.targetComps, cfg.minComps);

  const qualityNotes = (radius: number | null, kept: PoolItem<SaleListing>[], trimmed: PoolItem<SaleListing>[]): string[] => {
    const out: string[] = [];
    const dupes = duplicates.filter((d) => radius === null || d.distance <= radius).length;
    if (dupes > 0) out.push(`Removed ${dupes} duplicate listing${dupes === 1 ? "" : "s"} of the same property, keeping the most recent.`);
    if (trimmed.length > 0) {
      out.push(`Excluded ${trimmed.length} outlier${trimmed.length === 1 ? "" : "s"} by IQR fence (${trimmed.map((t) => `$${Math.round(t.value)}/sqft`).join(", ")}).`);
    }
    if (tooOld > 0) out.push(`Excluded ${tooOld} sale${tooOld === 1 ? "" : "s"} older than ${sc.recencyDays} days.`);
    if (noSize > 0) out.push(`Ignored ${noSize} listing${noSize === 1 ? "" : "s"} with no size (price per sqft cannot be computed).`);
    if (unreadable > 0) out.push(`Ignored ${unreadable} listing${unreadable === 1 ? "" : "s"} with an unreadable date.`);
    const unsold = kept.filter((k) => k.src.status !== "sold").length;
    if (unsold > 0) out.push(`${unsold} of ${kept.length} comps are active or pending listings, not closed sales.`);
    return out;
  };

  if (pick === null) {
    const widest = cfg.radiiMiles[cfg.radiiMiles.length - 1] as number;
    notes.push(
      `Insufficient sale comps: fewer than ${cfg.minComps} usable sales within ${widest} mi after quality filters (best step had ${Math.max(0, ...sizes)}). The list price cannot be checked against comps.`,
      ...qualityNotes(null, [], []),
    );
    return {
      estimate: null,
      comps: [],
      stepReached: "insufficient",
      radiusUsedMiles: null,
      confidence: "low",
      notes,
      medianPricePerSqft: null,
      pricePerSqft: {},
      listPriceCheck: null,
    };
  }

  const pool = pools[pick] as (typeof pools)[number];
  const radius = cfg.radiiMiles[pick] as number;
  const n = pool.kept.length;
  let confidence: Confidence = n >= cfg.targetComps && radius <= cfg.highConfidenceRadiusMiles ? "high" : "medium";
  if (sSqft === undefined) confidence = capConfidence(confidence, "medium");

  notes.push(`Used ${n} sale comp${n === 1 ? "" : "s"} within ${radius} mi, nearest first.`);
  if (n < cfg.targetComps) {
    notes.push(`No step reached ${cfg.targetComps} sale comps; used the narrowest step with at least ${cfg.minComps}.`);
  }
  notes.push(...qualityNotes(radius, pool.kept, pool.trimmed));
  if (pool.capped > 0) notes.push(`Showing the nearest ${n} comps; ${pool.capped} more matched.`);

  const points = pool.kept.map((k) => ({ value: k.value, weight: recencyWeight(k.ageDays, sc.recencyHalfLifeDays) }));
  const ppsfLow = weightedQuantile(points, 0.25);
  const ppsfMid = weightedQuantile(points, 0.5);
  const ppsfHigh = weightedQuantile(points, 0.75);
  const medianPricePerSqft = round2(ppsfMid);
  const estimate =
    sSqft === undefined
      ? null
      : {
          low: Math.round(ppsfLow * sSqft),
          median: Math.round(ppsfMid * sSqft),
          high: Math.round(ppsfHigh * sSqft),
        };

  const pricePerSqft: Record<string, number> = {};
  const comps: Comp[] = pool.kept.map((k) => {
    const ppsf = round2(k.value);
    pricePerSqft[k.id] = ppsf;
    return toComp(k, ppsf);
  });

  let listPriceCheck: ListPriceCheck | null = null;
  if (subject.listPrice !== undefined && estimate !== null && estimate.median > 0) {
    const differencePct = ((subject.listPrice - estimate.median) / estimate.median) * 100;
    const flagged = Math.abs(differencePct) > sc.listPriceFlagPct;
    const direction = !flagged ? "in-line" : differencePct > 0 ? "above" : "below";
    listPriceCheck = {
      listPrice: subject.listPrice,
      impliedValue: estimate.median,
      differencePct: round2(differencePct),
      flagged,
      direction,
    };
    if (flagged) {
      notes.push(
        `List price ${money(subject.listPrice)} is ${Math.abs(round2(differencePct))}% ${direction} the ${money(estimate.median)} implied by nearby sales (median $${Math.round(ppsfMid)}/sqft); more than the ${sc.listPriceFlagPct}% threshold.`,
      );
    }
  }

  return {
    estimate,
    comps,
    stepReached: TIER_STEPS[pick] as LadderStep,
    radiusUsedMiles: radius,
    confidence,
    notes,
    medianPricePerSqft,
    pricePerSqft,
    listPriceCheck,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toComp(item: PoolItem<SaleListing>, ppsf: number): Comp {
  const l = item.src;
  const comp: Comp = {
    id: l.id,
    address: l.address,
    distanceMiles: l.distanceMiles,
    amount: l.price,
    kind: l.status,
    date: l.date,
    matchClass: "same-size",
    matchReason: `Similar size, $${Math.round(ppsf)}/sqft, ${fmtMiles(l.distanceMiles)}`,
  };
  if (l.beds !== undefined) comp.beds = l.beds;
  if (l.baths !== undefined) comp.baths = l.baths;
  if (l.sqft !== undefined) comp.sqft = l.sqft;
  return comp;
}

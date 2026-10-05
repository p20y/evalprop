import type { Comp, CompResult, Confidence, LadderStep, PropertyFacts, RentListing } from "@evalprop/shared";
import { type CompsConfig, type CompsOptions, resolveConfig } from "./config.ts";
import {
  type Base,
  type PoolItem,
  ageInDays,
  capConfidence,
  dedupeMostRecent,
  demote,
  finalizePool,
  fmtMiles,
  money,
  normalizeAddress,
  pickTier,
  typeCompatible,
  withinPct,
} from "./ladder.ts";
import { recencyWeight, weightedQuantile } from "./stats.ts";

/** The subject facts rent-comp selection reads. A full `PropertyFacts` satisfies this. */
export type RentSubject = Pick<PropertyFacts, "propertyType" | "beds" | "baths" | "sqft" | "unitsInBuilding">;

const TIER_STEPS = ["strict-0.5mi", "strict-1mi", "strict-2mi"] as const satisfies readonly LadderStep[];

/**
 * Chooses rent comps by the ladder in ARCHITECTURE §9 / PRODUCT §4. Pure and deterministic:
 * the same input yields the same output in the same order; `now` is a parameter.
 *
 * Ladder (first step that works wins; nothing farther is ever added to pad a result):
 *   1. same building (same type, beds, size band), counted toward every strict step;
 *   2-4. strict matches (same type, same beds, baths +/-1, sqft +/-15%, or +/-10% for a unit in a
 *        multi-unit building) at 0.5, 1, then 2 miles;
 *   5. relaxed matches (sqft +/-30% OR beds +/-1), size-adjusted by rent per sqft, within the same radii;
 *   6. insufficient (estimate null, confidence low).
 * Strict matching is exhausted across ALL radii before size is relaxed.
 *
 * "Stop when enough": within a ladder (strict, then relaxed), take the first step with >= targetComps
 * (5). If no step reaches 5, take the NARROWEST step with >= minComps (3); that result is at best medium
 * confidence. If no step reaches 3, move to the next ladder.
 */
export function selectRentComps(
  subject: RentSubject,
  candidates: readonly RentListing[],
  options: CompsOptions,
): CompResult {
  const cfg = resolveConfig(options.config);
  const primary = runLadder(subject, candidates, options.now, cfg, cfg.recencyDays);
  if (primary.step !== "insufficient") return toResult(primary);

  if (cfg.staleFallbackDays > cfg.recencyDays) {
    const extended = runLadder(subject, candidates, options.now, cfg, cfg.staleFallbackDays);
    if (extended.step !== "insufficient") {
      extended.confidence = demote(extended.confidence);
      extended.notes.unshift(
        `Fewer than ${cfg.minComps} usable comps within ${cfg.recencyDays} days, so listings up to ${cfg.staleFallbackDays} days old were included; confidence lowered.`,
      );
      return toResult(extended);
    }
  }
  return toResult(primary);
}

interface Run {
  step: LadderStep;
  radius: number | null;
  comps: Comp[];
  estimate: { low: number; median: number; high: number } | null;
  confidence: Confidence;
  notes: string[];
}

function toResult(r: Run): CompResult {
  return {
    estimate: r.estimate,
    comps: r.comps,
    stepReached: r.step,
    radiusUsedMiles: r.radius,
    confidence: r.confidence,
    notes: r.notes,
  };
}

function runLadder(
  subject: RentSubject,
  candidates: readonly RentListing[],
  now: Date,
  cfg: CompsConfig,
  windowDays: number,
): Run {
  const notes: string[] = [];
  const qualityNotes: string[] = [];

  // ---- quality filters: readable date, inside the recency window, one listing per unit ----
  let unreadable = 0;
  let tooOld = 0;
  const fresh: Base<RentListing>[] = [];
  for (const l of candidates) {
    const age = ageInDays(now, l.date);
    if (age === null) unreadable++;
    else if (age > windowDays) tooOld++;
    else fresh.push({ src: l, id: l.id, address: l.address, distance: l.distanceMiles, ageDays: age });
  }
  const { kept: bases, removed: duplicates } = dedupeMostRecent(
    fresh,
    (b) => `${normalizeAddress(b.address)}|${b.src.beds}|${b.src.sqft ?? ""}`,
  );

  // ---- subject profile and unit-mix awareness ----
  const sBeds = subject.beds;
  const sBaths = subject.baths;
  const sSqft = subject.sqft;
  const multiUnit = (subject.unitsInBuilding ?? 0) > 1 || bases.some((b) => b.src.sameBuilding === true);
  const tol = multiUnit ? cfg.multiUnitSqftTolerancePct : cfg.strictSqftTolerancePct;
  if (sBeds === undefined) notes.push("Subject bedroom count unknown; bedrooms were not used for matching.");
  if (sSqft === undefined) notes.push("Subject size unknown; size was not used for matching and no size adjustment is possible.");
  if (sBaths === undefined) notes.push("Subject bathroom count unknown; bathrooms were not used for matching.");
  const missingKeyFacts = sBeds === undefined || sSqft === undefined;

  const isStrict = (l: RentListing): boolean =>
    typeCompatible(subject.propertyType, l.propertyType, cfg) &&
    (sBeds === undefined || l.beds === sBeds) &&
    (sBaths === undefined || l.baths === undefined || Math.abs(l.baths - sBaths) <= cfg.strictBathDelta) &&
    (sSqft === undefined || (l.sqft !== undefined && withinPct(l.sqft, sSqft, tol)));

  const inRange = (b: Base<RentListing>, radius: number): boolean => b.src.sameBuilding === true || b.distance <= radius;

  const finish = (
    step: LadderStep,
    radius: number | null,
    kept: PoolItem<RentListing>[],
    trimmed: PoolItem<RentListing>[],
    capped: number,
    confidence: Confidence,
  ): Run => {
    const withinRadius = (b: Base<RentListing>) => radius === null || inRange(b, radius);
    const dupes = duplicates.filter(withinRadius).length;
    if (dupes > 0) qualityNotes.push(`Removed ${dupes} duplicate listing${dupes === 1 ? "" : "s"} of the same unit, keeping the most recent.`);
    if (trimmed.length > 0) {
      const vals = trimmed.map((t) => money(t.value)).join(", ");
      qualityNotes.push(`Excluded ${trimmed.length} outlier${trimmed.length === 1 ? "" : "s"} by IQR fence (${vals}/mo).`);
    }
    if (capped > 0) qualityNotes.push(`Showing the ${kept.length} highest-priority comps; ${capped} more matched.`);
    if (tooOld > 0) qualityNotes.push(`Excluded ${tooOld} listing${tooOld === 1 ? "" : "s"} older than ${windowDays} days.`);
    if (unreadable > 0) qualityNotes.push(`Ignored ${unreadable} listing${unreadable === 1 ? "" : "s"} with an unreadable date.`);
    const asking = kept.filter((k) => k.src.kind === "asking").length;
    if (asking > 0) qualityNotes.push(`${asking} of ${kept.length} comps are asking rents, not confirmed leases.`);

    let conf = confidence;
    if (missingKeyFacts) conf = capConfidence(conf, "medium");

    if (kept.length === 0) {
      return { step, radius, comps: [], estimate: null, confidence: "low", notes: [...notes, ...qualityNotes] };
    }
    const points = kept.map((k) => ({ value: k.value, weight: recencyWeight(k.ageDays, cfg.recencyHalfLifeDays) }));
    const estimate = {
      low: Math.round(weightedQuantile(points, 0.25)),
      median: Math.round(weightedQuantile(points, 0.5)),
      high: Math.round(weightedQuantile(points, 0.75)),
    };
    const comps = kept.map((k) => toComp(k, sSqft));
    return { step, radius, comps, estimate, confidence: conf, notes: [...notes, ...qualityNotes] };
  };

  // ---- strict ladder: same building, then 0.5 / 1 / 2 mi ----
  const strictItems: PoolItem<RentListing>[] = [];
  for (const b of bases) {
    if (!isStrict(b.src)) continue;
    const same = b.src.sameBuilding === true;
    strictItems.push({ ...b, value: b.src.rent, group: same ? 0 : 1, cls: same ? "same-building" : "same-size" });
  }
  const strictPools = [
    finalizePool(strictItems.filter((i) => i.src.sameBuilding === true), cfg),
    ...cfg.radiiMiles.map((r) => finalizePool(strictItems.filter((i) => inRange(i, r)), cfg)),
  ];
  const strictSizes = strictPools.map((p) => p.kept.length);
  const strictPick = pickTier(strictSizes, cfg.targetComps, cfg.minComps);
  if (strictPick !== null) {
    const pool = strictPools[strictPick] as (typeof strictPools)[number];
    const isSameBuildingStep = strictPick === 0;
    const radius = isSameBuildingStep ? 0 : (cfg.radiiMiles[strictPick - 1] as number);
    const step: LadderStep = isSameBuildingStep ? "same-building" : (TIER_STEPS[strictPick - 1] as LadderStep);
    const n = pool.kept.length;
    const confidence: Confidence = n >= cfg.targetComps && radius <= cfg.highConfidenceRadiusMiles ? "high" : "medium";

    const sizeText = sSqft === undefined ? "" : `, sqft within ${tol}%`;
    const what = `same type${sBeds === undefined ? "" : ", same beds"}${sBaths === undefined ? "" : `, baths within ${cfg.strictBathDelta}`}${sizeText}`;
    notes.push(
      isSameBuildingStep
        ? `Used ${n} same-building comp${n === 1 ? "" : "s"} (${what}).`
        : `Used ${n} strict match${n === 1 ? "" : "es"} within ${radius} mi (${what}).`,
    );
    if (n < cfg.targetComps) {
      notes.push(
        `No step reached ${cfg.targetComps} strict matches; used the narrowest step with at least ${cfg.minComps} (${strictSizesText(strictSizes, cfg)}).`,
      );
    } else if (strictPick > 1 || (strictPick === 1 && strictSizes[0] !== undefined && strictSizes[0] > 0)) {
      notes.push(`Closer steps had fewer than ${cfg.targetComps} strict matches (${strictSizesText(strictSizes.slice(0, strictPick), cfg)}).`);
    }
    if (multiUnit) notes.push(`Subject is in a multi-unit building, so the size band was tightened to ${tol}%.`);
    return finish(step, radius, pool.kept, pool.trimmed, pool.capped, confidence);
  }

  // ---- relaxed ladder: needs sizes on both sides to adjust by rent per sqft ----
  if (sSqft === undefined) {
    notes.push(
      `Insufficient comps: no step had ${cfg.minComps} strict matches, and relaxed matching needs the subject's size to adjust rent per sqft. Use the provider's automated estimate or enter your own rent.`,
    );
    return finish("insufficient", null, [], [], 0, "low");
  }
  const relaxedItems: PoolItem<RentListing>[] = [];
  for (const b of bases) {
    const l = b.src;
    if (l.sqft === undefined || !typeCompatible(subject.propertyType, l.propertyType, cfg)) continue;
    const bedsOk = sBeds === undefined || Math.abs(l.beds - sBeds) <= cfg.relaxedBedDelta;
    if (!bedsOk && !withinPct(l.sqft, sSqft, cfg.relaxedSqftTolerancePct)) continue;
    if (isStrict(l)) {
      const same = l.sameBuilding === true;
      relaxedItems.push({ ...b, value: l.rent, group: same ? 0 : 1, cls: same ? "same-building" : "same-size" });
    } else {
      const adjusted = Math.max(1, Math.round((l.rent / l.sqft) * sSqft));
      relaxedItems.push({ ...b, value: adjusted, adjusted, group: 2, cls: "different-size" });
    }
  }
  const relaxedPools = cfg.radiiMiles.map((r) => finalizePool(relaxedItems.filter((i) => inRange(i, r)), cfg));
  const relaxedSizes = relaxedPools.map((p) => p.kept.length);
  const relaxedPick = pickTier(relaxedSizes, cfg.targetComps, cfg.minComps);
  if (relaxedPick === null) {
    const widest = cfg.radiiMiles[cfg.radiiMiles.length - 1] as number;
    notes.push(
      `Insufficient comps: no step had ${cfg.minComps} usable comps within ${widest} mi after quality filters (strict best ${Math.max(0, ...strictSizes)}, relaxed best ${Math.max(0, ...relaxedSizes)}). Use the provider's automated estimate or enter your own rent.`,
    );
    return finish("insufficient", null, [], [], 0, "low");
  }
  const rPool = relaxedPools[relaxedPick] as (typeof relaxedPools)[number];
  const radius = cfg.radiiMiles[relaxedPick] as number;
  const different = rPool.kept.filter((k) => k.cls === "different-size").length;
  notes.push(
    `No step had ${cfg.minComps} strict matches within ${cfg.radiiMiles[cfg.radiiMiles.length - 1]} mi, so size was relaxed (sqft within ${cfg.relaxedSqftTolerancePct}% or beds within ${cfg.relaxedBedDelta}) and rents adjusted by rent per sqft to ${sSqft} sqft.`,
    `Used ${rPool.kept.length} comps within ${radius} mi (${rPool.kept.length - different} same-size, ${different} different-size).`,
  );
  const confidence: Confidence = radius <= cfg.mediumRelaxedRadiusMiles ? "medium" : "low";
  return finish("relaxed", radius, rPool.kept, rPool.trimmed, rPool.capped, confidence);
}

function strictSizesText(sizes: readonly number[], cfg: CompsConfig): string {
  const labels = ["same building", ...cfg.radiiMiles.map((r) => `${r} mi`)];
  return sizes.map((n, i) => `${labels[i]}: ${n}`).join(", ");
}

function toComp(item: PoolItem<RentListing>, subjectSqft: number | undefined): Comp {
  const l = item.src;
  const dist = fmtMiles(l.distanceMiles);
  let matchReason: string;
  if (item.cls === "same-building") matchReason = "Same building";
  else if (item.cls === "same-size") matchReason = `Same size, ${dist}`;
  else matchReason = `Different size (${l.beds} bd), adjusted to ${subjectSqft} sqft, ${dist}`;
  const comp: Comp = {
    id: l.id,
    address: l.address,
    distanceMiles: l.distanceMiles,
    amount: l.rent,
    kind: l.kind,
    date: l.date,
    matchClass: item.cls,
    matchReason,
  };
  if (l.beds !== undefined) comp.beds = l.beds;
  if (l.baths !== undefined) comp.baths = l.baths;
  if (l.sqft !== undefined) comp.sqft = l.sqft;
  if (item.adjusted !== undefined) comp.adjustedAmount = item.adjusted;
  return comp;
}

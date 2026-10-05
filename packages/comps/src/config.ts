import type { PropertyType } from "@evalprop/shared";

/**
 * Every tunable threshold of the comp-selection engine lives here (ARCHITECTURE §9, PRODUCT §4).
 * Tuning the engine means editing these defaults (or passing `options.config` per call); it never
 * means touching the selection logic.
 */
export interface CompsConfig {
  /**
   * Search radii in miles, nearest first. Exactly three tiers: they map to the ladder steps
   * `strict-0.5mi`, `strict-1mi`, `strict-2mi` by position, so if you change the numbers the step
   * label keeps its tier name and `radiusUsedMiles` carries the true radius.
   */
  radiiMiles: readonly [number, number, number];

  /**
   * Reserved hook for the density-based radius (ARCHITECTURE §15 open question 6: widen the ladder
   * in low-density areas, up to ~5 miles, with a visible note). NOT implemented and NOT read by the
   * engine; it exists so a later story can wire it in without a config-shape change.
   */
  densityRadius: null;

  /** Stop at the first step with at least this many comps ("enough"). */
  targetComps: number;
  /**
   * Minimum acceptable comps for a step. If no step reaches `targetComps`, the narrowest step with at
   * least this many is used (medium confidence at best). Below this at every radius, the ladder
   * moves on (strict, then relaxed, then insufficient).
   */
  minComps: number;
  /** Most comps ever returned (highest priority first). Must be >= targetComps. */
  maxComps: number;

  /** Listings older than this are excluded (days). */
  recencyDays: number;
  /**
   * Only when the recent window leaves the ladder insufficient: retry with listings up to this old
   * (days), say so in `notes`, and demote confidence one level. Set <= recencyDays to disable.
   */
  staleFallbackDays: number;
  /** A listing this many days old has half the weight of one listed today. */
  recencyHalfLifeDays: number;

  /** Strict rent match: sqft within +/- this percent of the subject. */
  strictSqftTolerancePct: number;
  /**
   * Strict sqft band used instead when the subject is a unit in a multi-unit building
   * (`unitsInBuilding` > 1, or same-building candidates exist): unit mix is tight, so the band is too.
   */
  multiUnitSqftTolerancePct: number;
  /** Strict rent match: baths within +/- this many. */
  strictBathDelta: number;
  /** Relaxed rent match: sqft within +/- this percent, OR beds within +/- `relaxedBedDelta`. */
  relaxedSqftTolerancePct: number;
  relaxedBedDelta: number;

  /** Outlier trimming: values outside [Q1 - m, Q3 + m] are dropped, m = max(k * IQR, minFencePct of median). */
  outlierIqrMultiplier: number;
  outlierMinFencePct: number;
  /** Do not trim when fewer comps than this are in the pool. */
  outlierMinSamples: number;

  /** "High" confidence needs `targetComps` strict comps within this radius (miles). */
  highConfidenceRadiusMiles: number;
  /** "Medium" for relaxed matches needs the result within this radius (miles). */
  mediumRelaxedRadiusMiles: number;

  /** Sets of property types treated as the same unit type. */
  typeEquivalence: readonly (readonly PropertyType[])[];
  /** A listing with no property type matches any subject type (providers often omit it). */
  unknownTypeMatches: boolean;

  sale: SaleConfig;
}

export interface SaleConfig {
  /** Which statuses count as comps. Sold only by default; active asking prices are not evidence of value. */
  statuses: readonly ("sold" | "active" | "pending")[];
  recencyDays: number;
  recencyHalfLifeDays: number;
  /** Sale comp size band: sqft within +/- this percent of the subject. */
  sqftTolerancePct: number;
  /** Sale comp beds within +/- this many (when both are known). */
  bedDelta: number;
  /** Flag when the list price differs from the comps' implied value by more than this percent. */
  listPriceFlagPct: number;
}

export const DEFAULT_COMPS_CONFIG: CompsConfig = {
  radiiMiles: [0.5, 1, 2],
  densityRadius: null,
  targetComps: 5,
  minComps: 3,
  maxComps: 12,
  recencyDays: 180,
  staleFallbackDays: 365,
  recencyHalfLifeDays: 90,
  strictSqftTolerancePct: 15,
  multiUnitSqftTolerancePct: 10,
  strictBathDelta: 1,
  relaxedSqftTolerancePct: 30,
  relaxedBedDelta: 1,
  outlierIqrMultiplier: 1.5,
  outlierMinFencePct: 15,
  outlierMinSamples: 4,
  highConfidenceRadiusMiles: 1,
  mediumRelaxedRadiusMiles: 1,
  typeEquivalence: [["condo", "apartment_unit"]],
  unknownTypeMatches: true,
  sale: {
    statuses: ["sold"],
    recencyDays: 365,
    recencyHalfLifeDays: 180,
    sqftTolerancePct: 25,
    bedDelta: 1,
    listPriceFlagPct: 10,
  },
};

export type CompsConfigOverrides = Partial<Omit<CompsConfig, "sale">> & { sale?: Partial<SaleConfig> };

export interface CompsOptions {
  /** The reference "today". Comp selection never reads the clock. */
  now: Date;
  /** Per-call overrides of `DEFAULT_COMPS_CONFIG`. */
  config?: CompsConfigOverrides;
}

export function resolveConfig(overrides: CompsConfigOverrides | undefined): CompsConfig {
  const { sale, ...rest } = overrides ?? {};
  const cfg: CompsConfig = {
    ...DEFAULT_COMPS_CONFIG,
    ...stripUndefined(rest),
    sale: { ...DEFAULT_COMPS_CONFIG.sale, ...stripUndefined(sale ?? {}) },
  };
  if (cfg.maxComps < cfg.targetComps) cfg.maxComps = cfg.targetComps;
  return cfg;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

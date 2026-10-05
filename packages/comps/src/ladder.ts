import type { Confidence, MatchClass, PropertyType } from "@evalprop/shared";
import type { CompsConfig } from "./config.ts";
import { trimOutliers } from "./stats.ts";

const MS_PER_DAY = 86_400_000;

/** A listing that survived the basic quality filters, before it is assigned to a ladder tier. */
export interface Base<T> {
  src: T;
  id: string;
  address: string;
  distance: number;
  ageDays: number;
}

/** A candidate inside one ladder tier's pool. */
export interface PoolItem<T> extends Base<T> {
  /** The number the statistics run on (rent, size-adjusted rent, or price per sqft). */
  value: number;
  /** Sort priority, lower first (same building, then same size, then different size). */
  group: number;
  cls: MatchClass;
  /** Size-adjusted amount, set for different-size rent comps only (`value` equals it). */
  adjusted?: number;
}

/** Age in days of an ISO date relative to `now`; null when the date cannot be read. Future dates count as 0. */
export function ageInDays(now: Date, date: string): number | null {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now.getTime() - t) / MS_PER_DAY);
}

/** Lowercase, drop punctuation, collapse whitespace. Part of the dedupe key. */
export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Total order: priority group, nearest, most recent, then id (so ties never depend on input order). */
export function compareItems<T>(a: PoolItem<T>, b: PoolItem<T>): number {
  return a.group - b.group || a.distance - b.distance || a.ageDays - b.ageDays || compareStrings(a.id, b.id);
}

export function compareBases<T>(a: Base<T>, b: Base<T>): number {
  return a.ageDays - b.ageDays || a.distance - b.distance || compareStrings(a.id, b.id);
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * One entry per key, keeping the most recent listing (ties: nearest, then lowest id).
 * Returns the survivors and the listings dropped as duplicates.
 */
export function dedupeMostRecent<T>(
  bases: readonly Base<T>[],
  keyOf: (b: Base<T>) => string,
): { kept: Base<T>[]; removed: Base<T>[] } {
  const sorted = [...bases].sort(compareBases);
  const seen = new Set<string>();
  const kept: Base<T>[] = [];
  const removed: Base<T>[] = [];
  for (const b of sorted) {
    const k = keyOf(b);
    if (seen.has(k)) removed.push(b);
    else {
      seen.add(k);
      kept.push(b);
    }
  }
  return { kept, removed };
}

/** Outlier trim, priority order, then cap to `maxComps`. */
export function finalizePool<T>(
  items: readonly PoolItem<T>[],
  cfg: CompsConfig,
): { kept: PoolItem<T>[]; trimmed: PoolItem<T>[]; capped: number } {
  const sorted = [...items].sort(compareItems);
  const { kept, removed } = trimOutliers(sorted, (i) => i.value, {
    iqrMultiplier: cfg.outlierIqrMultiplier,
    minFencePct: cfg.outlierMinFencePct,
    minSamples: cfg.outlierMinSamples,
  });
  return { kept: kept.slice(0, cfg.maxComps), trimmed: removed, capped: Math.max(0, kept.length - cfg.maxComps) };
}

/**
 * Decides which tier of an ordered list of pools (narrowest first) to use:
 * the first pool with at least `target` comps; failing that, the narrowest pool with at least `min`;
 * failing that, null. Wider pools are never used when a narrower one is acceptable and none reaches `target`.
 */
export function pickTier(sizes: readonly number[], target: number, min: number): number | null {
  const enough = sizes.findIndex((n) => n >= target);
  if (enough >= 0) return enough;
  const acceptable = sizes.findIndex((n) => n >= min);
  return acceptable >= 0 ? acceptable : null;
}

export function demote(c: Confidence): Confidence {
  return c === "high" ? "medium" : "low";
}

export function capConfidence(c: Confidence, cap: Confidence): Confidence {
  const order: Confidence[] = ["low", "medium", "high"];
  return order[Math.min(order.indexOf(c), order.indexOf(cap))] as Confidence;
}

export function typeCompatible(
  a: PropertyType | undefined,
  b: PropertyType | undefined,
  cfg: Pick<CompsConfig, "typeEquivalence" | "unknownTypeMatches">,
): boolean {
  if (a === undefined || b === undefined) return cfg.unknownTypeMatches;
  if (a === b) return true;
  return cfg.typeEquivalence.some((set) => set.includes(a) && set.includes(b));
}

export function withinPct(value: number, base: number, pct: number): boolean {
  return Math.abs(value - base) <= (base * pct) / 100 + 1e-9;
}

export function fmtMiles(d: number): string {
  return d > 0 && d < 0.05 ? "<0.1 mi" : `${d.toFixed(1)} mi`;
}

export function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

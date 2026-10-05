/** Pure statistics helpers. No I/O, no clock. */

/** Linear-interpolated quantile (type 7) of an ascending array. */
export function quantile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const first = sorted[0] as number;
  if (n === 1) return first;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (h - lo) * (b - a);
}

export interface Weighted {
  value: number;
  weight: number;
}

/**
 * Weighted quantile. Each point sits at the midpoint of its weight band
 * (position_i = (cumulative weight before i + w_i / 2) / total); values are linearly interpolated
 * between positions and clamped at the ends. With equal weights and three values (100, 200, 300)
 * the 25th percentile is 125 and the median 200.
 */
export function weightedQuantile(points: readonly Weighted[], p: number): number {
  if (points.length === 0) return NaN;
  const sorted = [...points].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  const positions: number[] = [];
  let cum = 0;
  for (const x of sorted) {
    positions.push((cum + x.weight / 2) / total);
    cum += x.weight;
  }
  const lastIdx = sorted.length - 1;
  if (p <= (positions[0] as number)) return (sorted[0] as Weighted).value;
  if (p >= (positions[lastIdx] as number)) return (sorted[lastIdx] as Weighted).value;
  for (let i = 0; i < lastIdx; i++) {
    const p0 = positions[i] as number;
    const p1 = positions[i + 1] as number;
    if (p >= p0 && p <= p1) {
      const v0 = (sorted[i] as Weighted).value;
      const v1 = (sorted[i + 1] as Weighted).value;
      return p1 === p0 ? v0 : v0 + ((p - p0) / (p1 - p0)) * (v1 - v0);
    }
  }
  return (sorted[lastIdx] as Weighted).value;
}

/** Exponential recency weight: 1 today, 0.5 at one half-life. */
export function recencyWeight(ageDays: number, halfLifeDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

export interface FenceOptions {
  iqrMultiplier: number;
  minFencePct: number;
  minSamples: number;
}

/**
 * Splits items into kept and outliers using an IQR fence on `valueOf`. The fence margin is
 * max(k * IQR, minFencePct% of the median) so a tight cluster (IQR 0) does not reject ordinary
 * variation. Order of `items` is preserved in both outputs. Not applied below `minSamples`.
 */
export function trimOutliers<T>(
  items: readonly T[],
  valueOf: (t: T) => number,
  opts: FenceOptions,
): { kept: T[]; removed: T[] } {
  if (items.length < opts.minSamples) return { kept: [...items], removed: [] };
  const sorted = items.map(valueOf).sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const med = quantile(sorted, 0.5);
  const margin = Math.max(opts.iqrMultiplier * (q3 - q1), (opts.minFencePct / 100) * med);
  const lower = q1 - margin;
  const upper = q3 + margin;
  const kept: T[] = [];
  const removed: T[] = [];
  for (const it of items) {
    const v = valueOf(it);
    (v < lower || v > upper ? removed : kept).push(it);
  }
  return { kept, removed };
}

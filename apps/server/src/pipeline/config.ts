import type { Confidence } from "@evalprop/shared";
import type { CompsConfigOverrides } from "@evalprop/comps";

/** Tunable behaviour of the pipeline. Pass overrides through `PipelineContext.config`. */
export interface PipelineConfig {
  /**
   * Overall deadline for all provider work in one run (property lookup plus the parallel gather), in
   * milliseconds. ARCHITECTURE §7.4: 5 s. Per-call timeouts live in the gateway (3.5 s). When the
   * deadline passes, calls still pending are treated as timed out and the run continues with what it has.
   */
  deadlineMs: number;
  /** Same `(uid, inputHash)` within this window returns the existing analysis (ARCHITECTURE §5.1 rule 2). */
  idempotencyWindowMs: number;
  /**
   * Candidates are fetched ONCE at this radius (the widest rung of the comp ladder, 2 miles) and
   * `packages/comps` filters them by each rung's distance. The ladder needs successive radii (0.5, 1,
   * 2 mi); calling the provider three times would triple the cost and latency for no new information,
   * because a 2-mile result already contains every closer listing with its `distanceMiles`.
   */
  candidateRadiusMiles: number;
  /** Nearby (non-assigned) schools are added within this radius. */
  nearbySchoolsRadiusMiles: number;
  /**
   * The comps median is used as the rent when the comps confidence is at least this, or when at least
   * `rentCompsMinCount` comps back it (a thin but non-empty comp set still beats the provider's estimate).
   */
  rentCompsMinConfidence: Confidence;
  rentCompsMinCount: number;
  /** Per-call overrides for `packages/comps` thresholds. */
  comps?: CompsConfigOverrides;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  deadlineMs: 5_000,
  idempotencyWindowMs: 10 * 60 * 1000,
  candidateRadiusMiles: 2,
  nearbySchoolsRadiusMiles: 1,
  rentCompsMinConfidence: "medium",
  rentCompsMinCount: 3,
};

export function resolvePipelineConfig(overrides: Partial<PipelineConfig> | undefined): PipelineConfig {
  const defined = Object.fromEntries(Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined));
  return { ...DEFAULT_PIPELINE_CONFIG, ...defined };
}

import {
  AnalysisSchema,
  type Analysis,
  type DataNote,
  type PropertyFacts,
  type ToolError,
} from "@evalprop/shared";
import { ENGINE_VERSION } from "@evalprop/engine";
import { systemClock, type Clock, type UsageRecord } from "@evalprop/data";
import { newId as randomId } from "../repos/ids.ts";
import type { CreateResult, UsageEvent } from "../repos/types.ts";
import { resolvePipelineConfig, type PipelineConfig } from "./config.ts";
import { noopQuota, type QuotaGate, type QuotaKind } from "./quota.ts";
import type { PipelineContext, PipelineFailure } from "./types.ts";
import { PIPELINE_VERSION } from "./version.ts";

/** Shared plumbing for `runAnalysis` and `runWhatIf`: dependencies with defaults, stage timing, quota, persistence. */

export interface Runtime {
  ctx: PipelineContext;
  clock: Clock;
  quota: QuotaGate;
  config: PipelineConfig;
  newId: (prefix: string) => string;
  reportUrl: (analysisId: string) => string;
  /** Runs `fn`, recording its wall-clock duration under `name` (millisecond granularity from the injected clock). */
  stage: <T>(name: string, fn: () => Promise<T> | T) => Promise<T>;
  timings: Record<string, number>;
  nowIso: () => string;
}

export function createRuntime(ctx: PipelineContext): Runtime {
  const clock = ctx.clock ?? systemClock;
  const timings: Record<string, number> = {};
  return {
    ctx,
    clock,
    quota: ctx.quota ?? noopQuota,
    config: resolvePipelineConfig(ctx.config),
    newId: ctx.newId ?? randomId,
    reportUrl: ctx.reportUrl ?? ((id) => `/report/${id}`),
    timings,
    nowIso: () => new Date(clock.now()).toISOString(),
    stage: async (name, fn) => {
      const start = clock.now();
      try {
        return await fn();
      } finally {
        timings[name] = (timings[name] ?? 0) + (clock.now() - start);
      }
    },
  };
}

export const fail = (error: ToolError, dataNotes: DataNote[] = [], property?: PropertyFacts): PipelineFailure => ({
  ok: false,
  error,
  dataNotes,
  ...(property !== undefined ? { property } : {}),
});

export const internalFailure = (): PipelineFailure =>
  fail({ code: "INTERNAL", message: "The analysis could not be completed because of an internal error. Nothing was saved and no quota was used. Try again." });

/** Reserves quota before any provider call. Returns a failure, or the reservation id to give back on failure. */
export async function reserveQuota(rt: Runtime, uid: string, kind: QuotaKind): Promise<{ ok: true; reservationId: string } | PipelineFailure> {
  const r = await rt.quota.reserve(uid, kind);
  if (r.ok) return r;
  return fail({
    code: "QUOTA_EXCEEDED",
    message: r.message ?? "Your allowance for this period is used up.",
    ...(r.upgradeUrl !== undefined ? { upgradeUrl: r.upgradeUrl } : {}),
    ...(r.used !== undefined ? { used: r.used } : {}),
    ...(r.limit !== undefined ? { limit: r.limit } : {}),
  });
}

/** Gives a reservation back. A failure to release is swallowed: it must never mask the original outcome. */
export async function releaseQuota(rt: Runtime, uid: string, kind: QuotaKind, reservationId: string): Promise<void> {
  try {
    await rt.quota.release(uid, kind, reservationId);
  } catch {
    // Reconciliation of a leaked reservation is the quota implementation's job (S12).
  }
}

export interface AnalysisParts {
  id: string;
  ownerUid: string;
  inputHash: string;
  baseAnalysisId?: string;
  property: Analysis["property"];
  assumptions: Analysis["assumptions"];
  evaluation: Analysis["evaluation"];
  market: Analysis["market"];
  advisoryFlags: Analysis["advisoryFlags"];
  dataNotes: DataNote[];
  targetCashOnCashPct: number;
  maxOfferPrice: number | null;
  breakEvenRent: number | null;
}

export function assembleAnalysis(rt: Runtime, parts: AnalysisParts): Analysis {
  return {
    createdAt: rt.nowIso(),
    engineVersion: ENGINE_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    ...parts,
  };
}

/**
 * Validates the analysis against the shared schema and writes it with its usage event in ONE transaction.
 * If an identical request landed first (a race the up-front check cannot see), the repo returns that one
 * and writes nothing.
 */
export async function persist(
  rt: Runtime,
  analysis: Analysis,
  type: UsageEvent["type"],
  providerCalls: readonly UsageRecord[],
): Promise<CreateResult | null> {
  if (!AnalysisSchema.safeParse(analysis).success) return null;
  const calls = providerCalls.map((c) => ({ ...c }));
  const usage: UsageEvent = {
    id: rt.newId("ue"),
    type,
    analysisId: analysis.id,
    providerCalls: calls,
    stageTimingsMs: { ...rt.timings },
    costCents: calls.reduce((sum, c) => sum + c.costCents, 0),
    engineVersion: analysis.engineVersion,
    pipelineVersion: analysis.pipelineVersion,
    createdAt: analysis.createdAt,
  };
  return rt.stage("persist", () => rt.ctx.repo.createIfNew(analysis, usage, { reuseSince: reuseSince(rt) }));
}

/** Start of the idempotency window: an analysis created at or after this instant is a retry's target. */
export function reuseSince(rt: Runtime): string {
  return new Date(rt.clock.now() - rt.config.idempotencyWindowMs).toISOString();
}

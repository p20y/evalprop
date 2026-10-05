import type {
  Analysis,
  CardModel,
  ComparisonRow,
  DataNote,
  PropertyFacts,
  ToolError,
} from "@evalprop/shared";
import type {
  Clock,
  Gateway,
  PropertyProvider,
  RentProvider,
  SalesProvider,
  SchoolsProvider,
} from "@evalprop/data";
import type { AnalysisRepo } from "../repos/types.ts";
import type { PipelineConfig } from "./config.ts";
import type { QuotaGate } from "./quota.ts";

/** A raw provider and the name it is known by in cache keys, usage records, and provenance. */
export interface Named<T> {
  name: string;
  provider: T;
}

/** The four provider capabilities (ARCHITECTURE §10.1). They may all be one object (the fixture provider is). */
export interface PipelineProviders {
  property: Named<PropertyProvider>;
  rent: Named<RentProvider>;
  sales: Named<SalesProvider>;
  schools: Named<SchoolsProvider>;
}

/** Binds one object implementing all four interfaces (`FixtureProvider`, `FakeProvider`) under one name. */
export function singleProviderSet(
  name: string,
  provider: PropertyProvider & RentProvider & SalesProvider & SchoolsProvider,
): PipelineProviders {
  return {
    property: { name, provider },
    rent: { name, provider },
    sales: { name, provider },
    schools: { name, provider },
  };
}

/** Everything the pipeline depends on, injected so tests run with fakes, a fake clock, and no network. */
export interface PipelineContext {
  repo: AnalysisRepo;
  /** The shared gateway (cache, timeouts, retry). Each run takes its own `scope()` to collect its usage records. */
  gateway: Gateway;
  providers: PipelineProviders;
  /** Used for the deadline, stage timings, `createdAt`, the idempotency window and the comps `now`. Default: the system clock. */
  clock?: Clock;
  /** Default: no-op gate. S12 supplies the real one. */
  quota?: QuotaGate;
  config?: Partial<PipelineConfig>;
  /**
   * Where the report for an analysis lives. The pipeline has no opinion on routing (S07/S08 own it); the
   * default is the relative path `/report/{analysisId}`.
   */
  reportUrl?: (analysisId: string) => string;
  /** ID generator (prefix, then random). Default: crypto-random (`repos/ids.ts`). Tests can pin it. */
  newId?: (prefix: string) => string;
}

/** `analyze_property` after the tool layer has authenticated the caller. `input` is validated here, not by the handler. */
export interface AnalysisRequest {
  uid: string;
  /** Raw tool input. Validated with `AnalyzePropertyInputSchema` in stage 1. */
  input: unknown;
}

/** `what_if` after authentication. `input` is validated with `WhatIfInputSchema`. */
export interface WhatIfRequest {
  uid: string;
  input: unknown;
}

/** A typed failure. Nothing was saved and no quota stays reserved. */
export interface PipelineFailure {
  ok: false;
  error: ToolError;
  /** What degraded or was learned before failing (so the assistant can ask the right question, e.g. for a rent). */
  dataNotes: DataNote[];
  /** The property facts, when they were resolved before the failure (`NEEDS_RENT`). */
  property?: PropertyFacts;
}

export interface AnalysisSuccess {
  ok: true;
  analysis: Analysis;
  card: CardModel;
  /** Plain-language summary; every number is generated from `analysis`. */
  summary: string;
  /** True when an analysis for the same input already existed (idempotent retry): nothing new was saved or billed. */
  reused: boolean;
}

export interface WhatIfSuccess extends AnalysisSuccess {
  baseAnalysisId: string;
  /** Before/after for cash flow, cash-on-cash, DSCR, break-even month, 10-year IRR, cash invested. */
  rows: ComparisonRow[];
}

export type AnalysisOutcome = AnalysisSuccess | PipelineFailure;
export type WhatIfOutcome = WhatIfSuccess | PipelineFailure;

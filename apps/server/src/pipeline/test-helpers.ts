import {
  FakeClock,
  FakeProvider,
  FixtureProvider,
  MemoryCacheStore,
  createGateway,
  loadFixtureScenarios,
  type FakeBehavior,
  type FixtureScenario,
  type GatewayConfig,
} from "@evalprop/data";
import type { AnalyzePropertyInput, WhatIfInput } from "@evalprop/shared";
import { InMemoryAnalysisRepo } from "../repos/memory.ts";
import type { AnalysisRepo, UsageRepo } from "../repos/types.ts";
import { runAnalysis } from "./run-analysis.ts";
import { runWhatIf } from "./what-if.ts";
import type { QuotaGate, QuotaKind, QuotaReservation } from "./quota.ts";
import { singleProviderSet, type AnalysisOutcome, type PipelineContext, type WhatIfOutcome } from "./types.ts";
import type { PipelineConfig } from "./config.ts";

/** Addresses of the recorded fixtures (all fictional). */
export const ADDR = {
  condo: "100 Sample Tower Ln Unit 4B, Testville, TX 78701",
  house: "2415 Maple Test Dr, Sampleton, OH 43017",
  rural: "88 County Road 12, Quietfield, MT 59999",
  empty: "7 Placeholder Way, Emptyburg, NE 68001",
  ambiguous: "500 Main St",
  unknown: "1 Nowhere Rd, Faketown, TX 78701",
} as const;

/** A copy of a recorded scenario at a new address and place, with optional edits to its facts. */
export function variantScenario(
  base: string,
  id: string,
  address: string,
  state: string,
  factsEdit: (facts: Record<string, unknown>) => void = () => {},
  scenarioEdit: (scenario: FixtureScenario) => void = () => {},
): FixtureScenario {
  const source = loadFixtureScenarios().find((s) => s.id === base);
  if (source === undefined || !("facts" in source.property)) throw new Error(`no fixture ${base}`);
  const copy = structuredClone(source);
  const facts = (copy.property as { facts: Record<string, unknown> }).facts;
  facts["formattedAddress"] = address;
  facts["line1"] = address.split(",")[0];
  facts["state"] = state;
  facts["latitude"] = (facts["latitude"] as number) + 3;
  facts["longitude"] = (facts["longitude"] as number) + 3;
  factsEdit(facts);
  copy.id = id;
  copy.addresses = [address];
  scenarioEdit(copy);
  return copy;
}

export interface RecordingQuota extends QuotaGate {
  log: string[];
  reservations: number;
  releases: number;
}

/** A quota gate that logs into a shared event list so tests can assert ordering against provider calls. */
export function recordingQuota(events: string[], decide: (kind: QuotaKind) => QuotaReservation = () => ({ ok: true, reservationId: "r1" })): RecordingQuota {
  const q: RecordingQuota = {
    log: events,
    reservations: 0,
    releases: 0,
    async reserve(uid, kind) {
      events.push(`reserve:${kind}`);
      const r = decide(kind);
      if (r.ok) q.reservations += 1;
      return r;
    },
    async release(uid, kind, id) {
      events.push(`release:${kind}:${id}`);
      q.releases += 1;
    },
  };
  return q;
}

export interface Harness {
  ctx: PipelineContext;
  repo: AnalysisRepo & UsageRepo;
  clock: FakeClock;
  provider: FakeProvider;
  events: string[];
  quota: RecordingQuota;
  analyze(input: Partial<AnalyzePropertyInput> | Record<string, unknown>, uid?: string): Promise<AnalysisOutcome>;
  whatIf(input: Partial<WhatIfInput> | Record<string, unknown>, uid?: string): Promise<WhatIfOutcome>;
  /** Drives the fake clock until `p` settles (gateway retries and timeouts wait on fake timers). */
  drive<T>(p: Promise<T>): Promise<T>;
}

export interface HarnessOptions {
  behavior?: ((call: { endpoint: string; callNumber: number }) => FakeBehavior) | FakeBehavior;
  scenarios?: FixtureScenario[];
  repo?: AnalysisRepo & UsageRepo;
  /** Use the production random id generator instead of sequential test ids (needed on a shared emulator). */
  randomIds?: boolean;
  quota?: (events: string[]) => RecordingQuota;
  config?: Partial<PipelineConfig>;
  gateway?: GatewayConfig;
}

export function harness(options: HarnessOptions = {}): Harness {
  const clock = new FakeClock();
  const events: string[] = [];
  const fixtures = new FixtureProvider(options.scenarios ?? loadFixtureScenarios());
  // The FakeProvider delegates "ok" calls to the recorded fixtures and records every call it receives.
  const provider = new FakeProvider({ inner: fixtures, name: "fixture", behavior: options.behavior ?? "ok" });
  const logged = new Proxy(provider, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function" || typeof prop !== "string" || prop === "constructor") return value;
      return (...args: unknown[]) => {
        events.push(`provider:${prop}`);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const gateway = createGateway({ clock, cache: new MemoryCacheStore(), ...options.gateway });
  const repo = options.repo ?? new InMemoryAnalysisRepo();
  const quota = options.quota?.(events) ?? recordingQuota(events);
  let n = 0;
  const ctx: PipelineContext = {
    repo,
    gateway,
    providers: singleProviderSet("fixture", logged),
    clock,
    quota,
    // Readable sequential ids by default; a shared emulator needs the real random ones.
    ...(options.randomIds === true ? {} : { newId: (prefix: string) => `${prefix}_${String(++n).padStart(4, "0")}` }),
    reportUrl: (id) => `https://reports.example.test/${id}`,
    ...(options.config !== undefined ? { config: options.config } : {}),
  };

  async function drive<T>(p: Promise<T>): Promise<T> {
    let settled = false;
    const tracked = p.finally(() => {
      settled = true;
    });
    tracked.catch(() => {});
    for (let i = 0; i < 80 && !settled; i++) await clock.advance(250);
    return tracked;
  }

  return {
    ctx,
    repo,
    clock,
    provider,
    events,
    quota,
    drive,
    analyze: (input, uid = "user_a") => drive(runAnalysis({ uid, input }, ctx)),
    whatIf: (input, uid = "user_a") => drive(runWhatIf({ uid, input }, ctx)),
  };
}

/** Narrowing helpers so a test fails with a readable message instead of a type error. */
export function assertOk<T extends { ok: boolean }>(r: T): asserts r is Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected success, got ${JSON.stringify((r as { error?: unknown }).error)}`);
}

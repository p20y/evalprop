import {
  FixtureProvider,
  MemoryCacheStore,
  createGateway,
  type CacheStore,
} from "@evalprop/data";
import { FakeAuthProvider } from "../auth/fake.ts";
import { singleProviderSet, type PipelineContext } from "../pipeline/index.ts";
import { InMemoryAnalysisRepo } from "../repos/memory.ts";
import type { AnalysisRepo } from "../repos/types.ts";
import { InMemoryReportStore } from "../reports/memory-store.ts";
import type { AnalysisReader, ReportStore } from "../reports/types.ts";
import type { McpHandlerDeps } from "./handler.ts";
import { createReport } from "./create-report.ts";

/** Pipeline runtime with the recorded fixture provider and an in-memory repo and cache: no network, no emulator. */
export function createLocalPipelineRuntime(options: { repo?: AnalysisRepo; cache?: CacheStore } = {}): PipelineContext {
  return {
    repo: options.repo ?? new InMemoryAnalysisRepo(),
    gateway: createGateway({ cache: options.cache ?? new MemoryCacheStore() }),
    providers: singleProviderSet("fixture", new FixtureProvider()),
  };
}

/** Everything `index.ts` hands to `createApp`: the MCP deps plus the stores behind `GET /r/:token`. */
export interface LocalWiring {
  mcp: McpHandlerDeps;
  reports: ReportStore;
  analyses: AnalysisReader;
}

/**
 * The local-dev wiring used by `index.ts`: fake auth (`Authorization: Bearer test-token-<uid>`), fixture
 * providers, and either an in-memory repo (default) or the Firestore emulator (`EVALPROP_REPO=firestore`
 * with `FIRESTORE_EMULATOR_HOST` set, which `pnpm dev` does). The report store is shared between the MCP
 * tools (which mint share links) and the `/r/:token` route (which serves them), so a link in a card opens.
 */
export async function createLocalWiring(env: Record<string, string | undefined>, port: number): Promise<LocalWiring> {
  const baseUrl = (env["BASE_URL"] ?? `http://localhost:${port}`).replace(/\/+$/, "");
  let pipelineRuntime: PipelineContext;
  let reports: ReportStore;
  if (env["EVALPROP_REPO"] === "firestore") {
    // Loaded only on demand so the default path never needs firebase-admin or an emulator.
    const { initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const { FirestoreCacheStore } = await import("@evalprop/data");
    const { FirestoreAnalysisRepo } = await import("../repos/firestore.ts");
    const { FirestoreReportStore } = await import("../reports/firestore-store.ts");
    if (env["FIRESTORE_EMULATOR_HOST"] === undefined) {
      throw new Error("EVALPROP_REPO=firestore is local-dev only and needs FIRESTORE_EMULATOR_HOST (run `pnpm dev`).");
    }
    const db = getFirestore(initializeApp({ projectId: env["GCLOUD_PROJECT"] ?? "demo-evalprop" }, "evalprop-local"));
    pipelineRuntime = createLocalPipelineRuntime({ repo: new FirestoreAnalysisRepo(db), cache: new FirestoreCacheStore(db) });
    reports = new FirestoreReportStore(db);
  } else {
    pipelineRuntime = createLocalPipelineRuntime();
    reports = new InMemoryReportStore();
  }
  const analyses: AnalysisReader = pipelineRuntime.repo;
  const authorizationServers = (env["MCP_AUTH_SERVERS"] ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
  const createReportLink = async (uid: string, analysisId: string): Promise<string> =>
    (await createReport({ analysisId }, uid, { analyses, reports, baseUrl })).reportUrl;
  return {
    mcp: { auth: new FakeAuthProvider(), pipelineRuntime, baseUrl, authorizationServers, createReportLink },
    reports,
    analyses,
  };
}

/** Just the MCP deps of `createLocalWiring` (kept for tests and callers that mount only `/mcp`). */
export async function createLocalMcpDeps(env: Record<string, string | undefined>, port: number): Promise<McpHandlerDeps> {
  return (await createLocalWiring(env, port)).mcp;
}

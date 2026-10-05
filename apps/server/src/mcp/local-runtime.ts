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
import type { McpHandlerDeps } from "./handler.ts";

/** Pipeline runtime with the recorded fixture provider and an in-memory repo and cache: no network, no emulator. */
export function createLocalPipelineRuntime(options: { repo?: AnalysisRepo; cache?: CacheStore } = {}): PipelineContext {
  return {
    repo: options.repo ?? new InMemoryAnalysisRepo(),
    gateway: createGateway({ cache: options.cache ?? new MemoryCacheStore() }),
    providers: singleProviderSet("fixture", new FixtureProvider()),
  };
}

/**
 * The local-dev wiring used by `index.ts`: fake auth (`Authorization: Bearer test-token-<uid>`), fixture
 * providers, and either an in-memory repo (default) or the Firestore emulator (`EVALPROP_REPO=firestore`
 * with `FIRESTORE_EMULATOR_HOST` set, which `pnpm dev` does).
 */
export async function createLocalMcpDeps(env: Record<string, string | undefined>, port: number): Promise<McpHandlerDeps> {
  const baseUrl = (env["BASE_URL"] ?? `http://localhost:${port}`).replace(/\/+$/, "");
  let pipelineRuntime: PipelineContext;
  if (env["EVALPROP_REPO"] === "firestore") {
    // Loaded only on demand so the default path never needs firebase-admin or an emulator.
    const { initializeApp } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const { FirestoreCacheStore } = await import("@evalprop/data");
    const { FirestoreAnalysisRepo } = await import("../repos/firestore.ts");
    if (env["FIRESTORE_EMULATOR_HOST"] === undefined) {
      throw new Error("EVALPROP_REPO=firestore is local-dev only and needs FIRESTORE_EMULATOR_HOST (run `pnpm dev`).");
    }
    const db = getFirestore(initializeApp({ projectId: env["GCLOUD_PROJECT"] ?? "demo-evalprop" }, "evalprop-local"));
    pipelineRuntime = createLocalPipelineRuntime({ repo: new FirestoreAnalysisRepo(db), cache: new FirestoreCacheStore(db) });
  } else {
    pipelineRuntime = createLocalPipelineRuntime();
  }
  const authorizationServers = (env["MCP_AUTH_SERVERS"] ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
  return { auth: new FakeAuthProvider(), pipelineRuntime, baseUrl, authorizationServers };
}

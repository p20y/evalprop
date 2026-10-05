import { createHash } from "node:crypto";
import type { Confidence } from "@evalprop/shared";

/** Logical endpoints the gateway knows about. TTLs and costs are configured per endpoint. */
export type Endpoint =
  | "property.resolve"
  | "rent.candidates"
  | "rent.estimate"
  | "sales.candidates"
  | "schools.assigned"
  | "schools.nearby";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** ARCHITECTURE §10.4: property facts 30d, rent listings 24h, sale comps 7d, schools 90d, estimates 7d. */
export const DEFAULT_TTL_MS: Readonly<Record<Endpoint, number>> = {
  "property.resolve": 30 * DAY,
  "rent.candidates": 24 * HOUR,
  "rent.estimate": 7 * DAY,
  "sales.candidates": 7 * DAY,
  "schools.assigned": 90 * DAY,
  "schools.nearby": 90 * DAY,
};

/**
 * One cached provider response (ARCHITECTURE §6.2, `cache/{key}`).
 * `fetchedAt` is when the provider returned the data (ISO), kept verbatim so a cached result still
 * reports its original fetch time. `expiresAt` is an ISO string here; the Firestore store writes it
 * as a native Timestamp so a Firestore TTL policy can be attached to the field.
 */
export interface CacheEntry {
  provider: string;
  endpoint: string;
  /** The normalized provider payload (the `data` of a successful result). */
  payload: unknown;
  fetchedAt: string;
  expiresAt: string;
  /** Provenance extras carried through so a cache hit reports the same confidence/note. */
  confidence?: Confidence;
  note?: string;
}

/**
 * Storage for cached responses. Implementations must not interpret expiry: the gateway compares
 * `expiresAt` to its own (injectable) clock. Failures should reject; the gateway treats a store
 * error as a miss and never lets it break a provider call.
 */
export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>();

  async get(key: string): Promise<CacheEntry | undefined> {
    const entry = this.entries.get(key);
    return entry === undefined ? undefined : structuredClone(entry);
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.entries.set(key, structuredClone(entry));
  }

  get size(): number {
    return this.entries.size;
  }

  /** Copies of every stored entry (tests and local inspection). */
  values(): CacheEntry[] {
    return [...this.entries.values()].map((e) => structuredClone(e));
  }
}

/** Canonical JSON: object keys sorted recursively, `undefined` dropped, so equal values hash equally. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(obj).sort()) {
    if (obj[k] === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  }
  return `{${parts.join(",")}}`;
}

/** Cache key: sha256 hex of canonical JSON of provider + endpoint + normalized request. */
export function cacheKey(provider: string, endpoint: string, request: unknown): string {
  return createHash("sha256").update(stableStringify({ provider, endpoint, request })).digest("hex");
}

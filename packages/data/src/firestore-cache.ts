import type { Firestore } from "firebase-admin/firestore";
import type { CacheEntry, CacheStore } from "./cache.ts";

export interface FirestoreCacheOptions {
  /** Collection name; ARCHITECTURE §6.2 uses `cache`. */
  collection?: string;
}

/** Admin-SDK Timestamp or Date → ISO string. */
function toIso(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    return (value.toDate() as Date).toISOString();
  }
  return undefined;
}

/**
 * `cache/{key}` in Firestore, Admin SDK only (rules deny all client access). The caller passes an
 * initialised `Firestore`, so this module has no runtime dependency on firebase-admin and the same
 * code runs against the emulator (FIRESTORE_EMULATOR_HOST) and production.
 *
 * `expiresAt` is stored as a native Timestamp (attach a Firestore TTL policy to it to purge
 * expired documents); `fetchedAt` stays an ISO string exactly as the provider reported it.
 */
export class FirestoreCacheStore implements CacheStore {
  private readonly db: Firestore;
  private readonly collection: string;

  constructor(db: Firestore, options: FirestoreCacheOptions = {}) {
    this.db = db;
    this.collection = options.collection ?? "cache";
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const snap = await this.db.collection(this.collection).doc(key).get();
    if (!snap.exists) return undefined;
    const d = snap.data();
    if (d === undefined) return undefined;
    const expiresAt = toIso(d["expiresAt"]);
    // Data read from Firestore is untrusted: a malformed document is a miss, not a crash.
    if (
      typeof d["provider"] !== "string" ||
      typeof d["endpoint"] !== "string" ||
      typeof d["fetchedAt"] !== "string" ||
      expiresAt === undefined ||
      !("payload" in d)
    ) {
      return undefined;
    }
    const entry: CacheEntry = {
      provider: d["provider"],
      endpoint: d["endpoint"],
      payload: d["payload"],
      fetchedAt: d["fetchedAt"],
      expiresAt,
    };
    if (d["confidence"] === "high" || d["confidence"] === "medium" || d["confidence"] === "low") {
      entry.confidence = d["confidence"];
    }
    if (typeof d["note"] === "string") entry.note = d["note"];
    return entry;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const doc: Record<string, unknown> = {
      provider: entry.provider,
      endpoint: entry.endpoint,
      // JSON round trip drops `undefined` fields, which Firestore rejects.
      payload: JSON.parse(JSON.stringify(entry.payload ?? null)),
      fetchedAt: entry.fetchedAt,
      expiresAt: new Date(entry.expiresAt),
    };
    if (entry.confidence !== undefined) doc["confidence"] = entry.confidence;
    if (entry.note !== undefined) doc["note"] = entry.note;
    await this.db.collection(this.collection).doc(key).set(doc);
  }
}

import { CompResultSchema, type RentListing, type SaleListing } from "@evalprop/shared";
import assert from "node:assert/strict";

/** Fixed "today" for every test. Comp selection never reads the clock. */
export const NOW = new Date("2026-10-01T00:00:00Z");

/** ISO date `n` days before NOW. */
export function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

export interface RentOpts {
  address?: string;
  distance?: number;
  type?: RentListing["propertyType"];
  beds?: number;
  baths?: number;
  sqft?: number;
  rent?: number;
  kind?: RentListing["kind"];
  age?: number;
  sameBuilding?: boolean;
}

/** A 1 bd / 1 ba / 730 sqft condo listing 0.3 mi away, leased 30 days ago, unless overridden. */
export function rent(id: string, o: RentOpts = {}): RentListing {
  const l: RentListing = {
    id,
    address: o.address ?? `${id} Main St`,
    distanceMiles: o.distance ?? 0.3,
    propertyType: o.type ?? "condo",
    beds: o.beds ?? 1,
    baths: o.baths ?? 1,
    sqft: o.sqft ?? 730,
    rent: o.rent ?? 2000,
    kind: o.kind ?? "leased",
    date: daysAgo(o.age ?? 30),
  };
  if (o.sameBuilding !== undefined) l.sameBuilding = o.sameBuilding;
  return l;
}

export interface SaleOpts {
  address?: string;
  distance?: number;
  type?: SaleListing["propertyType"];
  beds?: number;
  sqft?: number;
  price?: number;
  status?: SaleListing["status"];
  age?: number;
}

/** A 3 bd / 1000 sqft single-family sale 0.3 mi away, sold 30 days ago, unless overridden. */
export function sale(id: string, o: SaleOpts = {}): SaleListing {
  return {
    id,
    address: o.address ?? `${id} Elm St`,
    distanceMiles: o.distance ?? 0.3,
    propertyType: o.type ?? "single_family",
    beds: o.beds ?? 3,
    sqft: o.sqft ?? 1000,
    price: o.price ?? 320_000,
    status: o.status ?? "sold",
    date: daysAgo(o.age ?? 30),
  };
}

/** Throws if `result` does not satisfy the shared CompResult contract. */
export function assertValidCompResult(result: unknown): void {
  const parsed = CompResultSchema.safeParse(result);
  assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
}

/** Deterministic shuffle (no randomness): a fixed pseudo-random permutation from `seed`. */
export function permute<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

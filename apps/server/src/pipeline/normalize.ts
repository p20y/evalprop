import { createHash } from "node:crypto";
import {
  AnalyzePropertyInputSchema,
  WhatIfInputSchema,
  type AnalyzePropertyInput,
  type Assumptions,
  type ToolError,
  type WhatIfInput,
} from "@evalprop/shared";

/** Stage 1 (ARCHITECTURE §7.1): validate, standardize the address, hash the input. */

export interface NormalizedAnalyze {
  input: AnalyzePropertyInput;
  /** Standardized address string sent to the provider. */
  address: string;
  /** `sha256` of the canonical JSON of everything that defines the request. Identical requests hash identically. */
  inputHash: string;
}

export interface NormalizedWhatIf {
  input: WhatIfInput;
  inputHash: string;
}

export type Normalized<T> = { ok: true; value: T } | { ok: false; error: ToolError };

/**
 * Tidies an address without changing what it says: Unicode-normalizes, collapses whitespace, puts exactly
 * one space after each comma, and drops trailing punctuation. Case is preserved (it is shown to the user);
 * `addressKey` is the case- and punctuation-insensitive form used for hashing.
 */
export function standardizeAddress(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/[\s,.;]+$/g, "")
    .replace(/^[\s,;]+/g, "")
    .trim();
}

/** Lower-case, punctuation-free form of an address, for hashing and comparisons. */
export function addressKey(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** JSON with object keys sorted and `undefined` dropped, so equal values always serialize identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function hashInput(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** First zod issue as a stable tool error: a missing address is `NEEDS_ADDRESS`, anything else names the field. */
function toToolError(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>, hasListingUrl: boolean): ToolError {
  const first = issues[0];
  const path = (first?.path ?? []).map(String);
  if (path[0] === "address") return needsAddress(hasListingUrl);
  const field = path[0] === "assumptions" || path[0] === "overrides" ? path.slice(1).join(".") : path.join(".");
  return {
    code: "INVALID_ASSUMPTION",
    field: field || undefined,
    message: field ? `${field}: ${first?.message ?? "invalid value"}` : (first?.message ?? "Invalid input."),
  };
}

export function needsAddress(hasListingUrl: boolean): ToolError {
  return {
    code: "NEEDS_ADDRESS",
    message: hasListingUrl
      ? "A street address is required. A listing link is not enough on its own because listing sites are never read; please share the property's street address (street, city, state, ZIP)."
      : "A street address is required (street, city, state, ZIP).",
  };
}

const hasUrl = (raw: unknown): boolean =>
  typeof raw === "object" &&
  raw !== null &&
  typeof (raw as { listing?: { url?: unknown } }).listing === "object" &&
  (raw as { listing?: { url?: unknown } }).listing !== null &&
  typeof (raw as { listing: { url?: unknown } }).listing.url === "string";

export function normalizeAnalyze(raw: unknown): Normalized<NormalizedAnalyze> {
  const parsed = AnalyzePropertyInputSchema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: toToolError(parsed.error.issues, hasUrl(raw)) };
  const input = parsed.data;
  const address = standardizeAddress(input.address ?? "");
  if (address === "") return { ok: false, error: needsAddress(input.listing?.url !== undefined) };
  const inputHash = hashInput({
    kind: "analyze",
    address: addressKey(address),
    listing: input.listing,
    assumptions: input.assumptions,
    targetCashOnCashPct: input.targetCashOnCashPct,
    advisoryFlags: input.advisoryFlags,
  });
  return { ok: true, value: { input, address, inputHash } };
}

export function normalizeWhatIf(raw: unknown): Normalized<NormalizedWhatIf> {
  const parsed = WhatIfInputSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = (first?.path ?? []).map(String);
    if (field[0] === "analysisId") {
      return { ok: false, error: { code: "NOT_FOUND", message: "An analysis id is required." } };
    }
    return { ok: false, error: toToolError(parsed.error.issues, false) };
  }
  const input = parsed.data;
  if (Object.values(input.overrides).every((v) => v === undefined)) {
    return {
      ok: false,
      error: { code: "INVALID_ASSUMPTION", message: "Provide at least one assumption to change (for example offerPrice or interestRatePct)." },
    };
  }
  const inputHash = hashInput({ kind: "what_if", analysisId: input.analysisId, overrides: input.overrides satisfies Assumptions });
  return { ok: true, value: { input, inputHash } };
}

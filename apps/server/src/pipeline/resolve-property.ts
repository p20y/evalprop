import {
  PropertyFactsSchema,
  type AnalyzePropertyInput,
  type DataNote,
  type PropertyFacts,
  type PropertyType,
  type Provenance,
  type ToolError,
} from "@evalprop/shared";
import type { ProviderFailure, PropertyProvider } from "@evalprop/data";
import type { Deadline } from "./deadline.ts";
import { failureReason, info, warn } from "./notes.ts";

/** Stage 2 (ARCHITECTURE §7.1): resolve the property, then let what the user/assistant supplied override the lookup. */

export interface ResolvedProperty {
  /** Facts with the user's `listing` fields applied on top of the looked-up record. This is what is saved and shown. */
  facts: PropertyFacts;
  /** The provider's record untouched (null when the lookup failed). It is the "lookup" layer in assumption precedence. */
  lookedUp: PropertyFacts | null;
  provenance: Provenance | null;
  notes: DataNote[];
}

export type ResolveOutcome =
  | { ok: true; value: ResolvedProperty }
  | { ok: false; error: ToolError; notes: DataNote[] };

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP".split(" "),
);

/** "123 Main St, Springfield, IL 62704" -> parts, or null when it does not look like a full US address. */
export function parseAddress(address: string): Pick<PropertyFacts, "formattedAddress" | "line1" | "city" | "state" | "zip"> | null {
  const m = /^(.+?),\s*([^,]+),\s*([A-Za-z]{2})(?:\s+(\d{5})(?:-\d{4})?)?$/.exec(address);
  if (m === null) return null;
  const [, line1, city, state, zip] = m;
  if (line1 === undefined || city === undefined || state === undefined) return null;
  const st = state.toUpperCase();
  if (!US_STATES.has(st)) return null;
  return { formattedAddress: address, line1: line1.trim(), city: city.trim(), state: st, zip: zip ?? "" };
}

const TYPE_SYNONYMS: Record<string, PropertyType> = {
  single_family: "single_family",
  singlefamily: "single_family",
  single_family_residence: "single_family",
  sfr: "single_family",
  sfh: "single_family",
  house: "single_family",
  condo: "condo",
  condominium: "condo",
  townhouse: "townhouse",
  townhome: "townhouse",
  town_house: "townhouse",
  multi_family: "multi_family",
  multifamily: "multi_family",
  duplex: "multi_family",
  triplex: "multi_family",
  fourplex: "multi_family",
  quadplex: "multi_family",
  apartment: "apartment_unit",
  apartment_unit: "apartment_unit",
  other: "other",
};

/** The listing's `propertyType` is free text from an assistant; map it onto our enum or ignore it. */
export function mapPropertyType(raw: string): PropertyType | undefined {
  return TYPE_SYNONYMS[raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")];
}

type Listing = NonNullable<AnalyzePropertyInput["listing"]>;

/**
 * Applies the user's listing fields on top of the base facts. Returns the merged facts plus which fields
 * overrode a different looked-up value or filled a gap, so the report can say so. `description` and the
 * URL are stored as given and never read again by any calculation.
 */
export function mergeListing(
  base: PropertyFacts,
  listing: Listing | undefined,
): { facts: PropertyFacts; used: string[]; ignored: string[] } {
  const facts: PropertyFacts = { ...base };
  const used: string[] = [];
  const ignored: string[] = [];
  if (listing === undefined) return { facts, used, ignored };

  const set = <K extends keyof PropertyFacts>(key: K, value: PropertyFacts[K] | undefined, label: string) => {
    if (value === undefined) return;
    if (facts[key] !== value) used.push(label);
    facts[key] = value;
  };
  set("beds", listing.beds, "beds");
  set("baths", listing.baths, "baths");
  set("sqft", listing.sqft, "square footage");
  set("yearBuilt", listing.yearBuilt, "year built");
  set("listPrice", listing.price, "list price");
  set("taxesAnnual", listing.taxesAnnual, "property taxes");
  set("hoaMonthly", listing.hoaMonthly, "HOA");
  set("daysOnMarket", listing.daysOnMarket, "days on market");
  if (listing.propertyType !== undefined) {
    const mapped = mapPropertyType(listing.propertyType);
    if (mapped === undefined) ignored.push("property type");
    else set("propertyType", mapped, "property type");
  }
  // Stored for display only.
  if (listing.description !== undefined) facts.description = listing.description;
  if (listing.url !== undefined) facts.listingUrl = listing.url;
  return { facts, used, ignored };
}

const listJoin = (items: string[]) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`);

export async function resolveProperty(args: {
  input: AnalyzePropertyInput;
  address: string;
  provider: PropertyProvider;
  deadline: Deadline;
}): Promise<ResolveOutcome> {
  const { input, address, provider, deadline } = args;
  const notes: DataNote[] = [];
  const result = await deadline.race(provider.resolve(address));

  let base: PropertyFacts;
  let lookedUp: PropertyFacts | null = null;
  let provenance: Provenance | null = null;

  if (result.ok) {
    base = result.data;
    lookedUp = result.data;
    provenance = result.provenance;
  } else if (result.code === "AMBIGUOUS") {
    return {
      ok: false,
      notes,
      error: {
        code: "AMBIGUOUS_ADDRESS",
        candidates: result.candidates,
        message: "That address matches more than one property. Ask the user which one they mean, then call again with the full address.",
      },
    };
  } else {
    const failure: ProviderFailure = result;
    const parsed = parseAddress(address);
    const hasPrice = input.listing?.price !== undefined || input.assumptions?.offerPrice !== undefined;
    if (failure.code === "NOT_FOUND" && !hasPrice) {
      return {
        ok: false,
        notes,
        error: {
          code: "NOT_FOUND",
          message:
            "No property record was found for this address and no listing details (such as the price) were supplied. Check the address, or share the listing details.",
        },
      };
    }
    if (parsed === null) {
      return failure.code === "NOT_FOUND"
        ? {
            ok: false,
            notes,
            error: {
              code: "NOT_FOUND",
              message: "No property record was found, and the address is missing a city or state, so the analysis cannot start from the listing details alone. Share the full address (street, city, state, ZIP).",
            },
          }
        : {
            ok: false,
            notes,
            error: {
              code: "INTERNAL",
              message: "The property lookup is temporarily unavailable. Try again shortly, or share the full address (street, city, state, ZIP) so the analysis can proceed from the details you supply.",
            },
          };
    }
    base = parsed;
    notes.push(
      warn(
        "property",
        failure.code === "NOT_FOUND"
          ? "No property record was found for this address; the analysis uses only the details you supplied, with labelled defaults for the rest. Comparable rentals, sales, and schools were not searched because the location is unknown."
          : `The property lookup ${failureReason(failure)}; the analysis uses only the details you supplied, with labelled defaults for the rest. Comparable rentals, sales, and schools were not searched because the location is unknown.`,
      ),
    );
  }

  const { facts, used, ignored } = mergeListing(base, input.listing);
  if (used.length > 0) {
    notes.push(
      info(
        "property",
        lookedUp === null
          ? `Using the ${listJoin(used)} you supplied.`
          : `Using the ${listJoin(used)} you supplied from the listing instead of the property record where they differ.`,
      ),
    );
  }
  if (ignored.length > 0) notes.push(info("property", `The ${listJoin(ignored)} in the listing was not recognised and was ignored.`));

  const valid = PropertyFactsSchema.safeParse(facts);
  if (!valid.success) {
    const first = valid.error.issues[0];
    const field = ["listing", ...(first?.path ?? []).map(String)].join(".");
    return { ok: false, notes, error: { code: "INVALID_ASSUMPTION", field, message: `${field}: ${first?.message ?? "invalid value"}` } };
  }
  return { ok: true, value: { facts: valid.data, lookedUp, provenance, notes } };
}

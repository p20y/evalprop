import {
  InputError,
  breakEvenRent,
  defaultPropertyTax,
  evaluate,
  maxPriceForCashOnCash,
  type AssumptionInputs,
  type PropertyInput,
} from "@evalprop/engine";
import type { DataNote, Evaluation, ResolvedAssumption, ToolError } from "@evalprop/shared";
import { ASSUMPTION_FIELDS, type AssumptionField, type Chosen } from "./assumptions.ts";
import { warn } from "./notes.ts";

/** Stage 6 (ARCHITECTURE §7.1): all numbers come from `packages/engine`. */

export interface EngineStage {
  evaluation: Evaluation;
  /** Every field of the analysis with its winning source, offer price and rent first. */
  assumptions: ResolvedAssumption[];
  maxOfferPrice: number | null;
  breakEvenRent: number | null;
  notes: DataNote[];
}

export type EngineResult = ({ ok: true } & EngineStage) | { ok: false; error: ToolError };

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Maps an engine `InputError` to the stable tool error naming the field (the engine calls the price `purchasePrice`). */
export function toolErrorFromInputError(e: InputError): ToolError {
  const field = e.field === "purchasePrice" ? "offerPrice" : e.field;
  return { code: "INVALID_ASSUMPTION", field, message: e.message.replace("purchasePrice", "offerPrice") };
}

/**
 * Runs the engine on the chosen values. Fields nobody supplied are left out of the engine input on
 * purpose: the engine fills them with its labelled defaults (and in states that reassess on sale, derives
 * the default property tax from the purchase price, including inside the max-offer search).
 *
 * `chosen.offerPrice` and `chosen.monthlyRent` must exist; the orchestrator returns `NEEDS_RENT` or a
 * price error before getting here.
 */
export function runEngine(args: {
  chosen: Chosen;
  state: string;
  listPrice: number | undefined;
  targetCashOnCashPct: number;
}): EngineResult {
  const { chosen, state, listPrice, targetCashOnCashPct } = args;
  const price = chosen.offerPrice;
  const rent = chosen.monthlyRent;
  if (price === undefined || rent === undefined) {
    throw new Error("runEngine requires an offer price and a monthly rent");
  }

  const overrides: Record<string, number> = {};
  for (const field of ASSUMPTION_FIELDS) {
    if (field === "offerPrice" || field === "monthlyRent") continue;
    const c = chosen[field];
    if (c !== undefined) overrides[field] = c.value;
  }
  const input: PropertyInput = {
    purchasePrice: price.value,
    monthlyRent: rent.value,
    state,
    ...(listPrice !== undefined ? { listPrice } : {}),
    ...(overrides as AssumptionInputs),
  };

  let evaluation: Evaluation;
  let maxOfferPrice: number | null;
  let breakEven: number | null;
  try {
    evaluation = evaluate(input);
    maxOfferPrice = maxPriceForCashOnCash(input, targetCashOnCashPct);
    breakEven = breakEvenRent(input);
  } catch (e) {
    if (e instanceof InputError) return { ok: false, error: toolErrorFromInputError(e) };
    throw e;
  }

  const notes: DataNote[] = [];
  const resolved: ResolvedAssumption[] = [];
  const push = (field: AssumptionField, value: number, c: Chosen[AssumptionField], engineNote?: string) => {
    const note = [c?.note, engineNote].filter((n): n is string => n !== undefined).join(" ");
    resolved.push({
      field,
      value,
      source: c?.source ?? "assumed",
      ...(note !== "" ? { note } : {}),
      ...(c?.provenance !== undefined ? { provenance: c.provenance } : {}),
    });
  };
  push("offerPrice", price.value, price);
  push("monthlyRent", rent.value, rent);

  // Reassessing states: a tax figure from the listing or the property record is the SELLER's bill, which
  // the new owner's bill will not follow. Precedence still applies (it is the best figure we were given),
  // but the assumption says so and quotes the engine's reassessed estimate for comparison.
  const reassessed = defaultPropertyTax(price.value, state);
  for (const rec of evaluation.assumptions) {
    const field = rec.field as AssumptionField;
    const c = chosen[field];
    let engineNote = c === undefined ? rec.note : undefined;
    if (field === "propertyTaxAnnual" && c !== undefined && c.source !== "provided" && reassessed.reassessed) {
      engineNote = `This state reassesses property tax to the purchase price on sale, so this figure (the seller's current bill) may understate what you will pay; the engine's estimate on the purchase price would be ${usd(reassessed.annual)} a year. Supply your own figure to override.`;
      notes.push(warn("assumptions", `Property tax comes from the ${c.source === "listing" ? "listing" : "property record"} but this state reassesses on sale: ${usd(reassessed.annual)} a year is the engine's estimate on the purchase price.`));
    }
    push(field, rec.value, c, engineNote);
  }

  return { ok: true, evaluation, assumptions: resolved, maxOfferPrice, breakEvenRent: breakEven, notes };
}

import { defaultPropertyTax } from "@evalprop/engine";
import type { Analysis, DataNote } from "@evalprop/shared";
import { ASSUMPTION_FIELDS, chooseAll, type Candidates } from "./assumptions.ts";
import { buildCard, buildComparisonRows, buildWhatIfSummary } from "./card.ts";
import { runEngine } from "./engine-stage.ts";
import { normalizeWhatIf, type NormalizedWhatIf } from "./normalize.ts";
import { info } from "./notes.ts";
import {
  assembleAnalysis,
  createRuntime,
  fail,
  internalFailure,
  persist,
  releaseQuota,
  reserveQuota,
  reuseSince,
  type Runtime,
} from "./runtime.ts";
import type { PipelineContext, WhatIfOutcome, WhatIfRequest } from "./types.ts";

/**
 * `what_if(baseAnalysisId, overrides)` (ARCHITECTURE §7.2): load the owner's analysis, REUSE its stored
 * market data (no provider is called, and this module never touches the gateway), re-run stages 5-8, and
 * save a new analysis that points at the base. Returns before/after rows read from the two saved analyses.
 *
 * Carry-over rules, which decide what an override can change:
 * - a value the user provided, the listing gave, or a provider looked up (offer price, rent, tax, HOA, and
 *   every other `provided` field) is carried to the new run with the same source;
 * - an `assumed` default is NOT carried: the engine re-derives it for the new inputs, so a new offer price
 *   moves the assumed insurance and the assumed (state-reassessed) property tax, as a fresh analysis would;
 * - an override is `provided` and wins over all of the above.
 * - In a state that reassesses tax on sale, a tax figure that came from the listing or the property record
 *   (the seller's bill) is dropped when the offer price changes and the user did not supply tax, so the
 *   engine re-derives the reassessed estimate on the new price; a tax the user provided is never touched.
 */
export async function runWhatIf(request: WhatIfRequest, ctx: PipelineContext): Promise<WhatIfOutcome> {
  const rt = createRuntime(ctx);
  const { uid } = request;
  if (typeof uid !== "string" || uid === "") {
    return fail({ code: "UNAUTHENTICATED", message: "A signed-in user is required." });
  }

  const normalized = await rt.stage("normalize", () => normalizeWhatIf(request.input));
  if (!normalized.ok) return fail(normalized.error);

  try {
    // Owner isolation: someone else's analysis is indistinguishable from a missing one.
    const base = await ctx.repo.get(normalized.value.input.analysisId, uid);
    if (base === null) {
      return fail({ code: "NOT_FOUND", message: "No analysis with that id was found for this account." });
    }

    const recent = await ctx.repo.findRecent(uid, normalized.value.inputHash, reuseSince(rt));
    if (recent !== null) return success(rt, base, recent, true);

    const reservation = await reserveQuota(rt, uid, "what_if");
    if (!("reservationId" in reservation)) return reservation;

    let outcome: WhatIfOutcome;
    try {
      outcome = await execute(rt, uid, base, normalized.value);
    } catch {
      outcome = internalFailure();
    }
    if (!outcome.ok || outcome.reused) await releaseQuota(rt, uid, "what_if", reservation.reservationId);
    return outcome;
  } catch {
    return internalFailure();
  }
}

function success(rt: Runtime, base: Analysis, next: Analysis, reused: boolean): WhatIfOutcome {
  const card = buildCard(next, rt.reportUrl(next.id));
  const rows = buildComparisonRows(base, next);
  return { ok: true, analysis: next, baseAnalysisId: base.id, card, rows, summary: buildWhatIfSummary(base, next, rows, card), reused };
}

async function execute(rt: Runtime, uid: string, base: Analysis, normalized: NormalizedWhatIf): Promise<WhatIfOutcome> {
  const { overrides } = normalized.input;
  const dataNotes: DataNote[] = [];

  const { chosen, notes: carryNotes } = await rt.stage("assumptions", () => {
    const basePrice = base.assumptions.find((a) => a.field === "offerPrice")?.value;
    const priceChanges = overrides.offerPrice !== undefined && overrides.offerPrice !== basePrice;
    const candidates: Candidates = {};
    const notes: DataNote[] = [];
    for (const field of ASSUMPTION_FIELDS) {
      const prior = base.assumptions.find((a) => a.field === field);
      const list = (candidates[field] ??= []);
      const override = overrides[field];
      if (override !== undefined) list.push({ value: override, source: "provided" });
      if (prior === undefined || prior.source === "assumed") continue;
      if (
        field === "propertyTaxAnnual" &&
        override === undefined &&
        priceChanges &&
        prior.source !== "provided" &&
        defaultPropertyTax(overrides.offerPrice as number, base.property.state).reassessed
      ) {
        notes.push(
          info(
            "assumptions",
            "The offer price changed in a state that reassesses property tax on sale, so the tax figure from the listing or property record (the seller's bill) was replaced by the engine's estimate on the new purchase price. Supply a tax figure to override.",
          ),
        );
        continue;
      }
      list.push({
        value: prior.value,
        source: prior.source,
        ...(prior.note !== undefined ? { note: prior.note } : {}),
        ...(prior.provenance !== undefined ? { provenance: prior.provenance } : {}),
      });
    }
    return { chosen: chooseAll(candidates), notes };
  });

  const engine = await rt.stage("engine", () =>
    runEngine({
      chosen,
      state: base.property.state,
      listPrice: base.property.listPrice,
      targetCashOnCashPct: base.targetCashOnCashPct,
    }),
  );
  if (!engine.ok) return fail(engine.error);

  // Keep what the base run learned about its data (property, comps, schools). Drop notes that describe a
  // choice this what-if may have replaced (they are regenerated or no longer true).
  dataNotes.push(
    ...base.dataNotes.filter(
      (n) =>
        n.section !== "assumptions" &&
        n.section !== "what_if" &&
        !(n.section === "rent" && overrides.monthlyRent !== undefined) &&
        !(n.section === "price" && overrides.offerPrice !== undefined),
    ),
  );
  dataNotes.push(...carryNotes, ...engine.notes);
  dataNotes.push(info("what_if", "Re-run of an earlier analysis with your changes. Market data was reused; nothing new was looked up."));

  const analysis = assembleAnalysis(rt, {
    id: rt.newId("an"),
    ownerUid: uid,
    inputHash: normalized.inputHash,
    baseAnalysisId: base.id,
    property: base.property,
    assumptions: engine.assumptions,
    evaluation: engine.evaluation,
    market: base.market,
    advisoryFlags: base.advisoryFlags,
    dataNotes,
    targetCashOnCashPct: base.targetCashOnCashPct,
    maxOfferPrice: engine.maxOfferPrice,
    breakEvenRent: engine.breakEvenRent,
  });
  const saved = await persist(rt, analysis, "what_if", []);
  if (saved === null) return internalFailure();
  return success(rt, base, saved.analysis, !saved.created);
}

import type { Analysis, DataNote } from "@evalprop/shared";
import { chooseAll, candidatesForAnalysis, type Chosen } from "./assumptions.ts";
import { Deadline } from "./deadline.ts";
import { runEngine } from "./engine-stage.ts";
import { gather } from "./gather.ts";
import { buildCard, buildSummary } from "./card.ts";
import { selectMarket } from "./market.ts";
import { normalizeAnalyze, type NormalizedAnalyze } from "./normalize.ts";
import { info, warn } from "./notes.ts";
import { resolveProperty } from "./resolve-property.ts";
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
import type { AnalysisOutcome, AnalysisRequest, PipelineContext } from "./types.ts";

/**
 * `runAnalysis`: the one orchestration from an address to a saved analysis (ARCHITECTURE §7).
 *
 *   1 normalize  -> 2 resolve property -> 3 gather (parallel) -> 4 select comps
 *   -> 5 resolve assumptions -> 6 engine -> 7 persist (analysis + usage event, one transaction) -> 8 card + summary
 *
 * It never throws and never returns a guessed number: every failure is a typed `PipelineFailure` and
 * nothing is saved. Quota is reserved before the first provider call and released unless an analysis was
 * newly saved.
 */
export async function runAnalysis(request: AnalysisRequest, ctx: PipelineContext): Promise<AnalysisOutcome> {
  const rt = createRuntime(ctx);
  const { uid } = request;
  if (typeof uid !== "string" || uid === "") {
    return fail({ code: "UNAUTHENTICATED", message: "A signed-in user is required." });
  }

  // Stage 1: normalize.
  const normalized = await rt.stage("normalize", () => normalizeAnalyze(request.input));
  if (!normalized.ok) return fail(normalized.error);
  const { inputHash } = normalized.value;

  try {
    // Idempotency: an identical request from the same user inside the window is a retry. Return the saved
    // analysis; do not reserve quota, call providers, or write a second usage event.
    const recent = await ctx.repo.findRecent(uid, inputHash, reuseSince(rt));
    if (recent !== null) return reuse(rt, recent);

    // Quota comes before any provider call (§7.3: no cost is incurred when the allowance is spent).
    const reservation = await reserveQuota(rt, uid, "analysis");
    if (!("reservationId" in reservation)) return reservation;

    let outcome: AnalysisOutcome;
    try {
      outcome = await execute(rt, uid, normalized.value);
    } catch {
      outcome = internalFailure();
    }
    if (!outcome.ok || outcome.reused) await releaseQuota(rt, uid, "analysis", reservation.reservationId);
    return outcome;
  } catch {
    return internalFailure();
  }
}

function reuse(rt: Runtime, analysis: Analysis): AnalysisOutcome {
  const card = buildCard(analysis, rt.reportUrl(analysis.id));
  return { ok: true, analysis, card, summary: buildSummary(analysis, card), reused: true };
}

async function execute(
  rt: Runtime,
  uid: string,
  normalized: NormalizedAnalyze,
): Promise<AnalysisOutcome> {
  const { ctx, config } = rt;
  const { input, address, inputHash } = normalized;
  const scope = ctx.gateway.scope();
  const dataNotes: DataNote[] = [];

  // One deadline covers every provider call of this run (§7.4).
  const deadline = new Deadline(rt.clock, config.deadlineMs);
  const providerWork = async () => {
    try {
      // Stage 2: resolve the property (ambiguous or unknown addresses end the run here).
      const resolved = await rt.stage("resolve", () =>
        resolveProperty({
          input,
          address,
          provider: scope.property(ctx.providers.property.name, ctx.providers.property.provider),
          deadline,
        }),
      );
      if (!resolved.ok) return { ok: false as const, failure: fail(resolved.error, resolved.notes) };
      // Stage 3: gather in parallel.
      const gathered = await rt.stage("gather", () =>
        gather({ facts: resolved.value.facts, gateway: scope, providers: ctx.providers, deadline, config }),
      );
      return { ok: true as const, resolved: resolved.value, gathered };
    } finally {
      deadline.cancel();
    }
  };
  const work = await providerWork();
  if (!work.ok) return work.failure;
  const { gathered } = work;
  const { facts, lookedUp, provenance: lookupProvenance } = work.resolved;
  dataNotes.push(...work.resolved.notes);
  if (deadline.expired) {
    dataNotes.push(warn("providers", "The overall data deadline passed before every source answered; the analysis continued with what was available."));
  }

  // Stage 4: select comps.
  const selection = await rt.stage("select", () =>
    selectMarket({ facts, gathered, lookupProvenance, now: new Date(rt.clock.now()), config }),
  );
  dataNotes.push(...selection.notes);

  // Stage 5: resolve assumptions by precedence.
  const { chosen, notes: assumptionNotes } = await rt.stage("assumptions", () => {
    const { candidates, notes } = candidatesForAnalysis({
      input,
      lookedUp,
      lookupProvenance,
      rent: {
        comps: selection.market.rentComps,
        compsProvenance: selection.market.provenance["rentComps"],
        estimate: selection.estimate,
      },
      config,
    });
    return { chosen: chooseAll(candidates), notes };
  });
  dataNotes.push(...assumptionNotes);

  if (chosen.offerPrice === undefined) {
    return fail(
      {
        code: "INVALID_ASSUMPTION",
        field: "offerPrice",
        message:
          "No purchase price is known for this property. Provide the price to analyze (assumptions.offerPrice) or the asking price from the listing (listing.price).",
      },
      dataNotes,
      facts,
    );
  }
  if (chosen.monthlyRent === undefined) {
    return fail(
      {
        code: "NEEDS_RENT",
        field: "monthlyRent",
        message:
          "No rent could be determined: none was supplied, and comparable rentals and the provider's rent estimate were unavailable or insufficient. The verdict is withheld rather than guessed. Ask the user for the monthly rent they expect (assumptions.monthlyRent), or the actual rent if the unit is occupied (listing.monthlyRentActual).",
      },
      dataNotes,
      facts,
    );
  }
  dataNotes.push(...sourceNotes(chosen));

  // Stage 6: the engine.
  const engine = await rt.stage("engine", () =>
    runEngine({ chosen, state: facts.state, listPrice: facts.listPrice, targetCashOnCashPct: input.targetCashOnCashPct }),
  );
  if (!engine.ok) return fail(engine.error, dataNotes, facts);
  dataNotes.push(...engine.notes);

  // Stage 7: persist. Advisory flags and the listing description are stored as given; nothing above read them.
  const analysis = assembleAnalysis(rt, {
    id: rt.newId("an"),
    ownerUid: uid,
    inputHash,
    property: facts,
    assumptions: engine.assumptions,
    evaluation: engine.evaluation,
    market: selection.market,
    advisoryFlags: input.advisoryFlags ?? [],
    dataNotes,
    targetCashOnCashPct: input.targetCashOnCashPct,
    maxOfferPrice: engine.maxOfferPrice,
    breakEvenRent: engine.breakEvenRent,
  });
  const saved = await persist(rt, analysis, "analysis", scope.usage());
  if (saved === null) return internalFailure();

  // Stage 8: card and summary, from the saved analysis.
  const card = buildCard(saved.analysis, rt.reportUrl(saved.analysis.id));
  return { ok: true, analysis: saved.analysis, card, summary: buildSummary(saved.analysis, card), reused: !saved.created };
}

/** Notes about which value was used when the user did not choose it (so an assumed or looked-up figure is never silent). */
export function sourceNotes(chosen: Chosen): DataNote[] {
  const notes: DataNote[] = [];
  const price = chosen.offerPrice;
  if (price !== undefined && price.source !== "provided") {
    notes.push(
      info(
        "price",
        price.source === "listing"
          ? "Analyzed at the asking price from the listing. Give an offer price to analyze a different one."
          : "Analyzed at the data provider's list price. Give an offer price to analyze a different one.",
      ),
    );
  }
  if (chosen.monthlyRent?.tag === "estimate") {
    notes.push(
      warn("rent", "Rent is the data provider's automated estimate (low confidence) because comparable rentals were not sufficient. Supply the rent you expect to replace it."),
    );
  }
  return notes;
}

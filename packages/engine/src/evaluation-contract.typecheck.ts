// Compile-time contract check: the engine's Evaluation and the Evaluation inferred from EvaluationSchema in
// packages/shared must be assignable to each other. This file produces no runtime code; `pnpm typecheck` fails
// if either side drifts (a renamed field, a changed nullability, a different union member).
//
// The engine is allowed two OPTIONAL extras the shared schema does not describe yet (see the S01 PR):
// `Evaluation.listPriceComparison` and `AssumptionRecord.note`. Optional extras do not break assignability in
// either direction; once shared adds them, they are checked too.
import type { Evaluation as SharedEvaluation } from "@evalprop/shared";
import type { Evaluation } from "./types.ts";

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

export type EngineMatchesSharedEvaluation = Expect<MutuallyAssignable<Evaluation, SharedEvaluation>>;

// `grossRentMultiplier` must stay nullable on both sides (never Infinity).
export type GrossRentMultiplierIsNullable = Expect<
  MutuallyAssignable<Evaluation["yearOne"]["grossRentMultiplier"], SharedEvaluation["yearOne"]["grossRentMultiplier"]>
>;
export type GrossRentMultiplierAllowsNull = Expect<null extends Evaluation["yearOne"]["grossRentMultiplier"] ? true : false>;

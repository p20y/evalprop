import type { Evaluation, PropertyInput } from "./types.ts";

export interface SnapshotDeal {
  name: string;
  input: PropertyInput;
  evaluation: Evaluation;
}

/** Stable text form of the snapshot (numbers rounded to 6 decimals so last-bit float noise cannot fail a build). */
export function snapshotText(engineVersion: string, deals: SnapshotDeal[]): string {
  const round = (_key: string, v: unknown) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v);
  return JSON.stringify({ engineVersion, deals }, round, 1) + "\n";
}

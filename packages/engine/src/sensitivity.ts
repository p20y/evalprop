import { normalizeInput } from "./defaults.ts";
import { evaluate } from "./evaluate.ts";
import type { Evaluation, PropertyInput, ResolvedInput } from "./types.ts";

/** Any numeric input the grid can vary. `offerPrice` is an alias for `purchasePrice`. */
export type NumericField = keyof ResolvedInput | "offerPrice";

export interface SensitivityGrid {
  xField: NumericField;
  yField: NumericField;
  xValues: number[];
  yValues: number[];
  /** cells[yIndex][xIndex] */
  cells: number[][];
}

const canonical = (f: NumericField): keyof ResolvedInput => (f === "offerPrice" ? "purchasePrice" : f);

/** Re-runs the engine across a two-way grid of input overrides. Cheap: each cell is a few milliseconds at most. */
export function sensitivity(
  base: PropertyInput,
  xField: NumericField,
  xValues: number[],
  yField: NumericField,
  yValues: number[],
  metric: (e: Evaluation) => number,
): SensitivityGrid {
  const normalized = normalizeInput(base);
  const xKey = canonical(xField);
  const yKey = canonical(yField);
  const cells = yValues.map((y) => xValues.map((x) => metric(evaluate({ ...normalized, [xKey]: x, [yKey]: y }))));
  return { xField, yField, xValues, yValues, cells };
}

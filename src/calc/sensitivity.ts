import { evaluate } from "./evaluate.ts";
import type { Evaluation, PropertyInput } from "./types.ts";

export type NumericField = Exclude<keyof PropertyInput, never>;

export interface SensitivityGrid {
  xField: NumericField;
  yField: NumericField;
  xValues: number[];
  yValues: number[];
  /** cells[yIndex][xIndex] */
  cells: number[][];
}

/** Re-runs the engine across a two-way grid of input overrides. Cheap: each cell is a few milliseconds at most. */
export function sensitivity(
  base: PropertyInput,
  xField: NumericField,
  xValues: number[],
  yField: NumericField,
  yValues: number[],
  metric: (e: Evaluation) => number,
): SensitivityGrid {
  const cells = yValues.map((y) =>
    xValues.map((x) => metric(evaluate({ ...base, [xField]: x, [yField]: y }))),
  );
  return { xField, yField, xValues, yValues, cells };
}

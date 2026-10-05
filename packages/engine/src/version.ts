/**
 * Semver of the calculation engine. Stored on every analysis.
 *
 * Bump whenever a formula, default, threshold, or output shape changes, then regenerate the
 * reference-deal snapshot (`pnpm --filter @evalprop/engine snapshot:update`) and the golden cases.
 * MAJOR: output shape or meaning changes. MINOR: new defaults/thresholds/features. PATCH: bug fixes.
 */
export const ENGINE_VERSION = "1.0.0";

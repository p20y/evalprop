/**
 * Semver of the analysis pipeline. Stored on every analysis next to `ENGINE_VERSION`.
 *
 * Bump whenever stage behaviour changes in a way that can change a saved analysis: assumption precedence,
 * rent or price selection rules, which data is gathered, degradation rules, or the shape of what is persisted.
 * MAJOR: stored shape or meaning changes. MINOR: new behaviour. PATCH: bug fixes.
 */
export const PIPELINE_VERSION = "1.0.0";

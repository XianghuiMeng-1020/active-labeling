/**
 * Feature flags for the labeling system.
 * Toggle ENABLE_ACTIVE_LEARNING to show/hide the Active Learning phase
 * (routes, survey questions, UI elements). Set to `true` when the seminar
 * needs the full three-phase flow; set to `false` for the simplified
 * Manual → LLM → Survey flow.
 */
export const ENABLE_ACTIVE_LEARNING = false;

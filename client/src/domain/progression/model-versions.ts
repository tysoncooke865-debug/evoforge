/**
 * PROGRESSION_OVERHAUL — model versions (spec §39). Every stored score
 * carries the version that produced it; formula changes bump the version
 * and create a NEW snapshot with trigger_type 'model_recalibration'.
 * History is never silently rewritten — the xp_events doctrine, applied
 * to scores.
 */
export const EVO_RATING_MODEL_VERSION = '1.0.0';
export const SIZE_MODEL_VERSION = '1.0.0';
export const AESTHETICS_MODEL_VERSION = '1.0.0';
export const STRENGTH_MODEL_VERSION = '1.0.0';
export const CARDIO_MODEL_VERSION = '1.0.0';
export const CLASS_RULE_VERSION = '1.0.0';
export const TRAIT_RULE_VERSION = '1.0.0';
export const FORGE_CURVE_VERSION = '1.0.0';
export const MIGRATION_VERSION = 'v1';

// Relative runtime imports on purpose: the vitest suite drives this model
// and the test runner resolves no '@/' alias (the domain/ and fixtures rule).

/**
 * PROMOTED (2026-09-25): this batch's model was folded into
 * domain/nutrition.ts verbatim (dual-rate triple, stored-row parsing, the
 * DB range mirror, both save-payload builders — its pins moved to
 * domain/__tests__/nutrition.test.ts). This shim keeps the variant
 * compiling until the batch is culled; new code imports from
 * '@/domain/nutrition'.
 */
export {
  DEFAULT_GAIN_RATE_KG_PER_WEEK,
  DEFAULT_LOSS_RATE_KG_PER_WEEK,
  buildSavePayload,
  dualIntakeError,
  dualRateInputsFromStored,
  dualRateTargets,
  dualTripleFromStored,
  legWithinDb,
  manualSavePayload,
  type DualRateInputs,
  type SaveTargetPayload,
} from '../../../../domain/nutrition';

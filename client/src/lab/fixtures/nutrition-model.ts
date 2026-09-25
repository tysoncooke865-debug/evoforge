// Relative runtime imports on purpose: the vitest suite loads these fixtures
// and the test runner resolves no '@/' alias (the domain/ and fixtures rule).

/**
 * PROMOTED (2026-09-25, the COUNTERWEIGHT batch): the dual-rate model now
 * lives in domain/nutrition.ts — this file is a re-export shim kept so the
 * lab fixtures (whose seeded FUEL target is COMPUTED from the model) keep
 * their import path. New code should import from '@/domain/nutrition'.
 */
export {
  DEFAULT_GAIN_RATE_KG_PER_WEEK,
  dualRateTargets,
  type DualRateInputs,
} from '../../domain/nutrition';

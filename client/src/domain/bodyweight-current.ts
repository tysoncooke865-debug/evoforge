import { pyFloat } from './py';

/**
 * THE one "current bodyweight" chain (audit A6, 2026-07-19). Three features
 * derived it three different ways (log-only vs log→profile vs
 * log→profile→sex-default), so the same athlete could weigh three different
 * amounts across Home estimates, current-stats and the Evo review.
 *
 * The ORDER, everywhere: latest positive bodyweight_log entry → positive
 * profile.bodyweight_kg → null. Callers own their default-when-null
 * (calibration constants, sex defaults) so a fallback is a visible decision
 * at the call site, never a hidden divergence in the lookup.
 */
export function currentBodyweightKg(
  logRows: readonly { bodyweight?: unknown }[] | null | undefined,
  profileKg: unknown
): number | null {
  for (let i = (logRows?.length ?? 0) - 1; i >= 0; i--) {
    const v = pyFloat(logRows![i].bodyweight) ?? 0;
    if (v > 0) return v;
  }
  const p = pyFloat(profileKg) ?? 0;
  return p > 0 ? p : null;
}

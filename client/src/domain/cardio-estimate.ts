/**
 * Cardio calorie ESTIMATE (improvement doc §4.1, 2026-07-19). For machines
 * without a readout, the app can offer a number instead of a blank field —
 * standard MET arithmetic, same family as workout-estimates.ts:
 *
 *   kcal = MET × 3.5 × bodyweightKg / 200 × minutes
 *
 * MET values from the Compendium of Physical Activities (moderate-effort
 * rows — an estimate should be conservative, not flattering). Keyed on the
 * activity `type` strings in ui/train/cardio/activities.ts.
 *
 * HONESTY RULES: null without a real bodyweight (the caller renders the
 * ESTIMATE control disabled — never a fake number), null for unknown
 * activities and non-positive minutes. The estimate PRE-FILLS an editable
 * field; it is never written unseen.
 */
const MET_BY_TYPE: Record<string, number> = {
  'Treadmill incline walk': 5.3, // brisk walk with grade
  'Outdoor walk': 3.5,
  Run: 9.8, // ~6 mph
  Bike: 7.5, // moderate stationary/road
  Stairmaster: 9.0,
  Boxing: 7.8, // bag/pad rounds
  Other: 5.0, // generic moderate conditioning
};

export function estimateCardioKcal(
  activityType: string,
  minutes: number,
  bodyweightKg: number | null | undefined
): number | null {
  const met = MET_BY_TYPE[activityType];
  if (met === undefined) return null;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (bodyweightKg == null || !Number.isFinite(bodyweightKg) || bodyweightKg <= 0) return null;
  return Math.round(((met * 3.5 * bodyweightKg) / 200) * minutes);
}

/**
 * WHAT A CLAIM MEANS TO THE CALENDAR — pure, so the rule can be tested
 * without a network (2026-08-10, §2/§24).
 *
 * The data layer (data/plan-claims.ts) fetches claims; this decides what they
 * do to a week. Kept apart because the RULE is the part that can be wrong in
 * an interesting way, and the rule is:
 *
 *   A claimed (planned_date, workout) has ALREADY BEEN TRAINED, elsewhere.
 *   Its day must not offer it again and must not generate a replacement.
 *   Everything else about the week is untouched.
 *
 * ORDER MATTERS MORE THAN THE CALENDAR (§2's scheduling philosophy). The plan
 * is a SEQUENCE of sessions that happens to be laid on dates. Training
 * Wednesday's legs on Tuesday does not create a hole on Wednesday that needs
 * filling, and it does not mean Wednesday arrives and asks for legs again
 * merely because Wednesday arrived.
 */

export interface PlanClaim {
  planned_date: string;
  workout: string;
  completed_date: string;
}

/** '2026-08-11|Legs' — the planned session's identity, as one key. */
export const claimKey = (plannedDate: string, workout: string): string =>
  `${plannedDate}|${workout}`;

export interface ClaimIndex {
  /** The claim on a given planned session, or null. */
  for: (plannedDate: string, workout: string) => PlanClaim | null;
  /** Has this planned session been trained elsewhere? */
  isClaimed: (plannedDate: string, workout: string) => boolean;
  /** How many claims exist at all — lets a caller skip the work entirely. */
  size: number;
}

const EMPTY: ClaimIndex = { for: () => null, isClaimed: () => false, size: 0 };

/** Index the claims once per data change, rather than scanning per card. */
export function indexClaims(claims: readonly PlanClaim[] | undefined): ClaimIndex {
  if (!claims || claims.length === 0) return EMPTY;
  const byKey = new Map<string, PlanClaim>();
  for (const c of claims) byKey.set(claimKey(c.planned_date, c.workout), c);
  return {
    for: (d, w) => byKey.get(claimKey(d, w)) ?? null,
    isClaimed: (d, w) => byKey.has(claimKey(d, w)),
    size: byKey.size,
  };
}

/**
 * Can this planned session be trained early right now?
 *
 * The refusals are the interesting part:
 *
 *   - a PAST or TODAY date is not "early"; today's card already starts it, and
 *     a past day is history, which this feature must never rewrite.
 *   - a session already claimed cannot be claimed twice (§24: "original plan
 *     day does not duplicate already-completed session").
 *   - a workout whose NAME is already in play today is refused outright.
 *     Sets are keyed (date, workout), so training Wednesday's "Legs" on a
 *     Tuesday that ALREADY has a "Legs" would file both sessions' sets under
 *     one key and silently fuse two workouts. Two sessions in one day is
 *     supported and wanted (§24) — two sessions sharing one identity is not.
 */
export type EarlyRefusal = 'not-future' | 'already-claimed' | 'name-in-play-today';

export function canTrainEarly(input: {
  plannedDate: string;
  workout: string;
  todayIso: string;
  claims: ClaimIndex;
  /** Every workout name that already owns a session on today's date. */
  namesInPlayToday: readonly string[];
}): { ok: true } | { ok: false; reason: EarlyRefusal } {
  const { plannedDate, workout, todayIso, claims, namesInPlayToday } = input;
  if (plannedDate <= todayIso) return { ok: false, reason: 'not-future' };
  if (claims.isClaimed(plannedDate, workout)) return { ok: false, reason: 'already-claimed' };
  if (namesInPlayToday.some((n) => n === workout)) {
    return { ok: false, reason: 'name-in-play-today' };
  }
  return { ok: true };
}

export const EARLY_REFUSAL_MESSAGE: Readonly<Record<EarlyRefusal, string>> = {
  'not-future': 'That session is already open — start it from today’s card.',
  'already-claimed': 'You have already trained that one early.',
  'name-in-play-today': 'You are already training that workout today.',
};

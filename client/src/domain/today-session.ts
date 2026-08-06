/**
 * WHAT DOES THIS ATHLETE TRAIN *TODAY*? — one decision, one place.
 *
 * Three surfaces used to answer this separately and disagree: onboarding's
 * "START FIRST WORKOUT" handed over the next SCHEDULED day (which on a rest
 * day was tomorrow, opened read-only as "Upcoming"), Home's mission card said
 * RECOVERY DAY, and Home's own TRAIN ANYWAY button just navigated to the
 * Train tab and left the athlete to work it out. A brand-new athlete could
 * finish onboarding and have no reachable way to train in that session —
 * which is the single thing onboarding exists to produce.
 *
 * The rule, in priority order:
 *
 *   1. RESUME  — sets are already logged today. That workout, always. An
 *                athlete who has started is never asked to start again.
 *   2. SCHEDULED — their own plan says today is a training day.
 *   3. STARTER  — nothing scheduled, but they have a plan and have never
 *                 completed a workout. A first session is offered from day
 *                 one of their plan. A rest day is a real thing, but it is
 *                 not something you can be on before you have trained once.
 *   4. NONE     — a genuine recovery day, earned by having a routine.
 *
 * Pure: no clock, no network. The caller supplies today.
 */

export type TodaySessionReason = 'resume' | 'scheduled' | 'starter' | 'none';

export interface TodaySessionInput {
  /** The schedule's name for today, or null on a rest day / no schedule. */
  scheduledToday: string | null;
  /** A workout with valid sets already logged today, or null. */
  startedToday: string | null;
  /** The athlete's plan day names, in plan order. */
  planDays: readonly string[];
  /** Has any workout ever been COMPLETED (a finished session)? */
  hasEverTrained: boolean;
}

export interface TodaySession {
  /** What to open. Null only on a genuine recovery day. */
  workout: string | null;
  reason: TodaySessionReason;
}

export function resolveTodaySession(input: TodaySessionInput): TodaySession {
  if (input.startedToday) return { workout: input.startedToday, reason: 'resume' };
  if (input.scheduledToday) return { workout: input.scheduledToday, reason: 'scheduled' };

  // The starter is day one of their own plan — never a generic invention.
  const starter = input.planDays.find((d) => d.trim() !== '') ?? null;
  if (!input.hasEverTrained && starter) return { workout: starter, reason: 'starter' };

  return { workout: null, reason: 'none' };
}

/**
 * The workout an athlete has already put sets into today.
 *
 * Server truth, from the workout log itself, so it survives a refresh, a new
 * device and a cleared session store — the three ways the old client-only
 * ad-hoc marker lost track of a half-finished session. When more than one
 * workout somehow has sets on the same day, the one with the most sets wins;
 * ties break on name so the answer is stable across renders.
 */
export function startedWorkoutToday(
  rows: readonly { date?: unknown; workout?: unknown }[],
  todayIso: string
): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (String(r.date ?? '') !== todayIso) continue;
    const name = String(r.workout ?? '').trim();
    if (name === '') continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > bestCount) {
      best = name;
      bestCount = n;
    }
  }
  return best;
}

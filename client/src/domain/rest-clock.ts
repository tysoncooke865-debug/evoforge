/**
 * THE REST CLOCK'S ARITHMETIC — pure, so the part that can be wrong is
 * testable without fake timers, a React tree, AsyncStorage or react-native
 * (2026-08-10).
 *
 * THE DESIGN, in one sentence: only two absolute instants are ever stored,
 * and everything the athlete sees is DERIVED from them and the current time.
 * That is what makes the timer survive backgrounding, a screen lock, a tab
 * freeze and a cold reopen — there is no counter to drift, so a JS interval
 * that misses sixty ticks in a suspended app is simply irrelevant to the
 * answer. The interval decides when the bar REDRAWS, never what it says.
 *
 * The store that holds the instants is state/rest-timer.ts; the surfaces are
 * ui/train/rest-timer.tsx. This file knows nothing about either.
 */

export const DEFAULT_REST_SECONDS = 120;
/** ±this much per tap on the timer's own controls. */
export const REST_STEP_SECONDS = 30;
/** A rest can never be nudged below this — zero would be "cancel", which is
 *  a different button with a different meaning. */
export const MIN_REST_SECONDS = 5;
/** Nor above this: a rest timer is not a nap timer. */
export const MAX_REST_SECONDS = 60 * 30;
/** How long "REST OVER" lingers on screen before the clock clears itself. */
export const REST_LINGER_SECONDS = 8;

export function clampRestSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_REST_SECONDS;
  return Math.max(MIN_REST_SECONDS, Math.min(MAX_REST_SECONDS, Math.round(seconds)));
}

export interface RestClockView {
  remaining: number;
  over: boolean;
  mm: number;
  ss: string;
  /** True once the linger has elapsed — the caller should clear the timer. */
  expired: boolean;
}

/**
 * What a clock should display for a given state at a given instant.
 *
 * Returns null when there is nothing to show. `expired` is separate from
 * `over` and carries the case the previous implementation got wrong:
 * reopening the app an hour after a rest ended must show NO timer, not a
 * stale "REST OVER" from breakfast. The old linger check only ran while a
 * subscriber was mounted and ticking, so a long suspension came back to it.
 */
export function restClockView(
  state: { isActive: boolean; endAt: number | null },
  now: number
): RestClockView | null {
  if (!state.isActive || state.endAt === null) return null;
  const remaining = Math.ceil((state.endAt - now) / 1000);
  if (remaining <= -REST_LINGER_SECONDS) {
    return { remaining, over: true, mm: 0, ss: '00', expired: true };
  }
  return {
    remaining,
    over: remaining <= 0,
    mm: Math.max(0, Math.trunc(remaining / 60)),
    ss: String(Math.max(0, remaining % 60)).padStart(2, '0'),
    expired: false,
  };
}

/** "Rest complete. Time for your next set." — kept short, per §14. A named
 *  next exercise earns one extra clause and no more. */
export function restAlarmBody(exerciseName: string | null): string {
  return exerciseName
    ? `Rest complete. Next: ${exerciseName}.`
    : 'Rest complete. Time for your next set.';
}

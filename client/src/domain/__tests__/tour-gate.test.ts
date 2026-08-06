import { describe, expect, it } from 'vitest';

import { startedWorkoutToday } from '../today-session';

/**
 * WHEN MAY THE FIRST-RUN TOUR RUN?
 *
 * Tyson, 2026-08-06: "after logging only one set and navigating back to Home,
 * the six-tab tour appears again. This interrupts the user while their
 * workout is still in progress."
 *
 * The gate had been "has a logged training day", which is true the INSTANT
 * the first set lands. `data/tour-state.ts` now asks for a COMPLETED workout
 * and no workout in progress. This pins the decision itself; the hook is a
 * thin read of these two facts over the same rows.
 */

interface Finish {
  date: string;
  workout: string;
}

/** The rule as `useTourGate` applies it, over persisted rows. */
function mayShow(input: {
  seen: boolean;
  finishes: Finish[];
  logRows: { date: string; workout: string }[];
  today: string;
}): boolean {
  const started = startedWorkoutToday(input.logRows, input.today);
  const inProgress =
    started !== null &&
    !input.finishes.some((f) => f.date === input.today && f.workout === started);
  return !input.seen && input.finishes.length > 0 && !inProgress;
}

const TODAY = '2026-08-06';

describe('the tour never interrupts a workout in progress', () => {
  it('THE BUG: one set logged, nothing finished — the tour stays away', () => {
    expect(
      mayShow({
        seen: false,
        finishes: [],
        logRows: [{ date: TODAY, workout: 'Full Body 1' }],
        today: TODAY,
      })
    ).toBe(false);
  });

  it('stays away mid-session even for an athlete who has trained before', () => {
    expect(
      mayShow({
        seen: false,
        // A completed workout exists — but a NEW one is under way right now.
        finishes: [{ date: '2026-08-04', workout: 'Full Body 1' }],
        logRows: [{ date: TODAY, workout: 'Full Body 2' }],
        today: TODAY,
      })
    ).toBe(false);
  });

  it('appears once the first workout is COMPLETED', () => {
    expect(
      mayShow({
        seen: false,
        finishes: [{ date: TODAY, workout: 'Full Body 1' }],
        logRows: [{ date: TODAY, workout: 'Full Body 1' }],
        today: TODAY,
      })
    ).toBe(true);
  });

  it('never appears merely because the athlete reached Home', () => {
    expect(mayShow({ seen: false, finishes: [], logRows: [], today: TODAY })).toBe(false);
  });

  it('never appears again once seen — skipped or completed', () => {
    expect(
      mayShow({
        seen: true,
        finishes: [{ date: TODAY, workout: 'Full Body 1' }],
        logRows: [],
        today: TODAY,
      })
    ).toBe(false);
  });

  it('yesterday’s unfinished session does not count as in progress today', () => {
    expect(
      mayShow({
        seen: false,
        finishes: [{ date: '2026-08-01', workout: 'Full Body 1' }],
        logRows: [{ date: '2026-08-05', workout: 'Full Body 2' }],
        today: TODAY,
      })
    ).toBe(true);
  });

  it('is idempotent — the same rows always give the same answer', () => {
    const input = {
      seen: false,
      finishes: [{ date: TODAY, workout: 'Full Body 1' }],
      logRows: [{ date: TODAY, workout: 'Full Body 1' }],
      today: TODAY,
    };
    for (let i = 0; i < 5; i += 1) expect(mayShow(input)).toBe(true);
  });
});

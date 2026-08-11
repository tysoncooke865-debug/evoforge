import { describe, expect, it } from 'vitest';

import type { ScheduleRow } from '../scheduled-streak';
import {
  completedSessionCount,
  dayKind,
  DAY_KIND_LABEL,
  resolvePlannedDay,
  SESSION_CTA,
  SESSION_KICKER,
  sessionStatus,
  uniqueTrainingDayCount,
} from '../session-status';

/**
 * §1 — THE CONTRADICTION, AS TESTS.
 *
 * The audit found Home showing, at once:
 *   TODAY'S PLAN: REST · IN PROGRESS · UPPER POWER · 17/17 SETS · RESUME MISSION
 * while Train showed the same workout COMPLETED.
 *
 * Every regression case the brief names is below, plus the two root causes:
 * the two screens resolving different workout NAMES, and the missing
 * `ready_to_finish` state.
 */

const TODAY = '2026-08-11'; // Tuesday
const schedule: ScheduleRow[] = [
  {
    effective_from: '2026-01-01',
    plan: { 0: '', 1: 'Push', 2: 'Upper Power', 3: 'Legs', 4: '', 5: 'Pull', 6: '' },
  } as unknown as ScheduleRow,
];
const PLAN_DAYS = ['Push', 'Upper Power', 'Legs', 'Pull'];

describe('the two screens now resolve the SAME workout name', () => {
  const base = { date: TODAY, todayIso: TODAY, scheduleRows: schedule, planDays: PLAN_DAYS };

  it('agrees on the ordinary case', () => {
    expect(resolvePlannedDay(base)).toBe('Upper Power');
  });

  it('honours a today-only DAY SWAP — the branch Home never had', () => {
    // Home called sourceDayFor directly and saw no swap, so it looked up the
    // marker under the WRONG name and read the session as unfinished while
    // Train, using the swapped name, found it. That is the reported bug.
    expect(resolvePlannedDay({ ...base, daySwap: 'Legs' })).toBe('Legs');
  });

  it('honours an explicit per-day SOURCE — the other missing branch', () => {
    expect(resolvePlannedDay({ ...base, hasExplicitSource: true })).toBe('Upper Power');
  });

  it('a swap applies to TODAY only, never to another date', () => {
    const thu = { ...base, date: '2026-08-13', daySwap: 'Legs' };
    expect(resolvePlannedDay(thu)).not.toBe('Legs');
  });

  it('a rest day resolves to null', () => {
    // Thursday 2026-08-13 is dow 4, which the fixture leaves empty.
    expect(resolvePlannedDay({ ...base, date: '2026-08-13' })).toBeNull();
  });
});

describe('the canonical status', () => {
  const S = (over: Partial<Parameters<typeof sessionStatus>[0]>) =>
    sessionStatus({ workout: 'Upper Power', targetSets: 17, doneSets: 0, finished: false, ...over });

  it('nothing logged -> planned', () => {
    expect(S({})).toBe('planned');
  });

  it('some sets -> in_progress', () => {
    expect(S({ doneSets: 4 })).toBe('in_progress');
  });

  it('OPENED with zero sets is still under way', () => {
    expect(S({ opened: true })).toBe('in_progress');
  });

  it('ALL sets logged, no marker -> ready_to_finish, NEVER resume', () => {
    // The audit's "17/17 SETS COMPLETED" beside "RESUME MISSION".
    expect(S({ doneSets: 17 })).toBe('ready_to_finish');
    expect(SESSION_CTA.ready_to_finish).toBe('FINISH WORKOUT');
    expect(SESSION_CTA.ready_to_finish).not.toMatch(/resume/i);
    expect(SESSION_KICKER.ready_to_finish).toBe('READY TO FINISH');
  });

  it('more sets than planned is still ready_to_finish', () => {
    expect(S({ doneSets: 22 })).toBe('ready_to_finish');
  });

  it('A COMPLETED WORKOUT CAN NEVER READ AS IN PROGRESS', () => {
    // The single most important line in this file.
    for (const done of [0, 4, 17, 99]) {
      expect(S({ doneSets: done, finished: true }), `done=${done}`).toBe('completed');
    }
    expect(S({ doneSets: 4, finished: true, opened: true })).toBe('completed');
  });

  it('cancelled outranks everything', () => {
    expect(S({ doneSets: 17, finished: true, cancelled: true })).toBe('cancelled');
  });

  it('an ad-hoc session with no plan does not offer FINISH at 0 of 0', () => {
    // target 0 with done 0 would satisfy `done >= target` — hence the guard.
    expect(S({ targetSets: 0, doneSets: 0 })).toBe('planned');
    expect(S({ targetSets: 0, doneSets: 3 })).toBe('in_progress');
  });

  it('every status has a CTA and a kicker, and none says two things', () => {
    for (const s of ['planned', 'in_progress', 'ready_to_finish', 'completed', 'cancelled'] as const) {
      expect(SESSION_CTA[s]).toBeTruthy();
      expect(SESSION_KICKER[s]).toBeTruthy();
    }
  });
});

describe('the brief`s regression list', () => {
  const facts = { workout: 'Upper Power', targetSets: 17 };

  it('completing all sets and finishing the workout', () => {
    expect(sessionStatus({ ...facts, doneSets: 17, finished: false })).toBe('ready_to_finish');
    expect(sessionStatus({ ...facts, doneSets: 17, finished: true })).toBe('completed');
  });

  it('reopening a completed workout returns it to the set-derived state', () => {
    // REOPEN deletes the marker; with every set still logged that is
    // ready_to_finish, not in_progress, and certainly not planned.
    expect(sessionStatus({ ...facts, doneSets: 17, finished: false })).toBe('ready_to_finish');
  });

  it('refreshing Home after completion still reads completed', () => {
    // Same inputs, same answer — the function has no memory to lose.
    const a = sessionStatus({ ...facts, doneSets: 17, finished: true });
    const b = sessionStatus({ ...facts, doneSets: 17, finished: true });
    expect(a).toBe('completed');
    expect(b).toBe(a);
  });

  it('a partially completed workout', () => {
    expect(sessionStatus({ ...facts, doneSets: 9, finished: false })).toBe('in_progress');
  });

  it('duplicate finish requests are the same state, not a second one', () => {
    const once = sessionStatus({ ...facts, doneSets: 17, finished: true });
    const twice = sessionStatus({ ...facts, doneSets: 17, finished: true });
    expect(twice).toBe(once);
  });
});

describe('rest days and extra sessions', () => {
  it('a rest day with nothing logged is a rest day', () => {
    expect(dayKind({ isPlannedRest: true, sessionWorkout: null })).toEqual({ kind: 'rest' });
  });

  it('TRAINING ON A REST DAY is an extra — the plan is not rewritten', () => {
    // §1: "label it as an optional extra session rather than changing the
    // planned rest state."
    expect(dayKind({ isPlannedRest: true, sessionWorkout: 'Quick Chest' })).toEqual({
      kind: 'extra',
      workout: 'Quick Chest',
    });
    expect(DAY_KIND_LABEL.extra).toBe('EXTRA SESSION');
  });

  it('a planned rest day and a planned workout can never both be true', () => {
    const rest = dayKind({ isPlannedRest: true, sessionWorkout: 'Anything' });
    expect(rest.kind).not.toBe('planned');
    const training = dayKind({ isPlannedRest: false, sessionWorkout: 'Upper Power' });
    expect(training.kind).toBe('planned');
  });

  it('onboarding on a rest day does not manufacture a planned workout', () => {
    // A day the schedule calls rest stays rest unless a session actually
    // exists, and then it is an EXTRA. Nothing here can invent `planned`.
    expect(dayKind({ isPlannedRest: true, sessionWorkout: null }).kind).toBe('rest');
  });
});

describe('progress counts only what was really finished', () => {
  const sessions = [
    { date: '2026-08-09', workout: 'Push', finished: true },
    { date: '2026-08-10', workout: 'Pull', finished: true },
    { date: '2026-08-10', workout: 'Extra Arms', finished: true },
    { date: '2026-08-11', workout: 'Upper Power', finished: false },
  ];

  it('counts finished sessions only', () => {
    expect(completedSessionCount(sessions)).toBe(3);
  });

  it('two sessions on one day are ONE training day', () => {
    expect(uniqueTrainingDayCount(sessions)).toBe(2);
  });

  it('A FRESH ACCOUNT SHOWS NOTHING', () => {
    // The failure this prevents: any stray dated row reading as a completed
    // workout on a brand-new account. A marker is a deliberate act.
    expect(completedSessionCount([])).toBe(0);
    expect(uniqueTrainingDayCount([])).toBe(0);
    expect(completedSessionCount(undefined)).toBe(0);
    expect(uniqueTrainingDayCount(undefined)).toBe(0);
    // Sets without a marker are not a completed session either.
    expect(completedSessionCount([{ date: '2026-08-01', workout: 'X', finished: false }])).toBe(0);
  });
});

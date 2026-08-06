import { describe, expect, it } from 'vitest';

import { deriveMission, type MissionInput } from '../home-mission';
import { autoWorkoutName } from '../session-plan';
import { localIso, todayIso } from '../today';
import { resolveTodaySession, startedWorkoutToday, type TodaySessionInput } from '../today-session';

/**
 * THE ACTIVATION PATH, PINNED.
 *
 * A real authenticated test (Tyson, 2026-08-06) found that a brand-new
 * athlete could finish onboarding and have NO reachable way to train in that
 * session: "START FIRST WORKOUT" handed over the next SCHEDULED day, which on
 * a rest day was tomorrow and opened read-only as "Upcoming"; Home said
 * RECOVERY DAY; and TRAIN ANYWAY only changed tabs.
 *
 * These are the cases that must never regress.
 */

const PLAN = ['Push A', 'Pull A', 'Legs A'] as const;

const session = (over: Partial<TodaySessionInput> = {}) =>
  resolveTodaySession({
    scheduledToday: null,
    startedToday: null,
    planDays: PLAN,
    hasEverTrained: false,
    ...over,
  });

describe('a new account can always train on the day it signs up', () => {
  it('SIGNS UP ON A TRAINING DAY: the scheduled workout is what opens', () => {
    const s = session({ scheduledToday: 'Pull A' });
    expect(s).toEqual({ workout: 'Pull A', reason: 'scheduled' });
  });

  it('SIGNS UP ON A REST DAY: day one of their plan is offered, not nothing', () => {
    const s = session({ scheduledToday: null });
    expect(s.workout).toBe('Push A');
    expect(s.reason).toBe('starter');
  });

  it('a rest day is only a rest day once it has been EARNED by training', () => {
    expect(session({ hasEverTrained: true }).workout).toBeNull();
    expect(session({ hasEverTrained: true }).reason).toBe('none');
  });

  it('an athlete with no plan at all is not handed an invented workout', () => {
    expect(session({ planDays: [] }).workout).toBeNull();
    expect(session({ planDays: ['', '  '] }).workout).toBeNull();
  });
});

describe('repeated taps and returning mid-session', () => {
  it('REPEATED TAPS on START FIRST WORKOUT resolve to the same workout every time', () => {
    const inputs: TodaySessionInput = {
      scheduledToday: null,
      startedToday: null,
      planDays: PLAN,
      hasEverTrained: false,
    };
    const first = resolveTodaySession(inputs);
    for (let i = 0; i < 5; i += 1) {
      expect(resolveTodaySession(inputs)).toEqual(first);
    }
  });

  it('RETURNING AFTER PARTIALLY LOGGING resumes that workout, not a new one', () => {
    const s = session({ startedToday: 'Push A', scheduledToday: 'Legs A' });
    expect(s).toEqual({ workout: 'Push A', reason: 'resume' });
  });

  it('resume wins even once the athlete counts as trained', () => {
    const s = session({ startedToday: 'Push A', hasEverTrained: true });
    expect(s.reason).toBe('resume');
  });
});

describe('startedWorkoutToday — server truth, and only today', () => {
  const rows = [
    { date: '2026-08-06', workout: 'Push A' },
    { date: '2026-08-06', workout: 'Push A' },
    { date: '2026-08-05', workout: 'Legs A' },
    { date: '2026-08-07', workout: 'Pull A' },
  ];

  it('finds the workout with sets logged today', () => {
    expect(startedWorkoutToday(rows, '2026-08-06')).toBe('Push A');
  });

  it('IGNORES yesterday and tomorrow — the local-date boundary', () => {
    expect(startedWorkoutToday(rows, '2026-08-04')).toBeNull();
    expect(startedWorkoutToday([{ date: '2026-08-05', workout: 'Legs A' }], '2026-08-06')).toBeNull();
  });

  it('picks the workout with the most sets, stably, when a day has two', () => {
    const mixed = [
      { date: '2026-08-06', workout: 'Zebra' },
      { date: '2026-08-06', workout: 'Alpha' },
      { date: '2026-08-06', workout: 'Alpha' },
    ];
    expect(startedWorkoutToday(mixed, '2026-08-06')).toBe('Alpha');
  });

  it('survives junk rows instead of returning an empty name', () => {
    expect(startedWorkoutToday([{ date: '2026-08-06', workout: '   ' }], '2026-08-06')).toBeNull();
    expect(startedWorkoutToday([{}], '2026-08-06')).toBeNull();
    expect(startedWorkoutToday([], '2026-08-06')).toBeNull();
  });
});

describe('local dates, in whatever timezone the athlete is standing in', () => {
  it('today is the LOCAL calendar date, never the UTC one', () => {
    const now = new Date();
    expect(todayIso()).toBe(localIso(now));
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * Timezone-independent by construction: an hour before local midnight is
   * always the previous local day, wherever the runner is. East of Greenwich
   * this instant's UTC date differs from its local date, which is exactly the
   * case that filed early-morning sessions under yesterday.
   */
  it('an instant just before local midnight belongs to the previous local day', () => {
    const localMidnight = new Date();
    localMidnight.setHours(0, 0, 0, 0);
    const anHourBefore = new Date(localMidnight.getTime() - 3600_000);
    const expected = new Date(localMidnight.getTime() - 86_400_000);
    expect(localIso(anHourBefore)).toBe(localIso(expected));
  });

  it('an instant just after local midnight belongs to the new local day', () => {
    const localMidnight = new Date();
    localMidnight.setHours(0, 0, 0, 0);
    expect(localIso(new Date(localMidnight.getTime() + 60_000))).toBe(localIso(localMidnight));
  });
});

describe('the Home card never says RECOVERY DAY to someone who has never trained', () => {
  const base: MissionInput = {
    hasSchedule: true,
    assignedWorkout: null,
    adhocWorkout: null,
    finished: false,
    doneSets: 0,
    targetSets: 0,
    loggedSets: 0,
    starterWorkout: 'Push A',
    hasEverTrained: false,
  };

  it('offers the first session instead of a rest day', () => {
    const m = deriveMission(base);
    expect(m.status).toBe('first_workout');
    expect(m.workout).toBe('Push A');
  });

  it('POSITIVE CONTROL: an established athlete DOES get a rest day', () => {
    const m = deriveMission({ ...base, hasEverTrained: true });
    expect(m.status).toBe('rest_day');
    expect(m.workout).toBeNull();
  });

  it('a scheduled day still wins over the starter', () => {
    const m = deriveMission({ ...base, assignedWorkout: 'Legs A', targetSets: 12 });
    expect(m.status).toBe('scheduled');
    expect(m.workout).toBe('Legs A');
  });

  it('a started workout reads as in progress, not as a fresh first session', () => {
    const m = deriveMission({ ...base, adhocWorkout: 'Push A', loggedSets: 3 });
    expect(m.status).toBe('in_progress');
    expect(m.workout).toBe('Push A');
  });

  it('no plan at all is still no_plan, not a fabricated starter', () => {
    const m = deriveMission({ ...base, starterWorkout: null, hasSchedule: false });
    expect(m.status).toBe('no_plan');
  });
});

describe('the Quick Workout names itself when the field is left empty', () => {
  it('uses the weekday and the focus', () => {
    // 2026-08-06 is a Thursday.
    expect(autoWorkoutName('2026-08-06', 'Push', [])).toBe('Thursday Push Workout');
    expect(autoWorkoutName('2026-08-06', null, [])).toBe('Thursday Workout');
    expect(autoWorkoutName('2026-08-06', '  ', [])).toBe('Thursday Workout');
  });

  it('never collides with a name already in play — two sessions must not merge', () => {
    const taken = ['Thursday Workout'];
    expect(autoWorkoutName('2026-08-06', null, taken)).toBe('Thursday Workout 2');
    expect(autoWorkoutName('2026-08-06', null, [...taken, 'Thursday Workout 2'])).toBe('Thursday Workout 3');
  });

  it('matches case-insensitively, because the plan does', () => {
    expect(autoWorkoutName('2026-08-06', 'Push', ['thursday push workout'])).toBe('Thursday Push Workout 2');
  });

  it('survives a junk date instead of producing "undefined Workout"', () => {
    expect(autoWorkoutName('not-a-date', null, [])).toContain('Workout');
    expect(autoWorkoutName('not-a-date', null, [])).not.toContain('undefined');
  });
});

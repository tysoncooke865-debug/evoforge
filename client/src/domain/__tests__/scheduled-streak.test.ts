import { describe, expect, it } from 'vitest';

import { computeScheduledStreak, crossedMilestones, type ScheduleRow } from '../scheduled-streak';
import type { WorkoutRow } from '../summary';

const set = (date: string): WorkoutRow => ({
  date,
  workout: 'Push 1 - Strength',
  exercise: 'Barbell Bench Press (Strength)',
  set: 1,
  weight: 60,
  reps: 5,
  timestamp: `${date}T10:00:00`,
});

// Mon–Sat training, Sunday rest. 2026-07-12 is a Sunday (UTC).
const WEEK: ScheduleRow = {
  effective_from: '2026-01-01',
  plan: { '0': 'Rest', '1': 'Push 1 - Strength', '2': 'Pull 1 - Back Thickness', '3': 'Push 2 - Hypertrophy', '4': 'Pull 2 - Width / V-Taper', '5': 'Legs', '6': 'Aesthetics' },
};

const TODAY = '2026-07-12'; // Sunday

describe('computeScheduledStreak', () => {
  it('no schedule at all → zero, all rest', () => {
    const s = computeScheduledStreak([], [set('2026-07-10')], TODAY, 10);
    expect(s.current).toBe(0);
    expect(s.days.get('2026-07-10')).toBe('rest');
  });

  it('rest days bridge, never reset: Fri+Sat trained, Sunday rest → streak 2', () => {
    const s = computeScheduledStreak([WEEK], [set('2026-07-10'), set('2026-07-11')], TODAY, 10);
    expect(s.current).toBe(2);
    expect(s.runStart).toBe('2026-07-10');
    expect(s.days.get(TODAY)).toBe('rest'); // Sunday
  });

  it('a missed scheduled day resets', () => {
    // Thu 07-09 trained, Fri 07-10 missed, Sat 07-11 trained → current 1
    const s = computeScheduledStreak([WEEK], [set('2026-07-09'), set('2026-07-11')], TODAY, 10);
    expect(s.current).toBe(1);
    expect(s.days.get('2026-07-10')).toBe('missed');
    expect(s.best).toBe(1);
  });

  it('today pending neither breaks nor extends', () => {
    // Monday as today: trained Sat, today no sets yet → pending, streak 1
    const s = computeScheduledStreak([WEEK], [set('2026-07-11')], '2026-07-13', 10);
    expect(s.days.get('2026-07-13')).toBe('pending');
    expect(s.current).toBe(1);
  });

  it('a reschedule affects only days from its effective_from', () => {
    // Friday becomes Rest from 07-10 → the miss on 07-10 disappears.
    const reschedule: ScheduleRow = {
      effective_from: '2026-07-10',
      plan: { ...WEEK.plan, '5': 'Rest' },
    };
    const s = computeScheduledStreak([WEEK, reschedule], [set('2026-07-09'), set('2026-07-11')], TODAY, 10);
    expect(s.days.get('2026-07-10')).toBe('rest');
    expect(s.current).toBe(2);
  });

  it('best remembers a longer earlier run', () => {
    const rows = ['2026-07-06', '2026-07-07', '2026-07-08'].map(set); // Mon-Wed
    const s = computeScheduledStreak([WEEK], rows, TODAY, 10); // Thu+Fri+Sat missed
    expect(s.current).toBe(0);
    expect(s.best).toBe(3);
  });
});

describe('crossedMilestones', () => {
  it('emits one key per crossed milestone, keyed to the run start', () => {
    const streak = { current: 8, best: 8, runStart: '2026-07-01', days: new Map() };
    expect(crossedMilestones(streak)).toEqual(['3:2026-07-01', '7:2026-07-01']);
  });
  it('no run start → nothing to claim', () => {
    expect(crossedMilestones({ current: 0, best: 0, runStart: null, days: new Map() })).toEqual([]);
  });
});

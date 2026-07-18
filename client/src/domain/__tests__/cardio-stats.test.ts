import { describe, expect, it } from 'vitest';

import {
  cardioStreak,
  dailyMission,
  todayMinutes,
  weekStart,
  weekStrip,
  weekTotals,
} from '../cardio-stats';

const row = (date: string, minutes: number, type = 'Run') => ({ date, minutes, type, timestamp: `${date}T08:00:00Z` });

describe('todayMinutes', () => {
  it('sums only today, ignoring other days and garbage', () => {
    const rows = [row('2026-07-18', 20), row('2026-07-18', 10), row('2026-07-17', 30), { date: '2026-07-18', minutes: 'x' }];
    expect(todayMinutes(rows, '2026-07-18')).toBe(30);
  });

  it('empty → 0', () => {
    expect(todayMinutes([], '2026-07-18')).toBe(0);
  });
});

describe('weekStart — Monday of the week', () => {
  it('a Saturday maps back to its Monday', () => {
    // 2026-07-18 is a Saturday → Monday is 2026-07-13.
    expect(weekStart('2026-07-18')).toBe('2026-07-13');
  });

  it('a Monday maps to itself', () => {
    expect(weekStart('2026-07-13')).toBe('2026-07-13');
  });

  it('a Sunday maps back six days', () => {
    // 2026-07-19 is a Sunday → Monday 2026-07-13.
    expect(weekStart('2026-07-19')).toBe('2026-07-13');
  });
});

describe('weekStrip — Mon→Sun with per-day totals', () => {
  const rows = [row('2026-07-13', 20), row('2026-07-15', 30), row('2026-07-15', 10), row('2026-07-18', 25)];
  const strip = weekStrip(rows, '2026-07-18');

  it('has seven days, Mon first', () => {
    expect(strip).toHaveLength(7);
    expect(strip[0].label).toBe('MON');
    expect(strip[6].label).toBe('SUN');
  });

  it('aggregates sessions and minutes per day', () => {
    expect(strip[0]).toMatchObject({ sessions: 1, minutes: 20 }); // Mon 13
    expect(strip[2]).toMatchObject({ sessions: 2, minutes: 40 }); // Wed 15
    expect(strip[5]).toMatchObject({ sessions: 1, minutes: 25 }); // Sat 18
  });

  it('marks today and future days', () => {
    expect(strip[5].isToday).toBe(true); // Sat 18
    expect(strip[6].isFuture).toBe(true); // Sun 19
    expect(strip[0].isFuture).toBe(false);
  });
});

describe('weekTotals — Mon→today inclusive', () => {
  it('counts this week only, not future or last week', () => {
    const rows = [
      row('2026-07-12', 99), // last week (Sun before)
      row('2026-07-13', 20),
      row('2026-07-18', 25),
      row('2026-07-19', 40), // future (Sun after today Sat)
    ];
    expect(weekTotals(rows, '2026-07-18')).toEqual({ sessions: 2, minutes: 45 });
  });
});

describe('cardioStreak — consecutive logged days', () => {
  const days = ['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17'];

  it('an unlogged today does not break the run', () => {
    expect(cardioStreak(days.map((d) => row(d, 30)), '2026-07-18')).toBe(4);
  });

  it('a logged today extends it', () => {
    expect(cardioStreak([...days, '2026-07-18'].map((d) => row(d, 30)), '2026-07-18')).toBe(5);
  });

  it('a gap ends the run', () => {
    expect(cardioStreak([row('2026-07-16', 30), row('2026-07-18', 30)], '2026-07-18')).toBe(1);
  });

  it('nothing → 0', () => {
    expect(cardioStreak([], '2026-07-18')).toBe(0);
  });
});

describe('dailyMission', () => {
  it('computes remaining and percent against the goal', () => {
    expect(dailyMission(24, 30)).toEqual({ done: 24, target: 30, remaining: 6, pct: 80, complete: false });
  });

  it('completes and clamps the bar at 100', () => {
    expect(dailyMission(45, 30)).toMatchObject({ remaining: 0, pct: 100, complete: true });
  });

  it('a non-positive target falls back to the default 30', () => {
    expect(dailyMission(15, 0).target).toBe(30);
  });
});

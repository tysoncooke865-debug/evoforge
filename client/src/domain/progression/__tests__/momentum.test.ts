import { describe, expect, it } from 'vitest';

import {
  computeMomentum,
  momentumTierFor,
  weekStartOf,
  weeksFromHistory,
  type WeekOutcome,
} from '../momentum';

const week = (weekStart: string, completed: number, extra: Partial<WeekOutcome> = {}): WeekOutcome => ({
  weekStart,
  targetSessions: 3,
  completedSessions: completed,
  mode: 'normal',
  recoveryWeekUsed: false,
  ...extra,
});

describe('Weekly Momentum — humane by construction (spec §21)', () => {
  it('successful weeks build; tiers land on the spec boundaries', () => {
    const weeks = Array.from({ length: 6 }, (_, i) => week(`2026-0${1 + Math.floor(i / 4)}-0${1 + ((i * 7) % 28)}`, 3));
    const m = computeMomentum(weeks);
    expect(m.current).toBe(6);
    expect(m.tier).toBe('Furnace');
    expect(momentumTierFor(52)).toBe('Legendary');
    expect(momentumTierFor(0)).toBeNull();
  });

  it('ONE missed week decays by 2 — a 12-week Inferno is not erased', () => {
    const weeks = [
      ...Array.from({ length: 12 }, (_, i) => week(`2026-01-${String(i + 1).padStart(2, '0')}`, 3)),
      week('2026-04-06', 0),
    ];
    const m = computeMomentum(weeks);
    expect(m.current).toBe(10);
    expect(m.peak).toBe(12);
    expect(m.lastWeekStatus).toBe('decayed');
  });

  it('protective modes and recovery weeks BRIDGE — hold, not grow, not decay', () => {
    const m = computeMomentum([
      week('2026-06-01', 3),
      week('2026-06-08', 0, { mode: 'illness' }),
      week('2026-06-15', 0, { recoveryWeekUsed: true }),
      week('2026-06-22', 3),
    ]);
    expect(m.current).toBe(2);
    expect(m.lifetimeSuccessfulWeeks).toBe(2);
  });

  it('rest days are simply not counted — only sessions vs target matter', () => {
    expect(computeMomentum([week('2026-06-01', 3, { targetSessions: 3 })]).current).toBe(1);
    expect(computeMomentum([week('2026-06-01', 2, { targetSessions: 3 })]).current).toBe(0);
  });

  it('weekStartOf lands on Monday for every day of the week', () => {
    expect(weekStartOf('2026-07-16')).toBe('2026-07-13'); // Thursday → Monday
    expect(weekStartOf('2026-07-13')).toBe('2026-07-13');
    expect(weekStartOf('2026-07-19')).toBe('2026-07-13'); // Sunday belongs to Monday's week
  });

  it('weeksFromHistory: gaps become explicit missed weeks; the CURRENT week is never judged', () => {
    const weeks = weeksFromHistory(
      ['2026-06-29', '2026-07-01', '2026-07-03', '2026-07-15'],
      3,
      '2026-07-16'
    );
    // Week of 06-29 trained 3 days (success); week of 07-06 zero (missed);
    // the week of 07-13 (today's) is EXCLUDED even though a day was trained.
    expect(weeks.map((w) => [w.weekStart, w.completedSessions])).toEqual([
      ['2026-06-29', 3],
      ['2026-07-06', 0],
    ]);
    const m = computeMomentum(weeks);
    expect(m.current).toBe(0);
    expect(m.peak).toBe(1);
  });
});

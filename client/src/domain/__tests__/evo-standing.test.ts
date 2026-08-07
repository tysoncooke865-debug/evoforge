import { describe, expect, it } from 'vitest';

import { ratingChange, standingLine, standingOf, workoutsToEvolve } from '../evo-standing';

/**
 * THE CONTEXT AROUND THE EVO RATING (Home redesign, 2026-08-07).
 *
 * The brief wants weekly change, position and top % on the first screen. The
 * rule these pin: **every one of them is derived or absent.** A motivating
 * number that is invented is worse than no number — the athlete eventually
 * notices, and then stops believing the true ones too.
 */

const NOW = Date.parse('2026-08-07T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('weekly rating change', () => {
  it('compares the newest snapshot against one at least a week old', () => {
    const snaps = [
      { displayed_rating: 52, calculated_at: daysAgo(0) },
      { displayed_rating: 51, calculated_at: daysAgo(3) },
      { displayed_rating: 48, calculated_at: daysAgo(9) },
    ];
    expect(ratingChange(snaps, NOW)).toBe(4);
  });

  it('a single snapshot is not "no change" — it is NOT KNOWN', () => {
    // "+0 this week" to someone who has been rated once is a lie about a week
    // that has not happened.
    expect(ratingChange([{ displayed_rating: 52, calculated_at: daysAgo(0) }], NOW)).toBeNull();
    expect(ratingChange([], NOW)).toBeNull();
  });

  it('refuses when nothing is old enough, rather than picking an arbitrary window', () => {
    const snaps = [
      { displayed_rating: 52, calculated_at: daysAgo(0) },
      { displayed_rating: 50, calculated_at: daysAgo(2) },
    ];
    expect(ratingChange(snaps, NOW)).toBeNull();
  });

  it('reports a fall honestly', () => {
    const snaps = [
      { displayed_rating: 47, calculated_at: daysAgo(0) },
      { displayed_rating: 52, calculated_at: daysAgo(8) },
    ];
    expect(ratingChange(snaps, NOW)).toBe(-5);
  });

  it('ignores unusable rows instead of counting them as zero', () => {
    const snaps = [
      { displayed_rating: 52, calculated_at: daysAgo(0) },
      { displayed_rating: null, calculated_at: daysAgo(8) },
      { displayed_rating: 40, calculated_at: 'not-a-date' },
      { displayed_rating: 45, calculated_at: daysAgo(10) },
    ];
    expect(ratingChange(snaps, NOW)).toBe(7);
  });

  it('order in never changes the answer', () => {
    const snaps = [
      { displayed_rating: 48, calculated_at: daysAgo(9) },
      { displayed_rating: 52, calculated_at: daysAgo(0) },
    ];
    expect(ratingChange(snaps, NOW)).toBe(ratingChange([...snaps].reverse(), NOW));
  });
});

describe('standing on the board', () => {
  const board = [
    { display_name: 'Charles 2', evo_rating: 66 },
    { display_name: 'tysoncooke', evo_rating: 52 },
    { display_name: 'jackruz', evo_rating: 46 },
    { display_name: 'Coolibah', evo_rating: null }, // never rated
  ];

  it('positions among RATED athletes only', () => {
    const s = standingOf(board, 'tysoncooke');
    expect(s).not.toBeNull();
    expect(s!.position).toBe(2);
    // Coolibah has no rating — ranking anyone above them compares against
    // nothing, so they are not in the denominator.
    expect(s!.total).toBe(3);
  });

  it('knows who is directly above', () => {
    const s = standingOf(board, 'tysoncooke')!;
    expect(s.chasingName).toBe('Charles 2');
    expect(s.chasingRating).toBe(66);
  });

  it('the leader is chasing nobody', () => {
    const s = standingOf(board, 'Charles 2')!;
    expect(s.position).toBe(1);
    expect(s.chasingName).toBeNull();
  });

  it('top % rounds UP, so nobody is told they are better placed than they are', () => {
    expect(standingOf(board, 'tysoncooke')!.topPercent).toBe(67); // 2 of 3
    expect(standingOf(board, 'Charles 2')!.topPercent).toBe(34); // 1 of 3
  });

  it('an athlete not on the board has NO standing — private is a choice', () => {
    expect(standingOf(board, 'nobody')).toBeNull();
    expect(standingOf(board, null)).toBeNull();
    expect(standingOf(board, '')).toBeNull();
  });

  it('an empty board yields nothing rather than "#1 of 0"', () => {
    expect(standingOf([], 'tysoncooke')).toBeNull();
    expect(standingOf([{ display_name: 'x', evo_rating: null }], 'x')).toBeNull();
  });
});

describe('the one line of context', () => {
  const standing = { position: 2, total: 3, topPercent: 67, chasingRating: 66, chasingName: 'Charles 2' };

  it('MOVEMENT outranks position — climbing acts on behaviour, a rank does not', () => {
    expect(standingLine(4, standing)).toBe('+4 this week · #2');
  });

  it('falls back to position when the rating has not moved', () => {
    expect(standingLine(0, standing)).toBe('#2 · TOP 67%');
    expect(standingLine(null, standing)).toBe('#2 · TOP 67%');
  });

  it('the leader is told so plainly', () => {
    expect(standingLine(0, { ...standing, position: 1, chasingRating: null, chasingName: null }))
      .toBe('TOP OF THE BOARD');
  });

  it('says nothing at all when nothing is known', () => {
    // Silence beats filler on the screen that is meant to mean something.
    expect(standingLine(null, null)).toBeNull();
  });

  it('a private athlete who improved still hears about it', () => {
    expect(standingLine(3, null)).toBe('+3 this week');
  });

  it('a fall with no board is still reported', () => {
    expect(standingLine(-2, null)).toBe('-2 this week');
  });
});

describe('workouts until the next form', () => {
  it('turns a percentage into an action', () => {
    expect(workoutsToEvolve(77, 8)).toBe(3);
  });

  it('already there is zero, not one', () => {
    expect(workoutsToEvolve(100, 5)).toBe(0);
    expect(workoutsToEvolve(120, 5)).toBe(0);
  });

  it('never says "0 workouts" for someone who is not there yet', () => {
    expect(workoutsToEvolve(99.9, 100)).toBe(1);
  });

  it('says nothing when the per-workout rate is unknown', () => {
    expect(workoutsToEvolve(50, null)).toBeNull();
    expect(workoutsToEvolve(50, 0)).toBeNull();
  });
});

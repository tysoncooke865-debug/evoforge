/**
 * COMPACT variant model pins:
 *  - activeSetNo respects holes (an edited-out set re-arms its slot);
 *  - logButtonState hands out 'next' AT MOST ONCE per exercise and never
 *    outside the isNext exercise — the one-brightest-element rule;
 *  - lastSummary paints kg history through the unit lens and caps segments;
 *  - badgeText pads to two digits.
 */
import { describe, expect, it } from 'vitest';

import type { LastPerformance } from '../../../../../domain/last-performance';
import { activeSetNo, badgeText, collapsedSummary, lastSummary, logButtonState } from '../model';

describe('activeSetNo', () => {
  it('returns the lowest unlogged set, skipping holes', () => {
    expect(activeSetNo([], 3)).toBe(1);
    expect(activeSetNo([1], 3)).toBe(2);
    expect(activeSetNo([1, 3], 3)).toBe(2);
    expect(activeSetNo([2, 3], 3)).toBe(1);
  });

  it('returns null when every set is banked', () => {
    expect(activeSetNo([1, 2, 3], 3)).toBeNull();
  });
});

describe('logButtonState', () => {
  it("grants 'next' to exactly one set of the isNext exercise", () => {
    const logged = [1];
    const states = [1, 2, 3].map((n) => logButtonState(n, logged, 3, true));
    expect(states).toEqual(['logged', 'next', 'idle']);
    expect(states.filter((s) => s === 'next')).toHaveLength(1);
  });

  it("never grants 'next' outside the isNext exercise", () => {
    for (const n of [1, 2, 3]) {
      expect(logButtonState(n, [], 3, false)).toBe('idle');
    }
  });

  it('logged wins over next', () => {
    expect(logButtonState(1, [1], 3, true)).toBe('logged');
  });
});

describe('lastSummary', () => {
  const last: LastPerformance = {
    date: '2026-07-20',
    sets: [
      { set: 1, weight: 14, reps: 12 },
      { set: 2, weight: 14, reps: 10 },
    ],
  };

  it('formats kg history through the unit lens', () => {
    expect(lastSummary(last, 'kg')).toBe('14 KG × 12 · 14 KG × 10');
    // 14 kg → 30.9 lb (displayWeight rounds lb to 1dp).
    expect(lastSummary(last, 'lb')).toBe('30.9 LB × 12 · 30.9 LB × 10');
  });

  it('caps at four segments with an ellipsis', () => {
    const many: LastPerformance = {
      date: '2026-07-20',
      sets: Array.from({ length: 6 }, (_, i) => ({ set: i + 1, weight: 20, reps: 8 })),
    };
    const out = lastSummary(many, 'kg')!;
    expect(out.endsWith('· …')).toBe(true);
    expect(out.split(' · ')).toHaveLength(5); // 4 segments + ellipsis
  });

  it('returns null with no prior session', () => {
    expect(lastSummary(null, 'kg')).toBeNull();
    expect(lastSummary({ date: '2026-07-20', sets: [] }, 'kg')).toBeNull();
  });
});

describe('badges', () => {
  it('pads to two digits', () => {
    expect(badgeText(1)).toBe('01');
    expect(badgeText(12)).toBe('12');
  });

  it('collapsedSummary reads n/N SETS', () => {
    expect(collapsedSummary(0, 2)).toBe('0/2 SETS');
  });
});

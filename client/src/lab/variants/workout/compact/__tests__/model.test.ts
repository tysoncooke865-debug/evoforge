/**
 * COMPACT variant model pins:
 *  - activeSetNo respects holes (an edited-out set re-arms its slot);
 *  - logButtonState hands out 'next' AT MOST ONCE per exercise and never
 *    outside the isNext exercise — the one-brightest-element rule;
 *  - badgeText pads to two digits.
 */
import { describe, expect, it } from 'vitest';

import { activeSetNo, badgeText, collapsedSummary, logButtonState } from '../model';

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

describe('badges', () => {
  it('pads to two digits', () => {
    expect(badgeText(1)).toBe('01');
    expect(badgeText(12)).toBe('12');
  });

  it('collapsedSummary reads n/N SETS', () => {
    expect(collapsedSummary(0, 2)).toBe('0/2 SETS');
  });
});

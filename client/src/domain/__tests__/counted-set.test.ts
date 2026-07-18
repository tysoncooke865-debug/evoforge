import { describe, expect, it } from 'vitest';

import { isCountedSet } from '../workouts';

describe('isCountedSet — the 061 contract', () => {
  it('0 kg with reps counts (bodyweight work)', () => {
    expect(isCountedSet(0, 8)).toBe(true);
    expect(isCountedSet('0', '12')).toBe(true); // wire strings coerce
    expect(isCountedSet(100, 5)).toBe(true);
  });

  it('reps still gate: 0 or missing reps never count', () => {
    expect(isCountedSet(0, 0)).toBe(false);
    expect(isCountedSet(100, 0)).toBe(false);
    expect(isCountedSet(100, null)).toBe(false);
  });

  it('missing/garbage weight is NOT zero — the server guard rejects null', () => {
    expect(isCountedSet(null, 8)).toBe(false);
    expect(isCountedSet(undefined, 8)).toBe(false);
    expect(isCountedSet('', 8)).toBe(false);
    expect(isCountedSet('abc', 8)).toBe(false);
  });

  it('negative weight is nonsense, not a set', () => {
    expect(isCountedSet(-20, 8)).toBe(false);
  });
});

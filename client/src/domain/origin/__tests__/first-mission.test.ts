/**
 * ORIGIN ONBOARDING — first-mission seeding tests (spec §6 + plan O-6).
 */

import { describe, expect, it } from 'vitest';

import { ORIGIN_SPLITS, originSplitFor, rotateScheduleToToday } from '../first-mission';
import type { OriginId } from '../types';

describe('ORIGIN_SPLITS', () => {
  it('every origin has a real split key', () => {
    const origins: OriginId[] = ['aesthetic', 'mass', 'titan', 'cardio', 'shredder'];
    for (const o of origins) {
      expect(['ppl3', 'fb3']).toContain(originSplitFor(o));
      expect(ORIGIN_SPLITS[o]).toBe(originSplitFor(o));
    }
  });
});

describe('rotateScheduleToToday', () => {
  it('today trains day 1, whatever the weekday', () => {
    for (let dow = 0; dow <= 6; dow += 1) {
      const plan = rotateScheduleToToday('ppl3', dow);
      expect(plan).not.toBeNull();
      expect(plan![String(dow)]).toBe('Push'); // ppl3 day 1
    }
  });

  it('preserves the split spacing (3 training days, rest between)', () => {
    // Sunday (0): offset from Monday = 6 → Push Sun, Pull Tue, Legs Thu.
    const plan = rotateScheduleToToday('ppl3', 0)!;
    expect(plan['0']).toBe('Push');
    expect(plan['2']).toBe('Pull');
    expect(plan['4']).toBe('Legs');
    const training = Object.values(plan).filter((v) => v !== 'Rest');
    expect(training).toHaveLength(3);
  });

  it('Monday is the identity rotation (matches the preset spread)', () => {
    const plan = rotateScheduleToToday('ppl3', 1)!;
    expect(plan['1']).toBe('Push');
    expect(plan['3']).toBe('Pull');
    expect(plan['5']).toBe('Legs');
    expect(plan['0']).toBe('Rest');
  });

  it('unknown splits and dayless splits return null', () => {
    expect(rotateScheduleToToday('nope', 2)).toBeNull();
    expect(rotateScheduleToToday('custom', 2)).toBeNull();
  });

  it('absurd weekday inputs normalise instead of throwing', () => {
    expect(rotateScheduleToToday('fb3', 9)!['2']).toBe('Full Body 1'); // 9 % 7 = 2
    expect(rotateScheduleToToday('fb3', -5)!['2']).toBe('Full Body 1'); // -5 ≡ 2 (mod 7)
  });
});

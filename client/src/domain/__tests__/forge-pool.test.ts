import { describe, expect, it } from 'vitest';

import {
  needsIndependentVerifier,
  poolJoinable,
  poolReturn,
  poolReturnLine,
  poolShare,
  poolTilt,
} from '../forge-pool';

describe('the scale leans, and sits level when empty', () => {
  it('is level with nothing on it', () => {
    // Not undefined and not NaN — "nobody has taken a side" is a real state and it
    // looks like a balanced scale.
    expect(poolTilt({ back: 0, push: 0 })).toBe(0);
    expect(poolShare({ back: 0, push: 0 })).toEqual({ backPct: 50, pushPct: 50 });
  });

  it('leans negative toward BACK and positive toward PUSH', () => {
    expect(poolTilt({ back: 100, push: 0 })).toBe(-1);
    expect(poolTilt({ back: 0, push: 100 })).toBe(1);
    expect(poolTilt({ back: 50, push: 50 })).toBe(0);
    expect(poolTilt({ back: 80, push: 70 })).toBeCloseTo(-0.0667, 3);
  });

  it('splits into whole percentages that always sum to 100', () => {
    expect(poolShare({ back: 80, push: 70 })).toEqual({ backPct: 53, pushPct: 47 });
    const odd = poolShare({ back: 1, push: 2 });
    expect(odd.backPct + odd.pushPct).toBe(100);
  });
});

describe('a position returns what the server actually pays', () => {
  /**
   * THE NUMBERS BELOW ARE FROM A REAL SETTLEMENT.
   * tools/falsify-pool-settle.mjs ran 80 v 70 against production and the wallets
   * moved: athlete 50 -> +44 net (93 paid, +1 remainder = 94), backer 30 -> +26 net
   * (56 paid). If this drifts from `callout_verify`, the tray promises one number
   * and the ledger pays another.
   */
  it('matches the proven 80 v 70 settlement', () => {
    // The athlete's own 50 on the winning side: 50 + floor(50*70/80) = 93.
    expect(poolReturn(50, 'back', { back: 80, push: 70 })).toBe(93);
    // The backer's 30: 30 + floor(30*70/80) = 56.
    expect(poolReturn(30, 'back', { back: 80, push: 70 })).toBe(56);
    // 93 + 56 = 149, one short of 150 — the remainder the server hands to the
    // largest position, and which this deliberately does not model.
    expect(93 + 56).toBe(149);
  });

  it('never overstates — understating by the remainder is the safe direction', () => {
    const paid = poolReturn(50, 'back', { back: 80, push: 70 }) +
      poolReturn(30, 'back', { back: 80, push: 70 });
    expect(paid).toBeLessThanOrEqual(150);
  });

  it('returns just the pledge when nobody is on the other side', () => {
    expect(poolReturn(40, 'back', { back: 40, push: 0 })).toBe(40);
    expect(poolReturn(40, 'push', { back: 0, push: 40 })).toBe(40);
  });

  it('never pays out more than the two sides hold', () => {
    const totals = { back: 40, push: 60 };
    expect(poolReturn(40, 'back', totals)).toBe(100);
    expect(poolReturn(40, 'back', totals)).toBeLessThanOrEqual(totals.back + totals.push);
  });

  it('is zero for a zero or negative pledge', () => {
    expect(poolReturn(0, 'back', { back: 10, push: 10 })).toBe(0);
    expect(poolReturn(-5, 'back', { back: 10, push: 10 })).toBe(0);
  });
});

describe('the line states both outcomes, never just the win', () => {
  it('includes the pledge being considered in its own projection', () => {
    // Joining 20 on PUSH against 80 v 0 makes it 80 v 20, so 20 + floor(20*80/20).
    const line = poolReturnLine(20, 'push', { back: 80, push: 0 }, 'Sarah');
    expect(line).toContain('Sarah misses');
    expect(line).toContain('100');
    // And it says what the downside is. A line that only quotes the win is an
    // advert, and the joiner cannot affect the outcome.
    expect(line).toContain('goes to the other side');
  });

  it('says plainly when there is nothing to win', () => {
    const line = poolReturnLine(25, 'back', { back: 0, push: 0 }, 'Marcus');
    expect(line).toContain('nothing to win');
    expect(line).toContain('25');
  });

  it('falls back to a pronoun rather than printing an empty name', () => {
    expect(poolReturnLine(10, 'back', { back: 0, push: 50 }, '   ')).toContain('they');
  });

  it('is empty for a zero pledge, so nothing renders before a choice', () => {
    expect(poolReturnLine(0, 'back', { back: 10, push: 10 }, 'Sam')).toBe('');
  });
});

describe('joining closes, and a big pool needs an outsider', () => {
  it('is joinable only while the set is still ahead of the athlete', () => {
    expect(poolJoinable('offered')).toBe(true);
    expect(poolJoinable('accepted')).toBe(true);
    // Once the set is logged, backing it is reading a result, not predicting one.
    expect(poolJoinable('awaiting_verification')).toBe(false);
    expect(poolJoinable('settled')).toBe(false);
    expect(poolJoinable('disputed')).toBe(false);
  });

  it('needs an independent verifier at the threshold, not past it', () => {
    // 182 uses `>=`, so 200 exactly must already require one.
    expect(needsIndependentVerifier({ back: 100, push: 99 })).toBe(false);
    expect(needsIndependentVerifier({ back: 100, push: 100 })).toBe(true);
    expect(needsIndependentVerifier({ back: 250, push: 50 })).toBe(true);
  });
});

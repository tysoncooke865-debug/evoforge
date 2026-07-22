/**
 * P7 tests — battle readability pure helpers
 * (features/arena/components/readability.ts). No React, no engine, no
 * Date.now(): every case is a direct input/output check on the derivation.
 */
import { describe, expect, it } from 'vitest';
import {
  abilityCooldownFraction,
  computeFloaterStagger,
  computeLaneMomentum,
  FLOATER_STAGGER_STEP_PX,
  healthBarColor,
  LOW_HEALTH_FRACTION,
} from '../features/arena/components/readability';

const TEAM_TINT = '#22D3EE';
const LOW_TINT = '#FBBF24';

describe('healthBarColor', () => {
  it('uses the team tint above the low-health threshold', () => {
    expect(healthBarColor(1, TEAM_TINT, LOW_TINT)).toBe(TEAM_TINT);
    expect(healthBarColor(LOW_HEALTH_FRACTION + 0.01, TEAM_TINT, LOW_TINT)).toBe(TEAM_TINT);
  });

  it('switches to the low-health color at exactly the threshold and below', () => {
    expect(healthBarColor(LOW_HEALTH_FRACTION, TEAM_TINT, LOW_TINT)).toBe(LOW_TINT);
    expect(healthBarColor(0.1, TEAM_TINT, LOW_TINT)).toBe(LOW_TINT);
  });

  it('does not special-case exactly 0 (a dead unit is never rendered by the caller)', () => {
    expect(healthBarColor(0, TEAM_TINT, LOW_TINT)).toBe(TEAM_TINT);
  });

  it('never divides or NaNs on a negative fraction (defensive)', () => {
    expect(healthBarColor(-0.1, TEAM_TINT, LOW_TINT)).toBe(TEAM_TINT);
  });
});

describe('computeLaneMomentum', () => {
  it('is 0 for an empty lane', () => {
    expect(computeLaneMomentum([])).toBe(0);
  });

  it('is 0 when both teams have equal living health (standoff)', () => {
    expect(
      computeLaneMomentum([
        { team: 'player', health: 100 },
        { team: 'opponent', health: 100 },
      ])
    ).toBe(0);
  });

  it('is +1 when only the player has living presence', () => {
    expect(
      computeLaneMomentum([
        { team: 'player', health: 50 },
        { team: 'player', health: 30 },
      ])
    ).toBe(1);
  });

  it('is -1 when only the opponent has living presence', () => {
    expect(computeLaneMomentum([{ team: 'opponent', health: 40 }])).toBe(-1);
  });

  it('is proportional for a partial imbalance', () => {
    // player 300, opponent 100 -> (300-100)/400 = 0.5
    expect(
      computeLaneMomentum([
        { team: 'player', health: 300 },
        { team: 'opponent', health: 100 },
      ])
    ).toBeCloseTo(0.5);
  });

  it('ignores non-positive health entries (defensive against stale/dead data slipping through)', () => {
    expect(
      computeLaneMomentum([
        { team: 'player', health: 100 },
        { team: 'opponent', health: 0 },
        { team: 'opponent', health: -5 },
      ])
    ).toBe(1);
  });
});

describe('computeFloaterStagger', () => {
  it('is 0 with no existing floaters nearby', () => {
    expect(computeFloaterStagger([], 50)).toBe(0);
  });

  it('is 0 when existing floaters are far away (different spot)', () => {
    expect(computeFloaterStagger([10, 90], 50)).toBe(0);
  });

  it('steps up once per nearby existing floater', () => {
    expect(computeFloaterStagger([50], 51)).toBe(FLOATER_STAGGER_STEP_PX);
    expect(computeFloaterStagger([50, 51.5, 49], 50)).toBe(FLOATER_STAGGER_STEP_PX * 3);
  });

  it('caps the stagger growth so a pile-up does not launch a floater off-screen', () => {
    const many = [50, 50, 50, 50, 50, 50, 50, 50];
    const capped = computeFloaterStagger(many, 50);
    expect(capped).toBe(computeFloaterStagger([50, 50, 50, 50], 50));
    expect(capped).toBeLessThan(FLOATER_STAGGER_STEP_PX * many.length);
  });
});

describe('abilityCooldownFraction', () => {
  it('is 1 (ready) when no ticks remain', () => {
    expect(abilityCooldownFraction(0, 240)).toBe(1);
  });

  it('is 0 (just used) when the full cooldown remains', () => {
    expect(abilityCooldownFraction(240, 240)).toBe(0);
  });

  it('is proportional partway through', () => {
    expect(abilityCooldownFraction(60, 240)).toBeCloseTo(0.75);
  });

  it('treats a zero-total cooldown (ultimates gate on charge, not cooldown) as always ready', () => {
    expect(abilityCooldownFraction(0, 0)).toBe(1);
    expect(abilityCooldownFraction(5, 0)).toBe(1);
  });

  it('clamps defensively outside [0,1] (stale/negative inputs never crash the bar)', () => {
    expect(abilityCooldownFraction(-10, 240)).toBe(1);
    expect(abilityCooldownFraction(300, 240)).toBe(0);
  });
});

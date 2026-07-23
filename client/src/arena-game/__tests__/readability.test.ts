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
  computeStackOffsets,
  FLOATER_STAGGER_STEP_PX,
  healthBarColor,
  LOW_HEALTH_FRACTION,
  STACK_OFFSET_PX,
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

describe('computeStackOffsets (Phase 6 - audit C1)', () => {
  it('a lone unit gets no offset and is not even in the map', () => {
    const out = computeStackOffsets([{ id: 1, x: 40 }]);
    expect(out.size).toBe(0);
  });

  it('spread-out units get no offsets', () => {
    const out = computeStackOffsets([
      { id: 1, x: 10 },
      { id: 2, x: 20 },
      { id: 3, x: 40 },
    ]);
    expect(out.size).toBe(0);
  });

  it('a pile fans out center-out in id order: 0, +1, -1 steps', () => {
    const out = computeStackOffsets([
      { id: 12, x: 40.5 },
      { id: 3, x: 40 },
      { id: 7, x: 41 },
    ]);
    expect(out.get(3)).toBe(0);
    expect(out.get(7)).toBe(STACK_OFFSET_PX);
    expect(out.get(12)).toBe(-STACK_OFFSET_PX);
  });

  it('offsets are stable per unit id across frames even as pile membership reshuffles', () => {
    const frameA = computeStackOffsets([
      { id: 3, x: 40 },
      { id: 7, x: 41 },
    ]);
    const frameB = computeStackOffsets([
      { id: 7, x: 41.2 },
      { id: 3, x: 40.1 },
    ]);
    expect(frameA.get(3)).toBe(frameB.get(3));
    expect(frameA.get(7)).toBe(frameB.get(7));
  });

  it('big piles cycle the slot pattern instead of fanning wider than +/-2 steps', () => {
    const pile = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, x: 40 + i * 0.1 }));
    const out = computeStackOffsets(pile);
    for (const [, offset] of out) {
      expect(Math.abs(offset)).toBeLessThanOrEqual(2 * STACK_OFFSET_PX);
    }
    expect(out.get(6)).toBe(0); // slot pattern restarts at the 6th unit
  });

  it('two separate piles offset independently', () => {
    const out = computeStackOffsets([
      { id: 1, x: 10 },
      { id: 2, x: 11 },
      { id: 8, x: 60 },
      { id: 9, x: 61 },
    ]);
    expect(out.get(1)).toBe(0);
    expect(out.get(2)).toBe(STACK_OFFSET_PX);
    expect(out.get(8)).toBe(0);
    expect(out.get(9)).toBe(STACK_OFFSET_PX);
  });
});

import { describe, expect, it } from 'vitest';

import {
  BATTLE_OBJECTS,
  STRENGTH_BUDGET,
  battleXp,
  characterMultiplier,
  coefficientFor,
  effectiveKg,
  finishTs,
  objectByKey,
  scoreStrengthRound,
  type VolumeEvent,
} from '../engine';

const ev = (exercise: string, weightKg: number, reps: number, ts = '2026-07-11T22:00:00Z'): VolumeEvent => ({
  exercise,
  weightKg,
  reps,
  serverTs: ts,
});

const SPEC = { objectKey: 'motorcycle', targetEffectiveKg: 1800, engineVersion: 1 };

describe('coefficients', () => {
  it('barbell compounds are 1.0; machines and cables are discounted', () => {
    expect(coefficientFor('Barbell Back Squat')).toBe(1.0);
    expect(coefficientFor('Barbell Bench Press (Strength)')).toBe(1.0);
    expect(coefficientFor('Leg Press')).toBe(0.45);
    expect(coefficientFor('Hack Squat Machine')).toBe(0.65);
    expect(coefficientFor('Machine Chest Press')).toBe(0.65);
    expect(coefficientFor('Cable Triceps Pushdown')).toBe(0.5);
    expect(coefficientFor('Dumbbell Lateral Raise')).toBe(0.85); // dumbbell rule wins by order
  });

  it('a kilogram on the leg press never beats a kilogram on the bar', () => {
    const squat = effectiveKg(ev('Barbell Back Squat', 100, 5));
    const legPress = effectiveKg(ev('Leg Press', 100, 5));
    expect(squat).toBe(500);
    expect(legPress).toBe(225);
  });

  it('unknown exercises hit the documented floor, never zero', () => {
    expect(coefficientFor('Totally Made Up Lift')).toBe(0.5);
  });
});

describe('characterMultiplier — the 15% cap is a hard wall', () => {
  it.each([
    [0, 1.0],
    [50, 1.075],
    [100, 1.15],
    [150, 1.15], // overflow clamps
    [-10, 1.0], // garbage clamps
  ])('stat %s -> ×%s', (stat, expected) => {
    expect(characterMultiplier(stat)).toBeCloseTo(expected, 12);
  });

  it('a maxed stat can never beat completed work: 100-stat zero-work loses to 0-stat full-work', () => {
    const zeroWork = scoreStrengthRound([], [], SPEC, 100, {});
    const fullWork = scoreStrengthRound(
      [ev('Barbell Back Squat', 120, 5, '2026-07-11T22:01:00Z'), ev('Barbell Back Squat', 120, 5, '2026-07-11T22:02:00Z'), ev('Barbell Back Squat', 120, 5, '2026-07-11T22:03:00Z')],
      [],
      SPEC,
      0,
      {}
    );
    expect(zeroWork.points).toBe(0);
    expect(fullWork.points).toBeGreaterThan(zeroWork.points);
  });
});

describe('scoreStrengthRound', () => {
  it('completion is linear and capped; finishing flips the flag', () => {
    // 3 × (120kg × 5) squat = 1800 effective = exactly the motorcycle.
    const events = [
      ev('Barbell Back Squat', 120, 5, '2026-07-11T22:01:00Z'),
      ev('Barbell Back Squat', 120, 5, '2026-07-11T22:02:00Z'),
      ev('Barbell Back Squat', 120, 5, '2026-07-11T22:03:00Z'),
    ];
    const s = scoreStrengthRound(events, [], SPEC, 0, {});
    expect(s.completion).toBe(700);
    expect(s.finished).toBe(true);
    expect(s.speed).toBe(200); // finished, opponent never did
    expect(s.variety).toBe(0); // one exercise is a rut
  });

  it('speed: earlier finisher takes 200, later 120, unfinished paces ≤80', () => {
    const fast = [ev('Barbell Back Squat', 200, 9, '2026-07-11T22:01:00Z')]; // 1800 in one
    const slow = [ev('Barbell Back Squat', 200, 9, '2026-07-11T22:05:00Z')];
    expect(scoreStrengthRound(fast, slow, SPEC, 0, {}).speed).toBe(200);
    expect(scoreStrengthRound(slow, fast, SPEC, 0, {}).speed).toBe(120);
    const half = [ev('Barbell Back Squat', 90, 10, '2026-07-11T22:01:00Z')]; // 900 = 50%
    expect(scoreStrengthRound(half, fast, SPEC, 0, {}).speed).toBe(40);
  });

  it('variety ladder: 1→0, 2→60, 3→120, 4+→180', () => {
    const mk = (n: number) =>
      ['Barbell Back Squat', 'Barbell Bench Press', 'T-Bar Row', 'Leg Press', 'Lat Pulldown']
        .slice(0, n)
        .map((x, i) => ev(x, 60, 8, `2026-07-11T22:0${i + 1}:00Z`));
    expect(scoreStrengthRound(mk(1), [], SPEC, 0, {}).variety).toBe(0);
    expect(scoreStrengthRound(mk(2), [], SPEC, 0, {}).variety).toBe(60);
    expect(scoreStrengthRound(mk(3), [], SPEC, 0, {}).variety).toBe(120);
    expect(scoreStrengthRound(mk(5), [], SPEC, 0, {}).variety).toBe(180);
  });

  it('overload pays the 75–95% band of YOUR OWN best and pays a max attempt NOTHING', () => {
    const best = { 'Barbell Bench Press (Strength)': 100 };
    const quality = [ev('Barbell Bench Press (Strength)', 77, 5)]; // e1RM 89.8 → in band
    const maxAttempt = [ev('Barbell Bench Press (Strength)', 100, 1)]; // e1RM 103 → above
    const noHistory = [ev('Totally New Lift', 77, 5)];
    expect(scoreStrengthRound(quality, [], SPEC, 0, best).overload).toBe(20);
    expect(scoreStrengthRound(maxAttempt, [], SPEC, 0, best).overload).toBe(0);
    expect(scoreStrengthRound(noHistory, [], SPEC, 0, best).overload).toBe(0);
  });

  it('points never exceed the round budget, even fully maxed', () => {
    const best = { 'Barbell Back Squat': 200, 'Barbell Bench Press': 150, 'T-Bar Row': 120, 'Leg Press': 300 };
    const events = [
      ev('Barbell Back Squat', 150, 5, '2026-07-11T22:01:00Z'),
      ev('Barbell Back Squat', 150, 5, '2026-07-11T22:02:00Z'),
      ev('Barbell Bench Press', 110, 5, '2026-07-11T22:03:00Z'),
      ev('Barbell Bench Press', 110, 5, '2026-07-11T22:04:00Z'),
      ev('T-Bar Row', 90, 8, '2026-07-11T22:05:00Z'),
      ev('T-Bar Row', 90, 8, '2026-07-11T22:06:00Z'),
      ev('Leg Press', 250, 10, '2026-07-11T22:07:00Z'),
    ];
    const s = scoreStrengthRound(events, [], SPEC, 100, best);
    expect(s.points).toBeLessThanOrEqual(STRENGTH_BUDGET);
    expect(s.points).toBe(STRENGTH_BUDGET); // and a genuinely full round hits it
  });

  it('finishTs crosses on the exact event, not after', () => {
    const events = [
      ev('Barbell Back Squat', 120, 5, '2026-07-11T22:01:00Z'),
      ev('Barbell Back Squat', 120, 5, '2026-07-11T22:02:00Z'),
      ev('Barbell Back Squat', 120, 5, '2026-07-11T22:03:00Z'),
    ];
    expect(finishTs(events, 1800)).toBe('2026-07-11T22:03:00Z');
    expect(finishTs(events, 1801)).toBe(null);
  });
});

describe('catalog + rewards', () => {
  it('objects are non-empty, keyed, and blitz targets sit in the honest band', () => {
    expect(BATTLE_OBJECTS.length).toBeGreaterThan(0);
    for (const o of BATTLE_OBJECTS) {
      expect(o.blitzTargetKg).toBeGreaterThanOrEqual(1800);
      expect(o.blitzTargetKg).toBeLessThanOrEqual(3000);
      expect(objectByKey(o.key)).toBe(o);
    }
    expect(objectByKey('nonsense')).toBe(BATTLE_OBJECTS[0]);
  });

  it('battle XP: win 150 / loss 50 / draw 75', () => {
    expect(battleXp(1000, 900)).toBe(150);
    expect(battleXp(900, 1000)).toBe(50);
    expect(battleXp(900, 900)).toBe(75);
  });
});

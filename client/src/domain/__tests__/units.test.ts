import { describe, expect, it } from 'vitest';

import {
  LB_PER_KG,
  WEIGHT_STEP,
  convertTyped,
  displayWeight,
  kgToLb,
  lbToKg,
  roundKg2,
  toKgForSave,
} from '../units';

describe('the constant', () => {
  it('pins the international avoirdupois pound', () => {
    expect(LB_PER_KG).toBe(2.2046226218);
  });

  it('kgToLb and lbToKg are inverses', () => {
    expect(lbToKg(kgToLb(87.5))).toBeCloseTo(87.5, 9);
  });
});

describe('ROUND-TRIP STABILITY — the load-bearing property', () => {
  // Every plate-shaped number a lb gym produces. If one of these fails to
  // come back identical after lb → kg(save) → lb(display), re-logging "the
  // same weight" writes a different kg float and set-save's exact-equality
  // maths sees phantom changes.
  const PLATE_NUMBERS = [2.5, 5, 10, 25, 35, 45, 62.5, 95, 100, 135, 185, 225, 275, 315, 405, 500];

  it.each(PLATE_NUMBERS.map((n) => [n] as const))('%s lb survives the loop', (lb) => {
    const storedKg = toKgForSave(lb, 'lb');
    expect(displayWeight(storedKg, 'lb')).toBe(String(lb % 1 === 0 ? Math.trunc(lb) : lb));
  });

  it('positive control: the list is not empty and the loop actually converts', () => {
    expect(PLATE_NUMBERS.length).toBeGreaterThan(0);
    expect(toKgForSave(100, 'lb')).not.toBe(100); // a vacuous loop proves nothing
  });

  it('saving 100 lb stores 45.36 kg — two decimals, deterministic', () => {
    expect(toKgForSave(100, 'lb')).toBe(45.36);
  });

  it('kg mode saves VERBATIM — the metric path gained no rounding', () => {
    expect(toKgForSave(102.5, 'kg')).toBe(102.5);
    expect(toKgForSave(45.359237, 'kg')).toBe(45.359237);
  });
});

describe('displayWeight', () => {
  it('kg paints the stored value, trimmed', () => {
    expect(displayWeight(100, 'kg')).toBe('100');
    expect(displayWeight(62.5, 'kg')).toBe('62.5');
    expect(displayWeight(45.36, 'kg')).toBe('45.36');
  });

  it('lb rounds to one decimal and trims', () => {
    expect(displayWeight(45.36, 'lb')).toBe('100');
    expect(displayWeight(20, 'lb')).toBe('44.1');
    expect(displayWeight(102.06, 'lb')).toBe('225');
  });
});

describe('convertTyped — flipping the string under the athlete', () => {
  it('kg → lb converts the typed value', () => {
    expect(convertTyped('100', 'kg', 'lb')).toBe('220.5');
  });

  it('lb → kg converts back', () => {
    expect(convertTyped('225', 'lb', 'kg')).toBe('102.06');
  });

  it('same unit is a no-op', () => {
    expect(convertTyped('80', 'kg', 'kg')).toBe('80');
  });

  it('empty stays empty — a flip must not conjure a value', () => {
    expect(convertTyped('', 'kg', 'lb')).toBe('');
    expect(convertTyped('  ', 'lb', 'kg')).toBe('  ');
  });

  it('unparseable text is left alone — a flip must not eat a half-typed value', () => {
    expect(convertTyped('80.', 'kg', 'lb')).not.toBe(''); // pyFloat('80.') parses; sanity below
    expect(convertTyped('abc', 'kg', 'lb')).toBe('abc');
  });
});

describe('WEIGHT_STEP', () => {
  it('covers both units (a guard over an empty table guards nothing)', () => {
    expect(Object.keys(WEIGHT_STEP)).toEqual(['kg', 'lb']);
  });

  it('metric: 2.5 steps, 20 plates; pounds: 5 steps, 45 plates', () => {
    expect(WEIGHT_STEP.kg).toEqual({ step: 2.5, bigStep: 20, quick: [2.5, 5, 10, 20] });
    expect(WEIGHT_STEP.lb).toEqual({ step: 5, bigStep: 45, quick: [5, 10, 25, 45] });
  });
});

describe('roundKg2', () => {
  it('rounds to two decimals', () => {
    expect(roundKg2(45.359237)).toBe(45.36);
    expect(roundKg2(20.4117)).toBe(20.41);
  });
});

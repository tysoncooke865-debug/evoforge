import { pyFloat } from './py';

/**
 * KG ⇄ LB — the conversion boundary (2026-07-15).
 *
 * THE RULE: the database never learns pounds. Every stored weight, every
 * cached row, every PR comparison, every e1RM, every achievement threshold is
 * kilograms — exactly as before this file existed. Pounds exist only between
 * the athlete's eyes and the input box: convert lb→kg ONCE, in SetRow's save
 * handler via `toKgForSave`, and kg→lb only when painting the screen.
 *
 * ROUND-TRIP STABILITY is the load-bearing property: a lb entry must survive
 * lb → kg(save) → lb(display) and come back as the number the athlete typed.
 * Otherwise re-logging "the same 100 lb" produces a different kg float, and
 * set-save's exact-equality checks (sameWeight, PR maths) start seeing
 * phantom changes. `toKgForSave` therefore rounds kg to 2 dp, and lb display
 * rounds to 1 dp — the tests pin that the loop closes for every plate-shaped
 * number a gym produces.
 */

export const LB_PER_KG = 2.2046226218;

export type WeightUnit = 'kg' | 'lb';

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

export function lbToKg(lb: number): number {
  return lb / LB_PER_KG;
}

/** The SAVE rounding: kg to 2 dp. The only rounding on the write path. */
export function roundKg2(kg: number): number {
  return Math.round(kg * 100) / 100;
}

/** What actually goes to the database: kg, rounded iff it came from pounds. */
export function toKgForSave(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? roundKg2(lbToKg(value)) : value;
}

/** Trim "100.0" → "100" but keep "62.5". */
function trimNumber(n: number): string {
  return String(n % 1 === 0 ? Math.trunc(n) : n);
}

/** A stored kg value, painted in the athlete's unit. kg: 2 dp; lb: 1 dp. */
export function displayWeight(kg: number, unit: WeightUnit): string {
  if (unit === 'lb') return trimNumber(Math.round(kgToLb(kg) * 10) / 10);
  return trimNumber(roundKg2(kg));
}

/**
 * Flip the string the athlete is LOOKING AT, in place. Empty stays empty and
 * unparseable text is left alone — a flip must never eat a half-typed value.
 */
export function convertTyped(text: string, from: WeightUnit, to: WeightUnit): string {
  if (from === to || text.trim() === '') return text;
  const v = pyFloat(text);
  if (v === null) return text;
  const kg = from === 'lb' ? lbToKg(v) : v;
  return displayWeight(kg, to);
}

/**
 * Stepper sizes per unit: metric gyms think in 2.5 kg increments and 20 kg
 * plates; pound gyms think in 5 lb increments and 45 lb plates. The double-
 * press plate jump must match the plates on the athlete's floor.
 */
export const WEIGHT_STEP: Readonly<Record<WeightUnit, { step: number; bigStep: number }>> = {
  kg: { step: 2.5, bigStep: 20 },
  lb: { step: 5, bigStep: 45 },
};

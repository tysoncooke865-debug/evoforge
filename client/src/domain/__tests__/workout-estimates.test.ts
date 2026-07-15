import { describe, expect, it } from 'vitest';

import type { PlanEntry } from '../session-plan';
import { estimateKcal, estimateMinutes, musclePillsFor, splitWorkoutName } from '../workout-estimates';

describe('estimateMinutes — sets × (45s work + 120s rest), to the nearest 5', () => {
  it('20 sets ≈ 55 min (the spec anchor: 20 × 165s = 3300s exactly)', () => {
    expect(estimateMinutes(20)).toBe(55);
  });

  it('18 sets → 49.5 min raw → 50 on the display grid', () => {
    expect(estimateMinutes(18)).toBe(50);
  });

  it('a tiny workout still reads 5, never 0 minutes', () => {
    expect(estimateMinutes(1)).toBe(5);
  });

  it('no sets → no estimate', () => {
    expect(estimateMinutes(0)).toBe(0);
    expect(estimateMinutes(-3)).toBe(0);
    expect(estimateMinutes(Number.NaN)).toBe(0);
  });
});

describe('estimateKcal — MET 5.0 over the UNROUNDED minutes, to the nearest 10', () => {
  it('18 sets at 77 kg: 6.7375 kcal/min × 49.5 min = 333.5 → 330', () => {
    expect(estimateKcal(18, 77)).toBe(330);
  });

  it('20 sets at 77 kg: 6.7375 × 55 = 370.6 → 370', () => {
    expect(estimateKcal(20, 77)).toBe(370);
  });

  it('heavier athlete burns more (positive control on the kg term)', () => {
    expect(estimateKcal(20, 100)).toBeGreaterThan(estimateKcal(20, 62));
  });

  it('no sets or no bodyweight → 0, never NaN', () => {
    expect(estimateKcal(0, 77)).toBe(0);
    expect(estimateKcal(10, 0)).toBe(0);
    expect(estimateKcal(10, Number.NaN)).toBe(0);
  });
});

describe('splitWorkoutName — the FIRST " - " splits title from sub', () => {
  it('the spec example', () => {
    expect(splitWorkoutName('Push 2 - Hypertrophy')).toEqual({ title: 'Push 2', sub: 'Hypertrophy' });
  });

  it('a single-word day has no sub', () => {
    expect(splitWorkoutName('Legs')).toEqual({ title: 'Legs', sub: null });
  });

  it('only the first separator splits — the rest stays in the sub', () => {
    expect(splitWorkoutName('A - B - C')).toEqual({ title: 'A', sub: 'B - C' });
  });

  it('a plain hyphen is not a separator (Full-Body is one word)', () => {
    expect(splitWorkoutName('Full-Body Blast')).toEqual({ title: 'Full-Body Blast', sub: null });
  });

  it('a degenerate " - Something" name survives whole', () => {
    expect(splitWorkoutName(' - Hypertrophy')).toEqual({ title: '- Hypertrophy', sub: null });
  });
});

describe('musclePillsFor — section labels via the muscle ladder, ordered, deduped', () => {
  const entry = (exercise: string): PlanEntry => [exercise, 3, '8-12'];

  it('a push day collapses to its sections in first-appearance order', () => {
    const pills = musclePillsFor([
      entry('Barbell Bench Press'), // Chest
      entry('Overhead Barbell Press'), // Front Delts → Shoulders
      entry('Incline Dumbbell Bench Press'), // Upper Chest → Chest (dedupe)
      entry('Cable Triceps Pushdown'), // Triceps → Arms
    ]);
    expect(pills).toEqual(['Chest', 'Shoulders', 'Arms']);
  });

  it('a leg day is one pill, however many lifts', () => {
    expect(
      musclePillsFor([entry('Barbell Back Squat'), entry('Romanian Deadlift'), entry('Seated Calf Raise')])
    ).toEqual(['Legs']);
  });

  it("the ATHLETE'S own tag outranks the library and the heuristic", () => {
    const pills = musclePillsFor([entry('Jefferson Curl')], [{ name: 'Jefferson Curl', muscle: 'Hamstrings' }]);
    expect(pills).toEqual(['Legs']); // their word — not the Biceps the name-heuristic would guess
  });

  it('an unclaimable name earns NO pill — honest beats wrong', () => {
    expect(musclePillsFor([entry('Mystery Machine Move')])).toEqual([]);
  });

  it('empty entries → no pills (and no crash)', () => {
    expect(musclePillsFor([])).toEqual([]);
  });
});

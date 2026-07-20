import { describe, expect, it } from 'vitest';

import { sweepAchievements, type SweepInputs } from '../achievements';
import {
  achievementProgress,
  categoryOf,
  CATEGORY_ORDER,
  isMet,
  type AchCategory,
} from '../achievement-progress';
import { ACHIEVEMENTS } from '../catalogs';
import type { WorkoutRow } from '../summary';

/**
 * The drift guard. `achievement-progress` duplicates the sweep's thresholds so
 * the awards screen can show real progress; this proves the duplication stays
 * honest. For any inputs, an achievement is "met" in the progress model iff the
 * sweep would grant it. If a threshold ever diverges, this goes red.
 */

const benchRow = (weight: number, reps: number): WorkoutRow => ({
  date: '2026-07-11', workout: 'Push 1 - Strength',
  exercise: 'Barbell Bench Press (Strength)', set: 1, weight, reps, timestamp: 't',
});
const squatRow = (weight: number, reps: number): WorkoutRow => ({
  date: '2026-07-12', workout: 'Legs', exercise: 'Barbell Back Squat', set: 1, weight, reps, timestamp: 't',
});

// A spread of scenarios that between them cross most thresholds in both
// directions, plus the null-prerequisite corners.
const scenarios: SweepInputs[] = [
  { workoutRows: [], totalSets: 0, bestBench1rm: 0, level: 1, heat: new Map(), bw: { latest: null, min: null, max: null, count: 0 }, bf: { latest: null, count: 0 }, cardio: { minutes: 0, distance: 0, count: 0, types: new Set() }, bfTarget: null },
  { workoutRows: [benchRow(100, 5), squatRow(160, 3)], totalSets: 120, bestBench1rm: 118, level: 42, heat: new Map([['Chest', 60], ['Back', 55], ['Delts', 51], ['Biceps', 60], ['Triceps', 50], ['Abs', 51], ['Quads', 101]]), bw: { latest: 82, min: 78, max: 90, count: 10 }, bf: { latest: 11, count: 5 }, cardio: { minutes: 320, distance: 26, count: 8, types: new Set(['Boxing', 'Run']) }, bfTarget: 12 },
  { workoutRows: [benchRow(125, 2), squatRow(205, 1)], totalSets: 1100, bestBench1rm: 130, level: 100, heat: new Map([['Chest', 200], ['Upper Chest', 5], ['Back Width', 90], ['Back Thickness', 70], ['Side Delts', 100], ['Rear Delts', 60], ['Biceps', 120], ['Triceps', 40], ['Legs', 120], ['Abs', 80]]), bw: { latest: 74, min: 74, max: 95, count: 20 }, bf: { latest: 9, count: 12 }, cardio: { minutes: 1200, distance: 120, count: 40, types: new Set(['Run']) }, bfTarget: 10 },
  { workoutRows: [benchRow(60, 8)], totalSets: 15, bestBench1rm: 70, level: 8, heat: new Map([['Chest', 20]]), bw: { latest: 86, min: 84, max: 86, count: 3 }, bf: { latest: 16, count: 1 }, cardio: { minutes: 100, distance: 5, count: 2, types: new Set(['Bike']) }, bfTarget: null },
  { workoutRows: [benchRow(90, 5), squatRow(140, 5)], totalSets: 500, bestBench1rm: 95, level: 61, heat: new Map([['Chest', 150], ['Back', 150], ['Delts', 150]]), bw: { latest: 80, min: 75, max: 82, count: 8 }, bf: { latest: 12.5, count: 4 }, cardio: { minutes: 300, distance: 25, count: 6, types: new Set() }, bfTarget: 13 },
];

describe('achievementProgress', () => {
  it('covers every catalog achievement exactly once, all categorised', () => {
    const ids = Object.keys(ACHIEVEMENTS);
    const prog = achievementProgress(scenarios[0]);
    for (const id of ids) {
      expect(prog[id], `progress missing for ${id}`).toBeDefined();
      expect(CATEGORY_ORDER).toContain(prog[id].category);
      expect(categoryOf(id)).toBe(prog[id].category);
    }
    // no stray keys the catalog doesn't know
    for (const id of Object.keys(prog)) expect(ACHIEVEMENTS[id], `stray ${id}`).toBeDefined();
  });

  it('every category is non-empty', () => {
    const prog = achievementProgress(scenarios[0]);
    const seen = new Set<AchCategory>(Object.values(prog).map((p) => p.category));
    for (const c of CATEGORY_ORDER) expect(seen.has(c), `empty category ${c}`).toBe(true);
  });

  it('met(progress) === sweep-would-grant, for every id across scenarios (DRIFT GUARD)', () => {
    for (const s of scenarios) {
      const granted = new Set(sweepAchievements(s, new Set()));
      const prog = achievementProgress(s);
      for (const id of Object.keys(ACHIEVEMENTS)) {
        expect(isMet(prog[id]), `${id} disagrees with sweep on scenario`).toBe(granted.has(id));
      }
    }
  });

  it('fraction is 1 exactly when met, and within [0,1] otherwise', () => {
    for (const s of scenarios) {
      const prog = achievementProgress(s);
      for (const p of Object.values(prog)) {
        expect(p.fraction).toBeGreaterThanOrEqual(0);
        expect(p.fraction).toBeLessThanOrEqual(1);
        if (isMet(p)) expect(p.fraction).toBe(1);
      }
    }
  });
});

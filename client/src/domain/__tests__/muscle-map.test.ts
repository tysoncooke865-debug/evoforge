import { describe, expect, it } from 'vitest';

import { MUSCLE_IDS, MUSCLE_ZONE, focusFor, muscleIdsFor, normaliseMuscleGroup, pillLabelsFor, type MusclePathTable } from '../muscle-map';

import { backMusclePaths } from '../../ui/muscle-map/back-muscle-paths';
import { frontMusclePaths } from '../../ui/muscle-map/front-muscle-paths';

describe('normaliseMuscleGroup', () => {
  it("claims EVERY tag of the app's own taxonomy — the ladder's whole vocabulary lights up", () => {
    const appTags = [
      'Chest', 'Upper Chest', 'Back Width', 'Back Thickness', 'Traps',
      'Side Delts', 'Rear Delts', 'Front Delts', 'Biceps', 'Triceps',
      'Forearms', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors', 'Abs',
    ];
    for (const tag of appTags) expect(normaliseMuscleGroup(tag), tag).not.toBeNull();
  });

  it('maps the spec examples', () => {
    expect(normaliseMuscleGroup('pecs')).toBe('chest');
    expect(normaliseMuscleGroup('pectorals')).toBe('chest');
    expect(normaliseMuscleGroup('delts')).toBe('shoulders');
    expect(normaliseMuscleGroup('rear delts')).toBe('shoulders');
    expect(normaliseMuscleGroup('latissimus dorsi')).toBe('lats');
    expect(normaliseMuscleGroup('trapezius')).toBe('traps');
    expect(normaliseMuscleGroup('abdominals')).toBe('abs');
    expect(normaliseMuscleGroup('quadriceps')).toBe('quads');
  });

  it('is case/space-insensitive, and honest about the unknown', () => {
    expect(normaliseMuscleGroup('  BACK WIDTH ')).toBe('lats');
    expect(normaliseMuscleGroup('mystery muscle')).toBeNull();
    expect(normaliseMuscleGroup('')).toBeNull();
  });

  it('muscleIdsFor dedupes, keeps order, drops the unclaimable', () => {
    expect(muscleIdsFor(['Chest', 'pecs', 'Side Delts', 'nonsense', 'Triceps'])).toEqual([
      'chest', 'shoulders', 'triceps',
    ]);
    expect(muscleIdsFor([])).toEqual([]);
  });
});

describe('pillLabelsFor — the chips speak the fine vocabulary', () => {
  it('a Push day reads Triceps, never "Arms"', () => {
    expect(pillLabelsFor(['chest', 'shoulders', 'triceps'])).toEqual(['Chest', 'Shoulders', 'Triceps']);
  });

  it('multi-word labels title-case', () => {
    expect(pillLabelsFor(['upperBack', 'lowerBack', 'quads'])).toEqual(['Upper Back', 'Lower Back', 'Quadriceps']);
  });

  it('empty selection → no pills', () => {
    expect(pillLabelsFor([])).toEqual([]);
  });
});

describe('focusFor — the zoom follows the work', () => {
  it('every MuscleId carries a zone (positive control)', () => {
    for (const id of MUSCLE_IDS) expect(MUSCLE_ZONE[id], id).toMatch(/^(upper|lower)$/);
  });

  it('an all-upper day zooms the torso', () => {
    expect(focusFor(['chest', 'shoulders', 'triceps'])).toBe('upper'); // Push
    expect(focusFor(['lats', 'upperBack', 'traps', 'biceps'])).toBe('upper'); // Pull
  });

  it('an all-lower day zooms the legs', () => {
    expect(focusFor(['quads', 'hamstrings', 'glutes', 'calves'])).toBe('lower'); // Legs
  });

  it('a mixed day shows the whole figure', () => {
    expect(focusFor(['chest', 'quads'])).toBe('full'); // Full Body
    expect(focusFor(['lowerBack', 'glutes'])).toBe('full'); // deadlift day straddles
  });

  it('an empty day shows the whole figure — a close-up of nothing helps nobody', () => {
    expect(focusFor([])).toBe('full');
  });
});

describe('muscle path tables — the SVG data the overlays draw', () => {
  const views: [string, MusclePathTable, string[]][] = [
    ['front', frontMusclePaths, ['chest', 'shoulders', 'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'quads', 'calves']],
    ['back', backMusclePaths, ['traps', 'shoulders', 'triceps', 'forearms', 'upperBack', 'lats', 'lowerBack', 'glutes', 'hamstrings', 'calves']],
  ];

  it('every MuscleId is drawable in at least one view (positive control: the tables are non-empty)', () => {
    expect(Object.keys(frontMusclePaths).length).toBeGreaterThan(0);
    expect(Object.keys(backMusclePaths).length).toBeGreaterThan(0);
    for (const id of MUSCLE_IDS) {
      expect(frontMusclePaths[id] ?? backMusclePaths[id], id).toBeTruthy();
    }
  });

  it.each(views)('%s view carries its spec-required regions', (_name, table, required) => {
    for (const id of required) expect(table[id as keyof MusclePathTable], id).toBeTruthy();
  });

  it('every path is a closed, axis-aligned staircase inside the 887×1774 grid', () => {
    for (const [, table] of views) {
      for (const [id, sides] of Object.entries(table)) {
        for (const d of Object.values(sides as Record<string, string>)) {
          expect(d, id).toMatch(/^M\d+ \d+( [HV]\d+)+ Z$/); // stepped: only H/V segments
          for (const m of d.matchAll(/[MHV](\d+)(?: (\d+))?/g)) {
            expect(Number(m[1])).toBeLessThanOrEqual(1774);
            if (m[2]) expect(Number(m[2])).toBeLessThanOrEqual(1774);
          }
        }
      }
    }
  });

  it('bilateral muscles carry BOTH sides where the spec demands', () => {
    expect(frontMusclePaths.chest?.left && frontMusclePaths.chest?.right).toBeTruthy();
    expect(backMusclePaths.lats?.left && backMusclePaths.lats?.right).toBeTruthy();
    expect(backMusclePaths.glutes?.left && backMusclePaths.glutes?.right).toBeTruthy();
  });
});

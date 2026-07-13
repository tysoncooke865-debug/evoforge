import { describe, expect, it } from 'vitest';

import { digestHistory, lastPerformanceLabel } from '../exercise-history';
import { EXERCISE_LIBRARY } from '../exercise-library';
import { buildSections } from '../exercise-sections';
import type { WorkoutRow } from '../summary';

const row = (exercise: string, date: string, weight = 60, reps = 8, setNo = 1): WorkoutRow => ({
  date,
  workout: 'Push',
  exercise,
  set: setNo,
  weight,
  reps,
  timestamp: `${date}T10:0${setNo}:00`,
});

const base = {
  library: EXERCISE_LIBRARY,
  program: [] as string[],
  history: digestHistory([]),
  favourites: new Set<string>(),
  hidden: new Set<string>(),
  targetMuscles: new Set<string>(),
  alreadyAdded: new Set<string>(),
};

describe('digestHistory', () => {
  const rows = [
    row('Barbell Bench Press', '2026-07-01', 80, 5),
    row('Barbell Bench Press', '2026-07-10', 85, 5, 2),
    row('Lat Pulldown', '2026-07-05', 60, 10),
    row('Face Pull', '2026-07-12', 0, 10), // invalid: never performed
  ];

  it('an invalid set is not a performance', () => {
    const h = digestHistory(rows);
    expect(h.performed.has('face pull')).toBe(false);
  });

  it('remembers the LAST performance, not the first', () => {
    const h = digestHistory(rows);
    expect(h.last.get('barbell bench press')).toMatchObject({ weight: 85, reps: 5 });
    expect(lastPerformanceLabel(h, 'Barbell Bench Press')).toBe('Last: 85 kg × 5');
  });

  it('orders RECENT by the newest set, not by frequency', () => {
    const h = digestHistory(rows);
    expect(h.recent[0]).toBe('Barbell Bench Press'); // 07-10 beats 07-05
    expect(h.recent).toContain('Lat Pulldown');
  });

  it('counts valid sets', () => {
    expect(digestHistory(rows).counts.get('barbell bench press')).toBe(2);
  });

  it('no history is empty, not a throw', () => {
    const h = digestHistory(undefined);
    expect(h.recent).toEqual([]);
    expect(lastPerformanceLabel(h, 'anything')).toBeNull();
  });
});

describe('buildSections — never a wall of 960', () => {
  it('a brand-new athlete gets POPULAR staples, not the alphabet', () => {
    const s = buildSections(base);
    expect(s.map((x) => x.key)).toEqual(['popular']);
    expect(s[0].exercises.length).toBeLessThanOrEqual(12);
    // popularity, not "3/4 Sit-Up" first
    expect(s[0].exercises[0].popularity ?? 0).toBeGreaterThan(80);
  });

  it('sections appear in the order the spec asks for', () => {
    const s = buildSections({
      ...base,
      program: ['Barbell Bench Press'],
      history: digestHistory([row('Lat Pulldown', '2026-07-10')]),
      favourites: new Set(['face pull']),
      targetMuscles: new Set(['Chest']),
    });
    expect(s.map((x) => x.key)).toEqual(['program', 'recent', 'favourites', 'suggested', 'popular']);
  });

  it('NO EXERCISE APPEARS TWICE across sections', () => {
    const s = buildSections({
      ...base,
      program: ['Barbell Bench Press', 'Lat Pulldown'],
      history: digestHistory([row('Barbell Bench Press', '2026-07-10'), row('Face Pull', '2026-07-11', 20, 12)]),
      favourites: new Set(['barbell bench press', 'face pull']),
      targetMuscles: new Set(['Chest', 'Back Width']),
    });
    const all = s.flatMap((x) => x.exercises.map((e) => e.name.toLowerCase()));
    expect(new Set(all).size).toBe(all.length);
  });

  it('FAVOURITES is hidden when there are none', () => {
    const s = buildSections({ ...base, favourites: new Set() });
    expect(s.find((x) => x.key === 'favourites')).toBeUndefined();
  });

  it('SUGGESTED only appears when we know what is being trained', () => {
    expect(buildSections(base).find((x) => x.key === 'suggested')).toBeUndefined();
    const s = buildSections({ ...base, targetMuscles: new Set(['Biceps']) });
    const sug = s.find((x) => x.key === 'suggested');
    expect(sug).toBeDefined();
    // and it suggests what is actually being trained
    expect(sug!.exercises.every((e) => e.muscle === 'Biceps')).toBe(true);
  });

  it('a HIDDEN exercise appears in no section', () => {
    const s = buildSections({
      ...base,
      program: ['Face Pull'],
      favourites: new Set(['face pull']),
      hidden: new Set(['face pull']),
    });
    const all = s.flatMap((x) => x.exercises.map((e) => e.name));
    expect(all).not.toContain('Face Pull');
  });

  it('filters apply to the sections too', () => {
    const s = buildSections({
      ...base,
      targetMuscles: new Set(['Chest']),
      filterPass: (e) => e.equipment === 'Dumbbell',
    });
    const all = s.flatMap((x) => x.exercises);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.equipment === 'Dumbbell')).toBe(true);
  });

  it('an exercise in the program is listed even if never performed', () => {
    const s = buildSections({ ...base, program: ['Tyson Special Lift'] });
    expect(s[0].exercises[0].name).toBe('Tyson Special Lift');
  });
});

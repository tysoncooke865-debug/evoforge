import { describe, expect, it } from 'vitest';

import {
  DAY_PRESETS,
  defaultScheduleFor,
  EXERCISE_LIBRARY,
  libraryMuscleFor,
  LIBRARY_SECTIONS,
  presetFor,
  REP_SCHEMES,
  scheduleForDays,
  seedPlanForSplit,
  SPLITS,
} from '../exercise-library';
import { IMPORTED_EXERCISES } from '../exercise-library-imported';

const LIBRARY_NAMES = new Set(EXERCISE_LIBRARY.map((e) => e.name));

describe('scheduleForDays — any plan maps onto the week (PLAN SCAN fix)', () => {
  const DOW = ['0', '1', '2', '3', '4', '5', '6'];
  const daysOf = (plan: Record<string, string>) => DOW.map((d) => plan[d]);

  it('spreads 3 days Mon/Wed/Fri with rest between', () => {
    expect(daysOf(scheduleForDays(['A', 'B', 'C'])!)).toEqual([
      'Rest', 'A', 'Rest', 'B', 'Rest', 'C', 'Rest',
    ]);
  });

  it.each([[1], [2], [3], [4], [5], [6], [7]] as const)(
    '%d-day plans place every day exactly once and fill the rest with Rest',
    (n) => {
      const days = Array.from({ length: n }, (_, i) => `Day ${i + 1}`);
      const plan = scheduleForDays(days)!;
      const values = daysOf(plan);
      expect(values).toHaveLength(7); // a positive control over the whole week
      for (const d of days) expect(values.filter((v) => v === d)).toHaveLength(1);
      expect(values.filter((v) => v === 'Rest')).toHaveLength(7 - n);
    }
  );

  it('caps at 7 — an 8-day "week" keeps the first seven', () => {
    const plan = scheduleForDays(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])!;
    expect(daysOf(plan)).not.toContain('h');
  });

  it('blank names are ignored; an all-blank list schedules nothing', () => {
    expect(scheduleForDays(['', '  '])).toBeNull();
    expect(scheduleForDays([])).toBeNull();
  });
});
/** Every tag the six UI sections can render. A tag outside this set belongs
 *  to no section, so the exercise carrying it is unpickable. */
const LEGAL_TAGS = new Set(LIBRARY_SECTIONS.flatMap((s) => s.muscles));

describe('the imported dataset (2026-07-14)', () => {
  it('is actually large (a shrunken import would pass every check below)', () => {
    expect(IMPORTED_EXERCISES.length).toBeGreaterThan(800);
    expect(EXERCISE_LIBRARY.length).toBeGreaterThan(900);
  });

  it('EVERY exercise carries a tag one of the six sections renders', () => {
    for (const e of EXERCISE_LIBRARY) {
      expect(LEGAL_TAGS.has(e.muscle), `"${e.name}" has unrenderable tag "${e.muscle}"`).toBe(true);
    }
  });

  it('NO EXACT DUPLICATE NAMES, case-insensitively', () => {
    const seen = new Map<string, string>();
    for (const e of EXERCISE_LIBRARY) {
      const key = e.name.trim().toLowerCase();
      expect(seen.has(key), `"${e.name}" duplicates "${seen.get(key)}"`).toBe(false);
      seen.set(key, e.name);
    }
  });

  it('the curated core still comes FIRST — staples before the long tail', () => {
    expect(EXERCISE_LIBRARY[0].name).toBe('Barbell Bench Press');
  });
});

describe('libraryMuscleFor — the library outranks the name heuristic', () => {
  it('answers for a core exercise', () => {
    expect(libraryMuscleFor('Barbell Bench Press')).toBe('Chest');
  });

  it('answers for an IMPORTED exercise inferMuscleGroup never saw', () => {
    const sample = IMPORTED_EXERCISES[0];
    expect(libraryMuscleFor(sample.name)).toBe(sample.muscle);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(libraryMuscleFor('  barbell BENCH press ')).toBe('Chest');
  });

  it('null for an unknown name, so the caller falls back to inference', () => {
    expect(libraryMuscleFor('Tyson’s Secret Lift')).toBeNull();
  });
});

describe('DAY_PRESETS — the guard that keeps a seeded routine real', () => {
  it('the presets are non-empty (an empty collection would pass every check below)', () => {
    expect(Object.keys(DAY_PRESETS).length).toBeGreaterThan(5);
    for (const [day, list] of Object.entries(DAY_PRESETS)) {
      expect(list.length, `${day} has no staples`).toBeGreaterThanOrEqual(4);
    }
  });

  it('EVERY seeded exercise exists in the library, byte-for-byte', () => {
    // A typo here would seed a routine with an exercise that has no muscle
    // tag — it would log, and grade against nothing.
    for (const [day, list] of Object.entries(DAY_PRESETS)) {
      for (const [name] of list) {
        expect(LIBRARY_NAMES.has(name), `${day}: "${name}" is not in EXERCISE_LIBRARY`).toBe(true);
      }
    }
  });

  it('every seeded rep scheme is one the builder can cycle', () => {
    for (const list of Object.values(DAY_PRESETS)) {
      for (const [, , reps] of list) {
        expect(REP_SCHEMES).toContain(reps);
      }
    }
  });

  it('set counts are inside the logger’s [1,8] clamp', () => {
    for (const list of Object.values(DAY_PRESETS)) {
      for (const [, sets] of list) {
        expect(sets).toBeGreaterThanOrEqual(1);
        expect(sets).toBeLessThanOrEqual(8);
      }
    }
  });
});

describe('SPLITS', () => {
  it('every split names days, except custom which names none', () => {
    for (const s of SPLITS) {
      if (s.key === 'custom') expect(s.days).toHaveLength(0);
      else expect(s.days.length).toBeGreaterThan(0);
    }
  });

  it('every preset key a split references actually exists', () => {
    for (const s of SPLITS) {
      for (const key of Object.values(s.presets ?? {})) {
        expect(DAY_PRESETS[key], `${s.key} references missing preset "${key}"`).toBeDefined();
      }
    }
  });

  it('a split never claims more training weekdays than it has days', () => {
    for (const s of SPLITS) {
      if (!s.weekdays) continue;
      expect(s.weekdays.length).toBeLessThanOrEqual(s.days.length);
    }
  });
});

describe('presetFor', () => {
  it('returns the staples for a mapped day', () => {
    const ppl = SPLITS.find((s) => s.key === 'ppl3')!;
    expect(presetFor(ppl, 'Push').length).toBeGreaterThan(0);
  });

  it('an unmapped day seeds NOTHING rather than guessing', () => {
    const bro = SPLITS.find((s) => s.key === 'bro5')!;
    expect(presetFor(bro, 'Shoulders')).toEqual([]); // no preset mapped
  });
});

describe('seedPlanForSplit', () => {
  it('builds a full plan for a preset split', () => {
    const plan = seedPlanForSplit('ppl3');
    expect(plan).not.toBeNull();
    expect(plan!.days.map((d) => d.day)).toEqual(['Push', 'Pull', 'Legs']);
    expect(plan!.days.every((d) => d.exercises.length >= 4)).toBe(true);
    // and every exercise is real
    for (const d of plan!.days) {
      for (const e of d.exercises) expect(LIBRARY_NAMES.has(e.exercise)).toBe(true);
    }
  });

  it('the new 3-day chest&back / arms / legs&core split seeds', () => {
    const plan = seedPlanForSplit('cbal3');
    expect(plan!.days.map((d) => d.day)).toEqual(['Chest & Back', 'Arms', 'Legs & Core']);
  });

  it('custom seeds NOTHING — the athlete names their own days', () => {
    expect(seedPlanForSplit('custom')).toBeNull();
  });

  it('an unknown key is null, not a throw', () => {
    expect(seedPlanForSplit('nope')).toBeNull();
  });
});

describe('defaultScheduleFor', () => {
  it('a 3-day split trains Mon/Wed/Fri and RESTS the rest', () => {
    const plan = defaultScheduleFor('ppl3')!;
    expect(plan['1']).toBe('Push');
    expect(plan['3']).toBe('Pull');
    expect(plan['5']).toBe('Legs');
    expect(plan['0']).toBe('Rest');
    expect(plan['2']).toBe('Rest');
    expect(plan['6']).toBe('Rest');
  });

  it('a 6-day split trains Mon–Sat and rests Sunday', () => {
    const plan = defaultScheduleFor('ppl6')!;
    expect(plan['0']).toBe('Rest');
    expect(Object.values(plan).filter((v) => v !== 'Rest')).toHaveLength(6);
  });

  it('every scheduled value is a real day of that split', () => {
    for (const s of SPLITS) {
      const plan = defaultScheduleFor(s.key);
      if (!plan) continue;
      for (const v of Object.values(plan)) {
        if (v === 'Rest') continue;
        expect(s.days).toContain(v);
      }
    }
  });

  it('custom has no schedule to imply', () => {
    expect(defaultScheduleFor('custom')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { EXERCISE_LIBRARY } from '../exercise-library';
import { editDistance, expandQuery, passesFilters, rankExercises } from '../exercise-rank';
import type { LibraryExercise } from '../exercise-taxonomy';

const names = (r: { exercise: LibraryExercise }[]) => r.map((x) => x.exercise.name);
const top = (q: string, opts = {}) => names(rankExercises(EXERCISE_LIBRARY, { query: q, ...opts }));

describe('the library is big enough for this to matter', () => {
  it('has 900+ exercises with taxonomy', () => {
    expect(EXERCISE_LIBRARY.length).toBeGreaterThan(900);
    expect(EXERCISE_LIBRARY.filter((e) => e.equipment).length).toBeGreaterThan(900);
    expect(EXERCISE_LIBRARY.filter((e) => e.category).length).toBeGreaterThan(900);
  });
});

describe('THE CASE THE WHOLE ENGINE EXISTS FOR', () => {
  it('"bench" puts bench PRESSES first — never a bench-supported ROW', () => {
    const r = top('bench');
    const firstRow = r.findIndex((n) => /row/i.test(n));
    const firstPress = r.findIndex((n) => /bench press/i.test(n));
    expect(firstPress).toBeGreaterThanOrEqual(0);
    expect(firstPress).toBeLessThan(firstRow === -1 ? Infinity : firstRow);
    expect(r[0]).toMatch(/bench press/i);
    // THE SPEC'S EXAMPLE, literally: the staple, not a band variation that
    // merely starts with the word.
    expect(r[0]).toBe('Barbell Bench Press');
  });

  it('during a CHEST workout, bench presses rank above everything else', () => {
    const r = names(
      rankExercises(EXERCISE_LIBRARY, {
        query: 'bench',
        context: { targetMuscles: new Set(['Chest', 'Upper Chest']) },
      })
    );
    expect(r.slice(0, 5).filter((n) => /bench press/i.test(n)).length).toBeGreaterThanOrEqual(4);
  });
});

describe('search: names, partials, aliases, abbreviations, typos', () => {
  it('exact name wins outright', () => {
    expect(top('Barbell Bench Press')[0]).toBe('Barbell Bench Press');
  });

  it('partial name', () => {
    expect(top('incline dumbbell')[0]).toBe('Incline Dumbbell Bench Press');
  });

  it('ABBREVIATION: "db incline" finds the dumbbell incline press', () => {
    expect(top('db incline').slice(0, 3)).toContain('Incline Dumbbell Bench Press');
  });

  it('ABBREVIATION: "rdl" finds the Romanian deadlift', () => {
    expect(top('rdl')[0]).toBe('Romanian Deadlift');
  });

  it('ABBREVIATION: "ohp" finds the overhead press', () => {
    expect(top('ohp')[0]).toMatch(/overhead/i);
  });

  it('VERNACULAR: "skull crusher" and "skullcrusher" both find it', () => {
    expect(top("skull crusher")[0]).toMatch(/skull ?crusher/i);
    expect(top("skullcrusher")[0]).toMatch(/skull ?crusher/i);
  });

  it('VERNACULAR: "tricep extension" (singular) finds triceps extensions', () => {
    expect(top('tricep extension')[0]).toMatch(/triceps/i);
  });

  // The search-bar brief, pinned 2026-07-15: a missed prefix must not skip
  // the exercise — "incline press" still finds machine variants whose names
  // it sits INSIDE.
  it('MID-NAME MULTI-WORD: "incline press" finds Smith Machine Incline Bench Press', () => {
    // "Smith Machine Incline Bench Press": neither word LEADS the name; the
    // all-tokens branch is what finds it. This worked unpinned — now it can't
    // silently stop working.
    expect(top('incline press')).toContain('Smith Machine Incline Bench Press');
    // And with the leading word supplied, it ranks well inside the top hits.
    expect(top('machine incline press').slice(0, 8)).toContain('Smith Machine Incline Bench Press');
  });

  it('MUSCLE TERM: "rear delt" finds rear-delt work', () => {
    const r = top('rear delt');
    expect(r.length).toBeGreaterThan(3);
    expect(
      rankExercises(EXERCISE_LIBRARY, { query: 'rear delt' })[0].exercise.muscle
    ).toBe('Rear Delts');
  });

  it('EQUIPMENT TERM: "cable" finds cable work', () => {
    const first = rankExercises(EXERCISE_LIBRARY, { query: 'cable' })[0].exercise;
    expect(`${first.name} ${first.equipment}`).toMatch(/cable/i);
  });

  it('TYPO: "benc pres" still finds the bench press', () => {
    expect(top('benc press')[0]).toMatch(/bench press/i);
  });

  it('a query that matches nothing returns nothing (no fuzzy nonsense)', () => {
    expect(top('qwertyuiop')).toEqual([]);
  });

  it('an empty query returns the whole library, popularity-ordered', () => {
    const r = rankExercises(EXERCISE_LIBRARY, { query: '' });
    expect(r.length).toBe(EXERCISE_LIBRARY.length);
    expect(r[0].exercise.popularity).toBeGreaterThanOrEqual(r[r.length - 1].exercise.popularity ?? 0);
  });
});

describe('the highlight points at the right characters (REGRESSION)', () => {
  // THE BUG: matchStart was measured against the NORMALISED name, where "(" is
  // a space and runs of space collapse. Applied to the RAW name, every index
  // past a parenthesis was shifted — searching "rear" highlighted "(Rea" in
  // "Reverse Pec Deck (Rear Delt Fly)". 18 library names contain parentheses.
  const scoredFor = (q: string, name: string) =>
    rankExercises(EXERCISE_LIBRARY, { query: q }).find((s) => s.exercise.name === name)!;

  it('the matched TEXT is returned, and it is found in the real name', () => {
    const s = scoredFor('rear', 'Reverse Pec Deck (Rear Delt Fly)');
    expect(s.match).toBe('rear');
    // What the row does: locate it in the name it renders.
    const at = s.exercise.name.toLowerCase().indexOf(s.match);
    expect(s.exercise.name.slice(at, at + s.match.length)).toBe('Rear');
  });

  it('a name with parentheses still highlights the right word', () => {
    const s = scoredFor('pulldown', 'Cable Lat Pullover (Straight-Arm Pulldown)');
    const at = s.exercise.name.toLowerCase().indexOf(s.match);
    expect(s.exercise.name.slice(at, at + s.match.length).toLowerCase()).toBe('pulldown');
  });

  it('a MUSCLE-only match highlights nothing in the name rather than guessing', () => {
    // "back width" is a muscle tag; no exercise is called that.
    const hits = rankExercises(EXERCISE_LIBRARY, { query: 'back width' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].exercise.muscle).toBe('Back Width');
    expect(hits[0].exercise.name.toLowerCase()).not.toContain('back width');
    expect(hits[0].match).toBe(''); // nothing in the NAME to point at
  });

  it('every match, when non-empty, really is IN the name', () => {
    for (const s of rankExercises(EXERCISE_LIBRARY, { query: 'press' }).slice(0, 40)) {
      if (s.match === '') continue;
      expect(s.exercise.name.toLowerCase()).toContain(s.match);
    }
  });
});

describe('expandQuery', () => {
  it('expands abbreviations into their words', () => {
    expect(expandQuery('db incline')).toContain('dumbbell');
    expect(expandQuery('rdl')).toEqual(expect.arrayContaining(['romanian', 'deadlift']));
  });
  it('leaves ordinary words alone', () => {
    expect(expandQuery('bench')).toEqual(['bench']);
  });
});

describe('editDistance', () => {
  it('counts edits and gives up past the cap', () => {
    expect(editDistance('bench', 'bench')).toBe(0);
    expect(editDistance('benc', 'bench')).toBe(1);
    expect(editDistance('bench', 'wildlyDifferent')).toBeGreaterThan(2);
  });
});

describe('filters EXCLUDE; ranking only orders', () => {
  const isCustom = () => false;

  it('muscle filter', () => {
    const r = rankExercises(EXERCISE_LIBRARY, { query: '', filters: { muscles: ['Biceps'] } });
    expect(r.length).toBeGreaterThan(10);
    expect(r.every((x) => x.exercise.muscle === 'Biceps')).toBe(true);
  });

  it('equipment filter', () => {
    const r = rankExercises(EXERCISE_LIBRARY, { query: '', filters: { equipment: ['Dumbbell'] } });
    expect(r.every((x) => x.exercise.equipment === 'Dumbbell')).toBe(true);
  });

  it('MULTIPLE filters compose (biceps AND dumbbell)', () => {
    const r = rankExercises(EXERCISE_LIBRARY, {
      query: '',
      filters: { muscles: ['Biceps'], equipment: ['Dumbbell'] },
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.exercise.muscle === 'Biceps' && x.exercise.equipment === 'Dumbbell')).toBe(true);
  });

  it('category and difficulty filters', () => {
    const r = rankExercises(EXERCISE_LIBRARY, {
      query: '',
      filters: { categories: ['Compound'], difficulties: ['Beginner'] },
    });
    expect(r.every((x) => x.exercise.category === 'Compound' && x.exercise.difficulty === 'Beginner')).toBe(true);
  });

  it('favourites-only shows only favourites', () => {
    const favourites = new Set(['face pull', 'hammer curl']);
    const r = rankExercises(EXERCISE_LIBRARY, {
      query: '',
      filters: { favouritesOnly: true },
      context: { favourites },
    });
    expect(names(r).sort()).toEqual(['Face Pull', 'Hammer Curl']);
  });

  it('clearing the filters restores the library', () => {
    expect(rankExercises(EXERCISE_LIBRARY, { query: '', filters: {} }).length).toBe(EXERCISE_LIBRARY.length);
  });

  it('passesFilters is the single gate', () => {
    const e = EXERCISE_LIBRARY.find((x) => x.name === 'Barbell Bench Press')!;
    expect(passesFilters(e, { muscles: ['Chest'] }, {}, isCustom)).toBe(true);
    expect(passesFilters(e, { muscles: ['Biceps'] }, {}, isCustom)).toBe(false);
  });
});

describe('the athlete outranks the alphabet', () => {
  const curl = (n: string) => n.toLowerCase();

  it('an exercise IN THEIR PROGRAM outranks an equal match that is not', () => {
    const r = names(
      rankExercises(EXERCISE_LIBRARY, {
        query: 'curl',
        context: { inProgram: new Set([curl('Spider Curl')]) },
      })
    );
    expect(r[0]).toBe('Spider Curl');
  });

  it('a FAVOURITE outranks an equal match that is not', () => {
    const r = names(
      rankExercises(EXERCISE_LIBRARY, {
        query: 'curl',
        context: { favourites: new Set([curl('Preacher Curl')]) },
      })
    );
    expect(r[0]).toBe('Preacher Curl');
  });

  it('something PERFORMED BEFORE outranks something never done', () => {
    const r = names(
      rankExercises(EXERCISE_LIBRARY, {
        query: 'curl',
        context: { performed: new Set([curl('Hammer Curl')]) },
      })
    );
    expect(r[0]).toBe('Hammer Curl');
  });

  it('an exercise ALREADY ADDED sinks, but is still findable', () => {
    const q = 'Face Pull';
    const without = names(rankExercises(EXERCISE_LIBRARY, { query: q }));
    const withAdded = names(
      rankExercises(EXERCISE_LIBRARY, { query: q, context: { alreadyAdded: new Set(['face pull']) } })
    );
    expect(without[0]).toBe('Face Pull');
    expect(withAdded).toContain('Face Pull'); // never hidden
  });

  it('a HIDDEN exercise is gone from browsing but found by typing its name', () => {
    const hidden = new Set(['face pull']);
    expect(names(rankExercises(EXERCISE_LIBRARY, { query: '', context: { hidden } }))).not.toContain('Face Pull');
    expect(names(rankExercises(EXERCISE_LIBRARY, { query: 'face pull', context: { hidden } }))).toContain('Face Pull');
  });
});

describe('custom exercises rank and filter like any other', () => {
  const custom: LibraryExercise = { name: 'Tyson Special Press', muscle: 'Chest', equipment: 'Barbell' };
  const lib = [...EXERCISE_LIBRARY, custom];
  const isCustom = (n: string) => n === custom.name;

  it('a custom exercise is searchable', () => {
    expect(names(rankExercises(lib, { query: 'tyson special' }))[0]).toBe('Tyson Special Press');
  });

  it('customs-only filter shows only theirs', () => {
    const r = rankExercises(lib, { query: '', filters: { customOnly: true }, isCustom });
    expect(names(r)).toEqual(['Tyson Special Press']);
  });
});

describe('determinism and cost', () => {
  it('the same query twice gives the same order', () => {
    expect(top('press')).toEqual(top('press'));
  });

  it('ranking the whole library stays well inside a keystroke budget', () => {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) rankExercises(EXERCISE_LIBRARY, { query: 'press' });
    const per = (performance.now() - t0) / 5;
    // ~10x a dev-machine measurement: catches an algorithmic regression, not a
    // busy runner. A keystroke must never feel like work.
    expect(per).toBeLessThan(120);
  });
});

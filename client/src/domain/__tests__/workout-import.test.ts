import { describe, expect, it } from 'vitest';

import { EXERCISE_LIBRARY } from '../exercise-library';
import { mapImportedPlan, parseSetsReps, type ImportedDay } from '../workout-import';

const day = (exercises: ImportedDay['exercises']): ImportedDay[] => [{ day: 'Push', exercises }];
const ex = (raw: string, exercise = raw, sets = 3, reps = '8-12') => ({ raw, exercise, sets, reps });

describe('mapImportedPlan — only corpus names survive', () => {
  it('an exact library name maps EXACT, verbatim', () => {
    const [d] = mapImportedPlan(day([ex('Barbell Bench Press')]), EXERCISE_LIBRARY);
    expect(d.exercises[0]).toMatchObject({
      exercise: 'Barbell Bench Press',
      confidence: 'exact',
      reason: '',
    });
  });

  it('shorthand maps to the closest real exercise — the best-guess requirement', () => {
    // The AI normalizes "inc db prss" -> "Incline Dumbbell Press"; the corpus
    // claims it as the incline dumbbell bench press.
    const [d] = mapImportedPlan(
      day([ex('inc db prss 3x8-12', 'Incline Dumbbell Press')]),
      EXERCISE_LIBRARY
    );
    expect(d.exercises[0].exercise).toMatch(/incline dumbbell/i);
    expect(['exact', 'close', 'guess']).toContain(d.exercises[0].confidence);
    expect(d.exercises[0].raw).toBe('inc db prss 3x8-12'); // the page's words survive
  });

  it('a NORMALIZED name that fails still falls back to matching the RAW text', () => {
    const [d] = mapImportedPlan(day([ex('romanian deadlift', 'zzzz')]), EXERCISE_LIBRARY);
    expect(d.exercises[0].exercise).toBe('Romanian Deadlift');
  });

  it('gibberish is UNMATCHED and keeps the raw name — never silently dropped', () => {
    const [d] = mapImportedPlan(day([ex('qwertyzxcv machine')]), EXERCISE_LIBRARY);
    expect(d.exercises[0].confidence).toBe('unmatched');
    expect(d.exercises[0].exercise).toBe('qwertyzxcv machine');
  });

  it('non-exact matches carry the audit trail in reason', () => {
    const [d] = mapImportedPlan(day([ex('skullcrusher', 'Skullcrusher')]), EXERCISE_LIBRARY);
    expect(d.exercises[0].reason).toContain('skullcrusher');
  });

  it('two lines that map to the SAME exercise collapse to one plan slot', () => {
    const [d] = mapImportedPlan(
      day([ex('bench 5x5', 'Barbell Bench Press', 5, '5'), ex('barbell bench press', 'Barbell Bench Press')]),
      EXERCISE_LIBRARY
    );
    expect(d.exercises).toHaveLength(1);
    expect(d.exercises[0].sets).toBe(5); // the first line wins
  });

  it('sets clamp to 1–8 and empty reps default', () => {
    const [d] = mapImportedPlan(day([ex('squat', 'Squat', 12, '')]), EXERCISE_LIBRARY);
    expect(d.exercises[0].sets).toBe(8);
    expect(d.exercises[0].reps).toBe('8-12');
  });

  it('a day whose every line was unreadable disappears; the plan does not', () => {
    const days: ImportedDay[] = [
      { day: 'Push', exercises: [ex('bench', 'Bench Press')] },
      { day: 'Ghost', exercises: [] },
    ];
    const mapped = mapImportedPlan(days, EXERCISE_LIBRARY);
    expect(mapped.map((d) => d.day)).toEqual(['Push']);
  });

  it('positive control: the corpus is real and the mapper actually ran', () => {
    expect(EXERCISE_LIBRARY.length).toBeGreaterThan(900);
    expect(mapImportedPlan(day([ex('bench', 'Bench Press')]), EXERCISE_LIBRARY)[0].exercises[0].confidence).not.toBe('unmatched');
  });
});

describe('parseSetsReps — what gym notes actually say', () => {
  it.each([
    ['5x5', 5, '5'],
    ['3x8-12', 3, '8-12'],
    ['4×10', 4, '10'],
    ['3 x 8 - 12', 3, '8-12'],
    ['3 sets of 12', 3, '12'],
    ['2 sets 6-10', 2, '6-10'],
  ] as const)('"%s" → %d sets, reps "%s"', (raw, sets, reps) => {
    expect(parseSetsReps(raw)).toEqual({ sets, reps });
  });

  it('AMRAP is a scheme, not a number', () => {
    expect(parseSetsReps('AMRAP')).toEqual({ sets: 3, reps: 'AMRAP' });
  });

  it('sets clamp at 8 — a "12x3" typo is not twelve sets', () => {
    expect(parseSetsReps('12x3')).toEqual({ sets: 8, reps: '3' });
  });

  it('unparseable → null, the caller keeps defaults', () => {
    expect(parseSetsReps('heavy')).toBeNull();
    expect(parseSetsReps('')).toBeNull();
  });
});

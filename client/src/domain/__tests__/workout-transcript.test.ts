import { describe, expect, it } from 'vitest';

import { formatExerciseSet } from '../exercise-load';
import { parseTranscript, parseTranscriptLine, validateParsedSet, type ParsedWorkoutSet } from '../workout-transcript';

const one = (s: string): ParsedWorkoutSet => {
  const r = parseTranscriptLine(s);
  expect(r.length, `expected at least one set from "${s}"`).toBeGreaterThan(0);
  return r[0];
};

describe('unweighted bodyweight phrases', () => {
  it('“Pull-ups, 12 reps”', () => {
    const s = one('Pull-ups, 12 reps');
    expect(s).toMatchObject({ exerciseName: 'Pull-Up', loadMode: 'bodyweight', externalLoadKg: null, assistanceKg: null, reps: 12 });
  });

  it('“I did three sets of 10 chin-ups” -> three sets', () => {
    const r = parseTranscriptLine('I did three sets of 10 chin-ups');
    expect(r).toHaveLength(3);
    expect(r.every((s) => s.loadMode === 'bodyweight' && s.reps === 10)).toBe(true);
  });

  it('“Bodyweight dips for 15”', () => {
    expect(one('Bodyweight dips for 15')).toMatchObject({ exerciseName: 'Dip', loadMode: 'bodyweight', reps: 15 });
  });

  it('“Push-ups, 20, 18 and 15” -> three descending sets', () => {
    const r = parseTranscriptLine('Push-ups, 20, 18 and 15');
    expect(r.map((s) => s.reps)).toEqual([20, 18, 15]);
    expect(r.every((s) => s.loadMode === 'bodyweight')).toBe(true);
  });

  it('“Four sets of pull-ups: 10, 9, 8, 7”', () => {
    const r = parseTranscriptLine('Four sets of pull-ups: 10, 9, 8, 7');
    expect(r.map((s) => s.reps)).toEqual([10, 9, 8, 7]);
  });

  it('never emits 0 kg for an unweighted set', () => {
    const s = one('Pull-ups, 12 reps');
    expect(s.weightKg).toBeNull();
    expect(s.externalLoadKg).toBeNull();
    expect(formatExerciseSet(validateParsedSet(s).set!)).toBe('BW × 12');
  });
});

describe('weighted phrases', () => {
  it('“Weighted pull-ups with 20 kilos for 8”', () => {
    expect(one('Weighted pull-ups with 20 kilos for 8')).toMatchObject({
      exerciseName: 'Pull-Up', loadMode: 'weighted_bodyweight', externalLoadKg: 20, assistanceKg: null, reps: 8,
    });
  });

  it('“Pull-ups plus 15 kilos for 10”', () => {
    expect(one('Pull-ups plus 15 kilos for 10')).toMatchObject({ loadMode: 'weighted_bodyweight', externalLoadKg: 15, reps: 10 });
  });

  it('“Three sets of dips with a 10-kilo plate”', () => {
    const r = parseTranscriptLine('Three sets of dips with a 10-kilo plate for 8');
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ exerciseName: 'Dip', loadMode: 'weighted_bodyweight', externalLoadKg: 10 });
  });

  it('“Chin-ups with 25 pounds added for 6” converts to kilograms', () => {
    const s = one('Chin-ups with 25 pounds added for 6');
    expect(s.loadMode).toBe('weighted_bodyweight');
    expect(s.externalLoadKg).toBeCloseTo(11.34, 1);
    expect(s.reps).toBe(6);
  });

  it('stores ADDED load only — never bodyweight plus added', () => {
    const s = one('Weighted pull-ups with 20 kilos for 8');
    expect(s.externalLoadKg).toBe(20);
    expect(s.weightKg).toBeNull();
  });
});

describe('assisted phrases', () => {
  it('“Assisted pull-ups with 30 kilos for 10”', () => {
    expect(one('Assisted pull-ups with 30 kilos for 10')).toMatchObject({
      exerciseName: 'Pull-Up', loadMode: 'assisted_bodyweight',
      externalLoadKg: null, assistanceKg: 30, assistanceType: 'machine', reps: 10,
    });
  });

  it('“Pull-up machine, 25 kilos assistance, 8 reps”', () => {
    expect(one('Pull-up machine, 25 kilos assistance, 8 reps')).toMatchObject({
      loadMode: 'assisted_bodyweight', assistanceKg: 25, reps: 8,
    });
  });

  it('“Dips with 20 kilos of assistance”', () => {
    expect(one('Dips with 20 kilos of assistance for 10')).toMatchObject({
      exerciseName: 'Dip', loadMode: 'assisted_bodyweight', assistanceKg: 20,
    });
  });

  it('“Band-assisted chin-ups for 12” NEVER invents kilograms', () => {
    const s = one('Band-assisted chin-ups for 12');
    expect(s.loadMode).toBe('assisted_bodyweight');
    expect(s.assistanceType).toBe('band');
    expect(s.assistanceKg).toBeNull();
    expect(s.warnings).toContain('band_assistance_has_no_kilogram_value');
  });

  it('assistance is never stored as positive external weight', () => {
    const s = one('Assisted pull-ups with 30 kilos for 10');
    expect(s.weightKg).toBeNull();
    expect(s.externalLoadKg).toBeNull();
    expect(validateParsedSet(s).set!.assistanceKg).toBe(30);
  });
});

describe('duration and repetition-only', () => {
  it('“Plank for 60 seconds”', () => {
    expect(one('Plank for 60 seconds')).toMatchObject({ exerciseName: 'Plank', loadMode: 'duration', durationSeconds: 60 });
  });

  it('“Plank for one minute”', () => {
    expect(one('Plank for one minute')).toMatchObject({ loadMode: 'duration', durationSeconds: 60 });
  });

  it('“Three 45-second side planks”', () => {
    const r = parseTranscriptLine('Three 45-second side planks');
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ exerciseName: 'Side Plank', durationSeconds: 45 });
  });

  it('“Dead hang for 40 seconds”', () => {
    expect(one('Dead hang for 40 seconds')).toMatchObject({ exerciseName: 'Dead Hang', durationSeconds: 40 });
  });

  it('“20 push-ups” and “30 air squats”', () => {
    expect(one('20 push-ups')).toMatchObject({ exerciseName: 'Push-Up', loadMode: 'bodyweight', reps: 20 });
    expect(one('30 air squats')).toMatchObject({ exerciseName: 'Air Squat', loadMode: 'repetition_only', reps: 30 });
  });

  it('preserves “each leg”', () => {
    expect(one('Walking lunges, 12 each leg')).toMatchObject({ loadMode: 'repetition_only', reps: 12, repsPerSide: true });
  });

  it('keeps tempo words as notes, not structured data', () => {
    expect(one('Strict pull-ups, 8 reps').notes).toMatch(/strict/i);
  });
});

describe('ambiguity is preserved, never guessed', () => {
  it('“Pull-ups, 20 kilos for 8” refuses to decide', () => {
    const s = one('Pull-ups, 20 kilos for 8');
    expect(s.loadMode).toBeNull();
    expect(s.confidence).toBeLessThan(0.5);
    expect(s.warnings).toContain('ambiguous_load_meaning');
  });

  it('an unresolved set cannot be saved and demands review', () => {
    const outcome = validateParsedSet(one('Pull-ups, 20 kilos for 8'));
    expect(outcome.ok).toBe(false);
    expect(outcome.requiresReview).toBe(true);
    expect(outcome.set).toBeNull();
  });

  it('NEVER defaults an ambiguous bodyweight load to ordinary external weight', () => {
    const s = one('Pull-ups, 20 kilos for 8');
    expect(s.loadMode).not.toBe('external');
    expect(s.weightKg).toBeNull();
  });

  it('an ordinary barbell lift with a load is NOT ambiguous', () => {
    expect(one('Bench press 100 kg for 5')).toMatchObject({ loadMode: 'external', weightKg: 100, reps: 5, confidence: 0.9 });
  });
});

describe('AI output is untrusted', () => {
  const base: ParsedWorkoutSet = {
    exerciseName: 'Pull-Up', matchedExerciseId: null, loadMode: 'bodyweight',
    weightKg: null, externalLoadKg: null, assistanceKg: null,
    assistanceType: null, assistanceDescription: null,
    reps: 10, repsPerSide: null, durationSeconds: null, distanceMeters: null,
    confidence: 0.9, warnings: [],
  };

  it('rejects an unsupported load mode', () => {
    const r = validateParsedSet({ ...base, loadMode: 'plyometric' as never });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('unsupported_load_mode');
  });

  it('rejects assistance smuggled in as external weight', () => {
    const r = validateParsedSet({ ...base, loadMode: 'assisted_bodyweight', weightKg: 30 });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('assistance_stored_as_external_weight');
  });

  it('rejects added weight and assistance together', () => {
    const r = validateParsedSet({ ...base, loadMode: 'weighted_bodyweight', externalLoadKg: 20, assistanceKg: 10 });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('added_and_assistance_together');
  });

  it('rejects a bodyweight set carrying a load', () => {
    const r = validateParsedSet({ ...base, loadMode: 'bodyweight', externalLoadKg: 20 });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('bodyweight_with_added_weight');
  });

  it('rejects negative assistance', () => {
    const r = validateParsedSet({ ...base, loadMode: 'assisted_bodyweight', assistanceKg: -5 });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('negative_assistance');
  });

  it('rejects a mode the exercise does not support', () => {
    const r = validateParsedSet({ ...base, exerciseName: 'Barbell Bench Press', loadMode: 'bodyweight' });
    expect(r.requiresReview).toBe(true);
  });

  it('low confidence always requires review even when otherwise valid', () => {
    expect(validateParsedSet({ ...base, confidence: 0.2 }).requiresReview).toBe(true);
  });
});

describe('manual entry and transcription produce identical records', () => {
  it('a transcribed weighted pull-up equals the manual one', () => {
    const transcribed = validateParsedSet(one('Weighted pull-ups with 20 kilos for 8')).set!;
    expect(transcribed.loadMode).toBe('weighted_bodyweight');
    expect(transcribed.externalLoadKg).toBe(20);
    expect(transcribed.assistanceKg).toBeNull();
    expect(formatExerciseSet(transcribed)).toBe('BW + 20 kg × 8');
  });

  it('a transcribed assisted pull-up formats the same as a manual one', () => {
    const t = validateParsedSet(one('Assisted pull-ups with 30 kilos for 10')).set!;
    expect(formatExerciseSet(t)).toBe('BW − 30 kg × 10');
  });
});

describe('multiple exercises in one transcript', () => {
  it('parses a whole session', () => {
    const sets = parseTranscript(
      'Pull-ups, 12 reps. Weighted pull-ups with 20 kilos for 8. Assisted pull-ups with 30 kilos for 10. Plank for 60 seconds.'
    );
    expect(sets).toHaveLength(4);
    expect(sets.map((s) => s.loadMode)).toEqual([
      'bodyweight', 'weighted_bodyweight', 'assisted_bodyweight', 'duration',
    ]);
  });

  it('re-parsing the same transcript is deterministic', () => {
    const t = 'Four sets of pull-ups: 10, 9, 8, 7';
    expect(JSON.stringify(parseTranscript(t))).toBe(JSON.stringify(parseTranscript(t)));
  });
});

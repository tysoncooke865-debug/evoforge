import { describe, expect, it } from 'vitest';

import {
  type CanonicalSet,
  calculateEffectiveResistanceKg,
  copyPreviousSet,
  formatExerciseSet,
  loadFieldLabel,
  loadFieldSign,
  modesForModel,
  normaliseExerciseSet,
  validateExerciseSet,
} from '../exercise-load';
import { contributesToTonnage, loadModelFor } from '../exercise-load-models';

const base: CanonicalSet = {
  loadMode: 'bodyweight',
  weightKg: null,
  externalLoadKg: null,
  assistanceKg: null,
  assistanceType: null,
  assistanceDescription: null,
  bodyweightSnapshotKg: null,
  reps: null,
  durationSeconds: null,
  distanceMeters: null,
  repsPerSide: null,
};
const set = (o: Partial<CanonicalSet>): CanonicalSet => ({ ...base, ...o });

/* ------------------------------------------------------------------ */
describe('load models come from exercise metadata, not screens', () => {
  it('maps the brief’s example exercises', () => {
    expect(loadModelFor('Pull-Up').model).toBe('bodyweight_weighted_or_assisted');
    expect(loadModelFor('Chin-Up').model).toBe('bodyweight_weighted_or_assisted');
    expect(loadModelFor('Dip').model).toBe('bodyweight_weighted_or_assisted');
    expect(loadModelFor('Assisted Pull-Up').model).toBe('bodyweight_assisted');
    expect(loadModelFor('Push-Up').model).toBe('bodyweight');
    expect(loadModelFor('Air Squat').model).toBe('repetition_only');
    expect(loadModelFor('Plank').model).toBe('duration');
    expect(loadModelFor('Dead Hang').model).toBe('duration');
    expect(loadModelFor('Barbell Bench Press').model).toBe('external_load');
    expect(loadModelFor('Lat Pulldown').model).toBe('external_load');
  });

  it('inherits a model for corpus VARIANTS without hand-written rows', () => {
    expect(loadModelFor('Wide-Grip Pull-Up').model).toBe('bodyweight_weighted_or_assisted');
    expect(loadModelFor('Ring Dip').model).toBe('bodyweight_weighted_or_assisted');
    expect(loadModelFor('Feet-Elevated Push-Up').model).toBe('bodyweight');
    expect(loadModelFor('Side Plank').model).toBe('duration');
  });

  it('prefers an explicit custom model over every heuristic', () => {
    const meta = loadModelFor('Pull-Up', { customLoadModel: 'bodyweight' });
    expect(meta.model).toBe('bodyweight');
    expect(meta.source).toBe('custom');
  });

  it('falls back by equipment, never by guessing', () => {
    expect(loadModelFor('Some Novel Machine Thing', { library: { name: 'x', equipment: 'Machine' } }).model)
      .toBe('external_load');
    expect(loadModelFor('Some Novel Floor Thing', { library: { name: 'x', equipment: 'Bodyweight' } }).model)
      .toBe('bodyweight');
  });
});

/* ------------------------------------------------------------------ */
describe('supported modes', () => {
  it('offers all three modes for a pull-up and only one for a bench press', () => {
    expect(modesForModel('bodyweight_weighted_or_assisted')).toEqual([
      'bodyweight',
      'weighted_bodyweight',
      'assisted_bodyweight',
    ]);
    expect(modesForModel('external_load')).toEqual(['external']);
  });

  it('an assist-only machine never offers added weight', () => {
    expect(modesForModel('bodyweight_assisted')).not.toContain('weighted_bodyweight');
  });
});

/* ------------------------------------------------------------------ */
describe('effective resistance', () => {
  it('bodyweight = the snapshot', () => {
    expect(calculateEffectiveResistanceKg(set({ loadMode: 'bodyweight', bodyweightSnapshotKg: 76, reps: 12 }))).toBe(76);
  });

  it('weighted = snapshot + added, and NEVER the stored total', () => {
    const s = set({ loadMode: 'weighted_bodyweight', bodyweightSnapshotKg: 76, externalLoadKg: 20, reps: 8 });
    expect(calculateEffectiveResistanceKg(s)).toBe(96);
    expect(s.externalLoadKg).toBe(20); // the PARTS survive
  });

  it('assisted = snapshot − assistance', () => {
    const s = set({ loadMode: 'assisted_bodyweight', bodyweightSnapshotKg: 76, assistanceKg: 30, reps: 10 });
    expect(calculateEffectiveResistanceKg(s)).toBe(46);
  });

  it('assistance can never produce a negative effective load', () => {
    const s = set({ loadMode: 'assisted_bodyweight', bodyweightSnapshotKg: 60, assistanceKg: 90, reps: 10 });
    expect(calculateEffectiveResistanceKg(s)).toBe(0);
  });

  it('returns NULL rather than inventing a bodyweight', () => {
    expect(calculateEffectiveResistanceKg(set({ loadMode: 'bodyweight', reps: 12 }))).toBeNull();
    expect(calculateEffectiveResistanceKg(set({ loadMode: 'weighted_bodyweight', externalLoadKg: 20, reps: 8 }))).toBeNull();
  });

  it('returns NULL for band assistance rather than inventing kilograms', () => {
    const s = set({
      loadMode: 'assisted_bodyweight',
      bodyweightSnapshotKg: 76,
      assistanceType: 'band',
      assistanceDescription: 'medium resistance band',
      reps: 12,
    });
    expect(calculateEffectiveResistanceKg(s)).toBeNull();
  });

  it('leaves ordinary external load exactly as it was', () => {
    expect(calculateEffectiveResistanceKg(set({ loadMode: 'external', weightKg: 60, reps: 8 }))).toBe(60);
  });
});

/* ------------------------------------------------------------------ */
describe('tonnage', () => {
  it('counts pull-ups, chin-ups and dips', () => {
    expect(contributesToTonnage('Pull-Up')).toBe(true);
    expect(contributesToTonnage('Chin-Up')).toBe(true);
    expect(contributesToTonnage('Dip')).toBe(true);
  });

  it('EXCLUDES push-ups, planks, air squats and burpees from full-bodyweight tonnage', () => {
    expect(contributesToTonnage('Push-Up')).toBe(false);
    expect(contributesToTonnage('Plank')).toBe(false);
    expect(contributesToTonnage('Air Squat')).toBe(false);
    expect(contributesToTonnage('Burpee')).toBe(false);
  });

  it('keeps ordinary weighted work in tonnage', () => {
    expect(contributesToTonnage('Barbell Bench Press')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
describe('formatting — one vocabulary everywhere', () => {
  it('renders the brief’s exact examples', () => {
    expect(formatExerciseSet(set({ loadMode: 'bodyweight', reps: 10 }))).toBe('BW × 10');
    expect(formatExerciseSet(set({ loadMode: 'weighted_bodyweight', externalLoadKg: 15, reps: 8 }))).toBe('BW + 15 kg × 8');
    expect(formatExerciseSet(set({ loadMode: 'assisted_bodyweight', assistanceKg: 25, reps: 10 }))).toBe('BW − 25 kg × 10');
    expect(formatExerciseSet(set({ loadMode: 'external', weightKg: 60, reps: 8 }))).toBe('60 kg × 8');
    expect(formatExerciseSet(set({ loadMode: 'duration', durationSeconds: 60 }))).toBe('1 min');
    expect(formatExerciseSet(set({ loadMode: 'repetition_only', reps: 20 }))).toBe('20 reps');
  });

  it('NEVER shows a bodyweight set as 0 kg', () => {
    const s = formatExerciseSet(set({ loadMode: 'bodyweight', reps: 12, bodyweightSnapshotKg: 76 }));
    expect(s).toBe('BW × 12');
    expect(s).not.toContain('0 kg');
    expect(s).not.toContain('76');
  });

  it('never replaces the description with the computed total', () => {
    const s = set({ loadMode: 'weighted_bodyweight', bodyweightSnapshotKg: 76, externalLoadKg: 20, reps: 8 });
    expect(formatExerciseSet(s)).toBe('BW + 20 kg × 8');
    expect(formatExerciseSet(s)).not.toContain('96');
  });

  it('names the band instead of a fabricated number', () => {
    const s = set({
      loadMode: 'assisted_bodyweight',
      assistanceType: 'band',
      assistanceDescription: 'medium resistance band',
      reps: 12,
    });
    expect(formatExerciseSet(s)).toBe('BW − medium resistance band × 12');
  });

  it('converts to pounds without changing what is stored', () => {
    const s = set({ loadMode: 'weighted_bodyweight', externalLoadKg: 20, reps: 8 });
    expect(formatExerciseSet(s, 'lb')).toBe('BW + 44.1 lb × 8');
    expect(s.externalLoadKg).toBe(20);
  });

  it('preserves per-side context', () => {
    expect(formatExerciseSet(set({ loadMode: 'repetition_only', reps: 12, repsPerSide: true }))).toBe('12 reps each side');
  });

  it('labels the keypad field by mode, with a visible sign', () => {
    expect(loadFieldLabel('weighted_bodyweight')).toBe('Added weight');
    expect(loadFieldLabel('assisted_bodyweight')).toBe('Assistance');
    expect(loadFieldLabel('bodyweight')).toBeNull();
    expect(loadFieldSign('weighted_bodyweight')).toBe('+');
    expect(loadFieldSign('assisted_bodyweight')).toBe('−');
  });
});

/* ------------------------------------------------------------------ */
describe('validation refuses the combinations that caused the bug', () => {
  const model = 'bodyweight_weighted_or_assisted';

  it('accepts a plain bodyweight set with no numeric load', () => {
    expect(validateExerciseSet(set({ loadMode: 'bodyweight', reps: 12 }), model).ok).toBe(true);
  });

  it('rejects bodyweight carrying added weight or assistance', () => {
    expect(validateExerciseSet(set({ loadMode: 'bodyweight', reps: 12, externalLoadKg: 20 }), model).errors)
      .toContain('bodyweight_with_added_weight');
    expect(validateExerciseSet(set({ loadMode: 'bodyweight', reps: 12, assistanceKg: 20 }), model).errors)
      .toContain('bodyweight_with_assistance');
  });

  it('rejects added weight and assistance together', () => {
    const r = validateExerciseSet(
      set({ loadMode: 'weighted_bodyweight', reps: 8, externalLoadKg: 20, assistanceKg: 10 }),
      model
    );
    expect(r.errors).toContain('added_and_assistance_together');
  });

  it('rejects negative loads', () => {
    expect(validateExerciseSet(set({ loadMode: 'weighted_bodyweight', reps: 8, externalLoadKg: -5 }), model).errors)
      .toContain('negative_added_weight');
    expect(validateExerciseSet(set({ loadMode: 'assisted_bodyweight', reps: 8, assistanceKg: -5 }), model).errors)
      .toContain('negative_assistance');
  });

  it('rejects weighted mode with no added weight', () => {
    expect(validateExerciseSet(set({ loadMode: 'weighted_bodyweight', reps: 8 }), model).errors)
      .toContain('added_weight_required');
  });

  it('rejects machine assistance with no amount, but ALLOWS a band', () => {
    expect(validateExerciseSet(set({ loadMode: 'assisted_bodyweight', reps: 8, assistanceType: 'machine' }), model).errors)
      .toContain('assistance_required');
    const band = set({ loadMode: 'assisted_bodyweight', reps: 12, assistanceType: 'band', assistanceDescription: 'light band' });
    expect(validateExerciseSet(band, model).ok).toBe(true);
  });

  it('rejects a mode the exercise does not support', () => {
    expect(validateExerciseSet(set({ loadMode: 'weighted_bodyweight', reps: 8, externalLoadKg: 10 }), 'bodyweight_assisted').errors)
      .toContain('mode_not_supported_by_exercise');
    // ...including plain external load on a canonical pull-up.
    expect(validateExerciseSet(set({ loadMode: 'external', reps: 8, weightKg: 96 }), model).errors)
      .toContain('mode_not_supported_by_exercise');
  });

  it('applies bounds from configuration', () => {
    expect(validateExerciseSet(set({ loadMode: 'weighted_bodyweight', reps: 8, externalLoadKg: 5000 }), model).errors)
      .toContain('added_weight_out_of_range');
  });

  it('leaves ordinary bench press valid and untouched', () => {
    expect(validateExerciseSet(set({ loadMode: 'external', weightKg: 100, reps: 5 }), 'external_load').ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
describe('normalisation clears fields that do not belong to the mode', () => {
  it('switching weighted -> assisted drops the stale added weight', () => {
    const stale = set({ loadMode: 'weighted_bodyweight', externalLoadKg: 20, reps: 8 });
    const flipped = normaliseExerciseSet({ ...stale, loadMode: 'assisted_bodyweight', assistanceKg: 30 }, 'bodyweight_weighted_or_assisted');
    expect(flipped.externalLoadKg).toBeNull();
    expect(flipped.assistanceKg).toBe(30);
  });

  it('switching to bodyweight drops every load', () => {
    const flipped = normaliseExerciseSet(
      { loadMode: 'bodyweight', externalLoadKg: 20, assistanceKg: 30, reps: 10 },
      'bodyweight_weighted_or_assisted'
    );
    expect(flipped.externalLoadKg).toBeNull();
    expect(flipped.assistanceKg).toBeNull();
    expect(validateExerciseSet(flipped, 'bodyweight_weighted_or_assisted').ok).toBe(true);
  });

  it('falls back to a supported mode when handed an impossible one', () => {
    const out = normaliseExerciseSet({ loadMode: 'assisted_bodyweight', reps: 8 }, 'external_load');
    expect(out.loadMode).toBe('external');
  });
});

/* ------------------------------------------------------------------ */
describe('copying a previous set', () => {
  it('copies the ADDED weight, not the effective total', () => {
    const previous = set({ loadMode: 'weighted_bodyweight', bodyweightSnapshotKg: 76, externalLoadKg: 20, reps: 8 });
    const next = copyPreviousSet(previous);
    expect(next.externalLoadKg).toBe(20);
    expect(next.loadMode).toBe('weighted_bodyweight');
  });

  it('preserves assistance mode and amount', () => {
    const previous = set({ loadMode: 'assisted_bodyweight', assistanceKg: 30, assistanceType: 'machine', reps: 10 });
    const next = copyPreviousSet(previous);
    expect(next.loadMode).toBe('assisted_bodyweight');
    expect(next.assistanceKg).toBe(30);
    expect(next.assistanceType).toBe('machine');
  });

  it('NEVER copies the historical bodyweight snapshot forward', () => {
    const previous = set({ loadMode: 'bodyweight', bodyweightSnapshotKg: 76, reps: 12 });
    expect(copyPreviousSet(previous).bodyweightSnapshotKg).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
describe('the bodyweight snapshot is frozen history', () => {
  it('a later weigh-in does not move an old set’s effective resistance', () => {
    const july = set({ loadMode: 'bodyweight', bodyweightSnapshotKg: 76, reps: 12 });
    // The athlete now weighs 80. Nothing reads current bodyweight here — the
    // stored set carries its own, so the old workout cannot drift.
    expect(calculateEffectiveResistanceKg(july)).toBe(76);
    const august = { ...july, bodyweightSnapshotKg: 80 };
    expect(calculateEffectiveResistanceKg(august)).toBe(80);
    expect(calculateEffectiveResistanceKg(july)).toBe(76);
  });

  it('a missing snapshot never blocks the set from being valid', () => {
    const s = set({ loadMode: 'bodyweight', reps: 12 });
    expect(validateExerciseSet(s, 'bodyweight_weighted_or_assisted').ok).toBe(true);
    expect(formatExerciseSet(s)).toBe('BW × 12');
    expect(calculateEffectiveResistanceKg(s)).toBeNull();
  });
});

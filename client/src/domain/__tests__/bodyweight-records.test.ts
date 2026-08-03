import { describe, expect, it } from 'vitest';

import { bodyweightRecords, isModeRecord } from '../bodyweight-records';
import { canonicalFromRow } from '../exercise-load';
import {
  buildSetRow,
  canonicalSetFor,
  isMissingLoadColumn,
  legacyWeightFor,
  stripLoadColumns,
  type SetInput,
} from '../set-save';

const row = (o: Record<string, unknown>) => ({ exercise: 'Pull-Up', date: '2026-01-01', ...o });

describe('records are separated by mode', () => {
  const rows = [
    row({ date: '2026-01-01', load_mode: 'bodyweight', reps: 10 }),
    row({ date: '2026-02-01', load_mode: 'bodyweight', reps: 12 }),
    row({ date: '2026-03-01', load_mode: 'weighted_bodyweight', external_load_kg: 20, reps: 8, bodyweight_snapshot_kg: 76 }),
    row({ date: '2026-04-01', load_mode: 'assisted_bodyweight', assistance_kg: 30, reps: 10 }),
    row({ date: '2026-05-01', load_mode: 'assisted_bodyweight', assistance_kg: 20, reps: 10 }),
  ];

  it('tracks most unweighted reps', () => {
    const r = bodyweightRecords(rows, 'Pull-Up').find((x) => x.kind === 'most_unweighted_reps');
    expect(r?.value).toBe(12);
  });

  it('tracks highest ADDED weight, not an effective total', () => {
    const r = bodyweightRecords(rows, 'Pull-Up').find((x) => x.kind === 'highest_added_weight');
    expect(r?.value).toBe(20);
    expect(r?.label).toBe('BW + 20 kg × 8');
  });

  it('LOWEST assistance wins — the direction that was inverted', () => {
    const r = bodyweightRecords(rows, 'Pull-Up').find((x) => x.kind === 'lowest_assistance');
    expect(r?.value).toBe(20);
  });

  it('records the FIRST unassisted rep as a milestone, not a maximum', () => {
    const r = bodyweightRecords(rows, 'Pull-Up').find((x) => x.kind === 'first_unassisted');
    expect(r?.date).toBe('2026-01-01');
  });

  it('never compares a weighted set against an assisted one', () => {
    const kinds = bodyweightRecords(rows, 'Pull-Up').map((r) => r.kind);
    expect(kinds).toContain('highest_added_weight');
    expect(kinds).toContain('lowest_assistance');
    // Four distinct record kinds, not one contested slot.
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('a bodyweight set CAN now set a record (it never could before)', () => {
    expect(isModeRecord(rows, 'Pull-Up', canonicalFromRow(row({ load_mode: 'bodyweight', reps: 15 })))).toBe(true);
  });

  it('reducing assistance registers as progress', () => {
    expect(isModeRecord(rows, 'Pull-Up', canonicalFromRow(row({ load_mode: 'assisted_bodyweight', assistance_kg: 10, reps: 10 })))).toBe(true);
    expect(isModeRecord(rows, 'Pull-Up', canonicalFromRow(row({ load_mode: 'assisted_bodyweight', assistance_kg: 40, reps: 10 })))).toBe(false);
  });

  it('excludes a weighted set with no bodyweight snapshot from e1RM records', () => {
    const noSnap = [row({ load_mode: 'weighted_bodyweight', external_load_kg: 40, reps: 5 })];
    const recs = bodyweightRecords(noSnap, 'Pull-Up');
    expect(recs.find((r) => r.kind === 'highest_added_weight')?.value).toBe(40);
    expect(recs.find((r) => r.kind === 'best_weighted_e1rm')).toBeUndefined();
  });

  it('tracks longest duration for holds', () => {
    const planks = [
      { exercise: 'Plank', date: '2026-01-01', load_mode: 'duration', duration_seconds: 45 },
      { exercise: 'Plank', date: '2026-02-01', load_mode: 'duration', duration_seconds: 75 },
    ];
    expect(bodyweightRecords(planks, 'Plank').find((r) => r.kind === 'longest_duration')?.value).toBe(75);
  });
});

describe('the stored row keeps mode and parts', () => {
  const base = { workoutDate: '2026-01-01', workout: 'Pull', exercise: 'Pull-Up', setNo: 1, weight: 0, reps: 8 };

  it('a weighted pull-up stores ADDED weight in the legacy column, not a total', () => {
    const input: SetInput = { ...base, load: { loadMode: 'weighted_bodyweight', externalLoadKg: 20, bodyweightSnapshotKg: 76 }, loadModel: 'bodyweight_weighted_or_assisted' };
    const r = buildSetRow(input, 'Back Width', '2026-01-01T00:00:00');
    expect(r.weight).toBe(20);
    expect(r.external_load_kg).toBe(20);
    expect(r.load_mode).toBe('weighted_bodyweight');
    // e1RM uses EFFECTIVE resistance (96), so it ranks honestly.
    expect(r.estimated_1rm).toBeCloseTo(96 * (1 + 8 / 30), 3);
  });

  it('an assisted pull-up never stores assistance as positive weight', () => {
    const input: SetInput = { ...base, reps: 10, load: { loadMode: 'assisted_bodyweight', assistanceKg: 30, assistanceType: 'machine', bodyweightSnapshotKg: 76 }, loadModel: 'bodyweight_weighted_or_assisted' };
    const r = buildSetRow(input, 'Back Width', '2026-01-01T00:00:00');
    expect(r.weight).toBe(0);
    expect(r.assistance_kg).toBe(30);
    expect(r.estimated_1rm).toBeCloseTo(46 * (1 + 10 / 30), 3);
  });

  it('a bodyweight pull-up gets a real e1RM from its snapshot', () => {
    const input: SetInput = { ...base, reps: 12, load: { loadMode: 'bodyweight', bodyweightSnapshotKg: 76 }, loadModel: 'bodyweight_weighted_or_assisted' };
    const r = buildSetRow(input, 'Back Width', '2026-01-01T00:00:00');
    expect(r.weight).toBe(0);
    expect(r.estimated_1rm).toBeGreaterThan(0);
  });

  it('push-ups contribute NO fabricated bodyweight tonnage', () => {
    const input: SetInput = { ...base, exercise: 'Push-Up', reps: 20, load: { loadMode: 'bodyweight', bodyweightSnapshotKg: 76 }, loadModel: 'bodyweight' };
    expect(buildSetRow(input, 'Chest', '2026-01-01T00:00:00').volume).toBe(0);
  });

  it('pull-ups DO contribute their effective resistance to tonnage', () => {
    const input: SetInput = { ...base, reps: 10, load: { loadMode: 'bodyweight', bodyweightSnapshotKg: 76 }, loadModel: 'bodyweight_weighted_or_assisted' };
    expect(buildSetRow(input, 'Back Width', '2026-01-01T00:00:00').volume).toBe(760);
  });

  it('an ordinary bench press is byte-identical to the legacy path', () => {
    const legacy: SetInput = { workoutDate: '2026-01-01', workout: 'Push', exercise: 'Barbell Bench Press', setNo: 1, weight: 100, reps: 5 };
    const r = buildSetRow(legacy, 'Chest', '2026-01-01T00:00:00');
    expect(r.weight).toBe(100);
    expect(r.volume).toBe(500);
    expect(r.load_mode).toBe('external');
    expect(r.external_load_kg).toBeNull();
    expect(r.estimated_1rm).toBeCloseTo(100 * (1 + 5 / 30), 6);
  });

  it('legacyWeightFor never emits a bodyweight-inclusive total', () => {
    const { set } = canonicalSetFor({ ...base, load: { loadMode: 'weighted_bodyweight', externalLoadKg: 20, bodyweightSnapshotKg: 76 }, loadModel: 'bodyweight_weighted_or_assisted' });
    expect(legacyWeightFor(set)).toBe(20);
  });
});

describe('the client ships before the migration does', () => {
  it('recognises a missing-load-column error', () => {
    expect(isMissingLoadColumn("Could not find the 'load_mode' column of 'workout_log' in the schema cache")).toBe(true);
    expect(isMissingLoadColumn('column workout_log.assistance_kg does not exist')).toBe(true);
  });

  it('does NOT mistake an unrelated failure for a missing column', () => {
    expect(isMissingLoadColumn('duplicate key value violates unique constraint')).toBe(false);
    expect(isMissingLoadColumn('column workout_log.nickname does not exist')).toBe(false);
    expect(isMissingLoadColumn(null)).toBe(false);
  });

  it('the stripped row is a valid pre-133 row — the set survives intact', () => {
    const input: SetInput = {
      workoutDate: '2026-01-01', workout: 'Pull', exercise: 'Pull-Up', setNo: 1, weight: 0, reps: 8,
      load: { loadMode: 'weighted_bodyweight', externalLoadKg: 20, bodyweightSnapshotKg: 76 },
      loadModel: 'bodyweight_weighted_or_assisted',
    };
    const stripped = stripLoadColumns(buildSetRow(input, 'Back Width', '2026-01-01T00:00:00'));
    expect(stripped.load_mode).toBeUndefined();
    expect(stripped.assistance_kg).toBeUndefined();
    // The legacy meaning is untouched: added weight, reps, and a real e1RM.
    expect(stripped.weight).toBe(20);
    expect(stripped.reps).toBe(8);
    expect(stripped.estimated_1rm).toBeGreaterThan(0);
  });
});

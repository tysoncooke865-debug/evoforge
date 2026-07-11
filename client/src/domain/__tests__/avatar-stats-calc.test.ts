import { describe, expect, it } from 'vitest';

import { calculateAvatarStats, muscleHeatMap, type AvatarStatsInputs } from '../avatar-stats-calc';
import type { WorkoutRow } from '../summary';

let stamp = 0;
const set = (exercise: string, weight: number, reps: number): WorkoutRow => ({
  date: '2026-07-10',
  workout: 'Push 1 - Strength',
  exercise,
  set: ++stamp, // unique set numbers: these rows are distinct sets, not edits
  weight,
  reps,
  timestamp: `2026-07-10T10:${String(stamp % 60).padStart(2, '0')}:00`,
});

const baseInputs = (over: Partial<AvatarStatsInputs> = {}): AvatarStatsInputs => ({
  workoutRows: [],
  level: 30,
  latestBodyweight: null,
  bfMid: null,
  physique: {
    physique_score: null,
    leanness_score: null,
    symmetry_score: null,
    muscularity_score: null,
  },
  cardioMinutes: 0,
  cardioDistanceKm: 0,
  profileDeadliftE1rm: null,
  ...over,
});

describe('calculateAvatarStats', () => {
  it('REGRESSION: a lean aesthetic athlete is NOT a Mass Monster', () => {
    // The profile-only approximation branded exactly this athlete "mass":
    // solid bench for their weight, lean, good AI physique ratings, little
    // cardio. The full blend must land on aesthetic, as the Streamlit app does.
    const stats = calculateAvatarStats(
      baseInputs({
        workoutRows: [
          set('Barbell Bench Press (Strength)', 90, 5),
          set('Barbell Back Squat', 110, 5),
          set('Lateral Raise', 12, 15),
          set('Incline Dumbbell Bench Press', 30, 10),
        ],
        latestBodyweight: 77,
        bfMid: 12,
        physique: {
          physique_score: 11,
          leanness_score: 11,
          symmetry_score: 10,
          muscularity_score: 9,
        },
      })
    );
    expect(stats.branch).toBe('aesthetic');
    // Leanness from bf 12: trunc(100 - (12-8)*6.5) = 74
    expect(stats.leannessScore).toBe(74);
  });

  it('a genuinely massive strength profile branches mass', () => {
    const stats = calculateAvatarStats(
      baseInputs({
        workoutRows: [
          set('Barbell Bench Press (Strength)', 140, 5),
          set('Barbell Back Squat', 200, 5),
          ...Array.from({ length: 100 }, () => set('Barbell Row', 100, 8)),
        ],
        latestBodyweight: 96,
        bfMid: 18,
        physique: {
          physique_score: 9,
          leanness_score: 6,
          symmetry_score: 8,
          muscularity_score: 14,
        },
      })
    );
    expect(stats.branch).toBe('mass');
    expect(stats.buildType).toBe('Heavy Frame');
  });

  it('empty data: conditioning 35, size floors at 25, bodyweight defaults 77 (Lean Frame)', () => {
    const stats = calculateAvatarStats(baseInputs());
    expect(stats.conditioningScore).toBe(35);
    expect(stats.sizeScore).toBeGreaterThanOrEqual(25);
    expect(stats.bodyweight).toBe(77);
    expect(stats.buildType).toBe('Lean Frame');
    expect(stats.weakPointFocus).toBe('Balanced'); // no heat map, no focus
  });

  it('bench falls back to the unlabelled bench names when the strength lift is absent', () => {
    const stats = calculateAvatarStats(
      baseInputs({ workoutRows: [set('Barbell Bench Press', 100, 1)] })
    );
    expect(stats.benchE1rm).toBeCloseTo(100 * (1 + 1 / 30), 10);
  });

  it('bf_mid wins over the AI leanness rating; absent bf falls back to it', () => {
    const withBf = calculateAvatarStats(
      baseInputs({ bfMid: 10, physique: { physique_score: null, leanness_score: 3, symmetry_score: null, muscularity_score: null } })
    );
    expect(withBf.leannessScore).toBe(87); // trunc(100 - 2*6.5)

    const withoutBf = calculateAvatarStats(
      baseInputs({ physique: { physique_score: null, leanness_score: 3, symmetry_score: null, muscularity_score: null } })
    );
    expect(withoutBf.leannessScore).toBe(20); // trunc(3/15*100)
  });

  it('the onboarding deadlift feeds the strength curve; absent it grades two lifts', () => {
    const rows = [
      set('Barbell Bench Press (Strength)', 90, 5), // e1RM 105 @ 77kg = 1.36x
      set('Barbell Back Squat', 110, 5), // e1RM 128.3 @ 77kg = 1.67x
    ];
    const without = calculateAvatarStats(baseInputs({ workoutRows: rows, latestBodyweight: 77 }));
    const withDl = calculateAvatarStats(
      baseInputs({ workoutRows: rows, latestBodyweight: 77, profileDeadliftE1rm: 180 }) // 2.34x
    );
    expect(without.deadliftE1rm).toBe(0);
    expect(withDl.deadliftE1rm).toBe(180);
    // A 2.34x deadlift is stronger evidence than the other two lifts alone.
    expect(withDl.strengthScore).toBeGreaterThan(without.strengthScore);
  });

  it('Romanian Deadlift does NOT count as the deadlift', () => {
    const stats = calculateAvatarStats(
      baseInputs({ workoutRows: [set('Romanian Deadlift', 180, 5)], latestBodyweight: 77 })
    );
    expect(stats.deadliftE1rm).toBe(0);
  });

  it('weak point focus picks the least-trained priority muscle, earlier wins ties', () => {
    const stats = calculateAvatarStats(
      baseInputs({
        workoutRows: [
          set('Incline Barbell Bench Press', 60, 10), // Upper Chest: 1
          set('Lateral Raise', 10, 15), // Side Delts: 1
          set('Lat Pulldown', 50, 12), // Back Width: 1
          // Rear Delts, Abs, Quads at 0 -> Rear Delts is the first zero
          // AFTER the earlier zeros... priority order walks Upper Chest(1),
          // Side Delts(1), Back Width(1), Rear Delts(0) -> lowest.
        ],
      })
    );
    expect(stats.weakPointFocus).toBe('Rear delts');
  });
});

describe('muscleHeatMap', () => {
  it('counts valid deduped sets per inferred muscle', () => {
    const heat = muscleHeatMap([
      set('Barbell Bench Press (Strength)', 80, 5),
      set('Incline Dumbbell Bench Press', 30, 10),
      set('Lateral Raise', 10, 0), // zero reps: not a valid set
    ]);
    expect(heat.get('Chest')).toBe(1);
    expect(heat.get('Upper Chest')).toBe(1);
    expect(heat.has('Side Delts')).toBe(false);
  });
});

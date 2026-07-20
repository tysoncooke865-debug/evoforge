/**
 * The DISPLAY side of achievements: for each of the 64 catalog entries, which
 * category it belongs to and how close the athlete is to earning it — a real
 * `current / target`, derived from the SAME thresholds `sweepAchievements`
 * grants on. The awards screen groups by category, shows a progress bar on the
 * locked ones, and ranks "next up" by how close each is.
 *
 * These thresholds are duplicated from the sweep ON PURPOSE (the sweep is a
 * pinned Python port and must not be refactored), so a drift guard exists:
 * `achievement-progress.test.ts` asserts, over random inputs, that
 * `met(progress) === sweepAchievements would-unlock` for every id. If a
 * threshold here ever disagrees with the grant path, that test goes red.
 */

import { exerciseMaxes, muscleSetsCount, uniqueTrainingDays, loggedAllPppplaDays, type SweepInputs } from './achievements';

export type AchCategory =
  | 'Milestones'
  | 'Consistency'
  | 'Strength'
  | 'Physique'
  | 'Volume'
  | 'Cardio'
  | 'Rank';

export const CATEGORY_ORDER: readonly AchCategory[] = [
  'Milestones',
  'Consistency',
  'Strength',
  'Physique',
  'Volume',
  'Cardio',
  'Rank',
];

export interface AchProgress {
  category: AchCategory;
  /** Athlete's current value on this achievement's metric. */
  current: number;
  /** Value that earns it. For a "get under" goal this is the ceiling. */
  target: number;
  /** 'up' = higher is closer (reach a number); 'down' = lower is closer (cut). */
  dir: 'up' | 'down';
  /** Suffix for the numbers, e.g. 'kg', 'sets', 'min'. '' for counts/bools. */
  unit: string;
  /** True when the target isn't knowable yet (a prerequisite log is missing). */
  indeterminate: boolean;
  /** Shown in place of a bar when indeterminate. */
  hint?: string;
  /** 0..1 how close, for ranking "next up". 1 = earned. */
  fraction: number;
}

const CATEGORY: Record<string, AchCategory> = {
  // Milestones — the "you did the thing once" set.
  first_set: 'Milestones', first_workout: 'Milestones', hundred_sets: 'Milestones',
  five_hundred_sets: 'Milestones', thousand_sets: 'Milestones', first_bw_log: 'Milestones',
  first_bf_log: 'Milestones', first_cardio: 'Milestones',
  // Consistency — training frequency.
  three_day_streak: 'Consistency', seven_day_streak: 'Consistency',
  fourteen_day_streak: 'Consistency', thirty_day_streak: 'Consistency',
  full_ppppla_week: 'Consistency',
  // Strength — bench + squat.
  bench_60: 'Strength', bench_80: 'Strength', bench_90: 'Strength', bench_100: 'Strength',
  bench_110: 'Strength', bench_120: 'Strength', bench_100_est: 'Strength', bench_120_est: 'Strength',
  bench_bw: 'Strength', bench_1_25_bw: 'Strength', bench_1_5_bw: 'Strength',
  squat_100: 'Strength', squat_140: 'Strength', squat_160: 'Strength', squat_180: 'Strength',
  squat_200: 'Strength', squat_1_5_bw: 'Strength', squat_2_bw: 'Strength',
  // Physique — bodyweight + body fat.
  bw_75: 'Physique', bw_80: 'Physique', bw_85: 'Physique', bulk_2kg: 'Physique', bulk_5kg: 'Physique',
  cut_2kg: 'Physique', cut_5kg: 'Physique', bf_under_15: 'Physique', bf_under_13: 'Physique',
  bf_under_12: 'Physique', bf_under_10: 'Physique', bf_target_hit: 'Physique',
  // Volume — muscle-group set counts.
  chest_50: 'Volume', chest_150: 'Volume', back_50: 'Volume', back_150: 'Volume',
  delts_50: 'Volume', delts_150: 'Volume', arms_100: 'Volume', legs_100: 'Volume', abs_50: 'Volume',
  // Cardio.
  cardio_100: 'Cardio', cardio_300: 'Cardio', cardio_1000: 'Cardio', cardio_5k_total: 'Cardio',
  cardio_25k_total: 'Cardio', cardio_100k_total: 'Cardio', boxing_logged: 'Cardio',
  // Rank — level tiers.
  aesthetic_tier: 'Rank', elite_physique: 'Rank', chad_lite: 'Rank', chad: 'Rank', true_adam: 'Rank',
};

/** The category of an achievement id (falls back to Milestones for safety). */
export function categoryOf(id: string): AchCategory {
  return CATEGORY[id] ?? 'Milestones';
}

function frac(p: Omit<AchProgress, 'fraction'>): number {
  if (p.indeterminate) return 0;
  if (p.target <= 0) return p.current > 0 ? 1 : 0;
  const raw = p.dir === 'up' ? p.current / p.target : p.target / Math.max(p.current, 0.0001);
  return Math.max(0, Math.min(1, raw));
}

function mk(p: Omit<AchProgress, 'fraction'>): AchProgress {
  return { ...p, fraction: frac(p) };
}

/**
 * Progress for every achievement, keyed by id. `current >= target` (dir up) /
 * `current <= target` (dir down), when not indeterminate, is exactly the
 * condition the sweep grants on — the drift test enforces it.
 */
export function achievementProgress(inputs: SweepInputs): Record<string, AchProgress> {
  const { workoutRows: rows, totalSets, bestBench1rm, level, heat, bw, bf, cardio, bfTarget } = inputs;
  const days = uniqueTrainingDays(rows);
  const bench = exerciseMaxes(rows, 'Barbell Bench Press (Strength)');
  const squat = exerciseMaxes(rows, 'Barbell Back Squat');
  const chest = muscleSetsCount(heat, ['Chest', 'Upper Chest']);
  const back = muscleSetsCount(heat, ['Back', 'Back Width', 'Back Thickness']);
  const delts = muscleSetsCount(heat, ['Delts', 'Side Delts', 'Rear Delts']);
  const arms = muscleSetsCount(heat, ['Biceps', 'Triceps']);
  const legs = muscleSetsCount(heat, ['Legs', 'Quads', 'Hamstrings', 'Glutes', 'Adductors', 'Calves']);
  const abs = muscleSetsCount(heat, ['Abs']);
  const bulk = bw.min !== null && bw.latest !== null ? bw.latest - bw.min : 0;
  const cut = bw.max !== null && bw.latest !== null ? bw.max - bw.latest : 0;
  const bwKnown = bw.latest !== null && bw.latest !== undefined && bw.latest > 0;

  const up = (category: AchCategory, current: number, target: number, unit = '') =>
    mk({ category, current, target, dir: 'up', unit, indeterminate: false });
  const down = (
    category: AchCategory,
    current: number | null | undefined,
    target: number,
    unit: string,
    hint: string
  ) =>
    mk({
      category,
      current: current ?? 0,
      target,
      dir: 'down',
      unit,
      indeterminate: !(current !== null && current !== undefined && current > 0),
      hint,
    });

  return {
    // Milestones
    first_set: up('Milestones', Math.min(totalSets, 1), 1),
    first_workout: up('Milestones', totalSets, 10, 'sets'),
    hundred_sets: up('Milestones', totalSets, 100, 'sets'),
    five_hundred_sets: up('Milestones', totalSets, 500, 'sets'),
    thousand_sets: up('Milestones', totalSets, 1000, 'sets'),
    first_bw_log: up('Milestones', Math.min(bw.count, 1), 1),
    first_bf_log: up('Milestones', Math.min(bf.count, 1), 1),
    first_cardio: up('Milestones', Math.min(cardio.count, 1), 1),

    // Consistency
    three_day_streak: up('Consistency', days, 3, 'days'),
    seven_day_streak: up('Consistency', days, 7, 'days'),
    fourteen_day_streak: up('Consistency', days, 14, 'days'),
    thirty_day_streak: up('Consistency', days, 30, 'days'),
    full_ppppla_week: mk({
      category: 'Consistency',
      current: loggedAllPppplaDays(rows) ? 1 : 0,
      target: 1,
      dir: 'up',
      unit: '',
      indeterminate: false,
      hint: 'Log all six PPPPLA days',
    }),

    // Strength — raw bench weight
    bench_60: up('Strength', bench.maxWeight, 60, 'kg'),
    bench_80: up('Strength', bench.maxWeight, 80, 'kg'),
    bench_90: up('Strength', bench.maxWeight, 90, 'kg'),
    bench_100: up('Strength', bench.maxWeight, 100, 'kg'),
    bench_110: up('Strength', bench.maxWeight, 110, 'kg'),
    bench_120: up('Strength', bench.maxWeight, 120, 'kg'),
    // Strength — estimated 1RM
    bench_100_est: up('Strength', bestBench1rm, 100, 'kg e1RM'),
    bench_120_est: up('Strength', bestBench1rm, 120, 'kg e1RM'),
    // Strength — bodyweight-relative (need a bodyweight log first)
    bench_bw: mk({ category: 'Strength', current: bestBench1rm, target: bwKnown ? bw.latest! : 0, dir: 'up', unit: 'kg', indeterminate: !bwKnown, hint: 'Log your bodyweight first' }),
    bench_1_25_bw: mk({ category: 'Strength', current: bestBench1rm, target: bwKnown ? bw.latest! * 1.25 : 0, dir: 'up', unit: 'kg', indeterminate: !bwKnown, hint: 'Log your bodyweight first' }),
    bench_1_5_bw: mk({ category: 'Strength', current: bestBench1rm, target: bwKnown ? bw.latest! * 1.5 : 0, dir: 'up', unit: 'kg', indeterminate: !bwKnown, hint: 'Log your bodyweight first' }),
    // Strength — squat
    squat_100: up('Strength', squat.maxWeight, 100, 'kg'),
    squat_140: up('Strength', squat.maxWeight, 140, 'kg'),
    squat_160: up('Strength', squat.maxWeight, 160, 'kg'),
    squat_180: up('Strength', squat.maxWeight, 180, 'kg'),
    squat_200: up('Strength', squat.maxWeight, 200, 'kg'),
    squat_1_5_bw: mk({ category: 'Strength', current: squat.maxE1rm, target: bwKnown ? bw.latest! * 1.5 : 0, dir: 'up', unit: 'kg', indeterminate: !(bwKnown && squat.maxE1rm > 0), hint: 'Squat + log your bodyweight' }),
    squat_2_bw: mk({ category: 'Strength', current: squat.maxE1rm, target: bwKnown ? bw.latest! * 2 : 0, dir: 'up', unit: 'kg', indeterminate: !(bwKnown && squat.maxE1rm > 0), hint: 'Squat + log your bodyweight' }),

    // Physique — bodyweight targets
    bw_75: down('Physique', bwKnown ? bw.latest : null, 75, 'kg', 'Log your bodyweight'),
    bw_80: mk({ category: 'Physique', current: bwKnown ? bw.latest! : 0, target: 80, dir: 'up', unit: 'kg', indeterminate: !bwKnown, hint: 'Log your bodyweight' }),
    bw_85: mk({ category: 'Physique', current: bwKnown ? bw.latest! : 0, target: 85, dir: 'up', unit: 'kg', indeterminate: !bwKnown, hint: 'Log your bodyweight' }),
    bulk_2kg: mk({ category: 'Physique', current: bulk, target: 2, dir: 'up', unit: 'kg gained', indeterminate: !(bw.min !== null && bw.latest !== null), hint: 'Log your bodyweight over time' }),
    bulk_5kg: mk({ category: 'Physique', current: bulk, target: 5, dir: 'up', unit: 'kg gained', indeterminate: !(bw.min !== null && bw.latest !== null), hint: 'Log your bodyweight over time' }),
    cut_2kg: mk({ category: 'Physique', current: cut, target: 2, dir: 'up', unit: 'kg lost', indeterminate: !(bw.max !== null && bw.latest !== null), hint: 'Log your bodyweight over time' }),
    cut_5kg: mk({ category: 'Physique', current: cut, target: 5, dir: 'up', unit: 'kg lost', indeterminate: !(bw.max !== null && bw.latest !== null), hint: 'Log your bodyweight over time' }),
    // Physique — body fat
    bf_under_15: down('Physique', bf.latest, 15, '%', 'Log your body fat'),
    bf_under_13: down('Physique', bf.latest, 13, '%', 'Log your body fat'),
    bf_under_12: down('Physique', bf.latest, 12, '%', 'Log your body fat'),
    bf_under_10: down('Physique', bf.latest, 10, '%', 'Log your body fat'),
    bf_target_hit: mk({ category: 'Physique', current: bf.latest ?? 0, target: bfTarget ?? 0, dir: 'down', unit: '%', indeterminate: !(bf.latest && bfTarget), hint: 'Set a body-fat target' }),

    // Volume
    chest_50: up('Volume', chest, 50, 'sets'),
    chest_150: up('Volume', chest, 150, 'sets'),
    back_50: up('Volume', back, 50, 'sets'),
    back_150: up('Volume', back, 150, 'sets'),
    delts_50: up('Volume', delts, 50, 'sets'),
    delts_150: up('Volume', delts, 150, 'sets'),
    arms_100: up('Volume', arms, 100, 'sets'),
    legs_100: up('Volume', legs, 100, 'sets'),
    abs_50: up('Volume', abs, 50, 'sets'),

    // Cardio
    cardio_100: up('Cardio', cardio.minutes, 100, 'min'),
    cardio_300: up('Cardio', cardio.minutes, 300, 'min'),
    cardio_1000: up('Cardio', cardio.minutes, 1000, 'min'),
    cardio_5k_total: up('Cardio', cardio.distance, 5, 'km'),
    cardio_25k_total: up('Cardio', cardio.distance, 25, 'km'),
    cardio_100k_total: up('Cardio', cardio.distance, 100, 'km'),
    boxing_logged: mk({ category: 'Cardio', current: cardio.types.has('Boxing') ? 1 : 0, target: 1, dir: 'up', unit: '', indeterminate: false, hint: 'Log a boxing session' }),

    // Rank
    aesthetic_tier: up('Rank', level, 40, 'lvl'),
    elite_physique: up('Rank', level, 60, 'lvl'),
    chad_lite: up('Rank', level, 75, 'lvl'),
    chad: up('Rank', level, 90, 'lvl'),
    true_adam: up('Rank', level, 100, 'lvl'),
  } satisfies Record<string, AchProgress>;
}

/** Whether a progress row counts as earned (mirrors the sweep's condition). */
export function isMet(p: AchProgress): boolean {
  if (p.indeterminate) return false;
  return p.dir === 'up' ? p.current >= p.target : p.current <= p.target;
}

/**
 * THE FIVE ORIGIN CONFIGURATIONS.
 *
 * Every origin is a value. There is no per-origin code path anywhere in the
 * Evolution Path — screens, the progression service and the reward engine
 * all read this table. Adding a sixth origin is: a `paths` row, an art
 * package, and one entry here.
 *
 * NAMING (see docs/EVOLUTION_PATH_PLAN.md §1): the brief's Speedster and
 * Hybrid are `cardio` and `mass`, the deployed slugs that key art, skins,
 * FKs and live user rows. `specName` records the mapping for a future
 * reader; it is never rendered and never an identifier.
 */

import { chapterOneRewards } from './rewards';
import { DEFAULT_QUALIFICATION } from './qualification';
import type { AssessmentRule, OriginChapter, OriginId, OriginLevelAsset, OriginPathConfig } from './types';

/** Chapters are identical in shape for every origin — the CONTENT of II-IV
 *  is unauthored in the beta and renders as a locked preview. */
function chapters(originName: string): OriginChapter[] {
  return [
    {
      id: 1,
      name: 'Chapter I — Awakening',
      fromWeek: 1,
      toWeek: 12,
      unlocksLevel: 2,
      summary: `Twelve qualified weeks. Prove the habit is real, and your ${originName} form evolves.`,
      authored: true,
    },
    {
      id: 2,
      name: 'Chapter II — Forged',
      fromWeek: 13,
      toWeek: 26,
      unlocksLevel: 3,
      summary: 'Fourteen more qualified weeks, plus real development in your Origin metrics.',
      authored: false,
    },
    {
      id: 3,
      name: 'Chapter III — Ascension',
      fromWeek: 27,
      toWeek: 48,
      unlocksLevel: 4,
      summary: 'Twenty-two more qualified weeks. The final form comes into reach.',
      authored: false,
    },
    {
      id: 4,
      name: 'Chapter IV — Origin Standard',
      fromWeek: 48,
      toWeek: 48,
      unlocksLevel: 4,
      summary: 'The real-world standard. Measured, not granted.',
      authored: false,
    },
  ];
}

/** Level packages. `artStage` maps the Origin Level onto the app's existing
 *  1-4 art stages; Level 0 borrows stage 1 in the dormant treatment. */
function levels(originName: string): OriginLevelAsset[] {
  return [
    { level: 0, artStage: 1, name: 'Dormant', blurb: `Your ${originName} has been chosen. It has not been awakened.`, manifestKey: 'stage_1' },
    { level: 1, artStage: 1, name: 'Awakened', blurb: 'One real workout. The form takes hold.', manifestKey: 'stage_1' },
    { level: 2, artStage: 2, name: 'Forged', blurb: 'Twelve qualified weeks. The body has started to answer.', manifestKey: 'stage_2' },
    { level: 3, artStage: 3, name: 'Ascendant', blurb: 'Twenty-six weeks. This is no longer a phase.', manifestKey: 'stage_3' },
    { level: 4, artStage: 4, name: 'Origin', blurb: 'The standard, met in the real world.', manifestKey: 'stage_4' },
  ];
}

/**
 * ASSESSMENT RULES — architecture, not beta behaviour.
 *
 * Nothing in the beta gates on these: no athlete can reach 48 qualified
 * weeks inside a beta, and the brief says keep the first implementation
 * conservative. They are declared now so the Level 4 gate has a shape, and
 * so it is obvious that a standard is a STORED NUMBER compared against a
 * THRESHOLD — never a model's opinion.
 */
const ASSESSMENTS: Record<OriginId, AssessmentRule[]> = {
  titan: [
    { id: 'titan_squat', label: 'Squat 2.0× bodyweight', metric: 'squat_e1rm', comparator: 'gte', target: 2.0, unit: 'x_bodyweight' },
    { id: 'titan_deadlift', label: 'Deadlift 2.5× bodyweight', metric: 'deadlift_e1rm', comparator: 'gte', target: 2.5, unit: 'x_bodyweight' },
  ],
  shredder: [
    { id: 'shredder_bf', label: 'Reach and hold a lean body-fat range', metric: 'bodyfat_pct', comparator: 'lte', target: 15, unit: 'percent' },
  ],
  cardio: [
    { id: 'cardio_volume', label: 'Sustain 150 cardio minutes a week', metric: 'cardio_minutes', comparator: 'gte', target: 150, unit: 'minutes' },
  ],
  aesthetic: [
    { id: 'aesthetic_bench', label: 'Bench 1.5× bodyweight', metric: 'bench_e1rm', comparator: 'gte', target: 1.5, unit: 'x_bodyweight' },
    { id: 'aesthetic_bf', label: 'Hold a presentable body-fat range', metric: 'bodyfat_pct', comparator: 'lte', target: 12, unit: 'percent' },
  ],
  mass: [
    { id: 'mass_volume', label: 'Sustain a high weekly working-set count', metric: 'total_sets', comparator: 'gte', target: 80, unit: 'count' },
  ],
};

interface Seed {
  id: OriginId;
  name: string;
  specName: string;
  promise: string;
  description: string;
  goals: OriginPathConfig['recommendationRules'];
}

const SEEDS: Seed[] = [
  {
    id: 'titan',
    name: 'Titan',
    specName: 'Titan',
    promise: 'Exceptional real-world strength.',
    description: 'Train for absolute strength. The Titan Standard is a real, measured total.',
    goals: [{ goal: 'strength', weight: 1 }, { goal: 'muscle_gain', weight: 0.4 }],
  },
  {
    id: 'shredder',
    name: 'Shredder',
    specName: 'Shredder',
    promise: 'Body-composition transformation and conditioning.',
    description: 'Train to change your composition — leaner, harder, better conditioned.',
    goals: [{ goal: 'fat_loss', weight: 1 }, { goal: 'cardio', weight: 0.4 }],
  },
  {
    id: 'cardio',
    name: 'Apex Engine',
    specName: 'Speedster',
    promise: 'Speed and cardiovascular ability.',
    description: 'Train for engine and speed. Distance, pace and recovery are the proof.',
    goals: [{ goal: 'cardio', weight: 1 }, { goal: 'fat_loss', weight: 0.3 }],
  },
  {
    id: 'aesthetic',
    name: 'Elite Aesthetic',
    specName: 'Aesthetic',
    promise: 'Muscularity, symmetry and physique development.',
    description: 'Train for the physique — balance, symmetry and visible development.',
    goals: [{ goal: 'aesthetics', weight: 1 }, { goal: 'muscle_gain', weight: 0.5 }],
  },
  {
    id: 'mass',
    name: 'Mass Monster',
    specName: 'Hybrid',
    promise: 'Balanced size, strength and conditioning.',
    description: 'Train for size on a base of strength and conditioning.',
    goals: [{ goal: 'muscle_gain', weight: 1 }, { goal: 'strength', weight: 0.5 }],
  },
];

export const ORIGIN_PATH_CONFIGS: Record<OriginId, OriginPathConfig> = Object.fromEntries(
  SEEDS.map((s) => [
    s.id,
    {
      id: s.id,
      name: s.name,
      specName: s.specName,
      promise: s.promise,
      description: s.description,
      recommendationRules: s.goals,
      levelAssets: levels(s.name),
      chapters: chapters(s.name),
      weeklyRewards: chapterOneRewards(s.id, s.name),
      qualificationRules: { ...DEFAULT_QUALIFICATION },
      assessmentRules: ASSESSMENTS[s.id],
    } satisfies OriginPathConfig,
  ])
) as Record<OriginId, OriginPathConfig>;

export const ORIGIN_PATH_LIST: OriginPathConfig[] = SEEDS.map((s) => ORIGIN_PATH_CONFIGS[s.id]);

export function originConfig(id: OriginId | null | undefined): OriginPathConfig | null {
  if (!id) return null;
  return ORIGIN_PATH_CONFIGS[id] ?? null;
}

/**
 * Recommend an Origin from the athlete's stated goal.
 *
 * DELIBERATELY SIMPLE AND DETERMINISTIC. The app already owns a far richer
 * server-side recommender (`origin_candidates`, calibration model v5) which
 * the onboarding reveal uses when there is enough evidence. This is the
 * pre-evidence fallback: a brand-new athlete has told us one thing — their
 * goal — and this maps it. Ties break by the config's declared order, so
 * the same input always produces the same recommendation.
 */
export function recommendOriginForGoal(
  goal: OriginPathConfig['recommendationRules'][number]['goal'] | null | undefined
): OriginId {
  if (!goal) return 'aesthetic';
  let best: OriginId = 'aesthetic';
  let bestWeight = -1;
  for (const cfg of ORIGIN_PATH_LIST) {
    const rule = cfg.recommendationRules.find((r) => r.goal === goal);
    if (rule && rule.weight > bestWeight) {
      bestWeight = rule.weight;
      best = cfg.id;
    }
  }
  return best;
}

/** The level package for a level, with a safe fallback to Dormant. */
export function levelAsset(config: OriginPathConfig, level: number): OriginLevelAsset {
  return config.levelAssets.find((l) => l.level === level) ?? config.levelAssets[0];
}

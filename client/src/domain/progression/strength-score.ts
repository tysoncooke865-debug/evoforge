/**
 * PROGRESSION_OVERHAUL — the Strength pillar (spec §11). Geometric across
 * five movement categories: horizontal press 25% · knee-dominant 25% ·
 * hip hinge 20% · upper pull 20% · vertical press 10%.
 *
 * THE ONE MAPPING: exercise → movement category lives HERE and nowhere
 * else. Evidence selection is best-2-of-the-last-4 comparable exposures
 * across ≥2 dates with recency weighting — one suspicious performance
 * cannot own a category. Relative (bodyweight-normalised) percentile
 * carries 80%, absolute 20%, against versioned reference curves kept in
 * this module until a real population dataset exists (spec: abstracted,
 * versioned, never scattered).
 */

import { daysBetween, evidenceConfidence, recencyWeight } from './confidence';
import { clampScore, confidenceLabelFor, type PillarResult } from './types';
import { scoreFromAnchors } from './size-score';

export const STRENGTH_REFERENCE_CURVE_VERSION = '1.0.0';

export type MovementCategory =
  | 'horizontal_press'
  | 'knee_dominant'
  | 'hip_hinge'
  | 'upper_pull'
  | 'vertical_press';

export const MOVEMENT_WEIGHTS: Record<MovementCategory, number> = {
  horizontal_press: 0.25,
  knee_dominant: 0.25,
  hip_hinge: 0.2,
  upper_pull: 0.2,
  vertical_press: 0.1,
};

/** Substring rules, first hit wins — ORDER MATTERS (RDL before "deadlift"
 *  would misfile; hinge patterns are listed before generic presses). */
const CATEGORY_RULES: readonly (readonly [MovementCategory, readonly string[]])[] = [
  ['hip_hinge', ['deadlift', 'rdl', 'romanian', 'good morning', 'hip thrust', 'rack pull', 'hinge']],
  ['knee_dominant', ['squat', 'leg press', 'hack', 'lunge', 'split squat', 'step-up', 'step up']],
  ['vertical_press', ['overhead press', 'ohp', 'shoulder press', 'military', 'push press', 'dip', 'landmine press']],
  ['horizontal_press', ['bench', 'chest press', 'push-up', 'push up', 'floor press', 'incline press', 'decline press']],
  ['upper_pull', ['pull-up', 'pull up', 'chin-up', 'chin up', 'pulldown', 'pull-down', 'row', 'lat ']],
];

export function movementCategoryFor(exercise: string): MovementCategory | null {
  const name = exercise.toLowerCase();
  for (const [category, needles] of CATEGORY_RULES) {
    if (needles.some((n) => name.includes(n))) return category;
  }
  return null;
}

/** Epley — the app-wide e1RM (domain/workouts.ts uses the same /30). Sets
 *  above 10 reps are NOT e1RM evidence (spec §11). */
export function e1rmFor(weightKg: number, reps: number): number | null {
  if (!(weightKg > 0) || !(reps > 0) || reps > 10) return null;
  return weightKg * (1 + reps / 30);
}

export type EquipmentClass =
  | 'verified_barbell'
  | 'barbell_history'
  | 'calibrated_plate_machine'
  | 'known_selectorised'
  | 'unknown_machine'
  | 'self_report';

/** Confidence ceilings by equipment provenance (spec §11). */
export const EQUIPMENT_CONFIDENCE: Record<EquipmentClass, number> = {
  verified_barbell: 100,
  barbell_history: 90,
  calibrated_plate_machine: 80,
  known_selectorised: 75,
  unknown_machine: 55,
  self_report: 40,
};

export interface StrengthObservation {
  exercise: string;
  weightKg: number;
  reps: number;
  /** YYYY-MM-DD */
  date: string;
  bodyweightKg?: number | null;
  equipment?: EquipmentClass;
}

/**
 * Reference curves v1 — e1RM/bodyweight ratio → percentile-ish score,
 * per category per sex. Manually configured until the internal dataset
 * exists; versioned via STRENGTH_REFERENCE_CURVE_VERSION.
 */
const RELATIVE_ANCHORS: Record<'male' | 'female', Record<MovementCategory, readonly (readonly [number, number])[]>> = {
  male: {
    horizontal_press: [[0.4, 10], [0.75, 30], [1.0, 50], [1.25, 70], [1.5, 85], [1.8, 95], [2.1, 99]],
    knee_dominant: [[0.6, 10], [1.0, 30], [1.4, 50], [1.8, 70], [2.2, 85], [2.6, 95], [3.0, 99]],
    hip_hinge: [[0.7, 10], [1.2, 30], [1.6, 50], [2.0, 70], [2.5, 85], [3.0, 95], [3.5, 99]],
    upper_pull: [[0.4, 10], [0.7, 30], [0.95, 50], [1.2, 70], [1.45, 85], [1.7, 95], [2.0, 99]],
    vertical_press: [[0.3, 10], [0.5, 30], [0.65, 50], [0.85, 70], [1.0, 85], [1.2, 95], [1.4, 99]],
  },
  female: {
    horizontal_press: [[0.25, 10], [0.45, 30], [0.6, 50], [0.8, 70], [1.0, 85], [1.2, 95], [1.4, 99]],
    knee_dominant: [[0.5, 10], [0.8, 30], [1.1, 50], [1.5, 70], [1.9, 85], [2.3, 95], [2.7, 99]],
    hip_hinge: [[0.6, 10], [1.0, 30], [1.3, 50], [1.7, 70], [2.1, 85], [2.6, 95], [3.0, 99]],
    upper_pull: [[0.25, 10], [0.45, 30], [0.6, 50], [0.8, 70], [1.0, 85], [1.2, 95], [1.4, 99]],
    vertical_press: [[0.2, 10], [0.35, 30], [0.45, 50], [0.6, 70], [0.75, 85], [0.9, 95], [1.05, 99]],
  },
};

/** Absolute anchors (kg e1RM → score), sex-specific. The 20% leg. */
const ABSOLUTE_ANCHORS: Record<'male' | 'female', Record<MovementCategory, readonly (readonly [number, number])[]>> = {
  male: {
    horizontal_press: [[40, 10], [70, 30], [95, 50], [120, 70], [145, 85], [170, 95], [200, 99]],
    knee_dominant: [[60, 10], [100, 30], [140, 50], [180, 70], [220, 85], [260, 95], [300, 99]],
    hip_hinge: [[70, 10], [120, 30], [160, 50], [200, 70], [250, 85], [300, 95], [350, 99]],
    upper_pull: [[40, 10], [65, 30], [85, 50], [110, 70], [130, 85], [150, 95], [175, 99]],
    vertical_press: [[25, 10], [45, 30], [60, 50], [75, 70], [90, 85], [110, 95], [130, 99]],
  },
  female: {
    horizontal_press: [[20, 10], [35, 30], [45, 50], [60, 70], [75, 85], [90, 95], [110, 99]],
    knee_dominant: [[40, 10], [65, 30], [90, 50], [120, 70], [150, 85], [180, 95], [210, 99]],
    hip_hinge: [[45, 10], [75, 30], [100, 50], [130, 70], [165, 85], [200, 95], [235, 99]],
    upper_pull: [[20, 10], [35, 30], [45, 50], [60, 70], [72, 85], [85, 95], [100, 99]],
    vertical_press: [[12, 10], [22, 30], [30, 50], [40, 70], [48, 85], [58, 95], [70, 99]],
  },
};

const CATEGORY_LABEL: Record<MovementCategory, string> = {
  horizontal_press: 'Horizontal Press',
  knee_dominant: 'Knee Dominant',
  hip_hinge: 'Hip Hinge',
  upper_pull: 'Upper Pull',
  vertical_press: 'Vertical Press',
};

export interface CategoryScore {
  category: MovementCategory;
  score: number;
  confidence: number;
  bestE1rm: number | null;
  evidenceDates: string[];
}

/**
 * One category from raw observations (spec's selection rule):
 * newest-first exposures → take the last 4, keep the BEST 2 by e1RM,
 * require ≥2 distinct dates for full confidence, recency-weight the rest.
 */
export function scoreCategory(
  category: MovementCategory,
  observations: StrengthObservation[],
  sex: 'male' | 'female',
  todayIso: string,
  fallbackBodyweightKg: number
): CategoryScore {
  const valid = observations
    .map((o) => ({ ...o, e1rm: e1rmFor(o.weightKg, o.reps) }))
    .filter((o): o is StrengthObservation & { e1rm: number } => o.e1rm !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  if (valid.length === 0) {
    return { category, score: 30, confidence: 15, bestE1rm: null, evidenceDates: [] };
  }

  const recent = valid.slice(0, 4);
  const best2 = [...recent].sort((a, b) => b.e1rm - a.e1rm).slice(0, 2);
  const dates = [...new Set(best2.map((o) => o.date))];

  let scoreSum = 0;
  let weightSum = 0;
  let confSum = 0;
  for (const o of best2) {
    const bw = (o.bodyweightKg ?? 0) > 0 ? (o.bodyweightKg as number) : fallbackBodyweightKg;
    const relative = scoreFromAnchors(o.e1rm / bw, RELATIVE_ANCHORS[sex][category]);
    const absolute = scoreFromAnchors(o.e1rm, ABSOLUTE_ANCHORS[sex][category]);
    const combined = relative * 0.8 + absolute * 0.2;
    const w = recencyWeight(daysBetween(o.date, todayIso));
    scoreSum += combined * w;
    weightSum += w;
    confSum += EQUIPMENT_CONFIDENCE[o.equipment ?? 'barbell_history'];
  }

  let confidence = Math.min(
    confSum / best2.length,
    evidenceConfidence(Math.min(valid.length, 8), { base: 25, max: 92 })
  );
  // Single-date evidence is soft: one session cannot own a category.
  if (dates.length < 2) confidence = Math.round(confidence * 0.7);

  return {
    category,
    score: clampScore(scoreSum / Math.max(weightSum, 1e-9)),
    confidence: Math.round(confidence),
    bestE1rm: Math.max(...best2.map((o) => o.e1rm)),
    evidenceDates: dates,
  };
}

export interface StrengthResult extends PillarResult {
  categories: CategoryScore[];
  allCoreCategoriesAtLeast85: boolean;
}

export function calculateStrengthScore(
  observations: StrengthObservation[],
  sex: 'male' | 'female',
  todayIso: string,
  fallbackBodyweightKg: number
): StrengthResult {
  const byCategory = new Map<MovementCategory, StrengthObservation[]>();
  for (const o of observations) {
    const cat = movementCategoryFor(o.exercise);
    if (!cat) continue;
    const list = byCategory.get(cat) ?? [];
    list.push(o);
    byCategory.set(cat, list);
  }

  const categories = (Object.keys(MOVEMENT_WEIGHTS) as MovementCategory[]).map((cat) =>
    scoreCategory(cat, byCategory.get(cat) ?? [], sex, todayIso, fallbackBodyweightKg)
  );

  let score = 100;
  for (const c of categories) {
    score *= Math.pow(clampScore(c.score) / 100, MOVEMENT_WEIGHTS[c.category]);
  }

  const covered = categories.filter((c) => c.evidenceDates.length > 0);
  const missing = categories
    .filter((c) => c.evidenceDates.length === 0)
    .map((c) => `${CATEGORY_LABEL[c.category]} evidence`);
  const weakest = [...categories].sort((a, b) => a.score - b.score)[0];
  const limiting = weakest && weakest.score < 55 ? [CATEGORY_LABEL[weakest.category]] : [];

  const confidence =
    covered.length === 0
      ? 15
      : Math.round(
          Math.min(...covered.map((c) => c.confidence)) * (covered.length / categories.length)
        );

  return {
    score: clampScore(score),
    confidence,
    confidenceLabel: confidenceLabelFor(confidence),
    evidenceCount: covered.reduce((n, c) => n + c.evidenceDates.length, 0),
    missingEvidence: missing,
    limitingFactors: limiting,
    categories,
    allCoreCategoriesAtLeast85: categories.every((c) => c.score >= 85),
  };
}

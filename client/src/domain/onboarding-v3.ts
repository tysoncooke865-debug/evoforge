/**
 * ONBOARDING V3 — the vocabulary, the placement and the plan recommender.
 * docs/ONBOARDING_V3_SPEC.md is the contract; this file is its pure core.
 *
 * V3 asks four things: what you are training for, where you are starting
 * from, how you want to train, and which Origin you want to become. It does
 * NOT ask for height, bodyweight, one-rep maxes, an eating phase, a physique
 * photo or a username — every one of those is collected later, at the moment
 * it earns its keep.
 *
 * Everything here is a pure function over those four answers so the screen
 * can be dumb and the decisions can be tested.
 */

import { defaultScheduleFor, SPLITS } from './exercise-library';
import type { PrimaryGoal } from './origin/types';

/* ───────────────────────────── goals ───────────────────────────────── */

export const ONBOARDING_GOALS = [
  'build_muscle',
  'get_stronger',
  'lose_fat',
  'improve_fitness',
  'be_consistent',
  'track_program',
] as const;
export type OnboardingGoal = (typeof ONBOARDING_GOALS)[number];

export const GOAL_LABEL: Record<OnboardingGoal, string> = {
  build_muscle: 'Build muscle',
  get_stronger: 'Get stronger',
  lose_fat: 'Lose body fat',
  improve_fitness: 'Improve fitness',
  be_consistent: 'Become more consistent',
  track_program: 'Track my current program',
};

/**
 * The v3 goal → the candidate model's `primary_goal`, which is an ORIGIN
 * signal and nothing else.
 *
 * "Become more consistent" and "track my current program" map to NULL on
 * purpose. They are real goals and they are stored verbatim in
 * `onboarding_goal` — but neither says anything about which Origin an
 * athlete resonates with, and the model already has a documented path for a
 * null goal (candidates.ts §4.2 phase-inferred fallback). Forcing them into
 * the five-value vocabulary would invent an affinity nobody expressed, which
 * is the same class of mistake as a mocked number.
 */
export const GOAL_TO_PRIMARY: Record<OnboardingGoal, PrimaryGoal | null> = {
  build_muscle: 'muscle_gain',
  get_stronger: 'strength',
  lose_fat: 'fat_loss',
  improve_fitness: 'cardio',
  be_consistent: null,
  track_program: null,
};

/* ─────────────────────────── experience ────────────────────────────── */

export const EXPERIENCE_LEVELS = [
  'new',
  'occasional',
  'consistent',
  'experienced',
  'competitive',
] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const EXPERIENCE_LABEL: Record<ExperienceLevel, string> = {
  new: 'New to training',
  occasional: 'Training occasionally',
  consistent: 'Training consistently',
  experienced: 'Experienced lifter',
  competitive: 'Competitive athlete',
};

/* ──────────────────────────── the route ────────────────────────────── */

export type TrainingRoute = 'have_program' | 'build_for_me';

export const EQUIPMENT = ['full_gym', 'home_basic', 'bodyweight', 'unsure'] as const;
export type EquipmentAccess = (typeof EQUIPMENT)[number];

export const EQUIPMENT_LABEL: Record<EquipmentAccess, string> = {
  full_gym: 'Full gym',
  home_basic: 'Home — dumbbells or bands',
  bodyweight: 'Bodyweight only',
  unsure: "I'm not sure yet",
};

export const SESSION_MINUTES = [30, 45, 60, 90] as const;

/* ──────────────────────────── placement ────────────────────────────── */

/**
 * PLACEMENT V3 — `base_level` from the experience band, and nothing else.
 *
 * What is deliberately NOT an input, and why:
 *
 *   PHOTOS. Under V2, physique came from the AI scan (0–15) or, when the
 *   scan was skipped, from `derivedPhysiqueDefault`, WHICH CAPS AT 10.
 *   Declining to photograph yourself was worth up to five levels. Missing
 *   photos must lower CONFIDENCE, never SCORE — otherwise the athletes most
 *   likely to decline are penalised for protecting their privacy, and they
 *   are exactly the athletes this app could help most.
 *
 *   LIFTS. A typed one-rep max is a claim, not evidence. The Evo Rating's
 *   strength pillar reads the workout LOG (strength-score.ts), so real
 *   numbers arrive by training — which is both more honest and the thing we
 *   want the athlete doing instead of filling in a form.
 *
 * The bands top out at 45 on purpose: placement never exceeds RARE
 * (avatar-stats.ts puts EPIC at 50). Onboarding is a claim; everything above
 * RARE is earned. `base_level` is a FLOOR — workoutSummary adds the XP
 * ledger on top — so a conservative placement costs an athlete nothing but
 * the head start they had not yet demonstrated.
 *
 * `base_level` stays immutable after onboarding, exactly as under V2, and no
 * existing row is ever recomputed by this function.
 */
const PLACEMENT: Record<ExperienceLevel, number> = {
  new: 3,
  occasional: 12,
  consistent: 26,
  experienced: 35,
  competitive: 45,
};

export function startingLevelV3(experience: ExperienceLevel | null): number {
  if (experience === null) return PLACEMENT.new;
  return PLACEMENT[experience] ?? PLACEMENT.new;
}

/**
 * The experience band as an approximate training-years figure, for the
 * systems that already read `training_years` (the candidate model, the
 * legacy avatar stats). It is a self-report either way — v3 just asks for it
 * in a form a human can answer without lying to themselves.
 */
const YEARS: Record<ExperienceLevel, number> = {
  new: 0,
  occasional: 0.5,
  consistent: 2,
  experienced: 5,
  competitive: 8,
};

export function trainingYearsFor(experience: ExperienceLevel | null): number {
  if (experience === null) return 0;
  return YEARS[experience] ?? 0;
}

/* ──────────────────────── the plan recommender ─────────────────────── */

export interface PlanRequest {
  goal: OnboardingGoal | null;
  experience: ExperienceLevel | null;
  daysPerWeek: number | null;
  equipment: EquipmentAccess | null;
}

/**
 * Days + goal + experience + equipment → one seedable split key.
 *
 * Two rules override everything else:
 *   - A beginner never gets a 5- or 6-day split. Handing "new to training"
 *     an Arnold split is how a plan becomes a thing you fail at in week two.
 *   - Without a full gym, full-body and upper/lower win: they need the
 *     fewest distinct implements to run at all.
 *
 * Returns a key that `seedPlanForSplit` can actually seed — never 'custom',
 * which has no presets.
 */
export function recommendSplit(req: PlanRequest): string {
  const days = Math.max(2, Math.min(6, Math.round(req.daysPerWeek ?? 3)));
  const beginner = req.experience === 'new' || req.experience === null;
  const light = req.equipment === 'bodyweight' || req.equipment === 'home_basic';

  if (beginner) return days >= 4 ? 'ul4' : 'fb3';
  if (light) return days >= 4 ? 'ul4' : 'fb3';

  if (days <= 3) {
    if (req.goal === 'get_stronger') return 'fb3';
    if (req.goal === 'improve_fitness' || req.goal === 'lose_fat') return 'fb3';
    return 'ppl3';
  }
  if (days === 4) {
    if (req.goal === 'get_stronger') return 'phul4';
    if (req.goal === 'build_muscle') return 'ubro4';
    return 'ul4';
  }
  if (days === 5) return req.goal === 'build_muscle' ? 'bro5full' : 'ppul5';
  return req.goal === 'build_muscle' ? 'arnold6' : 'ppl6';
}

/**
 * The first mission the seeded week actually hands over: today's assigned
 * day, or the next training day after it.
 *
 * The reveal screen promises a specific workout, so it must resolve the same
 * way Train will when the athlete taps through — walking forward from today
 * rather than naming the split's first day, which on a Wednesday signup is a
 * workout four days away being announced as "your next".
 *
 * Returns null when the week is all rest, which no seedable split produces
 * but a hand-edited schedule could.
 */
export function firstMissionDay(
  schedule: Record<string, string> | null,
  todayDow: number
): { day: string; inDays: number } | null {
  if (!schedule) return null;
  for (let offset = 0; offset < 7; offset += 1) {
    const dow = (todayDow + offset) % 7;
    const day = schedule[String(dow)];
    if (day && day !== 'Rest') return { day, inDays: offset };
  }
  return null;
}

/** The split's display name, for the reveal screen. Null when unknown. */
export function splitName(key: string): string | null {
  return SPLITS.find((s) => s.key === key)?.name ?? null;
}

/** The split's training day names, in order. Empty when unknown. */
export function splitDays(key: string): readonly string[] {
  return SPLITS.find((s) => s.key === key)?.days ?? [];
}

/**
 * The week the split implies, honouring the athlete's PREFERRED days when
 * they gave any.
 *
 * `defaultScheduleFor` lays a split onto its own canonical weekdays. When an
 * athlete has said which days they train, those win — otherwise we would ask
 * a question and then ignore the answer, which is worse than never asking.
 * Preferred days are used in ascending order; surplus training days fall back
 * to the split's own weekdays so a 4-day split with 2 preferred days still
 * produces a complete week rather than half a plan.
 */
export function scheduleForSplit(
  key: string,
  preferredDays: readonly number[] | null
): Record<string, string> | null {
  const fallback = defaultScheduleFor(key);
  if (!fallback) return null;
  const days = splitDays(key);
  if (!preferredDays || preferredDays.length === 0 || days.length === 0) return fallback;

  const wanted = [...new Set(preferredDays)]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);
  if (wanted.length === 0) return fallback;

  const plan: Record<string, string> = {
    '0': 'Rest', '1': 'Rest', '2': 'Rest', '3': 'Rest', '4': 'Rest', '5': 'Rest', '6': 'Rest',
  };
  const placed: string[] = [];
  days.forEach((day, i) => {
    const dow = wanted[i];
    if (dow !== undefined) {
      plan[String(dow)] = day;
      placed.push(day);
    }
  });
  // Any training day the athlete's chosen days could not hold keeps the
  // split's own weekday, provided that slot is still free.
  for (const [dow, day] of Object.entries(fallback)) {
    if (day !== 'Rest' && !placed.includes(day) && plan[dow] === 'Rest') plan[dow] = day;
  }
  return plan;
}

/**
 * FUEL — the calorie arithmetic (nutrition branch).
 *
 * THE RULE THAT SHAPES THIS FILE: the AI asks; the domain computes — never the
 * reverse. The intake assistant (ai-nutrition edge function) only ever extracts
 * structured fields (age, activity, goal, rate); the number that becomes the
 * athlete's daily target comes from the pure functions below. A hallucinated
 * calorie count can therefore never reach nutrition_targets: it has no code
 * path. Same contract shape as ai-plan (AI proposes, the validator disposes).
 *
 * Pure by doctrine: no react, no supabase, no dates-from-the-wall-clock. That
 * is what makes the safety floor a TESTED rule instead of a hope.
 */

export type Sex = 'male' | 'female';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very';
export type Goal = 'lose' | 'maintain' | 'gain';

/** 1 kcal = 4.184 kJ, exactly (the thermochemical calorie; what AU labels use). */
export const KJ_PER_KCAL = 4.184;

export function kjToKcal(kj: number): number {
  return kj / KJ_PER_KCAL;
}

export function kcalToKj(kcal: number): number {
  return kcal * KJ_PER_KCAL;
}

/** Standard TDEE multipliers over BMR. Keys double as the intake chips. */
export const ACTIVITY_FACTORS: Readonly<Record<Activity, number>> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very: 1.9,
};

export const ACTIVITY_LABEL: Readonly<Record<Activity, string>> = {
  sedentary: 'Sedentary · desk day, no training',
  light: 'Light · 1–3 sessions a week',
  moderate: 'Moderate · 3–5 sessions a week',
  active: 'Active · 6–7 sessions a week',
  very: 'Very active · hard training + physical job',
};

export const GOAL_LABEL: Readonly<Record<Goal, string>> = {
  lose: 'Lose fat',
  maintain: 'Maintain',
  gain: 'Gain muscle',
};

export interface BodyInputs {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
}

/**
 * Mifflin–St Jeor BMR. The published formula, verbatim:
 *   10·kg + 6.25·cm − 5·age + 5 (male) / − 161 (female)
 * Do not "improve" the constants — the tests pin them to reference values.
 */
export function mifflinStJeor(i: BodyInputs): number {
  const base = 10 * i.weightKg + 6.25 * i.heightCm - 5 * i.age;
  return i.sex === 'male' ? base + 5 : base - 161;
}

/** ≈ energy in 1 kg of body fat; the textbook figure behind "500 kcal/day ≈ 0.45 kg/week". */
export const KCAL_PER_KG = 7700;

/**
 * THE SAFETY FLOOR IS A HARD RULE. An aggressive rate on a small body can push
 * the arithmetic below anything defensible; the target never follows it there.
 * These are the commonly cited minimums (1,200 F / 1,500 M) — a floor, not
 * advice. Falsify this once when touching the file: drop the clamp, watch
 * the test go red, restore it.
 */
export const FLOOR_KCAL: Readonly<Record<Sex, number>> = {
  male: 1500,
  female: 1200,
};

/** Rates outside [0, 1] kg/week are not a plan, they are a typo. */
export const MAX_RATE_KG_PER_WEEK = 1;

export interface TargetInputs extends BodyInputs {
  activity: Activity;
  goal: Goal;
  /** kg per week toward the goal; ignored for maintain. */
  ratePerWeekKg: number;
}

/** The daily kcal target: BMR × activity ± the rate's daily energy, floored. */
export function dailyTarget(i: TargetInputs): number {
  const tdee = mifflinStJeor(i) * ACTIVITY_FACTORS[i.activity];
  const rate =
    i.goal === 'maintain' ? 0 : Math.min(Math.max(i.ratePerWeekKg, 0), MAX_RATE_KG_PER_WEEK);
  const delta = (rate * KCAL_PER_KG) / 7;
  const raw = i.goal === 'lose' ? tdee - delta : i.goal === 'gain' ? tdee + delta : tdee;
  return Math.max(Math.round(raw), FLOOR_KCAL[i.sex]);
}

/** Field ranges the intake accepts. The edge function mirrors these server-side. */
export const INTAKE_LIMITS = {
  age: { min: 13, max: 100 },
  weightKg: { min: 30, max: 300 },
  heightCm: { min: 120, max: 230 },
  ratePerWeekKg: { min: 0, max: MAX_RATE_KG_PER_WEEK },
} as const;

/** One reason the inputs are unusable, or null. The review card shows it verbatim. */
export function intakeError(i: TargetInputs): string | null {
  const L = INTAKE_LIMITS;
  if (!Number.isFinite(i.age) || i.age < L.age.min || i.age > L.age.max)
    return `Age must be ${L.age.min}–${L.age.max}.`;
  if (!Number.isFinite(i.weightKg) || i.weightKg < L.weightKg.min || i.weightKg > L.weightKg.max)
    return `Weight must be ${L.weightKg.min}–${L.weightKg.max} kg.`;
  if (!Number.isFinite(i.heightCm) || i.heightCm < L.heightCm.min || i.heightCm > L.heightCm.max)
    return `Height must be ${L.heightCm.min}–${L.heightCm.max} cm.`;
  if (i.goal !== 'maintain') {
    if (!Number.isFinite(i.ratePerWeekKg) || i.ratePerWeekKg < 0 || i.ratePerWeekKg > MAX_RATE_KG_PER_WEEK)
      return `Rate must be 0–${MAX_RATE_KG_PER_WEEK} kg per week.`;
  }
  return null;
}

export interface IntakeProgress {
  consumed: number;
  /** kcal still in the budget; never negative. */
  remaining: number;
  /** kcal past the budget; never negative. */
  over: number;
  /** consumed/target as 0–100 for the bar; clamped so the bar cannot escape. */
  barPct: number;
}

/** Sum today's entries against the target. Non-positive entries count nothing. */
export function intakeProgress(
  entries: readonly { kcal?: unknown }[],
  targetKcal: number
): IntakeProgress {
  let consumed = 0;
  for (const e of entries) {
    const k = Number(e.kcal ?? 0);
    if (Number.isFinite(k) && k > 0) consumed += k;
  }
  consumed = Math.round(consumed);
  const remaining = Math.max(0, Math.round(targetKcal - consumed));
  const over = Math.max(0, Math.round(consumed - targetKcal));
  const barPct = targetKcal > 0 ? Math.min(100, (consumed / targetKcal) * 100) : 0;
  return { consumed, remaining, over, barPct };
}

/**
 * What colour the meter is telling the truth in.
 *   under    — budget open (accent).
 *   reached  — a bulk/maintain target hit (success; eating enough IS the win).
 *   over_cut — a cutting budget exceeded (warn; the one state that is a miss).
 * On a cut, LANDING ON the budget is spending it, not failing it — only past
 * the line is over.
 */
export type MeterState = 'under' | 'reached' | 'over_cut';

export function meterState(consumed: number, targetKcal: number, goal: Goal): MeterState {
  if (goal === 'lose') return consumed > targetKcal ? 'over_cut' : 'under';
  return consumed >= targetKcal ? 'reached' : 'under';
}

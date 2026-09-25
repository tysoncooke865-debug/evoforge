/**
 * FUEL — the calorie arithmetic (nutrition branch).
 *
 * THE RULE THAT SHAPES THIS FILE: the AI asks; the domain computes — never the
 * reverse. (Since 2026-09-25 the target path asks NOTHING of the AI either:
 * the retired ai-nutrition intake only ever extracted structured fields, and
 * the recalculate sheet now collects them as a plain form.) The number that
 * becomes the athlete's daily target comes from the pure functions below. A
 * hallucinated calorie count can therefore never reach nutrition_targets: it
 * has no code path. Same contract shape as ai-plan (AI proposes, the
 * validator disposes).
 *
 * Pure by doctrine: no react, no supabase, no dates-from-the-wall-clock. That
 * is what makes the safety floor a TESTED rule instead of a hope.
 */

import { pyFloat } from './py';

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

/**
 * THE LABEL CALCULATOR — evaluate a small arithmetic expression ("435*5",
 * "1650/4+300") so the converter can total a nutrition label without a
 * separate calculator app. Supports + − × ÷ with normal precedence, decimals,
 * and unary minus. Display glyphs (× ÷ −, the keypad's) and x/X are accepted
 * alongside * and /.
 *
 * LENIENT WHILE TYPING: trailing operators are ignored ("435*" reads as 435),
 * so the other side of the converter never flickers empty mid-expression.
 * Anything else malformed — stray characters, consecutive operators, division
 * by zero — is null, never NaN/Infinity. A plain number keeps pyFloat's exact
 * semantics (the pre-calculator contract of every caller).
 */
export function evalEnergyExpression(input: string): number | null {
  const s = input
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/\s+/g, '')
    .replace(/[+\-*/]+$/, ''); // trailing operator(s): evaluate what's complete
  if (s === '') return null;
  // A plain number (optional leading sign) keeps pyFloat's exact semantics.
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return pyFloat(s);

  // `12.` (a decimal mid-typing) tokenizes whole so the join check passes.
  const tokens = s.match(/\d+\.?\d*|\.\d+|[+\-*/]/g);
  if (tokens === null || tokens.join('') !== s) return null; // stray characters

  let i = 0;
  const number = (): number | null => {
    let sign = 1;
    while (tokens[i] === '+' || tokens[i] === '-') {
      if (tokens[i] === '-') sign = -sign;
      i += 1;
    }
    const t = tokens[i];
    if (t === undefined || /^[+\-*/]$/.test(t)) return null;
    i += 1;
    return sign * Number(t);
  };
  const term = (): number | null => {
    let acc = number();
    while (acc !== null && (tokens[i] === '*' || tokens[i] === '/')) {
      const op = tokens[i];
      i += 1;
      const rhs = number();
      if (rhs === null) return null;
      acc = op === '*' ? acc * rhs : acc / rhs;
    }
    return acc;
  };
  let acc = term();
  while (acc !== null && (tokens[i] === '+' || tokens[i] === '-')) {
    const op = tokens[i];
    i += 1;
    const rhs = term();
    if (rhs === null) return null;
    acc = op === '+' ? acc + rhs : acc - rhs;
  }
  if (acc === null || i !== tokens.length || !Number.isFinite(acc)) return null;
  return acc;
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

/** The lifter's names for the goals — the summary card's switcher chips.
 *  Display only: the DB enum stays 'lose'|'maintain'|'gain'. */
export const GOAL_SHORT: Readonly<Record<Goal, string>> = {
  lose: 'CUT',
  maintain: 'MAINTAIN',
  gain: 'BULK',
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

/** All three goals' targets from ONE intake (081): computed once, stored on
 *  the target row, so switching CUT/MAINTAIN/BULK never re-runs the intake.
 *  The rate applies ± for lose/gain; maintain ignores it; each leg keeps the
 *  sex floor independently. */
export interface GoalTargets {
  lose: number;
  maintain: number;
  gain: number;
}

export function goalTargets(i: TargetInputs): GoalTargets {
  return {
    lose: dailyTarget({ ...i, goal: 'lose' }),
    maintain: dailyTarget({ ...i, goal: 'maintain' }),
    gain: dailyTarget({ ...i, goal: 'gain' }),
  };
}

/**
 * The triple from a STORED inputs blob (rows saved before 081, or rows whose
 * columns are null). Manual targets store `inputs: {}` and correctly return
 * null — a hand-typed number carries no model to derive the other goals from.
 * Validated through intakeError with a rated goal so the rate check runs;
 * a missing rate is never invented.
 */
export function goalTargetsFromInputs(
  inputs: Partial<TargetInputs> | null | undefined
): GoalTargets | null {
  if (!inputs) return null;
  if (inputs.sex !== 'male' && inputs.sex !== 'female') return null;
  if (typeof inputs.activity !== 'string' || !(inputs.activity in ACTIVITY_FACTORS)) return null;
  const c: TargetInputs = {
    sex: inputs.sex,
    weightKg: Number(inputs.weightKg),
    heightCm: Number(inputs.heightCm),
    age: Number(inputs.age),
    activity: inputs.activity,
    ratePerWeekKg: Number(inputs.ratePerWeekKg),
    goal: 'lose',
  };
  if (intakeError(c) !== null) return null;
  return goalTargets(c);
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

/**
 * MEALS (owner ask at port time): the day is structured into meal slots.
 * An entry with meal_no 1..N belongs to that slot; meal_no null is an
 * absolute quick-add and belongs to no slot. Same shape as Train's sets:
 * a count you bump up and down, floored so a logged slot can never be
 * removed out from under its entries.
 */
export const MIN_MEALS = 1;
export const MAX_MEALS = 8;
export const DEFAULT_MEALS = 3;

export interface MealEntryLike {
  kcal?: unknown;
  meal_no?: number | null;
}

/** Highest meal slot holding a logged entry; 0 when none (quick-adds don't count). */
export function highestMealNo(entries: readonly MealEntryLike[]): number {
  let highest = 0;
  for (const e of entries) {
    const n = e.meal_no;
    if (typeof n === 'number' && Number.isFinite(n) && n > highest) highest = Math.floor(n);
  }
  return highest;
}

/**
 * The count the page renders: the athlete's stored choice (null = never
 * touched → DEFAULT_MEALS), forced UP by any higher logged slot, clamped.
 * Entries can grow the day, never shrink it — the clampSets shape.
 */
export function effectiveMealCount(stored: number | null, entries: readonly MealEntryLike[]): number {
  const base = stored === null ? DEFAULT_MEALS : stored;
  return Math.max(MIN_MEALS, Math.min(MAX_MEALS, Math.max(base, highestMealNo(entries))));
}

/** kcal sum per slot (index 0 = MEAL 1). Ignores quick-adds, out-of-range
 *  slots and garbage kcal — the intakeProgress tolerance. */
export function mealTotals(entries: readonly MealEntryLike[], count: number): number[] {
  const totals = Array.from({ length: Math.max(0, count) }, () => 0);
  for (const e of entries) {
    const n = e.meal_no;
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    const slot = Math.floor(n);
    if (slot < 1 || slot > totals.length) continue;
    const k = Number(e.kcal ?? 0);
    if (Number.isFinite(k) && k > 0) totals[slot - 1] += k;
  }
  return totals.map((t) => Math.round(t));
}

/**
 * The first four slots carry the day's names (the redesign's reference
 * layout); slots past SNACKS keep the numbered fallback so an 8-meal
 * athlete loses nothing. Position IS meaning: slot 1 is breakfast because
 * it is slot 1 — no schema change, meal_no stays the storage contract.
 */
export const MEAL_SLOT_NAMES = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS'] as const;

/** Custom names (056, 2026-07-19): the athlete's own list from
 *  nutrition_prefs.meal_names, index = slot-1. A missing/null/blank entry
 *  falls back to the built-in name for that slot; garbage never throws. */
export function mealSlotName(slot: number, customNames?: readonly (string | null)[] | null): string {
  const custom = customNames?.[slot - 1];
  if (typeof custom === 'string' && custom.trim() !== '') return custom.trim().toUpperCase().slice(0, 24);
  return MEAL_SLOT_NAMES[slot - 1] ?? `MEAL ${slot}`;
}

export interface MacroEntryLike extends MealEntryLike {
  protein_g?: unknown;
  carbs_g?: unknown;
  fat_g?: unknown;
}

export interface MacroProgress {
  protein: number;
  carbs: number;
  fat: number;
}

const finitePositive = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Grams of each macro logged today. Manual kcal-only entries contribute
 *  nothing here — a macro sum must never be invented from calories. */
export function macroProgress(entries: readonly MacroEntryLike[]): MacroProgress {
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  for (const e of entries) {
    protein += finitePositive(e.protein_g);
    carbs += finitePositive(e.carbs_g);
    fat += finitePositive(e.fat_g);
  }
  return { protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat) };
}

export interface MacroTargets {
  protein: number;
  carbs: number;
  fat: number;
}

/** The fallback when no target exists — one place, per the redesign spec. */
export const DEFAULT_MACRO_TARGETS: Readonly<MacroTargets> = {
  protein: 200,
  carbs: 220,
  fat: 65,
};

const round5 = (n: number): number => Math.max(5, Math.round(n / 5) * 5);

/**
 * Macro targets derived from the calorie target: protein 2 g/kg when the
 * intake captured a body weight (the lifter's number), else 30% of kcal;
 * carbs 40%, fat 30% (4/4/9 kcal per gram). Deterministic and derived —
 * never stored, never from the AI. No target at all → the spec's defaults.
 */
export function macroTargetsFor(
  target: { daily_kcal: number; inputs?: { weightKg?: number } } | null
): MacroTargets {
  if (!target || !Number.isFinite(target.daily_kcal) || target.daily_kcal <= 0)
    return { ...DEFAULT_MACRO_TARGETS };
  const kcal = target.daily_kcal;
  const w = Number(target.inputs?.weightKg ?? NaN);
  const protein = Number.isFinite(w) && w >= 30 && w <= 300 ? round5(2 * w) : round5((0.3 * kcal) / 4);
  return {
    protein,
    carbs: round5((0.4 * kcal) / 4),
    fat: round5((0.3 * kcal) / 9),
  };
}

export interface MealSlotTotals {
  kcal: number;
  protein: number;
}

/** kcal + protein per slot (index 0 = slot 1) — mealTotals' tolerance rules. */
export function mealMacroTotals(
  entries: readonly MacroEntryLike[],
  count: number
): MealSlotTotals[] {
  const totals = Array.from({ length: Math.max(0, count) }, () => ({ kcal: 0, protein: 0 }));
  for (const e of entries) {
    const n = e.meal_no;
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    const slot = Math.floor(n);
    if (slot < 1 || slot > totals.length) continue;
    totals[slot - 1].kcal += finitePositive(e.kcal);
    totals[slot - 1].protein += finitePositive(e.protein_g);
  }
  return totals.map((t) => ({ kcal: Math.round(t.kcal), protein: Math.round(t.protein) }));
}

const dayBefore = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Consecutive logged days ending at today. An unlogged TODAY does not break
 * the run — the athlete opening the page at 7am has not failed yet; the
 * streak counts back from yesterday until they log. Dates are ISO strings
 * from the caller (the no-wall-clock rule).
 */
export function streakDays(dates: readonly string[], today: string): number {
  const set = new Set(dates);
  let cursor = set.has(today) ? today : dayBefore(today);
  let run = 0;
  while (set.has(cursor)) {
    run += 1;
    cursor = dayBefore(cursor);
  }
  return run;
}

export function canAddMeal(count: number): boolean {
  return count < MAX_MEALS;
}

/** Never remove a slot that already holds a logged entry — the sets rule. */
export function canRemoveMeal(count: number, entries: readonly MealEntryLike[]): boolean {
  return count > Math.max(MIN_MEALS, highestMealNo(entries));
}

/**
 * NUTRITION SCORE (2026-08-05) — a real 0–100 read of how close TODAY'S
 * logged intake sits to the day's own targets, not an AI verdict and not a
 * fabricated grade. Four components (calories, protein, carbs, fat), each
 * scored as `100 − |1 − consumed/target| × 100` (so 20% off target scores
 * 80, on-target scores 100, wildly over or under both score low — this
 * rewards ACCURACY to plan, not just "ate less") and floored at 0. A
 * component with no target (target ≤ 0) is skipped rather than scored zero.
 * Nothing logged yet → null, never a fabricated starting grade.
 */
export function nutritionScore(
  consumedKcal: number,
  targetKcal: number,
  macros: MacroProgress,
  macroTargets: MacroTargets
): number | null {
  if (consumedKcal <= 0) return null;
  const components: number[] = [];
  const score = (consumed: number, target: number): void => {
    if (target <= 0) return;
    const deviation = Math.abs(1 - consumed / target);
    components.push(Math.max(0, 100 - deviation * 100));
  };
  score(consumedKcal, targetKcal);
  score(macros.protein, macroTargets.protein);
  score(macros.carbs, macroTargets.carbs);
  score(macros.fat, macroTargets.fat);
  if (components.length === 0) return null;
  return Math.round(components.reduce((a, b) => a + b, 0) / components.length);
}

/* ────────────────────────────────────────────────────────────────────────
 * THE DUAL-RATE MODEL (promoted from the page lab's COUNTERWEIGHT batch,
 * 2026-09-25; proven in the culled CALCULATOR variant, 2026-08-21).
 *
 * `goalTargets` spreads ONE `ratePerWeekKg` into all three legs, so an
 * athlete cutting at 1 kg/wk was quoted a bulk at +1 kg/wk — a rate nobody
 * chose and standard advice warns against. Here the lose leg and the gain
 * leg carry INDEPENDENT rates; maintain ignores both, and each leg keeps
 * dailyTarget's sex floor and rounding by construction (it IS dailyTarget).
 *
 * Storage: `rateGainKgPerWeek` rides the target row's `inputs` jsonb next
 * to the existing `ratePerWeekKg` (the cut rate) — no migration; rows saved
 * before this model simply lack the key.
 * ──────────────────────────────────────────────────────────────────────── */

/** The default bulk surplus when a stored row predates the dual-rate model:
 *  0.25 kg/wk (~275 kcal) — the standard lean-bulk figure, deliberately NOT
 *  the athlete's cut rate (mirroring it is the bug this model exists to fix).
 *  Owner-confirmed 2026-08-21. */
export const DEFAULT_GAIN_RATE_KG_PER_WEEK = 0.25;

/** The cut-rate seed when no stored row carries one — the moderate-cut
 *  convention, NOT tied to the bulk default (independence is the point). */
export const DEFAULT_LOSS_RATE_KG_PER_WEEK = 0.5;

export interface DualRateInputs extends BodyInputs {
  activity: Activity;
  /** kg per week LOST on the cut leg. */
  rateLossKgPerWeek: number;
  /** kg per week GAINED on the bulk leg. */
  rateGainKgPerWeek: number;
}

/** The asymmetric triple: lose from the cut rate, gain from the bulk rate. */
export function dualRateTargets(i: DualRateInputs): GoalTargets {
  const base = {
    sex: i.sex,
    weightKg: i.weightKg,
    heightCm: i.heightCm,
    age: i.age,
    activity: i.activity,
  };
  return {
    lose: dailyTarget({ ...base, goal: 'lose', ratePerWeekKg: i.rateLossKgPerWeek }),
    maintain: dailyTarget({ ...base, goal: 'maintain', ratePerWeekKg: 0 }),
    gain: dailyTarget({ ...base, goal: 'gain', ratePerWeekKg: i.rateGainKgPerWeek }),
  };
}

/** One reason the dual inputs are unusable, or null — intakeError run per
 *  rated leg, so BOTH rates get the 0–MAX range check and the body fields
 *  are checked exactly once with the live wording. */
export function dualIntakeError(i: DualRateInputs): string | null {
  const base = {
    sex: i.sex,
    weightKg: i.weightKg,
    heightCm: i.heightCm,
    age: i.age,
    activity: i.activity,
  };
  const loseLeg = intakeError({ ...base, goal: 'lose', ratePerWeekKg: i.rateLossKgPerWeek });
  if (loseLeg !== null) return loseLeg;
  return intakeError({ ...base, goal: 'gain', ratePerWeekKg: i.rateGainKgPerWeek });
}

/**
 * A stored inputs blob → DualRateInputs, or null when the row cannot carry
 * the model (manual targets store `{}`; garbage stays garbage — a rate is
 * never invented for an unusable row). A row from BEFORE this model, valid
 * but without `rateGainKgPerWeek`, gets the 0.25 default — that is the one
 * value this function is allowed to supply.
 */
export function dualRateInputsFromStored(
  inputs: (Partial<TargetInputs> & { rateGainKgPerWeek?: unknown }) | null | undefined
): DualRateInputs | null {
  if (!inputs) return null;
  if (inputs.sex !== 'male' && inputs.sex !== 'female') return null;
  if (typeof inputs.activity !== 'string' || !(inputs.activity in ACTIVITY_FACTORS)) return null;
  const storedGain = Number(inputs.rateGainKgPerWeek);
  const candidate: DualRateInputs = {
    sex: inputs.sex,
    weightKg: Number(inputs.weightKg),
    heightCm: Number(inputs.heightCm),
    age: Number(inputs.age),
    activity: inputs.activity,
    rateLossKgPerWeek: Number(inputs.ratePerWeekKg),
    rateGainKgPerWeek:
      Number.isFinite(storedGain) && storedGain >= 0 && storedGain <= MAX_RATE_KG_PER_WEEK
        ? storedGain
        : DEFAULT_GAIN_RATE_KG_PER_WEEK,
  };
  return dualIntakeError(candidate) === null ? candidate : null;
}

/** The slice of a stored target row the triple resolver needs — structural,
 *  so domain/ never imports the data layer (NutritionTargetRow satisfies
 *  it). */
export interface StoredTargetTriple {
  inputs: Partial<TargetInputs> | null | undefined;
  kcal_lose?: number | null;
  kcal_maintain?: number | null;
  kcal_gain?: number | null;
}

/** The display-path resolver: the stored triple columns are the truth when
 *  present (081's contract), else derive asymmetrically from the stored
 *  inputs. Null = unknowable (manual target) — the maintain box shows it. */
export function dualTripleFromStored(row: StoredTargetTriple | null | undefined): GoalTargets | null {
  if (!row) return null;
  if (row.kcal_lose != null && row.kcal_maintain != null && row.kcal_gain != null) {
    return { lose: row.kcal_lose, maintain: row.kcal_maintain, gain: row.kcal_gain };
  }
  const inputs = dualRateInputsFromStored(row.inputs);
  return inputs === null ? null : dualRateTargets(inputs);
}

/** Mirror of 037's daily_kcal CHECK — a leg outside this range cannot be
 *  APPLIED, and the sheet says so instead of letting Postgres refuse. */
export function legWithinDb(kcal: number): boolean {
  return Number.isFinite(kcal) && kcal >= 1000 && kcal <= 6000;
}

/** Exactly what useSaveTarget.mutate takes — built here so tests pin the
 *  shape the DB receives instead of a component assembling it ad hoc. */
export interface SaveTargetPayload {
  effectiveFrom: string;
  dailyKcal: number;
  goal: Goal;
  inputs: Partial<TargetInputs> & { rateGainKgPerWeek?: number };
  triple: GoalTargets | null;
}

/**
 * The RECALCULATE payload: one upsert carrying the chosen goal's leg as
 * daily_kcal, the full input audit trail (BOTH rates ride the jsonb —
 * `ratePerWeekKg` stays the cut rate so pre-dual readers keep working), and
 * the asymmetric triple for the 081 columns. Null when the inputs are
 * unusable or the chosen leg falls outside the DB's 1,000–6,000 CHECK.
 */
export function buildSavePayload(
  i: DualRateInputs,
  goal: Goal,
  todayIso: string
): SaveTargetPayload | null {
  if (dualIntakeError(i) !== null) return null;
  const triple = dualRateTargets(i);
  if (!legWithinDb(triple[goal])) return null;
  return {
    effectiveFrom: todayIso,
    dailyKcal: triple[goal],
    goal,
    inputs: {
      sex: i.sex,
      weightKg: i.weightKg,
      heightCm: i.heightCm,
      age: i.age,
      activity: i.activity,
      goal,
      ratePerWeekKg: i.rateLossKgPerWeek,
      rateGainKgPerWeek: i.rateGainKgPerWeek,
    },
    triple,
  };
}

/**
 * The SET MANUALLY payload: a hand-typed number with no goal question asked —
 * the in-force goal carries forward (a manual number changes the budget, not
 * the plan), defaulting to maintain when no target exists yet. `triple: null`
 * EXPLICITLY clears the stored columns (a manual number carries no model),
 * and the ONE input that survives is a plausible stored weightKg, so
 * macroTargetsFor keeps its 2 g/kg protein target instead of silently
 * degrading to the 150 g fallback. Null when the number fails the DB range.
 */
export function manualSavePayload(
  kcal: number | null,
  inForceGoal: Goal | null | undefined,
  storedInputs: Partial<TargetInputs> | null | undefined,
  todayIso: string
): SaveTargetPayload | null {
  if (kcal === null) return null;
  const rounded = Math.round(kcal);
  if (!legWithinDb(rounded)) return null;
  const w = Number(storedInputs?.weightKg);
  const carryWeight =
    Number.isFinite(w) && w >= INTAKE_LIMITS.weightKg.min && w <= INTAKE_LIMITS.weightKg.max;
  return {
    effectiveFrom: todayIso,
    dailyKcal: rounded,
    goal: inForceGoal ?? 'maintain',
    inputs: carryWeight ? { weightKg: w } : {},
    triple: null,
  };
}

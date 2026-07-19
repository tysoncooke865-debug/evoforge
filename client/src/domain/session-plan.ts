/**
 * PHASE_3 Stage 1 — the session-override math, pure and unit-testable.
 *
 * A workout is plan-driven, but the athlete must be able to deviate: add an
 * exercise, drop one, skip one "not today", add or remove a set slot. All of
 * that is an OVERRIDE LAYER over the plan — the plan itself is never mutated
 * (custom_workout_plan is Streamlit-visible and multi-day; today's whim is
 * neither).
 *
 * THE LOAD-BEARING RULE: a logged set is immutable. The XP ledger is
 * append-only, so a granted set cannot be un-granted. Every operation here is
 * therefore constrained so that the day's arithmetic can never contradict the
 * XP that was actually banked:
 *
 *  - SKIP ("not today") clamps the obligation to what was already logged:
 *    target becomes min(planSets, loggedValid). Sets you did still count;
 *    sets you didn't are no longer owed. `N/N` stays true.
 *  - REMOVE deletes the exercise from the day entirely (0 done, 0 target) —
 *    which is only honest when NOTHING was logged for it. Removing an
 *    exercise with logged sets would drop those sets from `done` while their
 *    XP stays banked: the day bar would read 8/20 while +100 XP TODAY sat
 *    beside it. So removeAction() DEGRADES that case to a skip.
 *  - The set count clamps to [max(1, loggedMaxSetNo), 8]: "− SET" can never
 *    orphan a logged row by rendering fewer slots than the athlete filled.
 */

export interface SessionExercise {
  exercise: string;
  sets: number;
  reps: string;
}

export interface DayOverrides {
  /** Ad-hoc exercises, rendered after the plan's. */
  added: SessionExercise[];
  /** Gone from today entirely. */
  removed: string[];
  /** Visible, but not owed today. */
  skipped: string[];
  /** exercise -> ±slots against the plan. */
  setDelta: Record<string, number>;
  /** SUPERSETS (2026-07-18): exercise -> partner, stored SYMMETRICALLY
   *  (both directions). Presentation-level pairing — sets log normally. */
  superset?: Record<string, string>;
  /** REORDER (2026-07-19): the athlete's chosen exercise ORDER for today, as a
   *  list of exercise names. Presentation-only, today-scoped like every other
   *  override — applied by applyOrder() after buildEffectivePlan. A stale entry
   *  never drops an exercise (see applyOrder). */
  order?: string[];
}

export const EMPTY_OVERRIDES: DayOverrides = { added: [], removed: [], skipped: [], setDelta: {} };

export const MIN_SETS = 1;
export const MAX_SETS = 8;

/** [exercise, sets, repScheme] — the tuple today.tsx already renders. */
export type PlanEntry = readonly [string, number, string];

export interface EffectiveEntry {
  exercise: string;
  /** Slots to RENDER (never fewer than the athlete has already filled). */
  sets: number;
  reps: string;
  /** Sets OWED today — 0 when skipped, else `sets`. */
  target: number;
  skipped: boolean;
  /** True for athlete-added exercises (not in the plan). */
  added: boolean;
}

/** Per-exercise facts read from the log (optimistic queued rows included —
 *  they are in the same cache the UI renders from). */
export interface LoggedFacts {
  /** Sets with weight > 0 AND reps > 0. */
  validCount: number;
  /** The highest set NUMBER that has a rendered row (1-based), 0 if none. */
  maxSetNo: number;
}

export type Logged = (exercise: string) => LoggedFacts;

const clampSets = (n: number, maxLoggedSetNo: number): number =>
  Math.max(Math.max(MIN_SETS, maxLoggedSetNo), Math.min(MAX_SETS, n));

/**
 * The plan the athlete is actually looking at, after their overrides.
 * Order: plan exercises (minus removed), then added ones.
 */
export function buildEffectivePlan(
  basePlan: readonly PlanEntry[],
  overrides: DayOverrides,
  logged: Logged
): EffectiveEntry[] {
  const removed = new Set(overrides.removed);
  const skipped = new Set(overrides.skipped);

  const entry = (exercise: string, planSets: number, reps: string, added: boolean): EffectiveEntry => {
    const facts = logged(exercise);
    const delta = overrides.setDelta[exercise] ?? 0;
    const sets = clampSets(planSets + delta, facts.maxSetNo);
    const isSkipped = skipped.has(exercise);
    return {
      exercise,
      sets,
      reps,
      // Skipping does not erase work already done — it forgives what is left.
      target: isSkipped ? Math.min(sets, facts.validCount) : sets,
      skipped: isSkipped,
      added,
    };
  };

  const out: EffectiveEntry[] = [];
  for (const [exercise, planSets, reps] of basePlan) {
    if (removed.has(exercise)) continue;
    // AN EXERCISE APPEARS ONCE. A substitution onto something already in the day
    // used to render it TWICE — same React key, same logged rows, and planTotals
    // counted its target and its sets twice, so the bar and `complete` lied.
    if (out.some((e) => e.exercise === exercise)) continue;
    out.push(entry(exercise, planSets, reps, false));
  }
  for (const a of overrides.added) {
    if (removed.has(a.exercise)) continue;
    // An added exercise that also exists in the plan would render twice.
    if (out.some((e) => e.exercise === a.exercise)) continue;
    out.push(entry(a.exercise, a.sets, a.reps, true));
  }
  return out;
}

/**
 * REORDER (2026-07-19): reorder the effective plan by the athlete's chosen
 * order. `order` is a list of exercise NAMES. Entries whose name appears are
 * emitted in that order; anything NOT named (added or substituted after the
 * reorder) keeps its relative position and is appended after the ordered ones.
 * A stable, forgiving sort — a stale order can never drop or duplicate an entry.
 */
export function applyOrder<T extends { exercise: string }>(
  entries: readonly T[],
  order: readonly string[] | undefined
): T[] {
  if (!order || order.length === 0) return [...entries];
  const rank = new Map(order.map((name, i) => [name, i] as const));
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ra = rank.get(a.e.exercise);
      const rb = rank.get(b.e.exercise);
      if (ra === undefined && rb === undefined) return a.i - b.i; // both unranked: keep original order
      if (ra === undefined) return 1; // unranked sort AFTER ranked
      if (rb === undefined) return -1;
      return ra - rb;
    })
    .map(({ e }) => e);
}

export interface PlanTotals {
  done: number;
  target: number;
  complete: boolean;
  /** First entry still short of its target — the quest cursor. */
  nextExercise: string | null;
}

/** The day bar's numbers. `done` counts only sets that COUNT toward the
 *  target, so it can never exceed it — but every logged set is XP-banked
 *  regardless, which is why skip clamps the target instead of hiding work. */
export function planTotals(entries: EffectiveEntry[], logged: Logged): PlanTotals {
  let done = 0;
  let target = 0;
  let nextExercise: string | null = null;
  for (const e of entries) {
    const valid = logged(e.exercise).validCount;
    done += Math.min(valid, e.target);
    target += e.target;
    if (nextExercise === null && !e.skipped && valid < e.target) nextExercise = e.exercise;
  }
  return { done, target, complete: target > 0 && done >= target, nextExercise };
}

export type RemoveAction = 'remove' | 'skip';

/**
 * What "✕" must actually do. Removing an exercise that has banked XP would
 * make the summary lie, so it degrades to a skip (the caller toasts "Sets
 * already logged — skipped instead").
 */
export function removeAction(facts: LoggedFacts): RemoveAction {
  return facts.validCount > 0 ? 'skip' : 'remove';
}

/** Whether "− SET" is offered: never below what is already logged, never 0. */
export function canRemoveSet(currentSets: number, facts: LoggedFacts): boolean {
  return currentSets > Math.max(MIN_SETS, facts.maxSetNo);
}

export function canAddSet(currentSets: number): boolean {
  return currentSets < MAX_SETS;
}

/**
 * An ad-hoc workout's name must not collide with a day chip — `workout` is
 * the grouping key in workout_log, so a collision would merge two different
 * workouts into one day's math.
 */
export function adhocNameError(name: string, existingDays: readonly string[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return 'Give it a name (2+ characters).';
  if (trimmed.length > 40) return 'Keep it under 40 characters.';
  const clash = existingDays.some((d) => d.toLowerCase() === trimmed.toLowerCase());
  if (clash) return 'That name is already a day in your plan.';
  return null;
}

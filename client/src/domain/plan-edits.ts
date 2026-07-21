import type { CustomPlan, PlanDay, PlanExercise } from './custom-plan';
import {
  MAX_SETS,
  MIN_SETS,
  substitutionKey,
  type DayOverrides,
  type PlanEntry,
  type SessionExercise,
} from './session-plan';

/**
 * SAVE CHANGES (2026-07-21): the bridge between one day's session overrides
 * and the TEMPLATE the day was loaded from. Session edits are today's whim by
 * doctrine (session-plan.ts) — this module is what makes a whim durable when
 * the athlete says so at finish time.
 *
 * TWO OVERRIDES ARE DELIBERATELY NOT TEMPLATE CHANGES:
 *   - `skipped` — a skip forgives today's sets, it does not shrink the plan.
 *   - `order`   — presentation, not programming.
 * Everything else (substitutions, ±sets, add/remove, supersets) is the athlete
 * reprogramming the day, and is what diffDayEdits reports.
 */

export interface PlanEditSummary {
  dirty: boolean;
  /** Slot → substitute, for slots that exist in the template. */
  substitutions: { from: string; to: string }[];
  /** Athlete-added exercises that are not already template slots. */
  added: SessionExercise[];
  /** Template slot names the athlete removed (displayed names resolved back). */
  removed: string[];
  /** Net set-count changes on surviving slots, after the 1..8 clamp. */
  setChanges: { exercise: string; from: number; to: number }[];
  supersetChanged: boolean;
}

const clampSets = (n: number): number => Math.max(MIN_SETS, Math.min(MAX_SETS, n));

/** Symmetric pair map → canonical "a|b" set (sorted within the pair). */
const pairKeys = (m: Record<string, string>): Set<string> => {
  const out = new Set<string>();
  for (const [a, b] of Object.entries(m)) out.add([a, b].sort().join('|'));
  return out;
};

const samePairs = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const ka = pairKeys(a);
  const kb = pairKeys(b);
  return ka.size === kb.size && [...ka].every((k) => kb.has(k));
};

/**
 * What the athlete changed about the day, template vs overrides.
 * `templateSupersets` is the pairing the session was SEEDED from
 * (ResolvedDay.supersets), so untouched pairs compare clean; an overrides
 * `superset` left undefined means "never touched" and is never dirty.
 */
export function diffDayEdits(
  template: readonly PlanEntry[],
  templateSupersets: Record<string, string>,
  o: DayOverrides
): PlanEditSummary {
  const subs = o.substituted ?? {};
  const slots = new Set(template.map(([slot]) => slot));

  // A removed DISPLAYED name resolves back to its slot; a removal subsumes
  // any substitution on the same slot (the slot is gone either way).
  const removedSlots = new Set<string>();
  for (const r of o.removed) {
    const slot = substitutionKey(subs, r);
    if (slots.has(slot)) removedSlots.add(slot);
  }

  const substitutions = Object.entries(subs)
    .filter(([slot, to]) => slots.has(slot) && to !== slot && !removedSlots.has(slot))
    .map(([from, to]) => ({ from, to }));

  const displayedNames = new Set(
    template.filter(([slot]) => !removedSlots.has(slot)).map(([slot]) => subs[slot] ?? slot)
  );
  const added = o.added.filter(
    (a) => !displayedNames.has(a.exercise) && !o.removed.includes(a.exercise)
  );

  const setChanges: { exercise: string; from: number; to: number }[] = [];
  for (const [slot, planSets] of template) {
    if (removedSlots.has(slot)) continue;
    const displayed = subs[slot] ?? slot;
    const to = clampSets(planSets + (o.setDelta[displayed] ?? 0));
    if (to !== planSets) setChanges.push({ exercise: displayed, from: planSets, to });
  }

  const supersetChanged = o.superset !== undefined && !samePairs(o.superset, templateSupersets);

  const dirty =
    substitutions.length > 0 ||
    added.length > 0 ||
    removedSlots.size > 0 ||
    setChanges.length > 0 ||
    supersetChanged;

  return { dirty, substitutions, added, removed: [...removedSlots], setChanges, supersetChanged };
}

/**
 * The edited day as it should be SAVED: substitutions renamed, set deltas
 * applied (1..8 clamp — intent, never today's logged-row clamp), removed
 * dropped, added appended. `reasons` keeps a template exercise's coaching
 * note when the slot survives UNTOUCHED; a swapped slot loses it (the note
 * described the old exercise). `supersets` is the EFFECTIVE pairing
 * (overrides when touched, else the template's); supersetWith is emitted
 * only when both partners survive.
 */
export function applyEditsToDay(
  template: readonly PlanEntry[],
  reasons: ReadonlyMap<string, string> | null,
  o: DayOverrides,
  supersets: Record<string, string> = o.superset ?? {}
): PlanExercise[] {
  const subs = o.substituted ?? {};
  const removed = new Set(o.removed);
  const out: PlanExercise[] = [];

  for (const [slot, planSets, reps] of template) {
    const exercise = subs[slot] ?? slot;
    if (removed.has(exercise)) continue;
    if (out.some((e) => e.exercise === exercise)) continue;
    out.push({
      exercise,
      sets: clampSets(planSets + (o.setDelta[exercise] ?? 0)),
      reps,
      reason: exercise === slot ? (reasons?.get(slot) ?? '') : '',
    });
  }
  for (const a of o.added) {
    if (removed.has(a.exercise)) continue;
    if (out.some((e) => e.exercise === a.exercise)) continue;
    out.push({
      exercise: a.exercise,
      sets: clampSets(a.sets + (o.setDelta[a.exercise] ?? 0)),
      reps: a.reps,
      reason: '',
    });
  }

  const names = new Set(out.map((e) => e.exercise));
  return out.map((e) => {
    const partner = supersets[e.exercise];
    return partner && partner !== e.exercise && names.has(partner)
      ? { ...e, supersetWith: partner }
      : e;
  });
}

/** Fork/merge for BUILT-IN saves: replace the same-named day, or append. */
export function mergeDayIntoCustomPlan(plan: CustomPlan | null, day: PlanDay): CustomPlan {
  if (plan === null) return { plan_name: 'My Plan', days: [day] };
  const exists = plan.days.some((d) => d.day === day.day);
  return {
    ...plan,
    days: exists ? plan.days.map((d) => (d.day === day.day ? day : d)) : [...plan.days, day],
  };
}

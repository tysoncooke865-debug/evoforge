import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  applySubstitution,
  clearSubstitution,
  EMPTY_OVERRIDES,
  type DayOverrides,
  type SessionExercise,
} from '@/domain/session-plan';
import { todayIso } from '@/domain/today';

/**
 * PHASE_3 Stage 1 — today's deviations from the plan.
 *
 * PERSISTED (AsyncStorage), because a mid-workout force-close must not lose
 * the fact that you skipped legs and added face pulls. It is deliberately NOT
 * in the database: this is one day's whim, not a plan. custom_workout_plan
 * (which Streamlit reads) is never touched by anything in this file.
 *
 * SELF-EXPIRING: the store stamps the date it belongs to. Any read on a
 * different day sees empty overrides — yesterday's skip must not silently
 * forgive today's sets. Expiry happens on READ rather than by a timer,
 * because a timer that fires at midnight while the app is closed does not
 * exist.
 *
 * DOCTRINE: cleared on sign-out in auth-context, like every store — a shared
 * device must not hand the last athlete's workout to the next one.
 */

export interface AdhocWorkout {
  name: string;
  exercises: SessionExercise[];
}

interface SessionState {
  /** The date these overrides belong to (YYYY-MM-DD, UTC — the app's convention). */
  date: string;
  days: Record<string, DayOverrides>;
  adhoc: AdhocWorkout | null;
  /** DAY SWAP (2026-07-24): "just for today" only — trade today's scheduled
   *  split day for a different one from the same plan without touching the
   *  persisted weekly schedule. Same self-expiring date guard as `adhoc`; a
   *  permanent swap goes through useSaveSchedule instead and needs no entry
   *  here (the schedule itself already reflects it from today onward). */
  daySwap: string | null;
  /**
   * Tyson, 2026-07-14: the workout IN PROGRESS. Set the moment a set lands,
   * cleared when the athlete finishes (the summary ceremony) or ends an ad-hoc
   * workout. It exists so a cold start reopens the workout you are standing in
   * the middle of, instead of dumping you on Home — and it is LOCAL state, so
   * that decision is instant at boot and never waits on the network.
   *
   * Same date guard as everything else here: yesterday's unfinished workout is
   * not today's.
   */
  activeDay: string | null;
  /** Which plan source the workout was opened from (0 my / 1 ai / 2 built-in).
   *  Without it, a cold-start resume re-resolved the day against BUILT-IN and
   *  silently showed different exercises than the ones being trained. */
  activeSource: number | null;
  _hydrated: boolean;

  addExercise: (day: string, e: SessionExercise) => void;
  removeExercise: (day: string, exercise: string) => void;
  restoreExercise: (day: string, exercise: string) => void;
  toggleSkip: (day: string, exercise: string) => void;
  bumpSets: (day: string, exercise: string, delta: number) => void;
  /** Pair a and b as a superset (symmetric); calling again on a pair unlinks. */
  toggleSuperset: (day: string, a: string, b: string) => void;
  /** SUBSTITUTIONS (2026-07-21): swap displayed exercise `from` for `to`.
   *  Persisted like every other override — a refresh mid-workout must not
   *  quietly restore the exercise the athlete swapped away. */
  substitute: (day: string, from: string, to: string) => void;
  /** RESET TO PLAN: restore the original slot for a displayed name. */
  resetSubstitution: (day: string, displayed: string) => void;
  /** Seed a template's SAVED superset pairs into the session, exactly once per
   *  day: a no-op whenever the day's `superset` map is already defined (seeded
   *  earlier, or touched by the athlete — including unlinked to empty). */
  seedSupersets: (day: string, pairs: Record<string, string>) => void;
  /** REORDER (2026-07-19): set today's exercise order for a day (list of names). */
  reorderExercises: (day: string, order: string[]) => void;

  /** Adding to an ad-hoc day goes through addExercise like any other day —
   *  the override layer keys on the day NAME, and an ad-hoc workout's name is
   *  a day name. There is deliberately no separate add-to-adhoc action. */
  startAdhoc: (w: AdhocWorkout) => void;
  endAdhoc: () => void;

  /** Set (or clear, passing null) today's day swap. */
  setDaySwap: (to: string | null) => void;

  markActive: (day: string, source?: number) => void;
  clearActive: () => void;

  reset: () => void;
}

// The athlete's calendar day (domain/today.ts) — NOT the UTC date.

// `superset` is deliberately ABSENT here: undefined means "never touched",
// which is what lets seedSupersets seed a template's saved pairs exactly once
// — a day whose pairs were all unlinked holds a DEFINED empty map instead,
// and must not have them resurrected on the next mount.
const emptyDay = (): DayOverrides => ({
  added: [],
  removed: [],
  skipped: [],
  setDelta: {},
  substituted: {},
});

/** Mutate one day's overrides, rolling the whole store over if the date
 *  changed. Every action goes through this — there is no other way to write. */
const edit = (
  state: SessionState,
  day: string,
  fn: (d: DayOverrides) => DayOverrides
): Partial<SessionState> => {
  const today = todayIso();
  const stale = state.date !== today;
  const days = stale ? {} : { ...state.days };
  const current = days[day] ?? emptyDay();
  return {
    date: today,
    days: { ...days, [day]: fn(current) },
    adhoc: stale ? null : state.adhoc,
  };
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      date: todayIso(),
      days: {},
      adhoc: null,
      daySwap: null,
      activeDay: null,
      activeSource: null,
      _hydrated: false,

      addExercise: (day, e) =>
        set((s) =>
          edit(s, day, (d) => ({
            ...d,
            // Adding back something you removed simply un-removes it.
            removed: d.removed.filter((r) => r !== e.exercise),
            skipped: d.skipped.filter((r) => r !== e.exercise),
            added: d.added.some((a) => a.exercise === e.exercise) ? d.added : [...d.added, e],
          }))
        ),

      removeExercise: (day, exercise) =>
        set((s) =>
          edit(s, day, (d) => ({
            ...d,
            removed: d.removed.includes(exercise) ? d.removed : [...d.removed, exercise],
            // An added-then-removed exercise leaves no trace.
            added: d.added.filter((a) => a.exercise !== exercise),
          }))
        ),

      restoreExercise: (day, exercise) =>
        set((s) =>
          edit(s, day, (d) => ({
            ...d,
            removed: d.removed.filter((r) => r !== exercise),
            skipped: d.skipped.filter((r) => r !== exercise),
          }))
        ),

      toggleSkip: (day, exercise) =>
        set((s) =>
          edit(s, day, (d) => ({
            ...d,
            skipped: d.skipped.includes(exercise)
              ? d.skipped.filter((r) => r !== exercise)
              : [...d.skipped, exercise],
          }))
        ),

      bumpSets: (day, exercise, delta) =>
        set((s) =>
          edit(s, day, (d) => ({
            ...d,
            setDelta: { ...d.setDelta, [exercise]: (d.setDelta[exercise] ?? 0) + delta },
          }))
        ),

      // BOTH of these used to stamp the new date WITHOUT clearing `days` — so an
      // app left running across midnight carried yesterday's skips and set
      // deltas into today, silently forgiving sets that were never done. They go
      // through the same stale check as every other write now.
      startAdhoc: (w) =>
        set((s) => {
          const stale = s.date !== todayIso();
          return {
            date: todayIso(),
            days: stale ? {} : s.days,
            adhoc: w,
            activeDay: w.name,
            activeSource: s.activeSource,
          };
        }),

      endAdhoc: () =>
        set((s) => ({
          adhoc: null,
          activeDay: s.activeDay === s.adhoc?.name ? null : s.activeDay,
        })),

      setDaySwap: (to) =>
        set((s) => {
          const stale = s.date !== todayIso();
          return {
            date: todayIso(),
            days: stale ? {} : s.days,
            adhoc: stale ? null : s.adhoc,
            daySwap: to,
          };
        }),

      markActive: (day, source) =>
        set((s) => {
          const stale = s.date !== todayIso();
          return {
            date: todayIso(),
            days: stale ? {} : s.days,
            adhoc: stale ? null : s.adhoc,
            activeDay: day,
            activeSource: source ?? s.activeSource,
          };
        }),

      // Through edit() like every other write — it used to bypass the date
      // guard, so a superset paired before midnight leaked into the new day.
      toggleSuperset: (day, a, b) =>
        set((s) =>
          edit(s, day, (d) => {
            const sup = { ...(d.superset ?? {}) };
            const linked = sup[a] === b;
            // unlink anything either party is currently in, then link (or stop).
            for (const k of [a, b, sup[a], sup[b]]) if (k) delete sup[k];
            if (!linked) {
              sup[a] = b;
              sup[b] = a;
            }
            return { ...d, superset: sup };
          })
        ),

      substitute: (day, from, to) =>
        set((s) => edit(s, day, (d) => applySubstitution(d, from, to))),

      resetSubstitution: (day, displayed) =>
        set((s) => edit(s, day, (d) => clearSubstitution(d, displayed))),

      seedSupersets: (day, pairs) =>
        set((s) => {
          // Already defined (and not stale) → nothing to do. Returning {}
          // leaves every selected slice identical, so nothing re-renders.
          if (s.date === todayIso() && s.days[day]?.superset !== undefined) return {};
          return edit(s, day, (d) =>
            d.superset !== undefined ? d : { ...d, superset: { ...pairs } }
          );
        }),

      reorderExercises: (day, order) =>
        set((s) => edit(s, day, (d) => ({ ...d, order: [...order] }))),

      clearActive: () => set({ activeDay: null, activeSource: null }),

      reset: () =>
        set({ date: todayIso(), days: {}, adhoc: null, daySwap: null, activeDay: null, activeSource: null }),
    }),
    {
      name: 'evoforge-session-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        date: s.date,
        days: s.days,
        adhoc: s.adhoc,
        daySwap: s.daySwap,
        activeDay: s.activeDay,
        activeSource: s.activeSource,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // The rollover on READ (see the header): a persisted yesterday is
        // dropped the moment we wake up in a new day.
        if (state.date !== todayIso()) {
          state.date = todayIso();
          state.days = {};
          state.adhoc = null;
          state.daySwap = null;
          state.activeDay = null;
          state.activeSource = null;
        }
        state._hydrated = true;
      },
    }
  )
);

/** Today's overrides for a day — always fresh, never yesterday's. */
export function overridesFor(state: SessionState, day: string): DayOverrides {
  if (state.date !== todayIso()) return EMPTY_OVERRIDES;
  return state.days[day] ?? EMPTY_OVERRIDES;
}

/** Today's ad-hoc workout, or null (also date-guarded). */
export function adhocOf(state: SessionState): AdhocWorkout | null {
  if (state.date !== todayIso()) return null;
  return state.adhoc;
}

/** Today's "just for today" day swap, or null (also date-guarded). */
export function daySwapOf(state: SessionState): string | null {
  if (state.date !== todayIso()) return null;
  return state.daySwap;
}

/** The workout in progress RIGHT NOW, or null. Date-guarded: an unfinished
 *  workout from yesterday is not a workout you are standing in the middle of. */
export function activeWorkout(state: SessionState): string | null {
  if (state.date !== todayIso()) return null;
  return state.activeDay;
}

/** Which plan it was being trained from — so a resume reopens the SAME workout,
 *  not the built-in day that happens to share its name. */
export function activeWorkoutSource(state: SessionState): number | null {
  if (state.date !== todayIso()) return null;
  return state.activeSource;
}

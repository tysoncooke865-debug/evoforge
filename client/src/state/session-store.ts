import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { EMPTY_OVERRIDES, type DayOverrides, type SessionExercise } from '@/domain/session-plan';
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
  _hydrated: boolean;

  addExercise: (day: string, e: SessionExercise) => void;
  removeExercise: (day: string, exercise: string) => void;
  restoreExercise: (day: string, exercise: string) => void;
  toggleSkip: (day: string, exercise: string) => void;
  bumpSets: (day: string, exercise: string, delta: number) => void;

  /** Adding to an ad-hoc day goes through addExercise like any other day —
   *  the override layer keys on the day NAME, and an ad-hoc workout's name is
   *  a day name. There is deliberately no separate add-to-adhoc action. */
  startAdhoc: (w: AdhocWorkout) => void;
  endAdhoc: () => void;

  markActive: (day: string) => void;
  clearActive: () => void;

  reset: () => void;
}

// The athlete's calendar day (domain/today.ts) — NOT the UTC date.

const emptyDay = (): DayOverrides => ({ added: [], removed: [], skipped: [], setDelta: {} });

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
      activeDay: null,
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

      startAdhoc: (w) => set({ date: todayIso(), adhoc: w, activeDay: w.name }),

      endAdhoc: () => set((s) => ({ adhoc: null, activeDay: s.activeDay === s.adhoc?.name ? null : s.activeDay })),

      markActive: (day) => set({ date: todayIso(), activeDay: day }),
      clearActive: () => set({ activeDay: null }),

      reset: () => set({ date: todayIso(), days: {}, adhoc: null, activeDay: null }),
    }),
    {
      name: 'evoforge-session-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ date: s.date, days: s.days, adhoc: s.adhoc, activeDay: s.activeDay }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // The rollover on READ (see the header): a persisted yesterday is
        // dropped the moment we wake up in a new day.
        if (state.date !== todayIso()) {
          state.date = todayIso();
          state.days = {};
          state.adhoc = null;
          state.activeDay = null;
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

/** The workout in progress RIGHT NOW, or null. Date-guarded: an unfinished
 *  workout from yesterday is not a workout you are standing in the middle of. */
export function activeWorkout(state: SessionState): string | null {
  if (state.date !== todayIso()) return null;
  return state.activeDay;
}

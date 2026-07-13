import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { EMPTY_OVERRIDES, type DayOverrides, type SessionExercise } from '@/domain/session-plan';

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
  _hydrated: boolean;

  addExercise: (day: string, e: SessionExercise) => void;
  removeExercise: (day: string, exercise: string) => void;
  restoreExercise: (day: string, exercise: string) => void;
  toggleSkip: (day: string, exercise: string) => void;
  bumpSets: (day: string, exercise: string, delta: number) => void;

  startAdhoc: (w: AdhocWorkout) => void;
  addAdhocExercise: (e: SessionExercise) => void;
  endAdhoc: () => void;

  reset: () => void;
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

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

      startAdhoc: (w) => set({ date: todayIso(), adhoc: w }),

      addAdhocExercise: (e) =>
        set((s) =>
          s.adhoc === null
            ? {}
            : {
                date: todayIso(),
                adhoc: {
                  ...s.adhoc,
                  exercises: s.adhoc.exercises.some((x) => x.exercise === e.exercise)
                    ? s.adhoc.exercises
                    : [...s.adhoc.exercises, e],
                },
              }
        ),

      endAdhoc: () => set({ adhoc: null }),

      reset: () => set({ date: todayIso(), days: {}, adhoc: null }),
    }),
    {
      name: 'evoforge-session-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ date: s.date, days: s.days, adhoc: s.adhoc }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // The rollover on READ (see the header): a persisted yesterday is
        // dropped the moment we wake up in a new day.
        if (state.date !== todayIso()) {
          state.date = todayIso();
          state.days = {};
          state.adhoc = null;
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

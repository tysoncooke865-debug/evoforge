import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { MAX_MEALS, MIN_MEALS } from '@/domain/nutrition';
import { todayIso } from '@/domain/today';

/**
 * FUEL day state: how many meal slots the athlete wants TODAY. Date-guarded
 * exactly like session-store — yesterday's 6-meal day never shapes today
 * (the read selector AND rehydrate both drop a stale date). null means
 * "never touched": the domain's effectiveMealCount turns that into the
 * default three, and logged entries can force the count UP but never down.
 *
 * Sign-out clears this store AND its AsyncStorage key (auth-context — the
 * every-cache-layer rule: add a store, clear it there).
 */

interface FuelDayState {
  date: string;
  mealCount: number | null;
  _hydrated: boolean;
  setMealCount: (n: number) => void;
  reset: () => void;
}

export const useFuelStore = create<FuelDayState>()(
  persist(
    (set) => ({
      date: todayIso(),
      mealCount: null,
      _hydrated: false,

      setMealCount: (n) =>
        set(() => ({
          date: todayIso(), // re-stamp: a write always belongs to today
          mealCount: Math.max(MIN_MEALS, Math.min(MAX_MEALS, Math.round(n))),
        })),

      reset: () => set({ date: todayIso(), mealCount: null }),
    }),
    {
      name: 'evoforge-fuel-day-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ date: s.date, mealCount: s.mealCount }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.date !== todayIso()) {
          state.date = todayIso();
          state.mealCount = null;
        }
        state._hydrated = true;
      },
    }
  )
);

/** Today's stored meal count, or null (stale days read as never-touched). */
export function mealCountOf(state: FuelDayState): number | null {
  if (state.date !== todayIso()) return null;
  return state.mealCount;
}

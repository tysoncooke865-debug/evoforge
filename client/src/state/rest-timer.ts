import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { cancelRestAlarm, scheduleRestAlarm } from '@/data/rest-alarm';
import {
  clampRestSeconds as clamp,
  DEFAULT_REST_SECONDS,
  restAlarmBody,
} from '@/domain/rest-clock';

/**
 * THE REST CLOCK (§13/§16, 2026-08-10) — one store, app-wide.
 *
 * ---- WHAT WAS ALREADY RIGHT, AND STAYS ----
 *
 * The previous implementation (ui/train/rest-timer.tsx) was already built on
 * ABSOLUTE TIMESTAMPS: it wrote `endAt` to AsyncStorage and derived the
 * remaining seconds from `Date.now()` on every tick. That is the correct
 * design and it is kept verbatim, because it is what makes the timer survive
 * backgrounding, a screen lock and a cold reopen BY CONSTRUCTION — there is
 * no counter to drift, nothing to resynchronise, and a JS timer that misses
 * sixty ticks in a suspended tab is simply irrelevant to the answer. The
 * one-second interval only decides when the BAR REDRAWS.
 *
 * Also kept: the single shared interval for however many surfaces subscribe
 * (two components each owning a 1s timer meant two re-render trains per
 * second while resting), and the completion latch so one rest chimes once
 * however many clocks are mounted.
 *
 * ---- WHAT THIS ADDS ----
 *
 *   IDENTITY      the timer knows which exercise and set it belongs to, so
 *                 the notification can say what is next instead of "rest is
 *                 over" with no subject.
 *   ADD / SUBTRACT  ±30s without cancelling and restarting, which used to be
 *                 the only way to change your mind.
 *   AN ALARM      a scheduled local notification (data/rest-alarm.ts), always
 *                 cancelled and rescheduled together with the clock, so there
 *                 can never be two.
 *
 * ---- WHY A STORE AND NOT A MODULE OF LETS ----
 *
 * §16: "Move timer state out of individual workout screens." It already was,
 * but as module-level mutable state with a hand-rolled listener array, which
 * meant every surface had to opt in by calling one specific hook and nothing
 * outside that file could ask a question about the timer. As a Zustand store
 * the same state is addressable from anywhere — the workout page, a future
 * Live Activity bridge, a test — with one subscription mechanism the rest of
 * this app already uses, and sign-out clears it like every other store.
 */

/** The ARITHMETIC lives in domain/rest-clock.ts — pure, and therefore
 *  testable without react-native, AsyncStorage or a React tree. This module
 *  owns the STATE and the side effects; re-exported so callers keep one
 *  import path. */
export {
  clampRestSeconds,
  DEFAULT_REST_SECONDS,
  REST_LINGER_SECONDS,
  REST_STEP_SECONDS,
  restAlarmBody,
  restClockView,
  type RestClockView,
} from '@/domain/rest-clock';

export interface RestTimerState {
  isActive: boolean;
  /** Epoch ms. `endAt` is the ONLY source of truth for remaining time. */
  startedAt: number | null;
  endAt: number | null;
  /** The rest the athlete asked for, in seconds — what ±30s adjusts. */
  duration: number;
  /** What the rest is between. Display and notification only; the clock does
   *  not care, and a timer with no exercise attached is perfectly valid. */
  associatedExerciseId: string | null;
  associatedExerciseName: string | null;
  associatedSetNumber: number | null;

  startTimer: (input?: {
    seconds?: number;
    exerciseId?: string | null;
    exerciseName?: string | null;
    setNumber?: number | null;
  }) => void;
  cancelTimer: () => void;
  completeTimer: () => void;
  addTime: (seconds: number) => void;
  reset: () => void;
}

const IDLE = {
  isActive: false,
  startedAt: null,
  endAt: null,
  duration: DEFAULT_REST_SECONDS,
  associatedExerciseId: null,
  associatedExerciseName: null,
  associatedSetNumber: null,
} as const;

export const useRestTimerStore = create<RestTimerState>()(
  persist(
    (set, get) => ({
      ...IDLE,

      startTimer: (input = {}) => {
        const seconds = clamp(input.seconds ?? get().duration ?? DEFAULT_REST_SECONDS);
        const now = Date.now();
        const endAt = now + seconds * 1000;
        const exerciseName = input.exerciseName ?? null;
        set({
          isActive: true,
          startedAt: now,
          endAt,
          duration: seconds,
          associatedExerciseId: input.exerciseId ?? null,
          associatedExerciseName: exerciseName,
          associatedSetNumber: input.setNumber ?? null,
        });
        // A SECOND TIMER REPLACES THE FIRST (§14). scheduleRestAlarm cancels
        // whatever was pending before arming the new one, so starting a rest
        // while one is live can never leave two notifications in flight.
        void scheduleRestAlarm(endAt, restAlarmBody(exerciseName));
      },

      cancelTimer: () => {
        set({ ...IDLE, duration: get().duration });
        void cancelRestAlarm();
      },

      /** The rest ran out and has been acknowledged (or lingered long enough).
       *  Distinct from cancelTimer because the alarm has ALREADY fired — there
       *  is nothing to cancel, and cancelling would race a notification the
       *  athlete is looking at. */
      completeTimer: () => {
        set({ ...IDLE, duration: get().duration });
      },

      addTime: (seconds) => {
        const s = get();
        if (!s.isActive || s.endAt === null) return;
        // Nudge from the REMAINING time, not from the original duration: after
        // 90 seconds of a 120s rest, "+30s" means half a minute more from now,
        // which is the only reading that matches the number on screen.
        const remaining = Math.max(0, Math.round((s.endAt - Date.now()) / 1000));
        const next = clamp(remaining + seconds);
        const endAt = Date.now() + next * 1000;
        set({ endAt, duration: clamp(s.duration + seconds) });
        void scheduleRestAlarm(endAt, restAlarmBody(s.associatedExerciseName));
      },

      reset: () => {
        set({ ...IDLE });
        void cancelRestAlarm();
      },
    }),
    {
      name: 'evoforge-rest-timer-v1',
      storage: createJSONStorage(() => AsyncStorage),
      /**
       * PERSIST ENOUGH TO RECONSTRUCT THE TIMER, AND NOTHING ELSE (§16).
       * `endAt` is an absolute instant, so a rest reopened after a suspension
       * — or after the app was killed outright — resumes at the correct
       * remaining time, or arrives already expired, which is also correct.
       */
      partialize: (s) => ({
        isActive: s.isActive,
        startedAt: s.startedAt,
        endAt: s.endAt,
        duration: s.duration,
        associatedExerciseId: s.associatedExerciseId,
        associatedExerciseName: s.associatedExerciseName,
        associatedSetNumber: s.associatedSetNumber,
      }),
    }
  )
);

import { create } from 'zustand';

import type { SessionExercise } from '@/domain/session-plan';

/**
 * 065 — SAVE-ROUTINE PROMPT. After a QUICK (ad-hoc) workout finishes, a
 * dismissible offer: save what you just did as a named routine, then
 * optionally add it to the schedule. NOTHING writes without the athlete
 * confirming each step. Ephemeral on purpose (no persistence): a pending
 * offer belongs to the finish that raised it. Reset on sign-out (the
 * every-cache rule) — a pending offer belongs to that athlete too.
 */
export interface SaveRoutineOffer {
  /** Suggested routine name — the ad-hoc workout's name. */
  name: string;
  /** What the athlete actually DID (workout.tsx::performed()). */
  exercises: SessionExercise[];
}

interface SaveRoutinePromptState {
  pending: SaveRoutineOffer | null;
  offer: (o: SaveRoutineOffer) => void;
  clear: () => void;
  reset: () => void;
}

export const useSaveRoutinePromptStore = create<SaveRoutinePromptState>()((set) => ({
  pending: null,
  offer: (o) => set({ pending: o }),
  clear: () => set({ pending: null }),
  reset: () => set({ pending: null }),
}));

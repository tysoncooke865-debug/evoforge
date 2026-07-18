import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * SHARE PROMPT (Social) — after a workout is finished, a non-intrusive
 * "share it?" offer. NOTHING auto-publishes (the spec's rule): the prompt only
 * OPENS the composer; the athlete still confirms. `askDisabled` (persisted) is
 * the "don't ask again" — once set, `offer` becomes a no-op, so the finish
 * path never even raises the prompt. Cleared on sign-out (the every-cache rule).
 */
export interface SharePayload {
  workout: string;
  date: string;
}

interface SharePromptState {
  pending: SharePayload | null;
  askDisabled: boolean;
  offer: (p: SharePayload) => void;
  clear: () => void;
  disableForever: () => void;
  reset: () => void;
}

export const useSharePromptStore = create<SharePromptState>()(
  persist(
    (set, get) => ({
      pending: null,
      askDisabled: false,
      offer: (p) => {
        if (get().askDisabled) return;
        set({ pending: p });
      },
      clear: () => set({ pending: null }),
      disableForever: () => set({ pending: null, askDisabled: true }),
      reset: () => set({ pending: null }),
    }),
    {
      name: 'evoforge-share-prompt-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the preference persists — a pending offer is ephemeral.
      partialize: (s) => ({ askDisabled: s.askDisabled }),
    }
  )
);

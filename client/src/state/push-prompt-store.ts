import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * PUSH PROMPT — the post-workout offer to turn phone reminders on.
 *
 * WHY IT IS NOT ASKED SOONER. Push has existed since 053 with ONE subscriber,
 * because the only opt-in is buried in a modal behind the Social tab's bell and
 * is pitched as a social feature ("get pushed when friends react") on a feed
 * with 17 lifetime posts. Asking at the right moment, about training, is the
 * fix — but a workout finish already raises up to two other sheets (share,
 * save-routine), so a third one asked eagerly would just teach people to
 * dismiss sheets.
 *
 * So: `finishes` counts completed workouts and the offer is raised only from
 * the SECOND one onward — an athlete who has finished twice has shown the
 * intent a reminder is for. Asked once; "Don't ask again" is permanent; the
 * counter keeps rising either way so the rule stays honest if it is ever tuned.
 */
interface PushPromptState {
  pending: boolean;
  askDisabled: boolean;
  asked: boolean;
  finishes: number;
  /** Count a finished workout and raise the offer if this one qualifies. */
  offerAfterFinish: () => void;
  clear: () => void;
  disableForever: () => void;
  reset: () => void;
}

/** Ask from the second finished workout onward. */
export const PUSH_PROMPT_MIN_FINISHES = 2;

export const usePushPromptStore = create<PushPromptState>()(
  persist(
    (set, get) => ({
      pending: false,
      askDisabled: false,
      asked: false,
      finishes: 0,
      offerAfterFinish: () => {
        const s = get();
        const finishes = s.finishes + 1;
        // Always record the finish; only sometimes ask.
        if (s.askDisabled || s.asked || finishes < PUSH_PROMPT_MIN_FINISHES) {
          set({ finishes });
          return;
        }
        set({ finishes, pending: true });
      },
      clear: () => set({ pending: false }),
      disableForever: () => set({ pending: false, askDisabled: true }),
      reset: () => set({ pending: false, asked: false, finishes: 0 }),
    }),
    {
      name: 'evoforge-push-prompt-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // `askDisabled` is a preference and survives; the rest is per-athlete
      // progress that sign-out clears with every other cache.
      partialize: (s) => ({ askDisabled: s.askDisabled, asked: s.asked, finishes: s.finishes }),
    }
  )
);

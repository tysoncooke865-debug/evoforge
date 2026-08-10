import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * "GET ALERTED WHEN YOUR REST ENDS." — when to ask, and when to stop (§18).
 *
 * THE RULE, and it is short: ask ONCE, on the first rest the athlete actually
 * takes, and never again either way.
 *
 * Not during onboarding, which is §18's explicit instruction and also the
 * lesson of push notifications in this app: the only existing opt-in lives
 * behind the Social tab's bell, pitched as a social feature, and has one
 * subscriber. A permission prompt asked before its value is visible is a
 * prompt that gets denied permanently, and a denied browser permission cannot
 * be re-asked — the athlete has to go into site settings. So there is exactly
 * one chance, and it is spent at the moment the feature is obviously useful:
 * standing in a gym, watching a countdown.
 *
 * `dismissed` is set whether they enabled or declined. A decline is not a
 * failure state to retry — the timer works in-app regardless, and Settings
 * keeps the switch for anyone who changes their mind.
 */
interface RestAlarmPromptState {
  /** Show the inline offer right now. */
  pending: boolean;
  /** Asked once already — never ask again. */
  dismissed: boolean;
  offerOnFirstRest: () => void;
  dismissForever: () => void;
  reset: () => void;
}

export const useRestAlarmPromptStore = create<RestAlarmPromptState>()(
  persist(
    (set, get) => ({
      pending: false,
      dismissed: false,
      offerOnFirstRest: () => {
        if (get().dismissed || get().pending) return;
        set({ pending: true });
      },
      dismissForever: () => set({ pending: false, dismissed: true }),
      // `reset` is the sign-out hook (the every-cache doctrine). It clears the
      // in-flight offer but NOT the durable decision — see partialize.
      reset: () => set({ pending: false }),
    }),
    {
      name: 'evoforge-rest-alarm-prompt-v1',
      storage: createJSONStorage(() => AsyncStorage),
      /** Only the decision survives. It is a preference about this DEVICE's
       *  notification permission, which is itself per-device and per-browser,
       *  so it correctly outlives a sign-out. */
      partialize: (s) => ({ dismissed: s.dismissed }),
    }
  )
);

import { create } from 'zustand';

/**
 * UI settings. perfMode replaces the Streamlit :has() CSS hack with a real
 * flag: it disables AMBIENT LOOPS ONLY (idleFloat, breathe, auraPulse,
 * groundPulse, sheen, xpPulse). One-shot animations always play -- they end
 * at opacity 0, and skipping them makes toasts invisible (the old bug class).
 *
 * soundEnabled (Tyson, 2026-07-16) gates the retro button SFX — default
 * on, togglable beside perf mode on the profile page.
 *
 * DOCTRINE: cleared on sign-out in auth-context, like every store.
 */
interface SettingsState {
  perfMode: boolean;
  soundEnabled: boolean;
  setPerfMode: (on: boolean) => void;
  setSoundEnabled: (on: boolean) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  perfMode: false,
  soundEnabled: true,
  setPerfMode: (on) => set({ perfMode: on }),
  setSoundEnabled: (on) => set({ soundEnabled: on }),
  reset: () => set({ perfMode: false, soundEnabled: true }),
}));

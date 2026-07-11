import { create } from 'zustand';

/**
 * UI settings. perfMode replaces the Streamlit :has() CSS hack with a real
 * flag: it disables AMBIENT LOOPS ONLY (idleFloat, breathe, auraPulse,
 * groundPulse, sheen, xpPulse). One-shot animations always play -- they end
 * at opacity 0, and skipping them makes toasts invisible (the old bug class).
 *
 * DOCTRINE: cleared on sign-out in auth-context, like every store.
 */
interface SettingsState {
  perfMode: boolean;
  setPerfMode: (on: boolean) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  perfMode: false,
  setPerfMode: (on) => set({ perfMode: on }),
  reset: () => set({ perfMode: false }),
}));

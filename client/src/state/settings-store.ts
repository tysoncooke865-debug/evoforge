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
  /**
   * motionPhysics (2026-08-08): the chip table's gravity follows the phone's
   * tilt. Default ON because it is the feature, but it is a SETTING because a
   * sensor that moves things while you are reading is exactly the kind of
   * thing somebody must be able to switch off — and because a denied or
   * missing sensor has to degrade to plain downward gravity anyway.
   */
  motionPhysics: boolean;
  /**
   * revealsHidden (Spec v5 §8, 2026-08-09): "Hide Forge reveals forever."
   *
   * THE REWARD IS STILL GRANTED AND STILL PAID. This hides the ceremony, not the
   * coins — a hidden reveal is claimed silently and reported as a plain bonus
   * line. Anything else would make opting out of a chance feature cost money,
   * which turns the setting into a penalty and the feature into something you
   * cannot really decline.
   *
   * Off by default, and once on it stays on: §8 wants leaving frictionless, and a
   * setting that quietly re-enables itself is not a setting.
   */
  revealsHidden: boolean;
  setPerfMode: (on: boolean) => void;
  setSoundEnabled: (on: boolean) => void;
  setMotionPhysics: (on: boolean) => void;
  setRevealsHidden: (on: boolean) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  perfMode: false,
  soundEnabled: true,
  motionPhysics: true,
  revealsHidden: false,
  setPerfMode: (on) => set({ perfMode: on }),
  setSoundEnabled: (on) => set({ soundEnabled: on }),
  setMotionPhysics: (on) => set({ motionPhysics: on }),
  setRevealsHidden: (on) => set({ revealsHidden: on }),
  reset: () =>
    set({ perfMode: false, soundEnabled: true, motionPhysics: true, revealsHidden: false }),
}));

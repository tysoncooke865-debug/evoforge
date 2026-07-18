import { create } from 'zustand';

/**
 * THE FLOATING REST TIMER's UI state (2026-07-19, improvement doc §3.3).
 * `collapsed` = the athlete pressed ▴ to send the floating box away; the
 * inline bar's ▾ deploys it again. Session-lifetime only — NOT persisted
 * (a fresh open should always show the timer), but still reset on sign-out
 * like every store (the every-cache doctrine).
 */
interface RestUiState {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  reset: () => void;
}

export const useRestUiStore = create<RestUiState>()((set) => ({
  collapsed: false,
  setCollapsed: (collapsed) => set({ collapsed }),
  reset: () => set({ collapsed: false }),
}));

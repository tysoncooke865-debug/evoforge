import { create } from 'zustand';

/**
 * HOW FAST THE BOARD PLAYS BACK.
 *
 * PRESENTATION ONLY. This scales the animation clock and nothing else. The
 * outcome, the multiplier, the coins and the XP are all decided by the server
 * before a puck moves, so 2x cannot change what happens — only how long you
 * watch it happen. That is why it is safe to offer at all, and why it is safe
 * to change mid-fall: the trajectory is a pure function of a clock, so a
 * faster clock advances the same path without restarting or skipping it.
 *
 * Session-lifetime, defaulting to 1x, and reset on sign-out like every store.
 * Not in Settings: a speed you have to leave the board to change is a speed
 * nobody changes.
 */
export type DropSpeed = 1 | 2;

interface DropSpeedState {
  speed: DropSpeed;
  setSpeed: (s: DropSpeed) => void;
  reset: () => void;
}

export const useDropSpeedStore = create<DropSpeedState>()((set) => ({
  speed: 1,
  setSpeed: (speed) => set({ speed }),
  reset: () => set({ speed: 1 }),
}));

/**
 * PERF (Tyson, 2026-07-16: "everything lags") — the ONE gate for ambient
 * animation. The idle tab preload keeps five screens mounted, and on web
 * every Reanimated loop runs on the MAIN JS THREAD whether its screen is
 * visible or not: five screens of auras, motes, floats and pulses all
 * ticking at once is exactly the "no off-screen animation loops" rule
 * being violated, and button response queues behind them on phones.
 *
 * ambient === this screen is FOCUSED and the athlete allows motion.
 * Unfocused tabs go INERT (loops stop, sprite GIFs fall back to static
 * art via the same flag) and restart on focus.
 *
 * ONLY call inside a navigator screen — useIsFocused throws elsewhere
 * (root overlays like LevelUpOverlay must not use this).
 */

import { useIsFocused } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

import { useSettingsStore } from '@/state/settings-store';

export function useAmbient(): boolean {
  const focused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  return focused && !reducedMotion && !perfMode;
}

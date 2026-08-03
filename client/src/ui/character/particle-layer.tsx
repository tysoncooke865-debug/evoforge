/**
 * Drifting energy motes behind the champion. Pure ambience: gated by perf
 * mode, focus and reduced motion via `useAmbient` (renders nothing when any
 * is on — an invisible particle costs nothing).
 *
 * 2026-08-03 PREMIUM PASS — two changes, both for the brief:
 *
 *  1. THEY ARE PIXELS NOW. Square, not round, and drawn at whole-pixel sizes.
 *     "Subtle floating pixels" was the ask, and a round particle in a pixel-art
 *     game reads as another app's confetti.
 *  2. SEVEN MOTES, ONE DRIVER. This used to start SIX independent
 *     `withRepeat` loops, one per mote. On web every Reanimated loop runs on
 *     the main JS thread, so the cost that matters is the number of DRIVERS —
 *     the whole field now derives from a single 8s clock with each mote's
 *     phase folded into its worklet. Same drift, five fewer animation drivers
 *     on the busiest screen in the app, and it paid for the podium's tech
 *     layer without raising Home's total.
 *
 * Each mote also sways horizontally as it rises, on a different period from
 * its rise, so the field reads as air currents rather than a lift shaft.
 */

import { memo, useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useAmbient } from '@/ui/core/use-ambient';

/** left · size · phase (0..1 offset into the shared clock) · speed multiple ·
 *  sway amplitude in px. Fixed, never random: a tour screenshot has to be
 *  reproducible. */
const MOTES = [
  { left: '16%', size: 3, phase: 0.0, speed: 1.0, sway: 5 },
  { left: '30%', size: 2, phase: 0.62, speed: 0.78, sway: 8 },
  { left: '45%', size: 4, phase: 0.24, speed: 1.18, sway: 4 },
  { left: '58%', size: 2, phase: 0.81, speed: 0.7, sway: 9 },
  { left: '70%', size: 3, phase: 0.41, speed: 1.05, sway: 6 },
  { left: '84%', size: 2, phase: 0.13, speed: 0.86, sway: 7 },
  { left: '92%', size: 2, phase: 0.55, speed: 1.3, sway: 3 },
] as const;

const PERIOD = 8000;

export const ParticleLayer = memo(function ParticleLayer({
  colour,
  height = 240,
}: {
  colour: string;
  height?: number;
}) {
  // PERF: useAmbient = focused AND motion allowed (it embeds useReducedMotion
  // + perf mode) — a hidden tab's motes are pure waste.
  const ambient = useAmbient();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!ambient) return;
    t.value = withRepeat(withTiming(1, { duration: PERIOD, easing: Easing.linear }), -1);
  }, [ambient, t]);

  if (!ambient) return null;

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height }}>
      {MOTES.map((m, i) => (
        <Mote key={i} {...m} colour={colour} travel={height} t={t} />
      ))}
    </View>
  );
});

function Mote({
  left,
  size,
  phase,
  speed,
  sway,
  colour,
  travel,
  t,
}: {
  left: string;
  size: number;
  phase: number;
  speed: number;
  sway: number;
  colour: string;
  travel: number;
  t: { value: number };
}) {
  const style = useAnimatedStyle(() => {
    // Each mote runs its own fractional position through the shared clock.
    const raw = t.value * speed + phase;
    const p = raw - Math.floor(raw);
    return {
      transform: [
        { translateY: -p * travel },
        { translateX: Math.sin(p * Math.PI * 2 + phase * 6) * sway },
      ],
      // Fade in over the first 15% of the rise, then out across the rest.
      opacity: p < 0.15 ? p * 4 : (1 - p) * 0.7,
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          bottom: 0,
          left: left as `${number}%`,
          width: size,
          height: size,
          // SQUARE: this is a pixel game.
          backgroundColor: colour,
          shadowColor: colour,
          shadowOpacity: 0.8,
          shadowRadius: 4,
        },
        style,
      ]}
    />
  );
}

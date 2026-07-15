import { useEffect } from 'react';
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { G, Path } from 'react-native-svg';

import { MUSCLE_LABEL, type MuscleId, type MusclePathSides } from './types';

/**
 * One selected muscle, drawn as glowing 16-bit game art — NOT a smooth
 * medical diagram. The glow is built from three stacked copies of the same
 * stepped path (outer haze → middle bloom → the lit muscle), so the effect
 * stays angular and the base character's black shading remains partially
 * visible through the fill. One big blurry glow is exactly what this avoids.
 */
export const NEON = {
  core: '#18D9FF',
  highlight: '#7AEEFF',
  glow: '#00AEEF',
} as const;

const AnimatedG = Animated.createAnimatedComponent(G);

export function MuscleOverlay({
  muscle,
  sides,
  pulse = false,
  interactive = false,
  onPress,
}: {
  muscle: MuscleId;
  sides: MusclePathSides;
  pulse?: boolean;
  interactive?: boolean;
  onPress?: (muscle: MuscleId) => void;
}) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      // Hold still: fully lit, no fade, no pulse.
      opacity.value = 1;
      return;
    }
    opacity.value = pulse
      ? withSequence(
          withTiming(1, { duration: 180 }),
          // The continuous breath: 0.82 ↔ 1.0, ~1.4 s per cycle. Subtle.
          withRepeat(withSequence(withTiming(0.82, { duration: 700 }), withTiming(1, { duration: 700 })), -1)
        )
      : withTiming(1, { duration: 180 });
  }, [pulse, reducedMotion, opacity]);

  const animatedProps = useAnimatedProps(() => ({ opacity: opacity.value }));

  const paths = [sides.left, sides.right, sides.center].filter((d): d is string => !!d);

  return (
    <AnimatedG animatedProps={animatedProps} testID={`muscle-overlay-${muscle}`}>
      {paths.map((d, i) => (
        <G key={i}>
          {/* 1 · outer glow — the haze around the muscle */}
          <Path d={d} fill={NEON.glow} fillOpacity={0.15} stroke={NEON.glow} strokeWidth={12} strokeOpacity={0.15} />
          {/* 2 · middle glow */}
          <Path d={d} fill={NEON.core} fillOpacity={0.35} stroke={NEON.core} strokeWidth={6} strokeOpacity={0.35} />
          {/* 3 · the lit muscle — black shading shows through the 0.82 */}
          <Path d={d} fill={NEON.core} fillOpacity={0.82} stroke={NEON.highlight} strokeWidth={2} />
          {interactive ? (
            // The enlarged invisible hit target: same path, fat transparent
            // stroke. fillOpacity 0.01 keeps it hit-testable on web.
            <Path
              d={d}
              fill={NEON.core}
              fillOpacity={0.01}
              stroke={NEON.core}
              strokeOpacity={0.01}
              strokeWidth={36}
              onPress={onPress ? () => onPress(muscle) : undefined}
              accessibilityLabel={`Select ${MUSCLE_LABEL[muscle]}`}
            />
          ) : null}
        </G>
      ))}
    </AnimatedG>
  );
}

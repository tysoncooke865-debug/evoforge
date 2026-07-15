import { useEffect } from 'react';
import type { ImageSourcePropType } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { G, Path } from 'react-native-svg';

import { MUSCLE_LABEL, type MuscleId, type MusclePathSides } from './types';

/** The one selection animation: 180ms fade-in, optional 0.82↔1.0 pulse
 *  (~1.4s/cycle), held fully lit under reduced motion. Shared by the SVG
 *  overlays and the Krita mask images so both breathe identically. */
function useSelectionOpacity(pulse: boolean): SharedValue<number> {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = pulse
      ? withSequence(
          withTiming(1, { duration: 180 }),
          withRepeat(withSequence(withTiming(0.82, { duration: 700 }), withTiming(1, { duration: 700 })), -1)
        )
      : withTiming(1, { duration: 180 });
  }, [pulse, reducedMotion, opacity]);
  return opacity;
}

/**
 * A hand-drawn Krita mask, lit: the pre-tinted PNG rides the same box as the
 * base silhouette (absolute fill, same resizeMode, NO per-muscle offsets —
 * the artwork shares the base's exact canvas, so alignment is the asset's,
 * not the code's). `maskOpacity` scales the whole layer; the pulse composes
 * on top of it.
 */
export function MaskOverlay({
  muscle,
  source,
  pulse = false,
  maskOpacity = 1,
}: {
  muscle: MuscleId;
  source: ImageSourcePropType;
  pulse?: boolean;
  maskOpacity?: number;
}) {
  const opacity = useSelectionOpacity(pulse);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value * maskOpacity }));
  return (
    <Animated.Image
      source={source}
      resizeMode="contain"
      style={[{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }, style]}
      accessibilityIgnoresInvertColors
      testID={`muscle-mask-${muscle}`}
    />
  );
}

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
  /** Render ONLY the invisible hit target — used when a Krita mask image
   *  draws the visuals but presses still need per-muscle geometry. */
  hitOnly = false,
}: {
  muscle: MuscleId;
  sides: MusclePathSides;
  pulse?: boolean;
  interactive?: boolean;
  onPress?: (muscle: MuscleId) => void;
  hitOnly?: boolean;
}) {
  const opacity = useSelectionOpacity(pulse);
  const animatedProps = useAnimatedProps(() => ({ opacity: hitOnly ? 1 : opacity.value }));

  const paths = [sides.left, sides.right, sides.center].filter((d): d is string => !!d);

  return (
    <AnimatedG animatedProps={animatedProps} testID={`muscle-overlay-${muscle}`}>
      {paths.map((d, i) => (
        <G key={i}>
          {hitOnly ? null : (
            <>
              {/* 1 · outer glow — the haze around the muscle */}
              <Path d={d} fill={NEON.glow} fillOpacity={0.1} stroke={NEON.glow} strokeWidth={12} strokeOpacity={0.1} />
              {/* 2 · middle glow */}
              <Path d={d} fill={NEON.core} fillOpacity={0.2} stroke={NEON.core} strokeWidth={6} strokeOpacity={0.2} />
              {/* 3 · the lit muscle — translucent enough that the art's own
                  muscle shading stays legible under the cyan */}
              <Path d={d} fill={NEON.core} fillOpacity={0.45} stroke={NEON.highlight} strokeWidth={2} strokeOpacity={0.9} />
            </>
          )}
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

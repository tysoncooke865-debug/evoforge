import { Image } from 'expo-image';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { ImageSourcePropType } from 'react-native';

import type { Branch } from '@/domain/avatar-stats';
import { animations } from '@/theme/animations';
import tokens from '@/theme/tokens';
import { useSettingsStore } from '@/state/settings-store';

import { avatarImage } from './avatar-images';

/** Rotation sprites draw larger than the painted art (their frames are
 *  padded) and sit ~24% above their frame bottoms — both constants are
 *  MEASURED, not tuned by eye. Re-measure when new sets land. */
const SPRITE_SCALE = 1.35;
const SPRITE_BOTTOM_PAD = 0.24;

/**
 * The living avatar: the CSS §10 layered stage, in Reanimated. Four ambient
 * loops from animations.ts run on the UI thread -- idleFloat (the hover),
 * breathe (asymmetric x/y scale), auraPulse behind, groundPulse under -- and
 * ALL of them yield to perf mode and the OS reduced-motion setting. One-shots
 * are not gated; ambient loops are the only thing perf mode may kill
 * (assets/styles.css §16 rule, carried over).
 */
export function AvatarStage({
  branch,
  stage,
  auraColour,
  size = 220,
  source,
  animatedSource,
  silhouette = false,
}: {
  branch: Branch;
  stage: number;
  auraColour: string;
  size?: number;
  /** Override the art (v2 map); defaults to the branch/stage lookup. */
  source?: ImageSourcePropType;
  /** The rotating sprite GIF (Tyson, 2026-07-16). An animated GIF is an
   *  ambient loop, so it obeys the SAME gate as every other loop: reduced
   *  motion or perf mode fall back to the static art. */
  animatedSource?: ImageSourcePropType;
  /** True = placeholder form: render as a rim-lit silhouette, never as art. */
  silhouette?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const animate = !reducedMotion && !perfMode;

  const floatY = useSharedValue(0);
  const breatheX = useSharedValue(1);
  const breatheY = useSharedValue(1);
  const auraOpacity = useSharedValue(0.42);
  const auraScale = useSharedValue(0.97);
  const groundOpacity = useSharedValue(0.5);
  const groundScale = useSharedValue(1);

  useEffect(() => {
    if (!animate) {
      floatY.value = 0;
      breatheX.value = 1;
      breatheY.value = 1;
      auraOpacity.value = 0.42;
      auraScale.value = 0.97;
      groundOpacity.value = 0.5;
      groundScale.value = 1;
      return;
    }
    const ease = Easing.bezier(...(animations.idleFloat.easing as readonly [number, number, number, number]));
    const half = animations.idleFloat.duration / 2; // 2300ms up, 2300ms down
    floatY.value = withRepeat(
      withSequence(withTiming(-8, { duration: half, easing: ease }), withTiming(0, { duration: half, easing: ease })),
      -1
    );
    breatheX.value = withRepeat(
      withSequence(withTiming(1.012, { duration: half, easing: ease }), withTiming(1, { duration: half, easing: ease })),
      -1
    );
    breatheY.value = withRepeat(
      withSequence(withTiming(0.992, { duration: half, easing: ease }), withTiming(1, { duration: half, easing: ease })),
      -1
    );
    const auraHalf = animations.auraPulse.duration / 2;
    auraOpacity.value = withRepeat(
      withSequence(withTiming(0.72, { duration: auraHalf, easing: ease }), withTiming(0.42, { duration: auraHalf, easing: ease })),
      -1
    );
    auraScale.value = withRepeat(
      withSequence(withTiming(1.06, { duration: auraHalf, easing: ease }), withTiming(0.97, { duration: auraHalf, easing: ease })),
      -1
    );
    const groundHalf = animations.groundPulse.duration / 2;
    groundOpacity.value = withRepeat(
      withSequence(withTiming(0.28, { duration: groundHalf, easing: ease }), withTiming(0.5, { duration: groundHalf, easing: ease })),
      -1
    );
    groundScale.value = withRepeat(
      withSequence(withTiming(0.86, { duration: groundHalf, easing: ease }), withTiming(1, { duration: groundHalf, easing: ease })),
      -1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }, { scaleX: breatheX.value }, { scaleY: breatheY.value }],
  }));
  const auraStyle = useAnimatedStyle(() => ({
    opacity: auraOpacity.value,
    transform: [{ scale: auraScale.value }],
  }));
  const groundStyle = useAnimatedStyle(() => ({
    opacity: groundOpacity.value,
    transform: [{ scaleX: groundScale.value }],
  }));

  const auraSize = size * 1.12;

  return (
    <View style={{ width: auraSize, height: auraSize + 18 }} className="items-center justify-end">
      {/* Aura: a radial glow behind the body, in the rarity colour. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            width: auraSize,
            height: auraSize,
            borderRadius: auraSize / 2,
            backgroundColor: `${auraColour}2e`,
            shadowColor: auraColour,
            shadowOpacity: 0.55,
            shadowRadius: 40,
            elevation: 12,
          },
          auraStyle,
        ]}
      />
      <Animated.View style={bodyStyle}>
        <Image
          source={
            animate && !silhouette && animatedSource ? animatedSource : (source ?? avatarImage(branch, stage))
          }
          tintColor={silhouette ? '#070d1a' : undefined}
          style={{
            // Sprite frames render at 1.35× (Tyson: "scale it up") and are
            // PUSHED DOWN by their measured bottom padding — every rotation
            // set carries ~24% transparent rows under the feet (measured
            // with PIL, 2026-07-16: mass 25%, aesthetic 22.6–25%), so
            // without the translate the character floats above the podium.
            // Crisp via pixelated (the sprite-avatar/coin-flip technique).
            ...(animate && !silhouette && animatedSource
              ? {
                  width: size * SPRITE_SCALE,
                  height: size * SPRITE_SCALE,
                  transform: [{ translateY: size * SPRITE_SCALE * SPRITE_BOTTOM_PAD }],
                  ...({ imageRendering: 'pixelated' } as object),
                }
              : { width: size, height: size }),
          }}
          contentFit="contain"
          accessibilityLabel={silhouette ? 'Unforged form silhouette' : 'Current form'}
        />
      </Animated.View>
      {/* Ground shadow counter-pulsing under the float. */}
      <Animated.View
        style={[
          {
            width: size * 0.55,
            height: 10,
            borderRadius: 8,
            backgroundColor: tokens.colors['bg-deep'],
          },
          groundStyle,
        ]}
      />
    </View>
  );
}

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

import type { Branch } from '@/domain/avatar-stats';
import { animations } from '@/theme/animations';
import tokens from '@/theme/tokens';
import { useSettingsStore } from '@/state/settings-store';

import { avatarImage } from './avatar-images';

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
}: {
  branch: Branch;
  stage: number;
  auraColour: string;
  size?: number;
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
          source={avatarImage(branch, stage)}
          style={{ width: size, height: size }}
          contentFit="contain"
          accessibilityLabel="Current form"
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

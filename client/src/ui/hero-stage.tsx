import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import type { Branch } from '@/domain/avatar-stats';
import { useToastStore } from '@/state/toast-store';
import { durations } from '@/theme/animations';
import tokens from '@/theme/tokens';

import { AvatarStage } from './avatar-stage';
import { avatarImage } from './avatar-images';
import { ParticleLayer } from './particle-layer';

/**
 * The character stage: not a card — a place. Layers, back to front:
 * spotlight radial · fog · holographic platform (SVG ellipses) · particles ·
 * the living AvatarStage (float/breathe/aura/ground) · floor reflection.
 *
 * REACTIVE: subscribes to the toast store and blooms the stage light whenever
 * an XP or achievement toast lands — the character visibly responds to every
 * real grant. No fake events: the bloom keys off the same store the real
 * reward pipeline feeds.
 */
export function HeroStage({
  branch,
  stage,
  auraColour,
  size = 240,
  source,
  silhouette = false,
}: {
  branch: Branch;
  stage: number;
  auraColour: string;
  size?: number;
  source?: import('react-native').ImageSourcePropType;
  silhouette?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const bloom = useSharedValue(0);
  const lastToastId = useRef(0);

  useEffect(() => {
    // Subscribe outside React render: bloom on every new xp/pr/achievement toast.
    const unsub = useToastStore.subscribe((state) => {
      const latest = state.toasts[state.toasts.length - 1];
      if (!latest || latest.id <= lastToastId.current) return;
      if (latest.kind === 'xp' || latest.kind === 'pr' || latest.kind === 'achievement') {
        lastToastId.current = latest.id;
        bloom.value = withSequence(
          withTiming(1, { duration: durations.micro, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: durations.reward })
        );
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bloomStyle = useAnimatedStyle(() => ({ opacity: 0.35 + bloom.value * 0.5 }));

  const stageHeight = size + 120;

  return (
    <View style={{ height: stageHeight }} className="items-center justify-end">
      {/* Spotlight — reacts to XP events. */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, bloomStyle]}
      >
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="spot" cx="50%" cy="42%" rx="55%" ry="48%">
              <Stop offset="0%" stopColor={auraColour} stopOpacity={0.34} />
              <Stop offset="60%" stopColor={auraColour} stopOpacity={0.10} />
              <Stop offset="100%" stopColor={auraColour} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx="50%" cy="42%" rx="55%" ry="48%" fill="url(#spot)" />
        </Svg>
      </Animated.View>

      <ParticleLayer colour={auraColour} height={stageHeight - 40} />

      {/* The living character (float/breathe/aura/ground loops live inside). */}
      <View style={{ zIndex: 2 }}>
        <AvatarStage branch={branch} stage={stage} auraColour={auraColour} size={size} source={source} silhouette={silhouette} />
      </View>

      {/* Holographic platform under the ground shadow. */}
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 26, left: 0, right: 0, alignItems: 'center' }}>
        <Svg width={size * 1.3} height={54}>
          <Defs>
            <RadialGradient id="plat" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor={auraColour} stopOpacity={0.28} />
              <Stop offset="70%" stopColor={auraColour} stopOpacity={0.08} />
              <Stop offset="100%" stopColor={auraColour} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx="50%" cy="50%" rx="49%" ry="34%" fill="url(#plat)" />
          <Ellipse cx="50%" cy="50%" rx="46%" ry="30%" fill="none" stroke={`${auraColour}55`} strokeWidth={1} />
          <Ellipse cx="50%" cy="50%" rx="34%" ry="21%" fill="none" stroke={`${auraColour}33`} strokeWidth={1} />
        </Svg>
      </View>

      {/* Floor reflection: the same render, flipped, fading into the floor. */}
      {!reducedMotion ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', bottom: -size * 0.32 + 26, alignItems: 'center', left: 0, right: 0, opacity: 0.16 }}
        >
          <Image
            source={source ?? avatarImage(branch, stage)}
            tintColor={silhouette ? '#070d1a' : undefined}
            style={{ width: size * 0.9, height: size * 0.9, transform: [{ scaleY: -1 }] }}
            contentFit="contain"
          />
          <LinearGradient
            colors={['rgba(4,7,14,0.35)', tokens.colors['bg-deep']]}
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
          />
        </View>
      ) : null}

      {/* Fog rising from the floor. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(4,7,14,0)', 'rgba(13,21,36,0.55)', 'rgba(4,7,14,0.9)']}
        style={{ position: 'absolute', bottom: 0, left: -20, right: -20, height: 64 }}
      />
    </View>
  );
}

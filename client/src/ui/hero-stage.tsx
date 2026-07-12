import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import type { Branch } from '@/domain/avatar-stats';
import { useToastStore } from '@/state/toast-store';
import { durations } from '@/theme/animations';

import { AvatarStage } from './avatar-stage';
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

  // The podium (Tyson, 2026-07-12): the character stands ON a sci-fi disc.
  // Its top face sits ~34% down the image, so the avatar's feet (and the
  // AvatarStage ground shadow) land on the deck, not float above it.
  const podiumW = size * 1.5;
  const podiumH = podiumW * (304 / 720);
  const stageHeight = size + Math.round(podiumH * 0.78) + 60;

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

      {/* THE PODIUM — the character's sci-fi display disc. Rendered art
          (assets/podium.png), replacing the old SVG hologram rings AND the
          flipped floor reflection (a mirror image through a solid deck read
          as a glitch; the disc's own neon does the grounding now). */}
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center' }}>
        <Image
          source={require('../assets/podium.png')}
          style={{ width: podiumW, height: podiumH }}
          contentFit="contain"
        />
      </View>

      {/* Character-coloured light pooling on the deck under the athlete. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', bottom: podiumH * 0.42, left: 0, right: 0, alignItems: 'center' }}
      >
        <Svg width={size * 1.1} height={44}>
          <Defs>
            <RadialGradient id="deckpool" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor={auraColour} stopOpacity={0.30} />
              <Stop offset="100%" stopColor={auraColour} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx="50%" cy="50%" rx="49%" ry="40%" fill="url(#deckpool)" />
        </Svg>
      </View>

      {/* The living character, feet on the deck (float/breathe/aura inside). */}
      <View style={{ zIndex: 2, marginBottom: Math.round(podiumH * 0.44) }}>
        <AvatarStage branch={branch} stage={stage} auraColour={auraColour} size={size} source={source} silhouette={silhouette} />
      </View>

      {/* Fog rising from the floor. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(4,7,14,0)', 'rgba(13,21,36,0.55)', 'rgba(4,7,14,0.9)']}
        style={{ position: 'absolute', bottom: 0, left: -20, right: -20, height: 64 }}
      />
    </View>
  );
}

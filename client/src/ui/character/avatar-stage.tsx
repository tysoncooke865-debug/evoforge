import { Image } from 'expo-image';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import type { ImageSourcePropType } from 'react-native';

import type { Branch } from '@/domain/avatar-stats';
import { animations } from '@/theme/animations';
import { useThemeColors } from '@/theme/use-theme';

import { useAmbient } from '@/ui/core/use-ambient';

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
  stillSource,
  silhouette = false,
}: {
  branch: Branch;
  stage: number;
  auraColour: string;
  size?: number;
  /** Override the art (v2 map); defaults to the branch/stage lookup. */
  source?: ImageSourcePropType;
  /** The rotating sprite GIF (Tyson, 2026-07-16). An animated GIF is an
   *  ambient loop, so it obeys the SAME gate as every other loop. */
  animatedSource?: ImageSourcePropType;
  /** The rotation's FROZEN south pose — shown whenever the sprite exists
   *  but motion is gated (unfocused/reduced/perf). Same canvas as the gif
   *  so nothing jumps; the OLD painted art never flashes. */
  stillSource?: ImageSourcePropType;
  /** True = placeholder form: render as a rim-lit silhouette, never as art. */
  silhouette?: boolean;
}) {
  const colors = useThemeColors();
  // PERF: focus-aware — a preloaded hidden tab's stage runs NO loops and
  // serves the STATIC art instead of the gif (use-ambient.ts).
  const animate = useAmbient();
  // The sprite, in whichever state motion allows: rotating when ambient,
  // its frozen south pose otherwise. Painted art only when NO sprite set.
  const spriteSource = silhouette ? undefined : animate ? animatedSource : stillSource;

  const floatY = useSharedValue(0);
  const breatheX = useSharedValue(1);
  const breatheY = useSharedValue(1);
  const auraOpacity = useSharedValue(0.42);
  const auraScale = useSharedValue(0.97);

  useEffect(() => {
    if (!animate) {
      floatY.value = 0;
      breatheX.value = 1;
      breatheY.value = 1;
      auraOpacity.value = 0.42;
      auraScale.value = 0.97;
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
    // The ground shadow is no longer an independent pulse — it is DRIVEN by the
    // float below (groundStyle), so it tightens and lightens as the champion
    // rises and spreads as it lands. A real cast shadow, not a loose loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }, { scaleX: breatheX.value }, { scaleY: breatheY.value }],
  }));
  const auraStyle = useAnimatedStyle(() => ({
    opacity: auraOpacity.value,
    transform: [{ scale: auraScale.value }],
  }));
  // Contact shadow physics: t = how high the champion floats (0 grounded → 1 at
  // the -8px peak). Higher = a smaller, softer, lighter patch — light falls off
  // as the feet leave the deck. Grounded (or motion-gated) → full, dark, wide.
  const groundStyle = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, -floatY.value / 8));
    return {
      opacity: 0.62 - 0.34 * t,
      transform: [{ scaleX: 1 - 0.14 * t }, { scaleY: 1 - 0.24 * t }],
    };
  });

  const auraSize = size * 1.12;
  // Tyson (2026-07-16): each stage GROWS the avatar by 5% — evolution is
  // visible in stature, not just art. Stage 1 = base, stage 4 = +15%.
  const growth = 1 + 0.05 * (Math.max(1, Math.min(4, Math.trunc(stage))) - 1);
  // The shadow's footprint tracks the champion's actual size (bigger evolved
  // forms cast a bigger shadow). Width scales with growth; the ellipse is
  // squashed to ~1/3 height for a floor-plane read.
  const shadowW = Math.round(size * 0.66 * growth);
  const shadowH = Math.round(shadowW * 0.34);

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
          source={spriteSource ?? source ?? avatarImage(branch, stage)}
          tintColor={silhouette ? '#070d1a' : undefined}
          style={{
            // Sprite frames render at 1.35× (Tyson: "scale it up") and are
            // PUSHED DOWN by their measured bottom padding — every rotation
            // set carries ~24% transparent rows under the feet (measured
            // with PIL, 2026-07-16: mass 25%, aesthetic 22.6–25%), so
            // without the translate the character floats above the podium.
            // The STILL pose shares the canvas and therefore the layout —
            // gating motion never jumps or swaps bodies.
            ...(spriteSource
              ? {
                  width: size * SPRITE_SCALE * growth,
                  height: size * SPRITE_SCALE * growth,
                  transform: [{ translateY: size * SPRITE_SCALE * growth * SPRITE_BOTTOM_PAD }],
                  ...({ imageRendering: 'pixelated' } as object),
                }
              : { width: size * growth, height: size * growth }),
          }}
          contentFit="contain"
          accessibilityLabel={silhouette ? 'Unforged form silhouette' : 'Current form'}
        />
      </Animated.View>
      {/* Contact shadow: a soft radial ellipse (feathered, not a flat blob),
          cored in bg-deep with a faint rim in the champion's OWN aura colour —
          unique per avatar. Layout footprint pinned to ~14px (the SVG overflows
          symmetrically via absolute centring) so a taller shadow never lifts the
          champion off the podium; the transform in groundStyle animates it. */}
      <Animated.View
        pointerEvents="none"
        style={[{ width: shadowW, height: 14, alignItems: 'center', justifyContent: 'center' }, groundStyle]}
      >
        <View style={{ position: 'absolute' }}>
          <Svg width={shadowW} height={shadowH}>
            <Defs>
              <RadialGradient id="groundcore" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0%" stopColor={colors['bg-deep']} stopOpacity={0.9} />
                <Stop offset="52%" stopColor={colors['bg-deep']} stopOpacity={0.5} />
                <Stop offset="100%" stopColor={colors['bg-deep']} stopOpacity={0} />
              </RadialGradient>
              <RadialGradient id="groundrim" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="55%" stopColor={auraColour} stopOpacity={0} />
                <Stop offset="86%" stopColor={auraColour} stopOpacity={0.3} />
                <Stop offset="100%" stopColor={auraColour} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Ellipse cx={shadowW / 2} cy={shadowH / 2} rx={shadowW / 2} ry={shadowH / 2} fill="url(#groundcore)" />
            <Ellipse cx={shadowW / 2} cy={shadowH / 2} rx={shadowW / 2} ry={shadowH / 2} fill="url(#groundrim)" />
          </Svg>
        </View>
      </Animated.View>
    </View>
  );
}

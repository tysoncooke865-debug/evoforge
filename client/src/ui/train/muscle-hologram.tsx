/**
 * THE MUSCLE HOLOGRAM (2026-08-03, TRAIN brief) — "The muscle visual is
 * excellent. Bring it to life."
 *
 * The figure itself is untouched: MuscleMap still draws Tyson's permanent base
 * art with his Krita masks over it, and this adds only the RIG AROUND IT —
 * a blueprint grid, an ambient bloom under the lit regions, a scan line that
 * travels the figure, and corner brackets. It reads as a readout of the
 * athlete's own body rather than a picture on a card, which is the whole ask.
 *
 * ---- ONE DRIVER, AND ONLY FOR TODAY ----
 *
 * Each lit muscle already runs its own pulse loop inside MuscleMap, and the
 * day carousel keeps ~3 cards mounted. Adding an ambient loop per card would
 * have tripled this rig's cost for two cards nobody is looking at, so the
 * loop is gated on `alive` (today's card only) and everything else — grid,
 * bloom, brackets — is static geometry. The scan, the bloom breath and the
 * bracket flicker all derive from ONE 5.5-second clock inside worklets.
 *
 * ---- THE POWER-ON ----
 *
 * `intro` is the Train page's shared entrance clock (see mission-brief.tsx).
 * The hologram takes the 0.30–0.62 window of it: the grid fades up, the figure
 * resolves from 92% scale, and a single fast scan runs down it. That is the
 * brief's "muscle hologram powers on", and it costs no driver of its own.
 */

import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, Line, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { MapFocus, MuscleId, MuscleView } from '@/domain/muscle-map';
import { useThemeColors } from '@/theme/use-theme';
import { DECORATIVE } from '@/ui/home/evo-emblem';
import { MuscleMap } from '@/ui/muscle-map/muscle-map';

/** The intro window this rig owns, as fractions of the page's entrance clock. */
const IN_FROM = 0.3;
const IN_TO = 0.62;

/** 0 outside [a,b], 0→1 across it. Worklet-safe (no closures over objects). */
const seg = (t: number, a: number, b: number): number => {
  'worklet';
  return Math.max(0, Math.min(1, (t - a) / (b - a)));
};

export const MuscleHologram = memo(function MuscleHologram({
  muscles,
  view,
  focus,
  width,
  height,
  alive,
  intro,
  clock,
  onFlip,
  onMusclePress,
  testID = 'map-rotate',
}: {
  muscles: readonly MuscleId[];
  view: MuscleView;
  focus: MapFocus;
  /** The figure's own width inside the box. */
  width: number;
  /** The fixed box the figure is cropped into. */
  height: number;
  /** Run the ambient scan — TODAY's card only (see the driver note above). */
  alive: boolean;
  /** The page's entrance clock, 0→1. */
  intro: SharedValue<number>;
  /** The page's ambient clock, 0→1 on a 5.5s repeat. */
  clock: SharedValue<number>;
  onFlip: () => void;
  /** Tapping a LIT muscle opens its detail; tapping anywhere else flips. */
  onMusclePress?: (muscle: MuscleId) => void;
  testID?: string;
}) {
  const colors = useThemeColors();

  // The whole rig arrives together: fade + a 92% → 100% resolve.
  const powerOn = useAnimatedStyle(() => {
    const p = seg(intro.value, IN_FROM, IN_TO);
    return { opacity: p, transform: [{ scale: 0.92 + p * 0.08 }] };
  });

  // The scan: a soft band that crosses the figure once per revolution of the
  // shared clock, present for only the first 38% of it. A band that is always
  // on screen reads as a scrolling texture; one that arrives, passes and
  // leaves reads as a scan.
  const scan = useAnimatedStyle(() => {
    const p = clock.value / 0.38;
    if (p > 1) return { opacity: 0, transform: [{ translateY: -40 }] };
    return {
      opacity: Math.sin(p * Math.PI) * 0.5,
      transform: [{ translateY: -40 + p * (height + 60) }],
    };
  });

  // The bloom under the lit regions breathes on the same clock, a full cycle
  // behind the scan so the two never peak together.
  const bloom = useAnimatedStyle(() => ({
    opacity: 0.32 + Math.sin(clock.value * Math.PI * 2) * 0.12,
    transform: [{ scale: 1 + Math.sin(clock.value * Math.PI * 2) * 0.04 }],
  }));

  return (
    <Pressable
      onPress={onFlip}
      accessibilityRole="button"
      accessibilityLabel={`show ${view === 'front' ? 'back' : 'front'} view`}
      testID={testID}
      // STRETCH, CAPPED — not a fixed height. The card's own height is a fixed
      // budget (the equal-cards rule) and the blocks below this one GROW when a
      // set is logged: with a hard height the figure could not give any of its
      // space back and the rewards block was pushed under the card's clip on a
      // compact screen. It now yields down to two thirds, and the crop it
      // already runs makes losing the edges harmless.
      style={{
        width: '40%',
        alignSelf: 'stretch',
        maxHeight: height,
        minHeight: Math.round(height * 0.66),
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* THE BLUEPRINT — static geometry, drawn once, never animated. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} {...DECORATIVE}>
        <Svg width="100%" height="100%" viewBox="0 0 100 140" preserveAspectRatio="none">
          <Defs>
            {/* Peak 0.18, not 0.10: at a tenth on a 0.4-wide stroke the grid
                was invisible in the built export, which is a layer that costs
                nodes and returns nothing. Tuned against the real art, per the
                derived-colour rule. */}
            <LinearGradient id="holo-fade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={colors.accent} stopOpacity={0} />
              <Stop offset="35%" stopColor={colors.accent} stopOpacity={0.18} />
              <Stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {[20, 40, 60, 80].map((x) => (
            <Line key={`v${x}`} x1={x} y1={0} x2={x} y2={140} stroke="url(#holo-fade)" strokeWidth={0.55} />
          ))}
          {[20, 47, 74, 101, 128].map((y) => (
            <Line key={`h${y}`} x1={0} y1={y} x2={100} y2={y} stroke="url(#holo-fade)" strokeWidth={0.55} />
          ))}
        </Svg>
      </View>

      <Animated.View
        style={[
          { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
          powerOn,
        ]}
      >
        {/* AMBIENT BLOOM — a soft disc behind the figure so the lit muscles
            sit in light rather than on black. Under the figure, above the
            grid, and never over the art. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: width * 1.1,
              height: width * 1.1,
              borderRadius: width * 0.55,
              backgroundColor: 'rgba(34, 211, 238, 0.07)',
              shadowColor: colors.accent,
              shadowOpacity: 0.5,
              shadowRadius: 34,
            },
            bloom,
          ]}
        />

        <MuscleMap
          selectedMuscles={muscles}
          view={view}
          width={width}
          pulse
          focus={focus}
          interactive={onMusclePress !== undefined}
          onMusclePress={onMusclePress}
        />

        {/* THE SCAN — one band, pointerEvents off so it can never eat the tap
            that flips the figure (the overflowing-box lesson). */}
        {alive ? (
          <Animated.View
            pointerEvents="none"
            style={[{ position: 'absolute', left: 0, right: 0, height: 40 }, scan]}
          >
            <Svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
              <Defs>
                <LinearGradient id="holo-scan" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor={colors.accent} stopOpacity={0} />
                  <Stop offset="70%" stopColor={colors.accent} stopOpacity={0.16} />
                  <Stop offset="88%" stopColor={colors.accent} stopOpacity={0.6} />
                  <Stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width={100} height={40} fill="url(#holo-scan)" />
            </Svg>
          </Animated.View>
        ) : null}
      </Animated.View>

      {/* HUD BRACKETS — the frame the readout sits in. Four corners, static. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} {...DECORATIVE}>
        {([
          { top: 0, left: 0, borderTopWidth: 1, borderLeftWidth: 1 },
          { top: 0, right: 0, borderTopWidth: 1, borderRightWidth: 1 },
          { bottom: 0, left: 0, borderBottomWidth: 1, borderLeftWidth: 1 },
          { bottom: 0, right: 0, borderBottomWidth: 1, borderRightWidth: 1 },
        ] as const).map((corner, i) => (
          <View
            key={i}
            style={{ position: 'absolute', width: 12, height: 12, borderColor: `${colors.accent}4d`, ...corner }}
          />
        ))}
      </View>

      {/* The flip affordance. Small, quiet, and it says which way it turns —
          the old bare Pressable gave no hint that the figure had two sides.
          CENTRED at the foot rather than tucked into a corner: at bottom-right
          it sat on top of the bracket and the two read as one broken shape. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', bottom: 2, left: 0, right: 0, alignItems: 'center' }}
      >
        <View
          style={{
            paddingHorizontal: 5,
            paddingVertical: 2,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: `${colors.accent}40`,
            backgroundColor: 'rgba(2,5,11,0.55)',
          }}
        >
          <Text allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 0.5, color: colors.accent }}>
            {view === 'front' ? '⟳ BACK' : '⟳ FRONT'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

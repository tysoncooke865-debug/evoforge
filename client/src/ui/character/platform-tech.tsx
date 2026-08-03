/**
 * THE PODIUM'S TECH LAYER (PREMIUM PASS, 2026-08-03).
 *
 * The brief: "the platform should feel like advanced technology — rotating
 * rings, light sweeps, tiny LEDs, animated reflections, without hurting
 * performance." The podium itself is rendered art (assets/podium.png) and does
 * not change; this draws the LIVE parts on top of its deck.
 *
 * ONE ANIMATION DRIVER FOR FOUR EFFECTS. On web every Reanimated loop runs on
 * the main JS thread (the "everything lags" rule), so the cost that matters is
 * the number of DRIVERS, not the number of moving things. A single 12s linear
 * clock feeds all four worklets:
 *
 *   RING    rotates continuously — one revolution per loop.
 *   SWEEP   crosses the deck once, in the first 22% of the loop. The other
 *           ~9s is stillness, so it reads as "the deck scans" rather than a
 *           strobe.
 *   LEDS    three rim lights, phase-offset off the same clock, so they chase
 *           rather than blink in unison.
 *   SPARK   one ember rises off the rim in the last 18%. Once every 12s is
 *           "occasional"; more often is a campfire.
 *
 * THE RING IS ROTATED IN CIRCLE-SPACE, THEN SQUASHED. `[{scaleY}, {rotate}]`
 * composes right-to-left, so the ticks spin as a true circle and the whole
 * thing is flattened into the deck's plane afterwards. Squashing first and
 * rotating after would swing the ellipse like a coin on a table, which is the
 * one thing that would make the podium read as a sticker.
 *
 * Gated by `useAmbient` at the caller (it renders nothing when motion is off),
 * decorative to screen readers, and `pointerEvents="none"` throughout — the
 * champion above it must keep every tap.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';

import { useThemeColors } from '@/theme/use-theme';
import { DECORATIVE } from '@/ui/home/evo-emblem';
import { useAmbient } from '@/ui/core/use-ambient';

/** The deck's perspective squash — the podium art's own top face proportion. */
const DECK_SQUASH = 0.34;
const TICKS = 18;
const SWEEP_WINDOW = 0.22;
const SPARK_WINDOW = 0.18;

export const PlatformTech = memo(function PlatformTech({
  /** The podium image's rendered width; the deck is a fraction of it. */
  podiumWidth,
}: {
  podiumWidth: number;
}) {
  const ambient = useAmbient();
  // THE DECK IS CYAN, NOT THE AURA COLOUR (fixed after the first browser
  // tour). Drawing the machinery in the champion's rarity colour meant a
  // COMMON athlete got a #94a3b8 grey ring at 0.2 opacity on a purple-lit
  // disc — measured on the real build, and completely invisible. The podium
  // art's own rim light is cyan, so the accent is both the visible choice and
  // the coherent one: the ring reads as the same machine the art already
  // draws, and the aura stays the champion's alone.
  const colour = useThemeColors().accent;
  const t = useSharedValue(0);

  useEffect(() => {
    if (!ambient) {
      t.value = 0;
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 12000, easing: Easing.linear }), -1);
  }, [ambient, t]);

  // The ring sits inside the disc's top face, clear of its lit rim.
  const ringW = Math.round(podiumWidth * 0.54);
  const deckH = Math.round(ringW * DECK_SQUASH);
  const sweepW = Math.round(podiumWidth * 0.66);
  const sweepH = Math.round(sweepW * DECK_SQUASH);
  const BAR = Math.round(sweepW * 0.28);
  const boxH = Math.max(deckH, sweepH) + 4;

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: DECK_SQUASH }, { rotate: `${t.value * 360}deg` }],
  }));

  const sweepStyle = useAnimatedStyle(() => {
    const p = t.value / SWEEP_WINDOW;
    if (p > 1) return { opacity: 0, transform: [{ translateX: -BAR }] };
    return {
      opacity: Math.sin(p * Math.PI) * 0.85,
      transform: [{ translateX: -BAR + p * (sweepW + BAR) }],
    };
  });

  const sparkStyle = useAnimatedStyle(() => {
    const p = (t.value - (1 - SPARK_WINDOW)) / SPARK_WINDOW;
    if (p < 0) return { opacity: 0 };
    return {
      opacity: (1 - p) * 0.9,
      transform: [{ translateY: -p * 30 }, { scale: 1 - p * 0.5 }],
    };
  });

  if (!ambient) return null;

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, alignItems: 'center', justifyContent: 'flex-end' }}
      {...DECORATIVE}
    >
      {/* Anchored to the DISC'S TOP FACE, which hero-stage.tsx measures at
          ~36% down the podium image: podiumH = podiumW × 385/720, so the face
          sits 0.64 × 0.535 ≈ 0.342 × podiumW up from the stage floor. The box
          is centred on that, which is also where the champion's feet land. */}
      <View style={{ position: 'absolute', bottom: Math.round(podiumWidth * 0.342 - boxH / 2), alignItems: 'center', justifyContent: 'center', height: boxH, width: podiumWidth }}>
        {/* ROTATING INNER RING */}
        <Animated.View style={[{ position: 'absolute', width: ringW, height: ringW }, ringStyle]}>
          <Svg width={ringW} height={ringW} viewBox="0 0 100 100">
            {/* Opacities are tuned against the REAL podium art, not a blank
                canvas: the disc's top face is a mid-value purple, so anything
                under ~0.3 disappears into it. */}
            <Circle cx={50} cy={50} r={44} stroke={colour} strokeOpacity={0.4} strokeWidth={1.2} fill="none" />
            <Circle cx={50} cy={50} r={31} stroke={colour} strokeOpacity={0.2} strokeWidth={1} fill="none" />
            {Array.from({ length: TICKS }, (_, i) => {
              const a = ((i / TICKS) * 360 * Math.PI) / 180;
              // Every third tick is a long one — a machined index mark.
              const long = i % 3 === 0;
              const r1 = long ? 34 : 39;
              return (
                <Line
                  key={i}
                  x1={50 + r1 * Math.cos(a)}
                  y1={50 + r1 * Math.sin(a)}
                  x2={50 + 46 * Math.cos(a)}
                  y2={50 + 46 * Math.sin(a)}
                  stroke={colour}
                  strokeOpacity={long ? 0.85 : 0.4}
                  strokeWidth={long ? 2.4 : 1.4}
                />
              );
            })}
          </Svg>
        </Animated.View>

        {/* LIGHT SWEEP — clipped to the deck's footprint so it never spills
            off the disc and onto the page background. */}
        <View
          className="overflow-hidden"
          style={{ position: 'absolute', width: sweepW, height: sweepH, borderRadius: sweepH / 2 }}
        >
          <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: BAR }, sweepStyle]}>
            <LinearGradient
              colors={['rgba(103,232,249,0)', 'rgba(103,232,249,0.34)', 'rgba(103,232,249,0)']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ flex: 1 }}
            />
          </Animated.View>
        </View>

        {/* RIM LEDS — three, chasing. */}
        {[-0.42, 0, 0.42].map((offset, i) => (
          <Led key={i} t={t} phase={i} colour={colour} x={Math.round(sweepW * offset)} y={Math.round(sweepH * 0.42)} />
        ))}

        {/* THE OCCASIONAL SPARK, off the left rim. */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: Math.round(podiumWidth * 0.5 - sweepW * 0.34),
              bottom: 2,
              width: 3,
              height: 3,
              backgroundColor: colour,
              shadowColor: colour,
              shadowOpacity: 0.9,
              shadowRadius: 5,
            },
            sparkStyle,
          ]}
        />
      </View>
    </View>
  );
});

/** One rim light. Its brightness is a phase-shifted cosine off the shared
 *  clock — four beats per revolution, so the three chase each other. */
function Led({
  t,
  phase,
  colour,
  x,
  y,
}: {
  t: { value: number };
  phase: number;
  colour: string;
  x: number;
  y: number;
}) {
  const style = useAnimatedStyle(() => {
    const wave = (1 - Math.cos(t.value * Math.PI * 8 - phase * 1.6)) / 2;
    return { opacity: 0.25 + wave * 0.65 };
  });
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          transform: [{ translateX: x }, { translateY: y }],
          width: 2.5,
          height: 2.5,
          backgroundColor: colour,
          shadowColor: colour,
          shadowOpacity: 0.9,
          shadowRadius: 4,
        },
        style,
      ]}
    />
  );
}

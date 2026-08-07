import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * THE COMPLETION MOMENT on Home's mission card.
 *
 * The card already SAID "MISSION COMPLETE · 16 sets · +160 XP banked". It
 * said it instantly and flatly, which is the difference between being told
 * you were paid and watching it land. Everything here is a ONE-SHOT on the
 * numbers that were already true — no new information, no new card, no
 * decision to make.
 *
 * ONE-SHOTS ARE NEVER PERF-GATED (the animations.ts doctrine): performance
 * mode kills ambient loops, not the single beat that makes a reward feel
 * earned. REDUCED MOTION pins everything arrived and readable — the athlete
 * still sees the final number, immediately.
 *
 * Deliberately restrained: a tick, a count, a bar and six sparks that leave.
 * The brief's own rule is that losing should never feel punishing and winning
 * should never feel like a slot machine, and this is a workout, not a jackpot.
 */

/** Six sparks on a fixed ring — no randomness, so the beat is identical every
 *  time and can never draw the eye somewhere different on a re-render. */
const SPARKS = [
  { dx: -26, dy: -16 },
  { dx: -14, dy: -26 },
  { dx: 12, dy: -27 },
  { dx: 26, dy: -14 },
  { dx: 20, dy: 12 },
  { dx: -20, dy: 14 },
] as const;

export function MissionCompleteFlourish({
  sets,
  targetSets,
  xp,
  testID,
}: {
  sets: number;
  targetSets: number;
  xp: number;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();

  // ONE driver for the tick, the bar, the sparks and the count's window.
  const beat = useSharedValue(reduced ? 1 : 0);
  // `counted` is ONLY ever written from rAF. Reduced motion is DERIVED, not
  // set — `react-hooks/set-state-in-effect` is an error in this repo, and a
  // synchronous setState in an effect is a cascading render even when it
  // happens to look harmless.
  const [counted, setCounted] = useState(0);
  const shownXp = reduced ? xp : counted;

  useEffect(() => {
    if (reduced) {
      beat.value = 1;
      return;
    }
    beat.value = 0;
    beat.value = withDelay(120, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));

    // The count rides rAF, never a clock read — the first frame timestamp IS
    // the start, so a statically prerendered tree has nothing to mismatch on.
    if (xp <= 0) return;
    let raf = 0;
    let start = 0;
    const step = (now: number) => {
      if (start === 0) start = now;
      const p = Math.min(1, (now - start) / 900);
      // Ease-out so it decelerates into the real figure rather than snapping.
      setCounted(Math.round(xp * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduced, xp, beat]);

  const tickStyle = useAnimatedStyle(() => {
    if (reduced) return { transform: [{ scale: 1 }], opacity: 1 };
    // A single overshoot: 0 → 1.18 → 1, inside the first third of the beat.
    const p = Math.min(1, beat.value / 0.34);
    const overshoot = Math.sin(p * Math.PI) * 0.18;
    return { transform: [{ scale: p * 1 + overshoot }], opacity: p };
  });

  const barStyle = useAnimatedStyle(() => {
    const pct = targetSets > 0 ? Math.min(100, (sets / targetSets) * 100) : sets > 0 ? 100 : 0;
    return { width: `${pct * beat.value}%` };
  });

  return (
    <View testID={testID}>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
          {/* The sparks leave; the tick stays. */}
          {!reduced
            ? SPARKS.map((s, i) => <Spark key={i} beat={beat} dx={s.dx} dy={s.dy} index={i} />)
            : null}
          <Animated.Text
            allowFontScaling={false}
            style={[{ fontSize: 15, color: colors.success }, tickStyle]}
          >
            ✓
          </Animated.Text>
        </View>
        <Text
          className="text-2xs font-bold"
          style={{ letterSpacing: 2, color: colors.success }}
          testID="mission-complete-label"
        >
          MISSION COMPLETE
        </Text>
        <View style={{ flex: 1 }} />
        {xp > 0 ? (
          <Text
            allowFontScaling={false}
            testID="mission-complete-xp"
            accessibilityLabel={`${xp} XP banked`}
            style={{ fontSize: 15, letterSpacing: 0, color: colors.accent, ...pixelFont() }}
          >
            +{shownXp} XP
          </Text>
        ) : null}
      </View>

      {/* The sets bar fills to what was actually done. */}
      <View
        className="mt-s2 overflow-hidden rounded-pill"
        style={{ height: 4, backgroundColor: colors['surface-3'] }}
      >
        <Animated.View
          style={[
            { height: '100%', borderRadius: 999, backgroundColor: colors.success },
            barStyle,
          ]}
        />
      </View>
    </View>
  );
}

/** One spark: out from the tick, then gone. Staggered so they scatter. */
function Spark({
  beat,
  dx,
  dy,
  index,
}: {
  beat: { value: number };
  dx: number;
  dy: number;
  index: number;
}) {
  const colors = useThemeColors();
  const style = useAnimatedStyle(() => {
    const start = 0.08 + index * 0.03;
    const p = Math.max(0, Math.min(1, (beat.value - start) / 0.5));
    return {
      opacity: p === 0 || p === 1 ? 0 : Math.sin(p * Math.PI) * 0.9,
      transform: [{ translateX: dx * p }, { translateY: dy * p }, { scale: 1 - p * 0.4 }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: 3,
          height: 3,
          borderRadius: 2,
          backgroundColor: index % 2 === 0 ? colors.success : colors.accent,
        },
        style,
      ]}
    />
  );
}

/** The CTA breathes once when the card first shows a completed mission — a
 *  single invitation to look at the summary, not a loop. */
export function useCompletionPulse(active: boolean) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!active || reduced) {
      pulse.value = 0;
      return;
    }
    pulse.value = withDelay(
      900,
      withSequence(
        withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 520, easing: Easing.inOut(Easing.quad) })
      )
    );
  }, [active, reduced, pulse]);
  return useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.value * 0.02 }] }));
}

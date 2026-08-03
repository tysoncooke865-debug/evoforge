/**
 * ENTERING MISSION (2026-08-03, TRAIN brief) — the veil between tapping START
 * WORKOUT and the logging page.
 *
 * ---- THE CONFLICT THIS RESOLVES ----
 *
 * The brief asks for two things that pull against each other: "Transition into
 * 'Entering Mission…' before opening workout logging", and "Optimise
 * relentlessly for reducing time-to-first-set." A transition that DELAYS
 * navigation would trade the second for the first, and the second is the one
 * that decides whether a workout happens.
 *
 * So it does not delay anything. `router.push` fires on the same frame this
 * appears; the veil exists to COVER the stall that is already there (the
 * /workout route's chunk, its plan resolution, its first paint) rather than to
 * add one. If navigation is instant the athlete sees a 200ms flash of
 * intention; if it is slow they see a mission launching instead of a frozen
 * card. Either way the first set is no further away than it was.
 *
 * ---- WHY IT IS NOT A MODAL ----
 *
 * It renders inside the Train screen's own view tree (ScreenShell `overlay`),
 * which the pushed /workout screen draws OVER. A Modal would have floated above
 * the new page and had to be raced off it. The Train tab stays mounted behind
 * the push, so the caller also clears this on blur — belt and brace.
 */

import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

const RUN_MS = 620;

export function MissionLaunch({ workout }: { workout: string }) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  // A ONE-SHOT: never perf-gated (the animations doctrine), and reduced motion
  // pins it fully open rather than removing the cover it exists to provide.
  const t = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    t.value = withTiming(1, { duration: RUN_MS, easing: Easing.out(Easing.cubic) });
  }, [reduced, t]);

  const veil = useAnimatedStyle(() => ({ opacity: Math.min(1, t.value * 6) }));
  const label = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, (t.value - 0.12) / 0.45));
    return { opacity: p, transform: [{ scale: 0.94 + p * 0.06 }] };
  });
  const bar = useAnimatedStyle(() => ({ width: `${Math.min(100, t.value * 118)}%` as `${number}%` }));

  return (
    <Animated.View
      pointerEvents="auto"
      testID="mission-launch"
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(2,5,11,0.92)',
        },
        veil,
      ]}
    >
      <Animated.View style={[{ alignItems: 'center', paddingHorizontal: 32 }, label]}>
        {/* The bracket — machined, not a spinner. A spinner says "waiting"; a
            frame closing around a name says "loading a mission". */}
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <View style={{ width: 10, height: 10, borderLeftWidth: 2, borderTopWidth: 2, borderColor: colors.accent }} />
          <Text
            allowFontScaling={false}
            style={{
              fontSize: 15,
              letterSpacing: 2,
              color: colors.accent,
              textShadowColor: `${colors.accent}99`,
              textShadowRadius: 16,
              ...pixelFont(),
            }}
          >
            ENTERING MISSION
          </Text>
          <View style={{ width: 10, height: 10, borderRightWidth: 2, borderBottomWidth: 2, borderColor: colors.accent }} />
        </View>
        <Text
          className="mt-s2 text-text"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 22, letterSpacing: 0, ...pixelFont() }}
        >
          {workout.toUpperCase()}
        </Text>
        <View
          className="mt-s3 overflow-hidden rounded-pill"
          style={{ width: 180, height: 4, backgroundColor: colors['surface-3'] }}
        >
          <Animated.View
            style={[
              { height: '100%', borderRadius: 999, backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.8, shadowRadius: 8 },
              bar,
            ]}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The Reforge Day door on Home (docs/ONBOARDING_V3_SPEC.md §7).
 *
 * TWO STATES, and the gap between them is the point (2026-08-07):
 *
 *   DUE       a legendary chest. Gold, a border that travels, the numeral of
 *             the cycle, one button. It should be the second thing the eye
 *             lands on after the mission, because it is the only other thing
 *             on the page with a deadline.
 *   NOT DUE   ONE LINE. Not a card, not a progress bar, not a countdown with
 *             its own heading — a permanent countdown turns a ceremony into a
 *             chore, and everything that moves in between (strength, PRs, XP,
 *             the streak) already has a place on this page.
 *
 * It used to render nothing at all between Reforges. A quiet line is better:
 * an athlete who has never seen one has no idea it is coming, and the whole
 * value of a 28-day ceremony is anticipating it.
 */

import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReforgeDay } from '@/data/progression/use-reforge-day';
import { REFORGE_CYCLE_DAYS } from '@/domain/progression/reforge-day';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';
import { useAmbient } from '@/ui/core/use-ambient';

export function ReforgeDayCard({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const ambient = useAmbient();
  const { cadence, ready } = useReforgeDay();

  // ONE ambient driver for both the border sweep and the seal's breath, so the
  // chest costs a single value on the UI thread rather than three.
  const shimmer = useSharedValue(0);
  useEffect(() => {
    if (!ambient) {
      shimmer.value = 0;
      return;
    }
    shimmer.value = 0;
    shimmer.value = withRepeat(withTiming(1, { duration: 3800, easing: Easing.linear }), -1);
  }, [ambient, shimmer]);

  // The border's highlight travels around the card. Gold, low contrast — a
  // chest that is worth opening, not a notification demanding to be dismissed.
  const borderStyle = useAnimatedStyle(() => {
    if (reduced) return { opacity: 0.55 };
    const wave = (1 - Math.cos(shimmer.value * Math.PI * 2)) / 2;
    return { opacity: 0.3 + wave * 0.45 };
  });
  const sealStyle = useAnimatedStyle(() => {
    if (reduced) return { transform: [{ scale: 1 }] };
    const wave = (1 - Math.cos(shimmer.value * Math.PI * 2)) / 2;
    return { transform: [{ scale: 1 + wave * 0.05 }] };
  });

  if (!ready) return null;

  // ── NOT DUE: one quiet line, and only once a cycle has actually started. ──
  if (!cadence.due) {
    if (!cadence.started) return null;
    return (
      <Pressable
        onPress={() => router.push('/reforge' as never)}
        accessibilityRole="button"
        accessibilityLabel={`Reforge Day in ${cadence.daysUntil} days. Opens Reforge Day.`}
        testID={testID}
        style={{ minHeight: 32, justifyContent: 'center' }}
      >
        <Text
          className="text-2xs text-text-mute"
          numberOfLines={1}
          testID="reforge-countdown"
          style={{ letterSpacing: 0.6 }}
        >
          ✦ Reforge Day in {cadence.daysUntil} {cadence.daysUntil === 1 ? 'day' : 'days'} ·
          day {cadence.dayOfCycle} of {REFORGE_CYCLE_DAYS}
        </Text>
      </Pressable>
    );
  }

  // ── DUE: the chest. ──
  return (
    <View testID={testID}>
      <GlowCard glow={colors.legendary} padding={16}>
        {/* The travelling highlight sits INSIDE the card as an overlay border,
            so it cannot affect layout or push the mission off the fold. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: colors.legendary,
            },
            borderStyle,
          ]}
        />
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Animated.Text allowFontScaling={false} style={[{ fontSize: 22 }, sealStyle]}>
            ✦
          </Animated.Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              allowFontScaling={false}
              style={{ fontSize: 10, letterSpacing: 2, color: colors.legendary, ...pixelFont(false) }}
            >
              REFORGE DAY
            </Text>
            <Text
              className="mt-s1 text-text"
              allowFontScaling={false}
              numberOfLines={1}
              style={{ fontSize: 16, letterSpacing: 0, ...pixelFont() }}
            >
              {cadence.isFirst ? 'YOUR FIRST REFORGE' : `REFORGE ${cadence.cycleNumber}`} IS READY
            </Text>
          </View>
        </View>
        <Text className="mt-s2 text-xs text-text-dim">
          {REFORGE_CYCLE_DAYS} days of training reviewed, your rating recalculated, and your next
          priorities set.
        </Text>
        <View className="mt-s3">
          <NeonButton
            title="OPEN REFORGE DAY"
            onPress={() => router.push('/reforge' as never)}
            testID="reforge-open-home"
          />
        </View>
      </GlowCard>
    </View>
  );
}

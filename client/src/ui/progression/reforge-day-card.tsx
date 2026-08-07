/**
 * The Reforge Day door on Home (docs/ONBOARDING_V3_SPEC.md §7).
 *
 * TWO STATES, and the gap between them is the point (2026-08-07):
 *
 *   DUE       a legendary chest. Gold, a border that travels, the numeral of
 *             the cycle, one button. It should be the second thing the eye
 *             lands on after the mission, because it is the only other thing
 *             on the page with a deadline.
 *   NOT DUE   ONE ROW — label, position in the cycle, a thin bar, days left.
 *             Not a card: a ceremony touched every 28 days must not hold a
 *             card's worth of vertical space for the other 27.
 *
 * It used to render NOTHING between Reforges, and before that a full card. A
 * bare line was not enough either — a cycle whose end you cannot see is not
 * anticipated, it is forgotten, and anticipation is most of what a 28-day
 * ceremony is for. The strip shows where you are without asking for the room
 * a card would.
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

  // ── NOT DUE: a compact progress strip, not a card. ──
  //
  // A ceremony the athlete touches every 28 days must not hold a card's worth
  // of vertical space for the other 27. But a bare line said nothing about
  // WHERE they were in the cycle, and a cycle you cannot see the end of is not
  // anticipated — it is forgotten. One row: label, position, bar, remaining.
  if (!cadence.due) {
    if (!cadence.started) return null;
    const pct = Math.max(0, Math.min(100, (cadence.dayOfCycle / REFORGE_CYCLE_DAYS) * 100));
    return (
      <Pressable
        onPress={() => router.push('/reforge' as never)}
        accessibilityRole="button"
        accessibilityLabel={`Next Reforge Day in ${cadence.daysUntil} days. Day ${cadence.dayOfCycle} of ${REFORGE_CYCLE_DAYS}. Opens Reforge Day.`}
        testID={testID}
        className="w-full flex-row items-center"
        style={{ minHeight: 44, gap: 10 }}
      >
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          numberOfLines={1}
          testID="reforge-countdown"
          style={{ fontSize: 8, letterSpacing: 1.4, ...pixelFont(false) }}
        >
          NEXT REFORGE
        </Text>
        <Text
          className="text-text-dim"
          allowFontScaling={false}
          numberOfLines={1}
          style={{ fontSize: 10, letterSpacing: 0, ...pixelFont() }}
        >
          {cadence.dayOfCycle}/{REFORGE_CYCLE_DAYS}
        </Text>
        <View
          className="overflow-hidden rounded-pill"
          style={{ flex: 1, minWidth: 40, height: 4, backgroundColor: colors['surface-3'] }}
        >
          <View
            style={{
              width: `${pct}%`,
              minWidth: pct > 0 ? 3 : 0,
              height: '100%',
              borderRadius: 999,
              backgroundColor: `${colors.legendary}b3`,
            }}
          />
        </View>
        <Text
          className="text-text-mute"
          numberOfLines={1}
          style={{ fontSize: 10, letterSpacing: 0.2 }}
        >
          {cadence.daysUntil}d left
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

/**
 * The Reforge Day door on Home (docs/ONBOARDING_V3_SPEC.md §7).
 *
 * Renders ONLY when a 28-day cycle has actually elapsed. Between Reforges it
 * shows nothing at all — a permanent countdown would turn a ceremony into a
 * chore, and everything that moves in between (strength, PRs, XP, streak)
 * already has its own place on this page.
 */

import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { useReforgeDay } from '@/data/progression/use-reforge-day';
import { REFORGE_CYCLE_DAYS } from '@/domain/progression/reforge-day';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';

export function ReforgeDayCard({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const { cadence, ready } = useReforgeDay();
  if (!ready || !cadence.due) return null;

  return (
    <View testID={testID}>
      <GlowCard glow={colors.legendary} padding={16}>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 2, color: colors.legendary, ...pixelFont(false) }}
        >
          ✦ REFORGE DAY
        </Text>
        <Text
          className="mt-s1 text-text"
          allowFontScaling={false}
          style={{ fontSize: 16, letterSpacing: 0, ...pixelFont() }}
        >
          {cadence.isFirst ? 'YOUR FIRST REFORGE IS READY' : `REFORGE ${cadence.cycleNumber} IS READY`}
        </Text>
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

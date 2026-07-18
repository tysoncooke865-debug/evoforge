import { Text, View } from 'react-native';

import { DEFAULT_CARDIO_TARGETS, type DailyMission } from '@/domain/cardio-stats';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { PixelClock, PixelFlame } from '@/ui/core/pixel-icons';
import { ThinBar } from '@/ui/fuel/progress-bar';
import { GlowCard } from '@/ui/core/shell';

/**
 * CARDIO_REDESIGN — the day's conditioning anchor. Today's minutes loud
 * against the daily goal, the mission bar, the streak, and this week's session
 * count. The goal is DEFAULT_CARDIO_TARGETS (a suggested ceiling, not stored
 * data — labelled honestly). One concise progression line; no stat soup.
 */
export function DailyCardioSummary({
  mission,
  streak,
  weekSessions,
}: {
  mission: DailyMission;
  streak: number;
  weekSessions: number;
}) {
  const colors = useThemeColors();
  const tint = mission.complete ? colors.success : colors.accent;
  return (
    <GlowCard glow={mission.complete ? colors.success : undefined}>
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        TODAY&apos;S PROTOCOL
      </Text>
      <View className="mt-s1 flex-row items-baseline" style={{ gap: 8 }}>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 40, lineHeight: 46, color: tint, textShadowColor: `${tint}8c`, textShadowRadius: 16, ...pixelFont() }}
          testID="cardio-today-minutes"
        >
          {mission.done}
        </Text>
        <Text className="text-text-dim" allowFontScaling={false} style={{ fontSize: 12, letterSpacing: 0.5, ...pixelFont(false) }}>
          / {mission.target} MIN
        </Text>
        <Text className="text-text-mute" style={{ fontSize: 9, letterSpacing: 0.5 }}>· suggested goal</Text>
      </View>

      <View className="mt-s2 flex-row items-center" style={{ gap: 8 }}>
        <View style={{ flex: 1 }}>
          <ThinBar pct={mission.pct} color={tint} height={8} />
        </View>
        <Text allowFontScaling={false} style={{ fontSize: 10, color: tint, ...pixelFont(false) }}>
          {mission.pct}%
        </Text>
      </View>

      <Text className="mt-s2 text-2xs text-text-dim">
        {mission.complete
          ? "Today's conditioning mission complete. Every extra minute banks Forge XP."
          : `${mission.remaining} more ${mission.remaining === 1 ? 'minute' : 'minutes'} to complete today's conditioning mission.`}
      </Text>

      <View className="mt-s3 flex-row items-center border-t border-border-soft pt-s2" style={{ gap: 8 }}>
        <View className="flex-row items-center" style={{ gap: 5 }}>
          <PixelFlame size={12} color={colors.legendary} />
          <Text className="text-2xs text-text-dim" testID="cardio-streak">
            {streak > 0 ? `${streak} day streak` : 'No streak yet'}
          </Text>
        </View>
        <View style={{ width: 1, height: 12, backgroundColor: colors['border-soft'] }} />
        <View className="flex-row items-center" style={{ gap: 5 }}>
          <PixelClock size={12} color={colors.accent} />
          <Text className="text-2xs text-text-dim">
            {weekSessions} / {DEFAULT_CARDIO_TARGETS.weeklySessions} sessions this week
          </Text>
        </View>
      </View>
    </GlowCard>
  );
}

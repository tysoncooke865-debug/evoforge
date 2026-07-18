import { Text, View } from 'react-native';

import { DEFAULT_CARDIO_TARGETS, type WeekDay, type WeekTotals } from '@/domain/cardio-stats';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { GlowCard } from '@/ui/core/shell';
import { SectionLabel } from '@/ui/core/screen-header';

/**
 * CARDIO_REDESIGN — THIS WEEK: a seven-day activity strip (Mon→Sun) plus the
 * session and minute totals against the suggested weekly goal. Simple, static
 * bars — no analytics dashboard, no per-bar animation loop (kept cheap so the
 * page stays snappy).
 */
export function WeeklyCardioProgress({ strip, totals }: { strip: WeekDay[]; totals: WeekTotals }) {
  const colors = useThemeColors();
  const maxMin = Math.max(1, ...strip.map((d) => d.minutes));
  return (
    <GlowCard>
      <View className="mb-s3 flex-row items-end justify-between">
        <SectionLabel>THIS WEEK</SectionLabel>
        <Text className="text-2xs text-text-mute" allowFontScaling={false} style={{ letterSpacing: 0.5, ...pixelFont(false) }}>
          {totals.sessions}/{DEFAULT_CARDIO_TARGETS.weeklySessions} SESSIONS
        </Text>
      </View>

      <View className="flex-row items-end justify-between" style={{ height: 68 }}>
        {strip.map((d) => {
          const has = d.minutes > 0;
          const h = has ? Math.max(10, (d.minutes / maxMin) * 100) : 4;
          const tint = d.isToday ? colors.accent : has ? `${colors.accent}99` : colors['surface-3'];
          return (
            <View key={d.iso} className="items-center" style={{ flex: 1, gap: 4 }}>
              <View className="flex-1 justify-end">
                <View
                  style={{
                    width: 14,
                    height: `${h}%`,
                    minHeight: 4,
                    borderRadius: 3,
                    backgroundColor: d.isFuture ? colors['surface-2'] : tint,
                    opacity: d.isFuture ? 0.5 : 1,
                  }}
                />
              </View>
              <Text
                allowFontScaling={false}
                style={{
                  fontSize: 7,
                  letterSpacing: 0.5,
                  color: d.isToday ? colors.accent : colors['text-mute'],
                  ...pixelFont(false),
                }}
              >
                {d.label}
              </Text>
            </View>
          );
        })}
      </View>

      <Text className="mt-s3 text-2xs text-text-dim">
        {totals.sessions === 0
          ? 'No sessions logged this week yet.'
          : `${totals.sessions} ${totals.sessions === 1 ? 'session' : 'sessions'} · ${totals.minutes} / ${DEFAULT_CARDIO_TARGETS.weeklyMinutes} minutes`}
      </Text>
      <Text className="mt-s1 text-2xs text-text-mute" style={{ fontSize: 9, letterSpacing: 0.5 }}>
        Targets are a suggested weekly goal.
      </Text>
    </GlowCard>
  );
}

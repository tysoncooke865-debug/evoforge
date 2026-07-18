import { Text, View } from 'react-native';

import { useCardioLog } from '@/data/hooks';
import {
  cardioStreak,
  dailyMission,
  DEFAULT_CARDIO_TARGETS,
  todayMinutes,
  weekStrip,
  weekTotals,
} from '@/domain/cardio-stats';
import { todayIso as calendarToday } from '@/domain/today';
import { pyFloat } from '@/domain/py';
import { pixelFont } from '@/theme/fonts';
import { GlowCard } from '@/ui/core/shell';
import { SectionLabel } from '@/ui/core/screen-header';
import { ActivityTypeSelector } from '@/ui/train/cardio/activity-selector';
import { CardioSessionForm } from '@/ui/train/cardio/session-form';
import { DailyCardioSummary } from '@/ui/train/cardio/daily-cardio-summary';
import { RecentCardioSessions, type RecentRow } from '@/ui/train/cardio/recent-cardio-sessions';
import { WeeklyCardioProgress } from '@/ui/train/cardio/weekly-cardio-progress';

/**
 * CARDIO_REDESIGN — the conditioning dashboard (the CARDIO mode of Train).
 * REAL CARDIO → CONDITIONING PROGRESS → EVO RATING → CHAMPION REWARDS, in one
 * scroll: the day's mission, the activity picker + adaptive logger with the
 * live (real) reward preview, this week's strip, and recent sessions. Every
 * number is derived from cardio_log; the goals are labelled defaults, not
 * fabricated user data. `type`/`setType` are lifted so the Train header's
 * companion animation stays in sync.
 */
export function CardioDashboard({ type, setType }: { type: string; setType: (t: string) => void }) {
  const today = calendarToday();
  const history = useCardioLog();
  const rows = history.data ?? [];

  const minsToday = todayMinutes(rows, today);
  const mission = dailyMission(minsToday, DEFAULT_CARDIO_TARGETS.dailyMinutes);
  const streak = cardioStreak(rows, today);
  const strip = weekStrip(rows, today);
  const totals = weekTotals(rows, today);

  const recent: RecentRow[] = [...rows]
    .reverse()
    .slice(0, 5)
    .map((r) => ({
      id: String((r as { id: unknown }).id),
      type: String((r as { type: unknown }).type ?? 'Other'),
      minutes: pyFloat((r as { minutes: unknown }).minutes) ?? 0,
      distanceKm: pyFloat((r as Record<string, unknown>).distance_km) ?? 0,
      timestamp: String((r as { timestamp: unknown }).timestamp ?? ''),
      date: String((r as { date: unknown }).date ?? ''),
    }));

  return (
    <View style={{ gap: 16 }}>
      <DailyCardioSummary mission={mission} streak={streak} weekSessions={totals.sessions} />

      <GlowCard>
        <SectionLabel>CONDITIONING SESSION</SectionLabel>
        <Text
          className="mb-s2 text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          CHOOSE ACTIVITY
        </Text>
        <ActivityTypeSelector type={type} onSelect={setType} />
        <View className="mt-s4">
          <CardioSessionForm key={type} type={type} />
        </View>
      </GlowCard>

      <WeeklyCardioProgress strip={strip} totals={totals} />
      <RecentCardioSessions rows={recent} today={today} />
    </View>
  );
}

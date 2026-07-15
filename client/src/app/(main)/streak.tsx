import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useClaimCoin } from '@/data/coins';
import { useWorkoutLog } from '@/data/hooks';
import { useWorkoutSchedule } from '@/data/schedule';
import { computeScheduledStreak, crossedMilestones } from '@/domain/scheduled-streak';
import tokens from '@/theme/tokens';
import { HUDChip } from '@/ui/core/hud';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';
import { StreakCalendar } from '@/ui/train/streak-calendar';
import { todayIso as calendarToday } from '@/domain/today';

/**
 * IMPROVEMENT_PLAN #11: the streak calendar. Everything derives from
 * persisted rows (schedule + workout_log); crossing a milestone fires a
 * coin claim whose amount and truth the 013 guard re-proves server-side.
 */
export default function StreakScreen() {
  const todayIso = calendarToday();
  const schedule = useWorkoutSchedule();
  const workouts = useWorkoutLog();
  const claim = useClaimCoin();
  const [monthOffset, setMonthOffset] = useState(0);

  const streak = useMemo(
    () => computeScheduledStreak(schedule.data ?? [], workouts.data ?? [], todayIso),
    [schedule.data, workouts.data, todayIso]
  );

  // Milestone claims: fire-and-forget; the unique index absorbs repeats.
  const keys = crossedMilestones(streak).join(',');
  useEffect(() => {
    if (!keys) return;
    for (const key of keys.split(',')) {
      claim.mutate({ kind: 'streak_milestone', sourceId: key });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  const base = new Date(`${todayIso}T00:00:00Z`);
  const shown = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + monthOffset, 1));
  const hasSchedule = (schedule.data ?? []).length > 0;

  return (
    <ScreenShell>
      <ScreenHeader kicker="CONSISTENCY IS THE CHEAT CODE" title="STREAK" />
      {!hasSchedule ? (
        <>
          <Text className="text-center text-2xs text-text-mute">
            No schedule yet — the calendar needs to know which days count.
          </Text>
          <Link href={'/schedule' as never} asChild>
            <NeonButton title="SET MY WEEKLY SCHEDULE" onPress={() => undefined} testID="goto-schedule" />
          </Link>
        </>
      ) : (
        <>
          <View className="flex-row justify-center gap-s2">
            <HUDChip label="CURRENT" value={`${streak.current}🔥`} tint={streak.current > 0 ? tokens.colors.legendary : tokens.colors.common} />
            <HUDChip label="BEST" value={streak.best} tint={tokens.colors.epic} />
          </View>
          <View className="flex-row items-center justify-between">
            <Pressable onPress={() => setMonthOffset((m) => m - 1)} accessibilityRole="button" className="min-h-[44px] justify-center px-s3">
              <Text className="text-lg text-accent">‹</Text>
            </Pressable>
            <Text className="text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
              SWIPE MONTHS
            </Text>
            <Pressable
              onPress={() => setMonthOffset((m) => Math.min(0, m + 1))}
              accessibilityRole="button"
              className="min-h-[44px] justify-center px-s3"
            >
              <Text className="text-lg text-accent">›</Text>
            </Pressable>
          </View>
          <StreakCalendar year={shown.getUTCFullYear()} month={shown.getUTCMonth()} days={streak.days} todayIso={todayIso} />
          <Link href={'/schedule' as never} asChild>
            <NeonButton title="EDIT SCHEDULE" variant="ghost" onPress={() => undefined} />
          </Link>
        </>
      )}
    </ScreenShell>
  );
}

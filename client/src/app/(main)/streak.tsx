import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useClaimCoin } from '@/data/coins';
import { useWorkoutLog } from '@/data/hooks';
import { useWorkoutSchedule } from '@/data/schedule';
import { useStreakPauses, useStreakState, useToggleStreakPause } from '@/data/streak';
import { computeScheduledStreak, crossedMilestones } from '@/domain/scheduled-streak';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { HUDChip } from '@/ui/core/hud';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';
import { SkeletonScreen } from '@/ui/core/skeleton';
import { StreakCalendar } from '@/ui/train/streak-calendar';
import { todayIso as calendarToday } from '@/domain/today';

/**
 * IMPROVEMENT_PLAN #11: the streak calendar. Everything derives from
 * persisted rows (schedule + workout_log); crossing a milestone fires a
 * coin claim whose amount and truth the 013 guard re-proves server-side.
 */
export default function StreakScreen() {
  const colors = useThemeColors();
  const todayIso = calendarToday();
  const schedule = useWorkoutSchedule();
  const workouts = useWorkoutLog();
  const claim = useClaimCoin();
  const streakState = useStreakState();
  const pauses = useStreakPauses();
  const togglePause = useToggleStreakPause();
  const [monthOffset, setMonthOffset] = useState(0);

  // A streak of 0 while the log loads reads as "you broke it". Wait.
  const loading = schedule.isPending || workouts.isPending;
  /**
   * 179: the same rule the server counts by. `scheduled_streak` in SQL and
   * `computeScheduledStreak` here must agree, or an athlete comparing the number
   * on this screen with anything server-side would be right to trust neither.
   */
  const streak = computeScheduledStreak(
    schedule.data ?? [],
    workouts.data ?? [],
    todayIso,
    180,
    undefined,
    { pauses: pauses.data ?? [], gracePer30d: streakState.data?.grace_per_30d }
  );
  const state = streakState.data;
  const graceLeft = state ? Math.max(0, state.grace_per_30d - state.grace_used_30d) : null;

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

  if (loading) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="CONSISTENCY IS THE CHEAT CODE" title="STREAK" />
        <SkeletonScreen cards={3} testID="streak-loading" />
      </ScreenShell>
    );
  }

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
            <HUDChip label="CURRENT" value={`${streak.current}🔥`} tint={streak.current > 0 ? colors.legendary : colors.common} />
            <HUDChip label="BEST" value={streak.best} tint={colors.epic} />
          </View>
          <View className="flex-row items-center justify-between">
            <Pressable onPress={() => setMonthOffset((m) => m - 1)} accessibilityRole="button" className="min-h-[44px] justify-center px-s3">
              <Text className="text-lg text-accent">‹</Text>
            </Pressable>
            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
            >
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

          {/*
            PROTECTION, STATED AS A FACT AND NEVER AS A WARNING (Spec v5 §6).

            This says what is true right now — you are covered, or you are paused.
            It never counts down, never says a run is at risk, and never appears
            more urgently as the allowance runs low. §6 bans "streak about to die"
            messaging outright, and a protection meter is the easiest way to
            reintroduce exactly that feeling while technically not saying it.
          */}
          <View
            className="mt-s3 rounded-lg border p-s3"
            style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
            testID="streak-protection"
          >
            {state?.paused ? (
              <>
                <Text
                  allowFontScaling={false}
                  className="text-2xs"
                  style={{ color: colors.accent, letterSpacing: 1 }}
                >
                  PAUSED
                </Text>
                <Text className="mt-s1 text-2xs text-text-dim">
                  Your streak is on hold since {state.paused_since}. Nothing is counting
                  against you while you are away — take the time you need.
                </Text>
                <View className="mt-s2">
                  <NeonButton
                    title={togglePause.isPending ? 'RESUMING…' : 'I AM BACK'}
                    variant="ghost"
                    pixel
                    busy={togglePause.isPending}
                    disabled={togglePause.isPending}
                    onPress={() => togglePause.mutate({ pause: false })}
                    testID="streak-resume"
                  />
                </View>
              </>
            ) : (
              <>
                <Text
                  allowFontScaling={false}
                  className="text-2xs"
                  style={{ color: colors['text-dim'], letterSpacing: 1 }}
                >
                  PROTECTED
                </Text>
                <Text className="mt-s1 text-2xs text-text-dim">
                  {graceLeft === null
                    ? 'Rest days never break a run.'
                    : graceLeft > 0
                      ? `Rest days never break a run, and ${graceLeft} missed ${
                          graceLeft === 1 ? 'day is' : 'days are'
                        } covered this month.`
                      : 'Rest days never break a run. Pause any time if life gets in the way.'}
                </Text>
                <View className="mt-s2">
                  <NeonButton
                    title={togglePause.isPending ? 'PAUSING…' : 'PAUSE FOR INJURY OR TRAVEL'}
                    variant="ghost"
                    pixel
                    busy={togglePause.isPending}
                    disabled={togglePause.isPending}
                    onPress={() => togglePause.mutate({ pause: true })}
                    testID="streak-pause"
                  />
                </View>
              </>
            )}
          </View>
          <Link href={'/schedule' as never} asChild>
            <NeonButton title="EDIT SCHEDULE" variant="ghost" onPress={() => undefined} />
          </Link>
        </>
      )}
    </ScreenShell>
  );
}

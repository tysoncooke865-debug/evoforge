import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useCustomPlan, useWorkoutLog } from '@/data/hooks';
import { useClaimCoin } from '@/data/coins';
import { useWorkoutSchedule } from '@/data/schedule';
import { useAvatarData } from '@/data/use-avatar-data';
import { CARDIO_TYPES } from '@/domain/cardio';
import { ROUTINE, ROUTINE_ORDER } from '@/domain/catalogs';
import { pyFloat } from '@/domain/py';
import { nextEvolutionInfo } from '@/domain/next-evolution';
import { computeStreak } from '@/domain/streak';
import { normaliseWorkoutLog } from '@/domain/summary';
import { XP_PER_SET } from '@/domain/xp';
import tokens from '@/theme/tokens';
import { CardioCard, cardioAnim } from '@/ui/cardio-logger';
import { ExerciseCard } from '@/ui/exercise-logger';
import { Chip, NeonButton } from '@/ui/neon-button';
import { SummarySheet, type WorkoutSummaryData } from '@/ui/summary-sheet';
import { ScreenHeader } from '@/ui/screen-header';
import { SegmentedTabs } from '@/ui/segmented-tabs';
import { CompanionMenuButton } from '@/ui/companion-menu';
import { GlowCard, ScreenShell } from '@/ui/shell';

/**
 * Today: the logging loop. Saves go through useSaveSet -- an edit updates in
 * place (never re-granting XP) and only a new set announces. Set pips per
 * exercise, the day bar, WORKOUT COMPLETE once per (day,date), FINISH EARLY
 * with an honest summary.
 */
export default function TodayScreen() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const days = ROUTINE_ORDER.filter((d) => ROUTINE[d].length > 0);
  const [day, setDay] = useState(days[0]);

  // IMPROVEMENT_PLAN #10: the workout source. The AI plan shares the six
  // day names, so the chips, completion and logging are source-agnostic --
  // only the exercise list under each day changes.
  const aiPlan = useCustomPlan();
  const [source, setSource] = useState<0 | 1>(0);
  const useAi = source === 1 && aiPlan.data !== null && aiPlan.data !== undefined;

  // P2 C3: LIFT | CARDIO mode; cardio type hoisted so the header sprite can
  // train what's being logged (the old log.tsx rationale, relocated).
  const [mode, setMode] = useState<0 | 1>(0);
  const [cardioType, setCardioType] = useState<string>(CARDIO_TYPES[0]);

  // IMPROVEMENT_PLAN #11: default the day chip to today's SCHEDULED day
  // once a schedule exists; manual override stays (it's just useState).
  const schedule = useWorkoutSchedule();
  const scheduledDefaultRef = useRef(false);
  useEffect(() => {
    if (scheduledDefaultRef.current) return;
    const rows = schedule.data;
    if (!rows || rows.length === 0) return;
    scheduledDefaultRef.current = true;
    const t = setTimeout(() => {
      const plan = rows[rows.length - 1].plan;
      const dow = String(new Date(`${todayIso}T00:00:00Z`).getUTCDay());
      const assigned = plan[dow];
      if (assigned && assigned !== 'Rest' && days.includes(assigned)) setDay(assigned);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.data]);

  const claimCoins = useClaimCoin();
  const workouts = useWorkoutLog();
  const { summary, stats, bfMid } = useAvatarData();
  const [sheet, setSheet] = useState<WorkoutSummaryData | null>(null);
  const prCountRef = useRef(0);
  const todayRows = useMemo(
    () =>
      normaliseWorkoutLog(workouts.data ?? []).filter(
        (r) => String(r.date) === todayIso && String(r.workout) === day
      ),
    [workouts.data, todayIso, day]
  );

  const validRowsFor = (exercise: string) =>
    todayRows.filter(
      (r) =>
        String(r.exercise) === exercise &&
        (pyFloat(r.weight) ?? 0) > 0 &&
        (pyFloat(r.reps) ?? 0) > 0
    );

  const builtIn = ROUTINE[day];
  const aiDay = useAi ? aiPlan.data?.days.find((d) => d.day === day) : null;
  // The same [exercise, sets, scheme] tuple shape either way.
  const plan: readonly (readonly [string, number, string])[] = aiDay
    ? aiDay.exercises.map((e) => [e.exercise, e.sets, e.reps] as const)
    : builtIn;
  const totalTarget = plan.reduce((acc, [, sets]) => acc + sets, 0);
  const totalDone = plan.reduce(
    (acc, [exercise, sets]) => acc + Math.min(validRowsFor(exercise).length, sets),
    0
  );
  const complete = totalTarget > 0 && totalDone >= totalTarget;
  // The quest cursor: the first exercise still short of its target sets.
  const nextExercise = plan.find(([exercise, sets]) => validRowsFor(exercise).length < sets)?.[0] ?? null;


  const buildSummary = (): WorkoutSummaryData => ({
    day,
    setsDone: totalDone,
    setsTarget: totalTarget,
    xpBanked: totalDone * XP_PER_SET,
    prCount: prCountRef.current,
    streak: computeStreak(workouts.data ?? [], todayIso).current,
    level: summary.level,
    xpIntoLevel: summary.xpIntoLevel,
    xpNeeded: summary.xpNeeded,
    evolution: nextEvolutionInfo(stats.branch, {
      level: summary.level,
      benchE1rm: stats.benchE1rm,
      bfMid,
      totalSets: summary.totalSets,
      cardioMinutes: summary.cardioMinutes,
    }),
  });

  const announcedRef = useRef<string | null>(null);
  const sessionKey = `${todayIso}|${day}`;
  const hadDataRef = useRef(false);
  useEffect(() => {
    if (!workouts.data) return;
    if (!hadDataRef.current) {
      hadDataRef.current = true;
      if (complete) announcedRef.current = sessionKey;
      return;
    }
    if (complete && announcedRef.current !== sessionKey) {
      announcedRef.current = sessionKey;
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSheet(buildSummary());
      // Coin claim (IMPROVEMENT_PLAN #12): once per date; the 013 guard's
      // 10-valid-set floor and the unique index decide, not this client.
      claimCoins.mutate({ kind: 'workout_complete', sourceId: todayIso });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, sessionKey, workouts.data]);

  const finishEarly = () => {
    setSheet(buildSummary());
  };

  const dayPct = totalTarget > 0 ? (totalDone / totalTarget) * 100 : 0;


  return (
    <ScreenShell>
      <ScreenHeader
        kicker={`TODAY · ${todayIso}`}
        title={mode === 1 ? 'CARDIO' : day.split(' - ')[0].toUpperCase()}
        right={
          <CompanionMenuButton
            anim={mode === 1 ? cardioAnim(cardioType) : complete ? 'victory' : 'idle'}
            height={56}
          />
        }
      />

      {/* P2 C3: cardio lives on Today. Both panels stay MOUNTED and toggle
          via display style — the keep-mounted pattern from the old log.tsx,
          so half-typed cardio forms AND SetRow state survive mode flips. */}
      <SegmentedTabs left="LIFT" right="CARDIO" active={mode} onChange={setMode} testIDPrefix="today-mode" />

      <View style={{ display: mode === 0 ? 'flex' : 'none', gap: 16 }}>
      {aiPlan.data ? (
        <SegmentedTabs left="BUILT-IN" right="AI PLAN" active={source} onChange={setSource} testIDPrefix="today-source" />
      ) : null}

      <GlowCard glow={complete ? tokens.colors.success : undefined}>
        <View className="mb-s4 flex-row flex-wrap gap-s2">
          {days.map((d) => (
            <Chip key={d} label={d} active={d === day} onPress={() => setDay(d)} />
          ))}
        </View>

        <View className="h-s2 overflow-hidden rounded-pill bg-surface-3">
          <View
            style={{
              width: `${dayPct}%`,
              height: '100%',
              borderRadius: 999,
              backgroundColor: complete ? tokens.colors.success : tokens.colors.accent,
              minWidth: totalDone > 0 ? 4 : 0,
              shadowColor: complete ? tokens.colors.success : tokens.colors.accent,
              shadowOpacity: 0.5,
              shadowRadius: 8,
            }}
          />
        </View>
        <View className="mt-s2 flex-row justify-between">
          <Text className={`text-2xs font-bold ${complete ? 'text-success' : 'text-text-mute'}`} style={{ letterSpacing: 1.5 }}>
            {complete ? '✓ ALL SETS COMPLETE' : `${totalDone} / ${totalTarget} SETS`}
          </Text>
          <Text className="text-2xs font-bold text-accent">+{totalDone * XP_PER_SET} XP TODAY</Text>
        </View>
      </GlowCard>

      {plan.map(([exercise, sets, scheme]) => (
        <ExerciseCard
          // Day is part of the key: ROUTINE reuses exercise names across days
          // (e.g. Lat Pulldown on both Pull days), and SetRow seeds its typed
          // state once on mount — a same-key day switch kept the previous
          // day's numbers on screen and saved them under the NEW day.
          key={`${day}:${exercise}`}
          date={todayIso}
          workout={day}
          exercise={exercise}
          targetSets={sets}
          scheme={scheme}
          loggedRows={todayRows.filter((r) => String(r.exercise) === exercise)}
          allRows={workouts.data ?? []}
          doneCount={validRowsFor(exercise).length}
          isNext={exercise === nextExercise}
          onPr={() => (prCountRef.current += 1)}
        />
      ))}

      {totalDone > 0 && !complete ? (
        <NeonButton
          title={`FINISH WORKOUT · ${totalDone}/${totalTarget} SETS`}
          variant="ghost"
          onPress={finishEarly}
          testID="finish-workout"
        />
      ) : null}
      </View>

      <View style={{ display: mode === 1 ? 'flex' : 'none', gap: 16 }}>
        <CardioCard type={cardioType} setType={setCardioType} />
      </View>
      <SummarySheet data={sheet} onClose={() => setSheet(null)} />
    </ScreenShell>
  );
}

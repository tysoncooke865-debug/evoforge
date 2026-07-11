import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useSaveSet } from '@/data/mutations';
import { useWorkoutLog } from '@/data/hooks';
import { useAvatarData } from '@/data/use-avatar-data';
import { ROUTINE, ROUTINE_ORDER } from '@/domain/catalogs';
import { pyFloat, pyInt } from '@/domain/py';
import { nextEvolutionInfo } from '@/domain/next-evolution';
import { computeStreak } from '@/domain/streak';
import { normaliseWorkoutLog } from '@/domain/summary';
import { XP_PER_SET } from '@/domain/xp';
import tokens from '@/theme/tokens';
import { FloatingXP } from '@/ui/floating-xp';
import { Chip, NeonButton } from '@/ui/neon-button';
import { SummarySheet, type WorkoutSummaryData } from '@/ui/summary-sheet';
import { ScreenHeader } from '@/ui/screen-header';
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

  const plan = ROUTINE[day];
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, sessionKey, workouts.data]);

  const finishEarly = () => {
    setSheet(buildSummary());
  };

  const dayPct = totalTarget > 0 ? (totalDone / totalTarget) * 100 : 0;


  return (
    <ScreenShell>
      <ScreenHeader kicker={`TODAY · ${todayIso}`} title={day.split(' - ')[0].toUpperCase()} />

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
          key={exercise}
          date={todayIso}
          workout={day}
          exercise={exercise}
          targetSets={sets}
          scheme={scheme}
          loggedRows={todayRows.filter((r) => String(r.exercise) === exercise)}
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
      <SummarySheet data={sheet} onClose={() => setSheet(null)} />
    </ScreenShell>
  );
}

/** One pip per target set: filled = logged. Quest steps. */
function SetPips({ done, target }: { done: number; target: number }) {
  return (
    <View className="flex-row gap-s1">
      {Array.from({ length: target }, (_, i) => (
        <View
          key={i}
          style={{
            width: 14,
            height: 6,
            borderRadius: 3,
            backgroundColor: i < done ? tokens.colors.accent : tokens.colors['surface-3'],
            shadowColor: tokens.colors.accent,
            shadowOpacity: i < done ? 0.6 : 0,
            shadowRadius: 4,
          }}
        />
      ))}
    </View>
  );
}

function ExerciseCard({
  date,
  workout,
  exercise,
  targetSets,
  scheme,
  loggedRows,
  doneCount,
  isNext,
  onPr,
}: {
  date: string;
  workout: string;
  exercise: string;
  targetSets: number;
  scheme: string;
  loggedRows: import('@/domain/summary').WorkoutRow[];
  doneCount: number;
  isNext: boolean;
  onPr: () => void;
}) {
  const done = doneCount >= targetSets;
  return (
    <GlowCard glow={done ? tokens.colors.success : isNext ? tokens.colors.accent : undefined}>
      <View className="mb-s1 flex-row items-center justify-between">
        <Text className="flex-1 text-base font-bold text-text">{exercise}</Text>
        {isNext && !done ? (
          <Text className="mr-s2 text-xs font-bold text-accent" style={{ letterSpacing: 1 }}>
            ▸ NEXT
          </Text>
        ) : null}
        <Text className={`text-xs font-bold ${done ? 'text-success' : 'text-text-mute'}`}>
          {done ? '✓ DONE' : `${doneCount}/${targetSets}`}
        </Text>
      </View>
      <View className="mb-s4 flex-row items-center justify-between">
        <Text className="text-xs text-text-mute">{scheme}</Text>
        <SetPips done={doneCount} target={targetSets} />
      </View>
      {Array.from({ length: targetSets }, (_, i) => i + 1).map((setNo) => {
        const existing = loggedRows.find((r) => (pyInt(r.set) ?? 0) === setNo);
        return (
          <SetRow
            key={setNo}
            date={date}
            workout={workout}
            exercise={exercise}
            setNo={setNo}
            initialWeight={existing ? String(pyFloat(existing.weight) ?? '') : ''}
            initialReps={existing ? String(pyInt(existing.reps) ?? '') : ''}
            onPr={onPr}
          />
        );
      })}
    </GlowCard>
  );
}

function SetRow({
  date,
  workout,
  exercise,
  setNo,
  initialWeight,
  initialReps,
  onPr,
}: {
  date: string;
  workout: string;
  exercise: string;
  setNo: number;
  initialWeight: string;
  initialReps: string;
  onPr: () => void;
}) {
  const [weight, setWeight] = useState(initialWeight);
  const [reps, setReps] = useState(initialReps);
  const [floatXp, setFloatXp] = useState(false);
  const save = useSaveSet();
  const logged = initialWeight !== '';

  const onSave = () => {
    const w = pyFloat(weight);
    const r = pyFloat(reps);
    if (w === null || r === null || w <= 0 || r <= 0) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    save.mutate(
      {
        workoutDate: date,
        workout,
        exercise,
        setNo,
        weight: w,
        reps: Math.trunc(r),
      },
      {
        // Confirmed state only: the float fires on a REAL insert verdict,
        // never optimistically -- a failed save must not celebrate.
        onSuccess: (verdict) => {
          if (verdict.action === 'insert') setFloatXp(true);
          if ((verdict.action === 'insert' || verdict.action === 'update') && verdict.is_pr) onPr();
        },
      }
    );
  };

  return (
    <View className="mb-s2 flex-row items-center gap-s2">
      {floatXp ? <FloatingXP amount={XP_PER_SET} onDone={() => setFloatXp(false)} /> : null}
      <Text className="w-s10 text-2xs font-bold text-text-mute" style={{ letterSpacing: 1 }}>
        SET {setNo}
      </Text>
      <TextInput
        className="w-[84px] rounded-md border border-border bg-surface-2 p-s2 text-center text-text"
        inputMode="decimal"
        placeholder="kg"
        placeholderTextColor="#64758f"
        value={weight}
        onChangeText={setWeight}
        testID={`${exercise}-w-${setNo}`}
      />
      <Text className="text-text-mute">×</Text>
      <TextInput
        className="w-[64px] rounded-md border border-border bg-surface-2 p-s2 text-center text-text"
        inputMode="numeric"
        placeholder="reps"
        placeholderTextColor="#64758f"
        value={reps}
        onChangeText={setReps}
        testID={`${exercise}-r-${setNo}`}
      />
      <Pressable
        onPress={onSave}
        disabled={save.isPending}
        className={`ml-auto rounded-md px-s3 py-s2 ${logged ? 'border border-border bg-surface-2' : 'bg-accent'}`}
        style={
          logged
            ? undefined
            : { shadowColor: tokens.colors.accent, shadowOpacity: 0.45, shadowRadius: 10, elevation: 5 }
        }
        testID={`${exercise}-save-${setNo}`}
      >
        {save.isPending ? (
          <ActivityIndicator size="small" color={logged ? '#22d3ee' : '#04121a'} />
        ) : (
          <Text className={`text-xs font-bold ${logged ? 'text-text-dim' : 'text-accent-ink'}`}>
            {logged ? 'UPDATE' : 'LOG'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

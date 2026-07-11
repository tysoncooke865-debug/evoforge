import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useSaveSet } from '@/data/mutations';
import { useWorkoutLog } from '@/data/hooks';
import { ROUTINE, ROUTINE_ORDER } from '@/domain/catalogs';
import { pyFloat, pyInt } from '@/domain/py';
import { normaliseWorkoutLog } from '@/domain/summary';
import { XP_PER_SET } from '@/domain/xp';
import { useToastStore } from '@/state/toast-store';
import tokens from '@/theme/tokens';
import { ScreenHeader } from '@/ui/screen-header';

/**
 * Today: the logging loop. Saves go through useSaveSet -- an edit updates in
 * place (never re-granting XP) and only a new set announces. The day's
 * progress is visible per exercise (set pips) and overall (the day bar);
 * completing every listed set fires WORKOUT COMPLETE once, and FINISH EARLY
 * closes the session honestly with whatever was logged.
 */
export default function TodayScreen() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const days = ROUTINE_ORDER.filter((d) => ROUTINE[d].length > 0);
  const [day, setDay] = useState(days[0]);

  const workouts = useWorkoutLog();
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

  // WORKOUT COMPLETE fires exactly once per (day, date) when the last set
  // lands -- not on revisits to an already-complete day.
  const announcedRef = useRef<string | null>(null);
  const sessionKey = `${todayIso}|${day}`;
  const hadDataRef = useRef(false);
  useEffect(() => {
    if (!workouts.data) return;
    if (!hadDataRef.current) {
      hadDataRef.current = true;
      if (complete) announcedRef.current = sessionKey; // already done before we looked
      return;
    }
    if (complete && announcedRef.current !== sessionKey) {
      announcedRef.current = sessionKey;
      useToastStore.getState().push({
        kind: 'achievement',
        title: 'WORKOUT COMPLETE',
        subtitle: `${day} — all ${totalTarget} sets · +${totalTarget * XP_PER_SET} XP earned today`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, sessionKey, workouts.data]);

  const finishEarly = () => {
    useToastStore.getState().push({
      kind: 'info',
      title: 'WORKOUT FINISHED',
      subtitle: `${day} — ${totalDone}/${totalTarget} sets logged · +${totalDone * XP_PER_SET} XP banked`,
    });
  };

  const dayPct = totalTarget > 0 ? (totalDone / totalTarget) * 100 : 0;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[560px] gap-s4">
        <ScreenHeader kicker={`TODAY · ${todayIso}`} title={day.split(' - ')[0].toUpperCase()} />

        <View className="rounded-lg border border-border bg-surface p-s4">
          <View className="mb-s3 flex-row flex-wrap gap-s2">
            {days.map((d) => (
              <Pressable
                key={d}
                onPress={() => setDay(d)}
                className={`rounded-pill border px-s3 py-s1 ${
                  d === day ? 'border-border-strong bg-surface-3' : 'border-border bg-surface-2'
                }`}
              >
                <Text className={`text-xs font-bold ${d === day ? 'text-accent' : 'text-text-dim'}`}>
                  {d}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* The day bar: sets done across the whole session. */}
          <View className="h-s2 overflow-hidden rounded-pill bg-surface-3">
            <View
              style={{
                width: `${dayPct}%`,
                height: '100%',
                borderRadius: 999,
                backgroundColor: complete ? tokens.colors.success : tokens.colors.accent,
                minWidth: totalDone > 0 ? 4 : 0,
              }}
            />
          </View>
          <View className="mt-s1 flex-row justify-between">
            <Text className={`text-2xs font-bold ${complete ? 'text-success' : 'text-text-mute'}`}>
              {complete ? 'ALL SETS COMPLETE' : `${totalDone} / ${totalTarget} SETS`}
            </Text>
            <Text className="text-2xs text-text-mute">+{totalDone * XP_PER_SET} XP today</Text>
          </View>
        </View>

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
          />
        ))}

        {totalDone > 0 && !complete ? (
          <Pressable
            className="items-center rounded-md border border-border-strong bg-surface-2 p-s3"
            onPress={finishEarly}
            testID="finish-workout"
          >
            <Text className="font-bold text-accent">FINISH WORKOUT · {totalDone}/{totalTarget} SETS</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** One pip per target set: filled = logged. The RPG quest-step look. */
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
}: {
  date: string;
  workout: string;
  exercise: string;
  targetSets: number;
  scheme: string;
  loggedRows: import('@/domain/summary').WorkoutRow[];
  doneCount: number;
}) {
  const done = doneCount >= targetSets;
  return (
    <View
      className={`rounded-lg border bg-surface p-s4 ${done ? 'border-border-strong' : 'border-border'}`}
    >
      <View className="mb-s1 flex-row items-center justify-between">
        <Text className="flex-1 font-bold text-text">{exercise}</Text>
        <Text className={`text-xs font-bold ${done ? 'text-success' : 'text-text-mute'}`}>
          {done ? '✓ DONE' : `${doneCount}/${targetSets}`}
        </Text>
      </View>
      <View className="mb-s3 flex-row items-center justify-between">
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
          />
        );
      })}
    </View>
  );
}

function SetRow({
  date,
  workout,
  exercise,
  setNo,
  initialWeight,
  initialReps,
}: {
  date: string;
  workout: string;
  exercise: string;
  setNo: number;
  initialWeight: string;
  initialReps: string;
}) {
  const [weight, setWeight] = useState(initialWeight);
  const [reps, setReps] = useState(initialReps);
  const save = useSaveSet();
  const logged = initialWeight !== '';

  const onSave = () => {
    const w = pyFloat(weight);
    const r = pyFloat(reps);
    if (w === null || r === null || w <= 0 || r <= 0) return;
    save.mutate({
      workoutDate: date,
      workout,
      exercise,
      setNo,
      weight: w,
      reps: Math.trunc(r),
    });
  };

  return (
    <View className="mb-s2 flex-row items-center gap-s2">
      <Text className="w-s10 text-xs text-text-mute">SET {setNo}</Text>
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

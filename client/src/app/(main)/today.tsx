import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useSaveSet } from '@/data/mutations';
import { useWorkoutLog } from '@/data/hooks';
import { ROUTINE, ROUTINE_ORDER } from '@/domain/catalogs';
import { pyFloat, pyInt } from '@/domain/py';
import { normaliseWorkoutLog } from '@/domain/summary';

/**
 * Today: the logging loop. Pick the day's workout, enter weight x reps per
 * set, saves go through useSaveSet -- whose verdict machinery guarantees an
 * edit updates in place (never re-granting XP) and only a new set announces.
 * Values prefill from what is already logged today, so reopening the page
 * mid-session shows the sets you have done.
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

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[560px] gap-s4">
        <View className="rounded-lg border border-border bg-surface p-s4">
          <Text className="mb-s2 text-xs text-text-mute">TODAY · {todayIso}</Text>
          <View className="flex-row flex-wrap gap-s2">
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
        </View>

        {ROUTINE[day].map(([exercise, sets, scheme]) => (
          <ExerciseCard
            key={exercise}
            date={todayIso}
            workout={day}
            exercise={exercise}
            targetSets={sets}
            scheme={scheme}
            loggedRows={todayRows.filter((r) => String(r.exercise) === exercise)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function ExerciseCard({
  date,
  workout,
  exercise,
  targetSets,
  scheme,
  loggedRows,
}: {
  date: string;
  workout: string;
  exercise: string;
  targetSets: number;
  scheme: string;
  loggedRows: import('@/domain/summary').WorkoutRow[];
}) {
  const doneCount = loggedRows.filter(
    (r) => (pyFloat(r.weight) ?? 0) > 0 && (pyFloat(r.reps) ?? 0) > 0
  ).length;

  return (
    <View className="rounded-lg border border-border bg-surface p-s4">
      <View className="mb-s2 flex-row items-center justify-between">
        <Text className="flex-1 font-bold text-text">{exercise}</Text>
        <Text className={`text-xs ${doneCount >= targetSets ? 'text-success' : 'text-text-mute'}`}>
          {doneCount}/{targetSets} SETS
        </Text>
      </View>
      <Text className="mb-s3 text-xs text-text-mute">{scheme}</Text>
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

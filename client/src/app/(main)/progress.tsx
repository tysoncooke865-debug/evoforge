import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useBodyweightLog, useWorkoutLog } from '@/data/hooks';
import { pyFloat } from '@/domain/py';
import { normaliseWorkoutLog } from '@/domain/summary';
import { estimated1rm } from '@/domain/workouts';
import { LineChart, type ChartPoint } from '@/ui/line-chart';
import { ScreenHeader } from '@/ui/screen-header';

/**
 * Progress: bodyweight over time, and best e1RM per training day for ANY
 * exercise you have logged -- pick it from the pills (ordered by how much
 * you train it). Two measures on two scales means two charts, never a dual
 * axis.
 */
export default function ProgressScreen() {
  const bodyweights = useBodyweightLog();
  const workouts = useWorkoutLog();

  const validRows = useMemo(
    () =>
      normaliseWorkoutLog(workouts.data ?? []).filter(
        (r) => (pyFloat(r.weight) ?? 0) > 0 && (pyFloat(r.reps) ?? 0) > 0
      ),
    [workouts.data]
  );

  // Exercises you actually train, most-logged first.
  const exercises = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of validRows) {
      const ex = String(r.exercise);
      counts.set(ex, (counts.get(ex) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([ex]) => ex);
  }, [validRows]);

  const [selected, setSelected] = useState<string | null>(null);
  const exercise = selected ?? exercises[0] ?? null;

  const exercisePoints = useMemo<ChartPoint[]>(() => {
    if (!exercise) return [];
    const bestByDay = new Map<string, number>();
    for (const r of validRows) {
      if (String(r.exercise) !== exercise) continue;
      const day = String(r.date);
      const e1 = estimated1rm(pyFloat(r.weight) ?? 0, Math.trunc(pyFloat(r.reps) ?? 0));
      bestByDay.set(day, Math.max(bestByDay.get(day) ?? 0, e1));
    }
    return [...bestByDay.entries()]
      .map(([day, e1]) => ({ x: Date.parse(day), y: e1, label: `${day} · ${e1.toFixed(1)}kg e1RM` }))
      .filter((p) => Number.isFinite(p.x))
      .sort((a, b) => a.x - b.x);
  }, [validRows, exercise]);

  const bwPoints = useMemo<ChartPoint[]>(() => {
    return (bodyweights.data ?? [])
      .map((r) => ({ date: String(r.date), kg: pyFloat(r.bodyweight) ?? 0 }))
      .filter((r) => r.kg > 0)
      .map((r) => ({ x: Date.parse(r.date), y: r.kg, label: `${r.date} · ${r.kg.toFixed(1)}kg` }))
      .filter((p) => Number.isFinite(p.x))
      .sort((a, b) => a.x - b.x);
  }, [bodyweights.data]);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[560px] gap-s4">
        <ScreenHeader kicker="THE RECEIPTS" title="PROGRESS" />

        <View className="rounded-lg border border-border bg-surface p-s4">
          <Text className="mb-s2 text-xs text-text-mute">EXERCISE e1RM · BEST PER DAY</Text>
          {exercises.length === 0 ? (
            <Text className="py-s6 text-center text-xs text-text-mute">
              Log sets on Today and your lifts chart themselves here.
            </Text>
          ) : (
            <>
              <View className="mb-s3 flex-row flex-wrap gap-s1">
                {exercises.slice(0, 8).map((ex) => (
                  <Pressable
                    key={ex}
                    onPress={() => setSelected(ex)}
                    className={`rounded-pill border px-s2 py-s1 ${
                      ex === exercise ? 'border-border-strong bg-surface-3' : 'border-border bg-surface-2'
                    }`}
                  >
                    <Text
                      className={`text-2xs font-bold ${ex === exercise ? 'text-accent' : 'text-text-dim'}`}
                      numberOfLines={1}
                    >
                      {ex}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <LineChart points={exercisePoints} formatY={(y) => y.toFixed(0)} />
            </>
          )}
        </View>

        <View className="rounded-lg border border-border bg-surface p-s4">
          <Text className="mb-s2 text-xs text-text-mute">BODYWEIGHT (KG)</Text>
          <LineChart points={bwPoints} formatY={(y) => y.toFixed(1)} />
        </View>
      </View>
    </ScrollView>
  );
}

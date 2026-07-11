import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useBodyweightLog, useWorkoutLog } from '@/data/hooks';
import { pyFloat } from '@/domain/py';
import { BENCH_EXERCISE, normaliseWorkoutLog } from '@/domain/summary';
import { estimated1rm } from '@/domain/workouts';
import { LineChart, type ChartPoint } from '@/ui/line-chart';

/**
 * Progress: bodyweight and bench e1RM over time. Two measures on two scales
 * means two charts -- never a dual axis. Bench points are the best e1RM per
 * training day, from valid sets only.
 */
export default function ProgressScreen() {
  const bodyweights = useBodyweightLog();
  const workouts = useWorkoutLog();

  const bwPoints = useMemo<ChartPoint[]>(() => {
    return (bodyweights.data ?? [])
      .map((r) => ({ date: String(r.date), kg: pyFloat(r.bodyweight) ?? 0 }))
      .filter((r) => r.kg > 0)
      .map((r) => ({
        x: Date.parse(r.date),
        y: r.kg,
        label: `${r.date} · ${r.kg.toFixed(1)}kg`,
      }))
      .filter((p) => Number.isFinite(p.x))
      .sort((a, b) => a.x - b.x);
  }, [bodyweights.data]);

  const benchPoints = useMemo<ChartPoint[]>(() => {
    const bestByDay = new Map<string, number>();
    for (const r of normaliseWorkoutLog(workouts.data ?? [])) {
      if (String(r.exercise) !== BENCH_EXERCISE) continue;
      const weight = pyFloat(r.weight) ?? 0;
      const reps = pyFloat(r.reps) ?? 0;
      if (weight <= 0 || reps <= 0) continue;
      const day = String(r.date);
      const e1 = estimated1rm(weight, Math.trunc(reps));
      bestByDay.set(day, Math.max(bestByDay.get(day) ?? 0, e1));
    }
    return [...bestByDay.entries()]
      .map(([day, e1]) => ({
        x: Date.parse(day),
        y: e1,
        label: `${day} · ${e1.toFixed(1)}kg e1RM`,
      }))
      .filter((p) => Number.isFinite(p.x))
      .sort((a, b) => a.x - b.x);
  }, [workouts.data]);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[560px] gap-s4">
        <View className="rounded-lg border border-border bg-surface p-s4">
          <Text className="mb-s2 text-xs text-text-mute">BODYWEIGHT (KG)</Text>
          <LineChart points={bwPoints} formatY={(y) => y.toFixed(1)} />
        </View>

        <View className="rounded-lg border border-border bg-surface p-s4">
          <Text className="mb-s2 text-xs text-text-mute">BENCH e1RM (KG) · BEST PER DAY</Text>
          <LineChart points={benchPoints} formatY={(y) => y.toFixed(0)} />
        </View>
      </View>
    </ScrollView>
  );
}

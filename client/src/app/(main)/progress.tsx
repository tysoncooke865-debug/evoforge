import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useBodyweightLog, useCardioLog, useWorkoutLog } from '@/data/hooks';
import { useWorkoutSchedule } from '@/data/schedule';
import { pyFloat } from '@/domain/py';
import {
  METRICS,
  TIMEFRAMES,
  exerciseSeries,
  periodTotals,
  timeframeStart,
  weekStart,
  type MetricKey,
  type TimeframeKey,
} from '@/domain/progress-aggregates';
import { weeklyContract } from '@/domain/scheduled-streak';
import { normaliseWorkoutLog } from '@/domain/summary';
import tokens from '@/theme/tokens';
import { LineChart, type ChartPoint } from '@/ui/line-chart';
import { ScreenHeader } from '@/ui/screen-header';
import { GlowCard, ScreenShell } from '@/ui/shell';

/**
 * Progress: the receipts. THIS WEEK leads (aggregates over the same
 * Monday-start window Home's contract uses — one definition of "this week",
 * in domain/), then the lift chart with metric + timeframe pickers, then
 * bodyweight on its own scale. Two measures on two scales means two charts,
 * never a dual axis.
 */
export default function ProgressScreen() {
  const bodyweights = useBodyweightLog();
  const workouts = useWorkoutLog();
  const cardio = useCardioLog();
  const schedule = useWorkoutSchedule();

  const todayIso = new Date().toISOString().slice(0, 10);
  const [timeframe, setTimeframe] = useState<TimeframeKey>('12W');
  const [metric, setMetric] = useState<MetricKey>('E1RM');
  const [selected, setSelected] = useState<string | null>(null);

  const workoutRows = useMemo(() => workouts.data ?? [], [workouts.data]);
  const cardioRows = useMemo(() => cardio.data ?? [], [cardio.data]);

  // THIS WEEK — the same window Home's weekly contract judges.
  const week = useMemo(
    () => periodTotals(workoutRows, cardioRows, weekStart(todayIso), todayIso),
    [workoutRows, cardioRows, todayIso]
  );
  const contract = useMemo(
    () => weeklyContract(schedule.data ?? [], workoutRows, todayIso),
    [schedule.data, workoutRows, todayIso]
  );
  const hasSchedule = (schedule.data ?? []).length > 0;

  const validRows = useMemo(
    () =>
      normaliseWorkoutLog(workoutRows).filter(
        (r) => (pyFloat(r.weight) ?? 0) > 0 && (pyFloat(r.reps) ?? 0) > 0
      ),
    [workoutRows]
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

  const exercise = selected ?? exercises[0] ?? null;
  const from = timeframeStart(timeframe, todayIso);

  const exercisePoints = useMemo<ChartPoint[]>(() => {
    if (!exercise) return [];
    return exerciseSeries(workoutRows, exercise, metric, from, todayIso)
      .map((p) => ({
        x: Date.parse(p.date),
        y: p.value,
        label: `${p.date} · ${fmtMetric(p.value, metric)}`,
      }))
      .filter((p) => Number.isFinite(p.x));
  }, [workoutRows, exercise, metric, from, todayIso]);

  const bwPoints = useMemo<ChartPoint[]>(() => {
    return (bodyweights.data ?? [])
      .map((r) => ({ date: String(r.date), kg: pyFloat(r.bodyweight) ?? 0 }))
      .filter((r) => r.kg > 0 && (from === null || r.date >= from))
      .map((r) => ({ x: Date.parse(r.date), y: r.kg, label: `${r.date} · ${r.kg.toFixed(1)}kg` }))
      .filter((p) => Number.isFinite(p.x))
      .sort((a, b) => a.x - b.x);
  }, [bodyweights.data, from]);

  return (
    <ScreenShell>
      <ScreenHeader kicker="THE RECEIPTS" title="PROGRESS" />

      {/* A. THIS WEEK — aggregates, not a chart. */}
      <GlowCard>
        <View className="mb-s3 flex-row items-center justify-between">
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            THIS WEEK
          </Text>
          {hasSchedule ? (
            <Text
              className="text-2xs font-bold"
              style={{
                color:
                  contract.target > 0 && contract.done >= contract.target
                    ? tokens.colors.success
                    : tokens.colors.accent,
              }}
            >
              {contract.done} / {contract.target} SESSIONS
            </Text>
          ) : (
            <Text className="text-2xs font-bold text-text-dim">
              {week.sessions} {week.sessions === 1 ? 'SESSION' : 'SESSIONS'}
            </Text>
          )}
        </View>
        <View className="flex-row flex-wrap" style={{ rowGap: 12 }}>
          <Stat value={String(week.sets)} label="SETS" />
          <Stat value={fmtKg(week.volumeKg)} label="VOLUME" tint={tokens.colors.epic} />
          <Stat value={String(Math.trunc(week.cardioMinutes))} label="CARDIO MIN" tint={tokens.colors.rare} />
          <Stat value={`+${week.xp}`} label="XP" tint={tokens.colors.accent} />
        </View>
      </GlowCard>

      {/* B. The lift chart — metric × timeframe × exercise. */}
      <View className="rounded-lg border border-border bg-surface p-s4">
        <View className="mb-s3 flex-row items-center justify-between">
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            LIFT · {metric === 'E1RM' ? 'BEST e1RM PER DAY' : metric === 'VOLUME' ? 'VOLUME PER DAY' : 'SETS PER DAY'}
          </Text>
        </View>

        <View className="mb-s2 flex-row gap-s1">
          {METRICS.map((m) => (
            <Pill key={m} label={m} active={m === metric} onPress={() => setMetric(m)} testID={`metric-${m}`} />
          ))}
        </View>
        <View className="mb-s3 flex-row gap-s1">
          {TIMEFRAMES.map((t) => (
            <Pill
              key={t.key}
              label={t.key}
              active={t.key === timeframe}
              onPress={() => setTimeframe(t.key)}
              testID={`timeframe-${t.key}`}
            />
          ))}
        </View>

        {exercises.length === 0 ? (
          <Text className="py-s6 text-center text-xs text-text-mute">
            Log sets on Train and your lifts chart themselves here.
          </Text>
        ) : (
          <>
            <View className="mb-s3 flex-row flex-wrap gap-s1">
              {exercises.slice(0, 8).map((ex) => (
                <Pressable
                  key={ex}
                  onPress={() => setSelected(ex)}
                  accessibilityRole="button"
                  className={`rounded-pill border px-s2 py-s1 ${
                    ex === exercise ? 'border-border-strong bg-surface-3' : 'border-border bg-surface-2'
                  }`}
                  style={{ minHeight: 44, justifyContent: 'center' }}
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
            {exercisePoints.length === 0 ? (
              <Text className="py-s6 text-center text-xs text-text-mute">
                Nothing logged for this lift in the last {timeframe === 'ALL' ? 'ever' : timeframe}.
              </Text>
            ) : (
              <LineChart points={exercisePoints} formatY={axisFormat(metric, exercisePoints)} />
            )}
          </>
        )}
      </View>

      {/* C. Bodyweight — its own scale. */}
      <View className="rounded-lg border border-border bg-surface p-s4">
        <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
          BODYWEIGHT (KG)
        </Text>
        <LineChart points={bwPoints} formatY={(y) => y.toFixed(1)} />
      </View>
    </ScreenShell>
  );
}

function Stat({ value, label, tint = tokens.colors.text }: { value: string; label: string; tint?: string }) {
  return (
    <View style={{ width: '25%' }}>
      <Text className="text-lg font-bold" style={{ color: tint }} numberOfLines={1}>
        {value}
      </Text>
      <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
        {label}
      </Text>
    </View>
  );
}

function Pill({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      className={`flex-1 items-center justify-center rounded-pill border px-s2 ${
        active ? 'border-border-strong bg-surface-3' : 'border-border bg-surface-2'
      }`}
      style={{ minHeight: 44 }}
    >
      <Text className={`text-2xs font-bold ${active ? 'text-accent' : 'text-text-dim'}`}>{label}</Text>
    </Pressable>
  );
}

function fmtKg(kg: number): string {
  if (kg >= 10000) return `${(kg / 1000).toFixed(1)}t`;
  return `${Math.round(kg)}kg`;
}

/**
 * One unit for the whole axis, chosen from the series' own peak — a
 * per-tick threshold mixed "23.1t" and "6493kg" on the same scale, which
 * reads as two different quantities.
 */
function axisFormat(metric: MetricKey, points: ChartPoint[]): (y: number) => string {
  if (metric !== 'VOLUME') return (y) => y.toFixed(0);
  const peak = Math.max(...points.map((p) => p.y));
  if (peak >= 10000) return (y) => `${(y / 1000).toFixed(1)}t`;
  return (y) => `${Math.round(y)}kg`;
}

function fmtMetric(v: number, metric: MetricKey): string {
  if (metric === 'E1RM') return `${v.toFixed(1)}kg e1RM`;
  if (metric === 'VOLUME') return fmtKg(v);
  return `${v} ${v === 1 ? 'set' : 'sets'}`;
}

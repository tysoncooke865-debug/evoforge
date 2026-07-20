import { useMemo } from 'react';

import { muscleHeatMap } from '@/domain/avatar-stats-calc';
import { pyFloat } from '@/domain/py';
import type { SweepInputs } from '@/domain/achievements';
import type { CardioRow } from '@/domain/summary';

import { useAvatarData } from './use-avatar-data';
import {
  useBodyfatStats,
  useBodyweightLog,
  useCardioLog,
  useTargets,
  useWorkoutLog,
} from './hooks';

/**
 * Assembles the same `SweepInputs` the achievement sweep grants on, but for
 * DISPLAY (the awards screen's progress bars + "next up"). Reads come from the
 * Query cache the rest of the app already warmed — this adds no new round-trip
 * that useAvatarData didn't already make. The grant path (achievement-sweep.ts)
 * stays the authority; this only mirrors it to show how close you are.
 */
export function useAchievementInputs(): { inputs: SweepInputs; ready: boolean } {
  const avatar = useAvatarData(); // summary (totalSets, bestBench1rm, level) + shared reads
  const workouts = useWorkoutLog();
  const cardio = useCardioLog();
  const bodyweights = useBodyweightLog();
  const bf = useBodyfatStats();
  const targets = useTargets();

  const rows = workouts.data ?? [];
  const cardioRows = (cardio.data ?? []) as CardioRow[];
  const bwVals = (bodyweights.data ?? [])
    .map((r) => pyFloat(r.bodyweight) ?? 0)
    .filter((v) => v > 0);

  const bfTargetRows = (targets.data ?? []).filter(
    (t) => String(t.target_type) === 'Body Fat' && String(t.name) === 'Body Fat %'
  );
  const bfTarget =
    bfTargetRows.length > 0
      ? (pyFloat(bfTargetRows[bfTargetRows.length - 1].target_value) ?? null)
      : null;

  const inputs = useMemo<SweepInputs>(
    () => ({
      workoutRows: rows,
      totalSets: avatar.summary.totalSets,
      bestBench1rm: avatar.summary.bestBench1rm,
      level: avatar.summary.level,
      heat: muscleHeatMap(rows),
      bw: {
        latest: bwVals.length > 0 ? bwVals[bwVals.length - 1] : null,
        min: bwVals.length > 0 ? Math.min(...bwVals) : null,
        max: bwVals.length > 0 ? Math.max(...bwVals) : null,
        count: bwVals.length,
      },
      bf: bf.data ?? { latest: null, count: 0 },
      cardio: {
        minutes: cardioRows.reduce((a, r) => a + (pyFloat(r.minutes) ?? 0), 0),
        distance: cardioRows.reduce(
          (a, r) => a + (pyFloat((r as Record<string, unknown>).distance_km) ?? 0),
          0
        ),
        count: cardioRows.length,
        types: new Set(cardioRows.map((r) => String(r.type ?? '')).filter((t) => t !== '')),
      },
      bfTarget,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      rows,
      cardioRows,
      avatar.summary.totalSets,
      avatar.summary.bestBench1rm,
      avatar.summary.level,
      bf.data,
      bfTarget,
      bwVals.length,
    ]
  );

  const ready =
    avatar.ready && !workouts.isPending && !cardio.isPending && !bodyweights.isPending;

  return { inputs, ready };
}

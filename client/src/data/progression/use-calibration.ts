/**
 * The calibration summary, assembled from rows the app already has loaded.
 *
 * Every input is real state: the rating row, the workout index, the cardio
 * log and the athlete's own photo preference. Nothing is defaulted into
 * looking finished — an athlete with no evidence gets a summary that says so
 * (docs/ONBOARDING_V3_SPEC.md §5).
 */

import { useMemo } from 'react';

import { useCardioLog, useProfile, useWorkoutIndex } from '@/data/hooks';
import { calibrationSummary, type CalibrationSummary } from '@/domain/progression/calibration';
import { weekStart } from '@/domain/progress-aggregates';

import { useEvoRatingCurrent } from './use-evo-rating';

export function useCalibration(): { summary: CalibrationSummary; ready: boolean } {
  const rating = useEvoRatingCurrent();
  const index = useWorkoutIndex();
  const cardio = useCardioLog();
  const profile = useProfile();

  const dates = index.data?.byDate;
  const summary = useMemo(() => {
    const days = [...(dates?.keys() ?? [])];
    return calibrationSummary({
      row: (rating.data ?? null) as Record<string, unknown> | null,
      workoutDays: days.length,
      hasCardio: (cardio.data ?? []).length > 0,
      hasPhysiqueBaseline: profile.data?.physique_baseline_at != null,
      photoPromptsDisabled: profile.data?.photo_prompts_disabled === true,
      weeksTrained: new Set(days.map((d) => weekStart(d))).size,
    });
  }, [rating.data, dates, cardio.data, profile.data]);

  return {
    summary,
    ready: !rating.isPending && !index.isPending && !cardio.isPending && !profile.isPending,
  };
}

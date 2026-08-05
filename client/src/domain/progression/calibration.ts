/**
 * THE EVO RATING, WHILE IT IS STILL LEARNING (docs/ONBOARDING_V3_SPEC.md §5).
 *
 * V3 hands over a first workout instead of a complete assessment, so for the
 * first stretch of an athlete's life the rating is genuinely incomplete. The
 * honest way to show an incomplete number is to say which parts of it are
 * incomplete and what moves each one — not to pad it out with defaults until
 * it looks finished.
 *
 * FIVE AREAS, FOUR PILLARS. The athlete sees Training, Strength, Cardio,
 * Physique and Consistency; the rating has four pillars (size, aesthetics,
 * strength, cardio). They are not the same list and the count shown never
 * pretends they are: `pillarsCalibrated` is out of FOUR and is derived from
 * pillar confidence. Training and Consistency are the two areas that explain
 * where the evidence comes from, and Physique folds size + aesthetics, which
 * is what one scan actually moves.
 *
 * Pure: rows in, a description out. Nothing here reads a query.
 */

import { confidenceLabelFor, type PillarKey } from './types';

export type AreaKey = 'training' | 'strength' | 'cardio' | 'physique' | 'consistency';

/** `waiting` = nothing yet · `learning` = evidence arriving · `calibrated` =
 *  enough of it to be trusted · `declined` = the athlete opted out, which is
 *  a settled state and must never be styled as missing. */
export type AreaState = 'waiting' | 'learning' | 'calibrated' | 'declined';

export interface AreaStatus {
  key: AreaKey;
  label: string;
  state: AreaState;
  /** What moves this area — always an action, never a scolding. */
  detail: string;
}

export interface CalibrationInputs {
  /** evo_rating_current, or null when no review has ever run. */
  row: {
    displayed_rating?: unknown;
    overall_confidence?: unknown;
    size_confidence?: unknown;
    aesthetics_confidence?: unknown;
    strength_confidence?: unknown;
    cardio_confidence?: unknown;
    limiting_pillar?: unknown;
    status?: unknown;
  } | null;
  /** Distinct days with a logged set. */
  workoutDays: number;
  /** Any cardio at all. */
  hasCardio: boolean;
  /** A private physique baseline exists (the DATE, never the photos). */
  hasPhysiqueBaseline: boolean;
  /** "Don't ask me again" — a settled preference, honoured everywhere. */
  photoPromptsDisabled: boolean;
  /** Distinct calendar weeks containing at least one logged workout. A
   *  count we can actually derive from the log, rather than a "on contract"
   *  claim that would need a target this card does not read. */
  weeksTrained: number;
}

export interface CalibrationSummary {
  /** True while the rating is not yet worth reading as a finished number. */
  calibrating: boolean;
  rating: number | null;
  confidence: number | null;
  pillarsCalibrated: number;
  pillarsTotal: 4;
  /** The area actually holding the rating back, or null when none is. */
  limiting: PillarKey | null;
  areas: AreaStatus[];
  headline: string;
  sub: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A pillar counts as calibrated once its confidence clears `moderate`. */
function pillarState(confidence: number | null): AreaState {
  if (confidence === null || confidence <= 0) return 'waiting';
  return confidenceLabelFor(confidence) === 'provisional' ? 'learning' : 'calibrated';
}

export function calibrationSummary(input: CalibrationInputs): CalibrationSummary {
  const row = input.row;
  const rating = row ? num(row.displayed_rating) : null;
  const confidence = row ? num(row.overall_confidence) : null;

  const strengthC = row ? num(row.strength_confidence) : null;
  const cardioC = row ? num(row.cardio_confidence) : null;
  const sizeC = row ? num(row.size_confidence) : null;
  const aestheticsC = row ? num(row.aesthetics_confidence) : null;
  // Physique is one area over two pillars: the weaker one is the honest one.
  const physiqueC =
    sizeC === null || aestheticsC === null ? (sizeC ?? aestheticsC) : Math.min(sizeC, aestheticsC);

  const pillarsCalibrated = [strengthC, cardioC, sizeC, aestheticsC].filter(
    (c) => pillarState(c) === 'calibrated'
  ).length;

  const trainingState: AreaState = input.workoutDays > 0 ? 'calibrated' : 'waiting';
  const physiqueState: AreaState = input.photoPromptsDisabled
    ? 'declined'
    : input.hasPhysiqueBaseline
      ? pillarState(physiqueC)
      : 'waiting';
  const consistencyState: AreaState =
    input.weeksTrained >= 4 ? 'calibrated' : input.weeksTrained > 0 ? 'learning' : 'waiting';

  const areas: AreaStatus[] = [
    {
      key: 'training',
      label: 'Training',
      state: trainingState,
      detail:
        input.workoutDays === 0
          ? 'Starts after your first workout'
          : `${input.workoutDays} training ${input.workoutDays === 1 ? 'day' : 'days'} logged`,
    },
    {
      key: 'strength',
      label: 'Strength',
      state: pillarState(strengthC),
      detail:
        pillarState(strengthC) === 'waiting'
          ? 'Learns from logged sets'
          : pillarState(strengthC) === 'learning'
            ? 'Learning — a few more sessions sharpen it'
            : 'Calibrated from your logged sets',
    },
    {
      key: 'cardio',
      label: 'Cardio',
      state: input.hasCardio ? pillarState(cardioC) : 'waiting',
      detail: input.hasCardio
        ? 'Learning from your cardio'
        : 'Add a run or a benchmark whenever you like',
    },
    {
      key: 'physique',
      label: 'Physique',
      state: physiqueState,
      // The one area that must never read as an outstanding task.
      detail:
        physiqueState === 'declined'
          ? 'Not used — you turned photo prompts off'
          : physiqueState === 'waiting'
            ? 'Optional private calibration'
            : 'Calibrated from your private baseline',
    },
    {
      key: 'consistency',
      label: 'Consistency',
      state: consistencyState,
      detail:
        input.weeksTrained === 0
          ? 'Builds over time'
          : `${input.weeksTrained} ${input.weeksTrained === 1 ? 'week' : 'weeks'} trained`,
    },
  ];

  const calibrating = row === null || String(row.status ?? 'provisional') === 'provisional';
  const limitingRaw = row ? String(row.limiting_pillar ?? '') : '';
  const limiting = (['size', 'aesthetics', 'strength', 'cardio'] as PillarKey[]).includes(
    limitingRaw as PillarKey
  )
    ? (limitingRaw as PillarKey)
    : null;

  return {
    calibrating,
    rating,
    confidence,
    pillarsCalibrated,
    pillarsTotal: 4,
    limiting,
    areas,
    headline:
      rating === null
        ? 'CALIBRATING'
        : calibrating
          ? `${Math.round(rating)} · PROVISIONAL`
          : `${Math.round(rating)}`,
    sub:
      rating === null
        ? input.workoutDays === 0
          ? 'Log your first workout to begin your rating.'
          : 'Your first rating arrives with your next review.'
        : calibrating
          ? `Provisional · ${pillarsCalibrated} of 4 areas calibrated`
          : `${pillarsCalibrated} of 4 areas calibrated`,
  };
}

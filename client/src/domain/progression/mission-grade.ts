/**
 * THE MISSION GRADE (2026-08-03, TRAIN brief) — "Introduce optional grading.
 * S / A+ / A / B / C. Users should naturally chase higher grades."
 *
 * ---- WHAT THIS IS ALLOWED TO READ ----
 *
 * The brief listed five inputs: completion, consistency, intensity, tempo and
 * rest-timer adherence. Three of those exist as data and two do not:
 *
 *   COMPLETION   sets logged against the sets the plan asked for. Always real.
 *   OVERLOAD     this session's tonnage against the athlete's OWN last session
 *                of the same workout. Real wherever a previous session exists;
 *                this is "intensity" measured the only honest way — against
 *                yourself, not against a table.
 *   PACE         the median gap between consecutive sets, from `workout_log`'s
 *                per-set `timestamp`. This is as close to "tempo / rest
 *                adherence" as the schema can get, and it REFUSES rather than
 *                guesses (see sessionPace).
 *
 * There is no RPE column and the rest timer persists nothing, so a grade that
 * claimed to read effort or timer adherence would be inventing them. It does
 * not. Streak and PRs ride as bonuses because they are true and they are the
 * two things worth chasing, but neither can rescue an abandoned session.
 *
 * ---- WHY UNMEASURED FACTORS SCORE NEUTRAL, NOT ZERO ----
 *
 * The first time an athlete trains a workout there is no previous session, so
 * OVERLOAD cannot be computed. Scoring it zero would hand a perfect session a
 * C for the crime of being the first one; scoring it full would make the grade
 * meaningless. It scores NEUTRAL (0.6) and the factor says "NOT MEASURED" on
 * the card — the athlete is told exactly which parts of their grade were
 * judged and which were not. A neutral fill that is disclosed is a scoring
 * convention; one that is hidden would be a fabrication.
 *
 * Nothing here touches the clock or the network: the caller passes the
 * session's own numbers in.
 */

export type MissionGradeKey = 'S' | 'A+' | 'A' | 'B' | 'C';

export interface GradeFactor {
  key: 'completion' | 'overload' | 'pace';
  label: string;
  /** 0–1 of this factor's weight, after the neutral rule. */
  earned: number;
  /** Points this factor contributes to the 100. */
  weight: number;
  /** The one line shown under the factor — "18 / 20 SETS", "NOT MEASURED". */
  detail: string;
  /** False when the neutral fill was applied instead of a real measurement. */
  measured: boolean;
}

export interface MissionGrade {
  grade: MissionGradeKey;
  /** 0–100, rounded. */
  score: number;
  factors: GradeFactor[];
  /** Points added on top of the weighted factors, and why. */
  bonuses: { label: string; points: number }[];
}

export interface MissionGradeInput {
  setsDone: number;
  /** The plan's ask. 0 for an ad-hoc workout — completion then goes neutral. */
  setsTarget: number;
  /** Σ weight × reps over this session's counted sets, kilograms. */
  volumeKg: number;
  /** The same total for the athlete's previous session of THIS workout, or
   *  null when they have never trained it before. */
  previousVolumeKg: number | null;
  /** sessionPace(...).medianGapSeconds, or null when it refused. */
  medianGapSeconds: number | null;
  prCount: number;
  /** Current streak in days — a bonus only. */
  streakDays: number;
}

/** The weighted factors. They sum to 100 before bonuses. */
const WEIGHTS = { completion: 55, overload: 25, pace: 20 } as const;

/** Applied to a factor that could not be measured. Disclosed on the card. */
export const NEUTRAL = 0.6;

/**
 * A pace this fast is not training — it is a session being typed in
 * afterwards, and it must not be scored as though it were rushed.
 */
export const PACE_MIN_GAP_S = 12;
/** Beyond this the athlete stopped and came back; not a rest interval. */
export const PACE_MAX_GAP_S = 900;
/** Fewer gaps than this and a median means nothing. */
export const PACE_MIN_SETS = 4;

export interface SessionPace {
  /** Median seconds between consecutive sets. */
  medianGapSeconds: number;
  /** First set to last set, in whole minutes (>= 1). */
  minutes: number;
  /** Sets the pace was measured across. */
  sets: number;
}

/**
 * The session's rhythm, from the per-set timestamps `workout_log` already
 * stores. Returns null — and the grade goes neutral — in every case where the
 * timestamps do not describe someone actually training:
 *
 *   - fewer than PACE_MIN_SETS sets (a median over two gaps is noise),
 *   - any unparseable or out-of-order stamp (a queued offline flush can land
 *     rows in a different order than they were performed),
 *   - a median gap over PACE_MAX_GAP_S (they left and came back), or
 *   - a median gap under PACE_MIN_GAP_S (the whole session was typed in at
 *     once, which is a legitimate thing to do and must not be graded).
 */
export function sessionPace(timestamps: readonly (string | number | null | undefined)[]): SessionPace | null {
  const times: number[] = [];
  for (const raw of timestamps) {
    if (raw === null || raw === undefined) return null;
    const ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
    if (!Number.isFinite(ms)) return null;
    times.push(ms);
  }
  if (times.length < PACE_MIN_SETS) return null;
  times.sort((a, b) => a - b);

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / 1000);
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (!(median >= PACE_MIN_GAP_S) || median > PACE_MAX_GAP_S) return null;

  const spanMinutes = (times[times.length - 1] - times[0]) / 60000;
  return {
    medianGapSeconds: Math.round(median),
    minutes: Math.max(1, Math.round(spanMinutes)),
    sets: times.length,
  };
}

/**
 * Pace → 0–1. The plateau is the rest range resistance training is actually
 * prescribed in (45s–180s; the app's own rest timer defaults to 120s), and it
 * falls off on both sides rather than rewarding one "correct" number: an
 * athlete resting 30 seconds between heavy squats and one resting eight
 * minutes are both training worse than the one in the middle.
 */
export function paceScore(medianGapSeconds: number): number {
  const g = medianGapSeconds;
  if (g >= 45 && g <= 180) return 1;
  if (g < 45) return Math.max(0.5, 0.5 + ((g - PACE_MIN_GAP_S) / (45 - PACE_MIN_GAP_S)) * 0.5);
  // 180s → 1.0 decaying to 0.4 at 600s and holding there.
  return Math.max(0.4, 1 - ((g - 180) / (600 - 180)) * 0.6);
}

/**
 * Tonnage ratio → 0–1. Matching the last session is a PASS, not a failure —
 * but only BEATING it scores full, which is what makes S worth chasing: a
 * complete session at last week's exact weight lands A+, and the last five
 * points are the ones progressive overload buys.
 */
export function overloadScore(volumeKg: number, previousVolumeKg: number): number {
  if (!(previousVolumeKg > 0)) return NEUTRAL;
  const ratio = volumeKg / previousVolumeKg;
  if (ratio >= 1.05) return 1;
  if (ratio >= 1.0) return 0.8;
  if (ratio >= 0.95) return 0.65;
  if (ratio >= 0.85) return 0.45;
  return 0.25;
}

const THRESHOLDS: readonly [MissionGradeKey, number][] = [
  ['S', 96],
  ['A+', 89],
  ['A', 78],
  ['B', 62],
];

export function gradeFor(score: number): MissionGradeKey {
  for (const [grade, floor] of THRESHOLDS) if (score >= floor) return grade;
  return 'C';
}

export function gradeMission(input: MissionGradeInput): MissionGrade {
  const factors: GradeFactor[] = [];

  // ---- COMPLETION ----
  const target = Math.max(0, Math.trunc(input.setsTarget));
  const done = Math.max(0, Math.trunc(input.setsDone));
  if (target > 0) {
    factors.push({
      key: 'completion',
      label: 'COMPLETION',
      earned: Math.min(1, done / target),
      weight: WEIGHTS.completion,
      detail: `${done} / ${target} SETS`,
      measured: true,
    });
  } else {
    // An ad-hoc workout has no plan to complete. It is not a failure to
    // finish a session nobody scheduled.
    factors.push({
      key: 'completion',
      label: 'COMPLETION',
      earned: done > 0 ? 1 : NEUTRAL,
      weight: WEIGHTS.completion,
      detail: done > 0 ? `${done} SETS · NO PLAN TARGET` : 'NOT MEASURED',
      measured: done > 0,
    });
  }

  // ---- OVERLOAD ----
  const prev = input.previousVolumeKg;
  if (prev !== null && prev > 0 && input.volumeKg > 0) {
    const pct = Math.round((input.volumeKg / prev - 1) * 100);
    factors.push({
      key: 'overload',
      label: 'OVERLOAD',
      earned: overloadScore(input.volumeKg, prev),
      weight: WEIGHTS.overload,
      detail: `${pct >= 0 ? '+' : ''}${pct}% VOLUME VS LAST TIME`,
      measured: true,
    });
  } else {
    factors.push({
      key: 'overload',
      label: 'OVERLOAD',
      earned: NEUTRAL,
      weight: WEIGHTS.overload,
      detail: prev === null ? 'FIRST TIME — NOTHING TO BEAT' : 'NOT MEASURED',
      measured: false,
    });
  }

  // ---- PACE ----
  if (input.medianGapSeconds !== null) {
    factors.push({
      key: 'pace',
      label: 'PACE',
      earned: paceScore(input.medianGapSeconds),
      weight: WEIGHTS.pace,
      detail: `${Math.round(input.medianGapSeconds)}S BETWEEN SETS`,
      measured: true,
    });
  } else {
    factors.push({
      key: 'pace',
      label: 'PACE',
      earned: NEUTRAL,
      weight: WEIGHTS.pace,
      detail: 'NOT MEASURED',
      measured: false,
    });
  }

  const base = factors.reduce((n, f) => n + f.earned * f.weight, 0);

  const bonuses: { label: string; points: number }[] = [];
  const prs = Math.max(0, Math.trunc(input.prCount));
  if (prs > 0) bonuses.push({ label: prs === 1 ? 'PERSONAL RECORD' : `${prs} PERSONAL RECORDS`, points: Math.min(12, prs * 6) });
  if (input.streakDays >= 7) bonuses.push({ label: `${Math.trunc(input.streakDays)}-DAY STREAK`, points: 4 });

  // ---- THE COMPLETION CEILING ----
  //
  // Without this, three personal records and a long streak lifted a session
  // abandoned after four of twenty sets to a B. The records are real and the
  // streak is real, but neither of them is a thing that happened to THIS
  // MISSION, and a grade that says otherwise teaches an athlete that quitting
  // early is survivable if the first lift went well. The mission's grade is
  // capped by how much of the mission was actually completed: everything is
  // available at 100%, and the ceiling falls linearly to 40 at zero.
  const completion = factors.find((f) => f.key === 'completion')!.earned;
  const ceiling = 40 + 60 * completion;

  const score = Math.max(
    0,
    Math.min(100, ceiling, Math.round(base + bonuses.reduce((n, b) => n + b.points, 0)))
  );
  return { grade: gradeFor(Math.round(score)), score: Math.round(score), factors, bonuses };
}

/**
 * Σ weight × reps over counted sets — the tonnage OVERLOAD compares.
 *
 * The fields are OPTIONAL and `unknown` because that is what `workout_log`
 * rows actually are: numeric columns that arrive as strings from PostgREST and
 * are absent on a malformed row. Coercion and the "is this a set" test both
 * happen here rather than at the call site, so every caller gets the same
 * answer (domain/py.ts's rule, applied to one narrow case).
 */
export function sessionVolumeKg(
  rows: readonly { weight?: unknown; reps?: unknown }[]
): number {
  let total = 0;
  for (const r of rows) {
    const w = Number(r.weight);
    const reps = Number(r.reps);
    if (!Number.isFinite(w) || !Number.isFinite(reps)) continue;
    if (!(w >= 0) || !(reps > 0)) continue;
    total += w * reps;
  }
  return Math.round(total);
}

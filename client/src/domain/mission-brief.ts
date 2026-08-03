/**
 * TRAIN 2026-08-03 — THE MISSION BRIEF'S LANGUAGE.
 *
 * The brief asked that the Train card stop reading like a form and start
 * reading like a briefing: an OBJECTIVE ("Build width & V-taper"), a
 * DIFFICULTY, and — when a muscle is tapped — what that muscle is actually
 * FOR. All three are derived here, purely, from what the plan already knows.
 *
 * WHY EVERY LINE IN THIS FILE IS DERIVED AND NOT WRITTEN PER WORKOUT. Athletes
 * name their own days ("Pull II", "Back/Bis", "Tuesday"), import 848-exercise
 * libraries and forge AI plans — nothing can be keyed to a day NAME. The one
 * thing the app always knows about a session is which muscles its exercises
 * tag, so the objective is a statement about THAT SET OF MUSCLES, and it is
 * true whatever the day is called.
 *
 * WHAT "DIFFICULTY" HONESTLY MEANS HERE: the day's PLANNED SET VOLUME, banded.
 * It is not an RPE and does not claim to be — nothing in the plan carries load
 * intensity before the sets are logged, so a difficulty that claimed to read
 * effort would be inventing it. `difficultyFor` returns null at zero sets
 * rather than calling an empty day "light".
 */

import { MUSCLE_ZONE, type MuscleId } from './muscle-map';

/* ------------------------------------------------------------------ *
 * THE OBJECTIVE
 * ------------------------------------------------------------------ */

/** The training themes a set of muscles can belong to. */
export type MissionTheme = 'width' | 'push' | 'arms' | 'legs' | 'core' | 'upper' | 'full';

/**
 * Each region's theme. Shoulders sit with `push` because the map has ONE
 * shoulder region: front, side and rear delts all normalise to `shoulders`
 * (domain/muscle-map TABLE), so a rear-delt row and an overhead press are
 * indistinguishable by the time they reach here. A pull day still resolves to
 * `width` — lats + upper back outvote the single shoulder tag, which is
 * exactly the arithmetic the tie-break below relies on.
 */
const THEME: Readonly<Record<MuscleId, Exclude<MissionTheme, 'upper' | 'full'>>> = {
  lats: 'width',
  upperBack: 'width',
  traps: 'width',
  chest: 'push',
  triceps: 'push',
  shoulders: 'push',
  biceps: 'arms',
  forearms: 'arms',
  quads: 'legs',
  hamstrings: 'legs',
  glutes: 'legs',
  calves: 'legs',
  abductors: 'legs',
  adductors: 'legs',
  abs: 'core',
  obliques: 'core',
  lowerBack: 'core',
};

/** Ties break by this order — the theme that most defines a session wins. */
const PRIORITY: readonly Exclude<MissionTheme, 'upper' | 'full'>[] = [
  'width',
  'push',
  'legs',
  'arms',
  'core',
];

/**
 * The one-line objective. Sentence case (it renders beside a target glyph as
 * prose, not as a label), no trailing stop.
 */
export const THEME_OBJECTIVE: Readonly<Record<MissionTheme, string>> = {
  width: 'Build width & V-taper',
  push: 'Build pressing power & upper-body size',
  arms: 'Build arm size & definition',
  legs: 'Build lower-body power & leg size',
  core: 'Build core strength & stability',
  upper: 'Build upper-body size & strength',
  full: 'Build total-body strength',
};

/**
 * Which theme a day belongs to, or null when it targets nothing the map
 * recognises. A tie between two themes resolves to `full` when the tied
 * themes span both halves of the body and to `upper` when they are all upper;
 * a tie inside one half that includes legs cannot span, so PRIORITY decides.
 */
export function missionThemeFor(muscles: readonly MuscleId[]): MissionTheme | null {
  const unique = [...new Set(muscles)];
  if (unique.length === 0) return null;

  const counts = new Map<Exclude<MissionTheme, 'upper' | 'full'>, number>();
  for (const m of unique) {
    const theme = THEME[m];
    counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }

  let max = 0;
  for (const n of counts.values()) if (n > max) max = n;
  const tied = PRIORITY.filter((t) => counts.get(t) === max);
  if (tied.length === 1) return tied[0];

  // A genuine tie. Does the tied group span the body?
  const zones = new Set<string>();
  for (const m of unique) if (tied.includes(THEME[m])) zones.add(MUSCLE_ZONE[m]);
  if (zones.size > 1) return 'full';
  if (zones.has('lower')) return 'legs';
  return 'upper';
}

/** The briefing's MISSION OBJECTIVE line, or null when nothing is targeted. */
export function missionObjectiveFor(muscles: readonly MuscleId[]): string | null {
  const theme = missionThemeFor(muscles);
  return theme === null ? null : THEME_OBJECTIVE[theme];
}

/* ------------------------------------------------------------------ *
 * DIFFICULTY
 * ------------------------------------------------------------------ */

export type DifficultyKey = 'light' | 'normal' | 'hard' | 'brutal';

export interface Difficulty {
  key: DifficultyKey;
  /** Display label — the card renders it verbatim. */
  label: string;
  /** 1–4, for the signal-bars glyph beside it. */
  bars: 1 | 2 | 3 | 4;
}

/**
 * Bands over PLANNED SETS. The boundaries are the ones the estimate curve
 * already implies (estimateMinutes: 20 sets ≈ 55 minutes), so a "NORMAL" day
 * is roughly an hour and "BRUTAL" is the volume that genuinely runs long.
 *
 * Zero sets returns null. An unplanned day is not an easy day — it is not a
 * day, and a card that says "LIGHT" over an empty plan is lying about work
 * that does not exist.
 */
export function difficultyFor(plannedSets: number): Difficulty | null {
  const sets = Number.isFinite(plannedSets) ? Math.trunc(plannedSets) : 0;
  if (sets <= 0) return null;
  if (sets < 12) return { key: 'light', label: 'LIGHT', bars: 1 };
  if (sets <= 20) return { key: 'normal', label: 'NORMAL', bars: 2 };
  if (sets <= 28) return { key: 'hard', label: 'HARD', bars: 3 };
  return { key: 'brutal', label: 'BRUTAL', bars: 4 };
}

/* ------------------------------------------------------------------ *
 * WHAT A MUSCLE IS FOR
 * ------------------------------------------------------------------ */

/**
 * PRIMARY FUNCTION, for the tapped-muscle sheet. Anatomy, not motivation:
 * each line says what the region DOES, so an athlete who taps "Lats" learns
 * something true rather than being sold their own plan back.
 *
 * Deliberately absent: any "estimated growth" figure. Hypertrophy from a
 * single planned session is not predictable from sets — see
 * domain/progression/session-evidence.ts for the same refusal on the Evo side.
 * The sheet shows planned sets and the week's real volume instead.
 */
export const MUSCLE_FUNCTION: Readonly<Record<MuscleId, string>> = {
  chest: 'Presses the arms forward and across the body — the drive in every push.',
  shoulders: 'Raises and rotates the arm in every direction — the width of your frame.',
  biceps: 'Bends the elbow and turns the palm up — every pull finishes here.',
  triceps: 'Straightens the elbow — two thirds of your arm, and every lockout.',
  forearms: 'Grips, and holds the wrist steady — the limit on how much you can hold.',
  abs: 'Braces the trunk and resists bending — the link between upper and lower body.',
  obliques: 'Rotates and side-bends the trunk — everything that twists.',
  traps: 'Lifts, pulls back and steadies the shoulder blades — the yoke.',
  upperBack: 'Draws the shoulder blades together — thickness, and posture.',
  lats: 'Pulls the arms down and back — the width that makes the V-taper.',
  lowerBack: 'Holds the spine extended under load — what keeps a heavy lift safe.',
  glutes: 'Drives the hips forward — the strongest muscle you own.',
  quads: 'Straightens the knee — every squat, every step up.',
  hamstrings: 'Bends the knee and extends the hip — the brake and the hinge.',
  calves: 'Pushes off the ground — every stride and every jump.',
  abductors: 'Takes the leg out to the side and steadies the pelvis on one leg.',
  adductors: 'Pulls the leg back in — the inner thigh, and squat stability.',
};

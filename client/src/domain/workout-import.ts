import type { PlanExercise } from './custom-plan';
import { rankExercises } from './exercise-rank';
import type { LibraryExercise } from './exercise-taxonomy';

/**
 * PLAN SCAN — the deterministic half of "best guess" (2026-07-15).
 *
 * The AI transcribes and normalizes; THIS module decides what lands in the
 * plan. Every scanned name is re-ranked against the real corpus (the 960
 * library + the athlete's own customs), so a hallucinated exercise cannot
 * reach MY PLAN: only corpus names survive, and anything the corpus cannot
 * claim stays as the page's own words, flagged `unmatched` for the athlete
 * to fix or keep as a custom.
 *
 * Confidence is the MATCH CLASS, not the score's decoration: the ranking
 * engine's classes sit ≥2,000 apart while context/popularity nudges stay
 * well under that, so thresholding on the class boundaries is stable.
 */

export interface ImportedExercise {
  raw: string;
  exercise: string;
  sets: number;
  reps: string;
}

export interface ImportedDay {
  day: string;
  exercises: ImportedExercise[];
}

export type MatchConfidence = 'exact' | 'close' | 'guess' | 'unmatched';

export interface MappedExercise extends PlanExercise {
  /** What the page said, verbatim. */
  raw: string;
  confidence: MatchConfidence;
}

export interface MappedDay {
  day: string;
  exercises: MappedExercise[];
}

/** Word-prefix class floor (S_WORD in exercise-rank). At/above = 'close'. */
const CLOSE_FLOOR = 5_000;

const norm = (s: string) => s.trim().toLowerCase();

function matchOne(
  name: string,
  raw: string,
  library: readonly LibraryExercise[]
): { exercise: string; muscleKnown: boolean; confidence: MatchConfidence } {
  // Exact corpus name (either the normalized guess or the raw text) wins flat.
  const exactHit = library.find((e) => norm(e.name) === norm(name) || norm(e.name) === norm(raw));
  if (exactHit) return { exercise: exactHit.name, muscleKnown: true, confidence: 'exact' };

  // Rank WITHOUT context: import mapping must not depend on what the athlete
  // trained last week — same photo, same plan, every time.
  const hit =
    rankExercises(library, { query: name, limit: 1 })[0] ??
    rankExercises(library, { query: raw, limit: 1 })[0];
  if (!hit) return { exercise: raw, muscleKnown: false, confidence: 'unmatched' };
  return {
    exercise: hit.exercise.name,
    muscleKnown: true,
    confidence: hit.score >= CLOSE_FLOOR ? 'close' : 'guess',
  };
}

/** The whole scanned plan, mapped onto the corpus. Days keep their names;
 *  duplicate mappings within a day collapse to the first (a page that lists
 *  "bench" twice is a superset scheme, not two plan slots). */
export function mapImportedPlan(
  days: readonly ImportedDay[],
  library: readonly LibraryExercise[]
): MappedDay[] {
  const out: MappedDay[] = [];
  for (const d of days) {
    const seen = new Set<string>();
    const exercises: MappedExercise[] = [];
    for (const e of d.exercises) {
      const m = matchOne(e.exercise, e.raw, library);
      const key = norm(m.exercise);
      if (seen.has(key)) continue;
      seen.add(key);
      exercises.push({
        exercise: m.exercise,
        sets: Math.max(1, Math.min(8, Math.trunc(e.sets) || 3)),
        reps: e.reps || '8-12',
        reason: m.confidence === 'exact' ? '' : `Read as “${e.raw}”`,
        raw: e.raw,
        confidence: m.confidence,
      });
    }
    if (exercises.length > 0) out.push({ day: d.day, exercises });
  }
  return out;
}

/**
 * "5x5", "3 x 8-12", "4×10", "3 sets of 12", "AMRAP" — what gym notes
 * actually say, folded to (sets, reps-scheme). Null when unparseable —
 * the caller keeps its defaults.
 */
export function parseSetsReps(raw: string): { sets: number; reps: string } | null {
  const s = raw.trim().toLowerCase();
  if (s === '') return null;

  // "NxM" / "N x M-K" / "N×M"
  const x = s.match(/^(\d{1,2})\s*[x×]\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3})?)$/);
  if (x) {
    return {
      sets: Math.max(1, Math.min(8, parseInt(x[1], 10))),
      reps: x[2].replace(/\s*[-–]\s*/, '-'),
    };
  }

  // "N sets of M(-K)"
  const of = s.match(/^(\d{1,2})\s*sets?\s*(?:of|x)?\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3})?)$/);
  if (of) {
    return {
      sets: Math.max(1, Math.min(8, parseInt(of[1], 10))),
      reps: of[2].replace(/\s*[-–]\s*/, '-'),
    };
  }

  if (/^amrap$/.test(s)) return { sets: 3, reps: 'AMRAP' };

  return null;
}

/**
 * RECOMMENDED EXERCISES, FOR THIS ATHLETE AND THIS SESSION.
 *
 * "PREFILL WITH RECOMMENDED EXERCISES" used to run the SEARCH ranker, whose
 * top sections are `suggested` (driven by training history) and `popular`.
 * A brand-new athlete has no history, so `suggested` was empty and the list
 * degraded to library order — which is alphabetical. Tyson's Shoulders-focused
 * session was offered Ab Wheel Rollout, Arnold Press, Assisted Pull-Up,
 * Barbell Back Squat, Barbell Bench Press and Barbell Bent-Over Row: one
 * shoulder movement in six, and a squat and a bench in a shoulder workout.
 *
 * This picks from the same library and never needs history. It reads what the
 * athlete has actually told us — goal, experience, equipment, how long they
 * have — and what the session is FOR, then sequences it the way a coach would:
 * compounds first, isolation after, nothing they cannot physically perform
 * with the kit they said they have.
 *
 * Pure. Library in, a short ordered session out.
 */

import { MUSCLE_GROUPS, type Equipment, type LibraryExercise } from './exercise-taxonomy';
import type { EquipmentAccess, ExperienceLevel, OnboardingGoal } from './onboarding-v3';

export interface StarterExercise {
  exercise: string;
  sets: number;
  reps: string;
}

export interface StarterRequest {
  goal: OnboardingGoal | null;
  experience: ExperienceLevel | null;
  equipment: EquipmentAccess | null;
  /** Typical session length in minutes. */
  sessionMinutes: number | null;
  /** Muscle tags the session is centred on. Empty = a full-body session. */
  targetMuscles: readonly string[];
  library: readonly LibraryExercise[];
  /** Names already chosen — never offered twice. */
  exclude?: readonly string[];
}

/** What each equipment answer actually permits. */
const ALLOWED: Record<EquipmentAccess, readonly Equipment[] | null> = {
  // null = no restriction.
  full_gym: null,
  unsure: null,
  home_basic: ['Bodyweight', 'Dumbbell', 'Band', 'Kettlebell', 'Other'],
  bodyweight: ['Bodyweight', 'Band'],
};

/** Rep ranges follow the goal, because that is what a rep range IS. */
const REPS: Record<OnboardingGoal, string> = {
  get_stronger: '4-6',
  build_muscle: '8-12',
  lose_fat: '10-15',
  improve_fitness: '10-15',
  be_consistent: '8-12',
  track_program: '8-12',
};

/**
 * How many exercises fit. Time sets the ceiling, experience lowers it — a
 * first session that takes ninety minutes is a session somebody does once.
 */
export function exerciseCountFor(
  minutes: number | null,
  experience: ExperienceLevel | null
): number {
  const byTime = minutes === null ? 4 : minutes <= 30 ? 3 : minutes <= 45 ? 4 : minutes <= 60 ? 5 : 6;
  const cap = experience === 'new' ? 4 : experience === 'occasional' ? 5 : 6;
  return Math.max(3, Math.min(byTime, cap));
}

function setsFor(experience: ExperienceLevel | null, compound: boolean): number {
  if (experience === 'new') return 3;
  if (experience === 'occasional') return compound ? 4 : 3;
  return compound ? 4 : 3;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * COARSE IN, FINE OUT. `inferMuscleGroup` speaks the parity-pinned coarse
 * vocabulary ("Shoulders", "Back"); the LIBRARY tags exercises finely ("Front
 * Delts", "Side Delts", "Rear Delts", "Back Width"). Matching the two
 * directly found five exercises out of nine hundred and sixty and returned an
 * empty session — the first version of this file shipped that bug, and the
 * browser found it.
 *
 * MUSCLE_GROUPS is the map that already exists for this. A tag that IS a
 * library tag passes through untouched, so callers can name either.
 */
export function expandMuscleTargets(targets: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of targets) {
    const key = norm(t);
    out.add(key);
    for (const g of MUSCLE_GROUPS) {
      if (norm(g.label) === key || g.key === key) {
        for (const m of g.muscles) out.add(norm(m));
      }
      for (const sub of g.subgroups ?? []) {
        if (norm(sub.label) === key || sub.key === key) {
          for (const m of sub.muscles) out.add(norm(m));
        }
      }
    }
  }
  return out;
}

/**
 * What muscles does a typed session name mean?
 *
 * The sheet ran the typed text through `inferMuscleGroup`, which reads
 * EXERCISE names ("Barbell Bench Press" -> Chest). Handed the word
 * "Shoulders" it returns **"Other"** — its fallback — so a shoulders session
 * targeted a tag no exercise carries and came back empty. The browser caught
 * this; the unit tests could not, because they passed the tags directly.
 *
 * Group names are checked FIRST, against the taxonomy that owns them. Only
 * then does the exercise-name inference get a turn, and "Other" is treated as
 * what it is: no answer, so a full-body session rather than an empty one.
 */
export function targetMusclesFromText(
  text: string,
  inferFromExerciseName: (name: string) => string | null
): string[] {
  const key = norm(text);
  if (key === '') return [];

  for (const g of MUSCLE_GROUPS) {
    if (g.key === 'all') continue;
    if (norm(g.label) === key || g.key === key) return [g.label];
    for (const sub of g.subgroups ?? []) {
      if (norm(sub.label) === key || sub.key === key) return [...sub.muscles];
    }
    // "Shoulder Day", "Chest and Back" — the group name inside a longer title.
    if (key.includes(norm(g.label))) return [g.label];
  }
  // A library tag typed exactly ("Front Delts").
  for (const g of MUSCLE_GROUPS) {
    for (const m of g.muscles) if (norm(m) === key) return [m];
  }

  const inferred = inferFromExerciseName(text);
  return inferred && norm(inferred) !== 'other' ? [inferred] : [];
}

export function recommendStarter(req: StarterRequest): StarterExercise[] {
  const excluded = new Set((req.exclude ?? []).map(norm));
  const allowed = req.equipment ? ALLOWED[req.equipment] : null;
  const allowedSet = allowed ? new Set<string>(allowed) : null;
  const targets = expandMuscleTargets(req.targetMuscles);

  const candidates = req.library.filter((e) => {
    if (!e.name || excluded.has(norm(e.name))) return false;
    // Kit they said they have. An unknown equipment tag is allowed through —
    // refusing on missing metadata would silently shrink the library.
    if (allowedSet && e.equipment && !allowedSet.has(e.equipment)) return false;
    // A beginner is not handed Advanced movements on session one.
    if (req.experience === 'new' && e.difficulty === 'Advanced') return false;
    return true;
  });

  const score = (e: LibraryExercise): number => {
    let n = 0;
    if (targets.size > 0) {
      if (targets.has(norm(e.muscle))) n += 100;
      if ((e.secondary ?? []).some((m) => targets.has(norm(m)))) n += 30;
      // Off-target work is not "recommended" for a targeted session.
      if (n === 0) n -= 200;
    }
    if (e.category === 'Compound') n += 12;
    if (req.experience === 'new' && e.difficulty === 'Beginner') n += 10;
    n += (e.popularity ?? 0) / 20;
    return n;
  };

  const ranked = [...candidates]
    .map((e) => ({ e, s: score(e) }))
    .filter((x) => x.s > -100) // never fill a targeted session with off-target work
    .sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name))
    .map((x) => x.e);

  const want = exerciseCountFor(req.sessionMinutes, req.experience);
  const chosen: LibraryExercise[] = [];
  const perMuscle = new Map<string, number>();
  // Two per muscle tag when the session is FOR that muscle, one otherwise —
  // that is the difference between a shoulder session and six shoulder
  // presses, and between a full-body day and three chest movements.
  const cap = targets.size > 0 ? 2 : 1;

  for (const pass of [0, 1]) {
    for (const e of ranked) {
      if (chosen.length >= want) break;
      if (chosen.some((c) => norm(c.name) === norm(e.name))) continue;
      const key = norm(e.muscle);
      const used = perMuscle.get(key) ?? 0;
      // First pass respects the per-muscle cap; the second fills any shortfall
      // rather than returning a two-exercise session.
      if (pass === 0 && used >= cap) continue;
      chosen.push(e);
      perMuscle.set(key, used + 1);
    }
    if (chosen.length >= want) break;
  }

  // SEQUENCE: compounds before isolation. Heavy multi-joint work belongs at
  // the front of a session, and this is the order the logger will show.
  const rank = (e: LibraryExercise) => (e.category === 'Compound' ? 0 : e.category === 'Isolation' ? 2 : 1);
  chosen.sort((a, b) => rank(a) - rank(b));

  const reps = REPS[req.goal ?? 'build_muscle'] ?? '8-12';
  return chosen.map((e) => ({
    exercise: e.name,
    sets: setsFor(req.experience, e.category === 'Compound'),
    reps,
  }));
}

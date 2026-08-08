import type { ExerciseLoadMode } from '@/domain/exercise-load';

/**
 * WHAT IS TYPED IN AN UPCOMING SET ROW, RIGHT NOW.
 *
 * There is no planned-set record in this product. A plan entry is
 * `[exercise, setCount, repScheme]`; the numbers an athlete sees in an upcoming
 * row are `prefillForSet()`'s guess from last session, and anything they type
 * over it lives in that `SetRow`'s local `useState` until LOG.
 *
 * A call out has to propose exactly what is ON SCREEN. If somebody types 105
 * and then opens the tray, a tray that re-derives the prefill would offer 100 —
 * which is a different bet from the one they are looking at, and the kind of
 * wrongness nobody notices until it costs coins.
 *
 * SO: a plain module-level Map, written from the same onChange handlers that
 * already run on every keystroke, read once when the tray opens.
 *
 * NOT a store, NOT context, NOT React state — deliberately. This is written on
 * every character typed into a number field; routing it through React would
 * re-render the logging card mid-keystroke, and the workout logger's
 * responsiveness outranks every decorative thing in this feature. Nothing
 * re-renders because of this file; nothing reads it during render.
 */

export interface SetDraft {
  weightKg: number | null;
  reps: number | null;
  loadMode: ExerciseLoadMode;
}

const drafts = new Map<string, SetDraft>();

const keyOf = (date: string, workout: string, exercise: string, setNo: number) =>
  `${date}|${workout}|${exercise}|${setNo}`;

export function putSetDraft(
  date: string,
  workout: string,
  exercise: string,
  setNo: number,
  draft: SetDraft
): void {
  drafts.set(keyOf(date, workout, exercise, setNo), draft);
}

export function getSetDraft(
  date: string,
  workout: string,
  exercise: string,
  setNo: number
): SetDraft | null {
  return drafts.get(keyOf(date, workout, exercise, setNo)) ?? null;
}

/** Drop everything. Called when the workout page unmounts and on sign-out —
 *  a draft is about one session on one device and must never outlive either. */
export function clearSetDrafts(): void {
  drafts.clear();
}

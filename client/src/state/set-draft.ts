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
 * responsiveness outranks every decorative thing in this feature.
 *
 * ── AND IT WORKS BOTH WAYS (2026-08-08) ──
 *
 * Tyson asked to be able to change the weight and reps in the tray. The tray
 * could have kept its own private target, but then calling 105 × 5 and logging
 * 100 × 5 would be a MISS the athlete never chose — two numbers for one set.
 * So a tray edit writes back here and the row adopts it: one number, edited
 * from either end.
 *
 * Only a `tray` write notifies. The row writes on every keystroke, and a row
 * that listened to itself would be a loop.
 */

export interface SetDraft {
  weightKg: number | null;
  reps: number | null;
  loadMode: ExerciseLoadMode;
}

type Listener = (draft: SetDraft) => void;

const drafts = new Map<string, SetDraft>();
const listeners = new Map<string, Set<Listener>>();

const keyOf = (date: string, workout: string, exercise: string, setNo: number) =>
  `${date}|${workout}|${exercise}|${setNo}`;

export function putSetDraft(
  date: string,
  workout: string,
  exercise: string,
  setNo: number,
  draft: SetDraft,
  /** `tray` edits are broadcast back to the row; `row` writes are not, or the
   *  row would hear its own keystrokes. */
  source: 'row' | 'tray' = 'row'
): void {
  const key = keyOf(date, workout, exercise, setNo);
  drafts.set(key, draft);
  if (source !== 'tray') return;
  for (const fn of listeners.get(key) ?? []) {
    try {
      fn(draft);
    } catch {
      // A listener is a convenience. It must never take down a set row.
    }
  }
}

export function getSetDraft(
  date: string,
  workout: string,
  exercise: string,
  setNo: number
): SetDraft | null {
  return drafts.get(keyOf(date, workout, exercise, setNo)) ?? null;
}

/** Hear tray edits for one set. Returns the unsubscribe. */
export function subscribeSetDraft(
  date: string,
  workout: string,
  exercise: string,
  setNo: number,
  fn: Listener
): () => void {
  const key = keyOf(date, workout, exercise, setNo);
  const set = listeners.get(key) ?? new Set<Listener>();
  set.add(fn);
  listeners.set(key, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(key);
  };
}

/** Drop everything. Called when the workout page unmounts and on sign-out —
 *  a draft is about one session on one device and must never outlive either. */
export function clearSetDrafts(): void {
  drafts.clear();
  listeners.clear();
}

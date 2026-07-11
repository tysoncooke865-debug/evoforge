/**
 * IMPROVEMENT_PLAN #8: when does a round-3 photo reveal, and what state is
 * each side in? Pure over battle_media rows. Deliberately NOT in
 * client/src/domain/ (that tree is parity-pinned).
 *
 * THE REVEAL RULE — after BOTH sides are final, or the round is scored,
 * whichever first. "Final" mirrors battle-settle's predicate exactly (a
 * non-low-confidence verdict, or both attempts used): move them in
 * lockstep or reveal timing and scoring disagree. No first-mover
 * disadvantage: nobody's photo shows while the other may still retake.
 */

export interface MediaLite {
  user_id: string;
  confidence: string | null;
  compliant: boolean | null;
  created_at: string;
  storage_path?: string | null;
}

export const PHYSIQUE_MAX_ATTEMPTS = 2;

/** battle-settle's isFinal, verbatim in spirit: last verdict not low, or attempts exhausted. */
export function isFinal(rows: MediaLite[]): boolean {
  if (rows.length === 0) return false;
  const last = rows[rows.length - 1];
  return String(last.confidence ?? 'low').toLowerCase() !== 'low' || rows.length >= PHYSIQUE_MAX_ATTEMPTS;
}

export function revealReady(mine: MediaLite[], theirs: MediaLite[], roundScored: boolean): boolean {
  return roundScored || (isFinal(mine) && isFinal(theirs));
}

export type SideState = 'waiting' | 'judging' | 'locked' | 'revealed' | 'noncompliant';

/** One side of the duel. `judging` = that side's own mutation in flight. */
export function sideState(rows: MediaLite[], revealed: boolean, judging: boolean): SideState {
  if (judging) return 'judging';
  if (rows.length === 0) return 'waiting';
  if (!revealed) return 'locked';
  const last = rows[rows.length - 1];
  return last.compliant === false ? 'noncompliant' : 'revealed';
}

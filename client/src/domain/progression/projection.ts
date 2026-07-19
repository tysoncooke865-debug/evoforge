/**
 * EVO PROJECTION (Tyson, 2026-07-19) — "where the four pillars go after X weeks
 * of CONSISTENT training". A deliberately simple, honest headroom model, NOT a
 * promise: each week closes a per-pillar fraction of the gap to 100, so gains
 * diminish as a pillar matures (the last 10 points are the hardest) and nothing
 * ever projects past 100.
 *
 * It is a projection ON the same four scores the Evo Rating is built from
 * (evo_rating_current.{size,aesthetics,strength,cardio}_score), so the dashed
 * overlay and the solid radar share one axis system and one scale.
 */

export interface PillarScores {
  size: number;
  aesthetics: number;
  strength: number;
  cardio: number;
}

/**
 * Per-pillar responsiveness: the fraction of the remaining gap to 100 a single
 * fully-consistent week closes. Strength and size answer consistent lifting
 * fastest; aesthetics (body composition) and cardio move more slowly.
 */
export const PILLAR_RESPONSIVENESS: PillarScores = {
  strength: 0.045,
  size: 0.038,
  cardio: 0.032,
  aesthetics: 0.028,
};

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));

/** Consistency factor in [0.4, 1] from current momentum weeks: even zero weeks
 *  assumes the projection's premise (you DO train consistently), ramping to a
 *  full 1.0 by ~8 sustained weeks. */
export function consistencyFromMomentum(momentumWeeks: number): number {
  return Math.max(0.4, Math.min(1, 0.55 + (Math.max(0, momentumWeeks) / 8) * 0.45));
}

/** Project one pillar forward `weeks` weeks at consistency `c`. */
function projectOne(score: number, rate: number, weeks: number, c: number): number {
  let s = clamp100(score);
  const steps = Math.max(0, Math.floor(weeks));
  for (let w = 0; w < steps; w++) s += (100 - s) * rate * c;
  return Math.min(100, s);
}

/**
 * Project the four pillars after `weeks` of consistent training.
 * `consistency` defaults to 1 (full) — pass consistencyFromMomentum(weeks) to
 * scale by the athlete's real recent adherence.
 */
export function projectPillars(
  current: PillarScores,
  weeks: number,
  consistency = 1
): PillarScores {
  const c = Math.max(0.4, Math.min(1, consistency));
  return {
    size: projectOne(current.size, PILLAR_RESPONSIVENESS.size, weeks, c),
    aesthetics: projectOne(current.aesthetics, PILLAR_RESPONSIVENESS.aesthetics, weeks, c),
    strength: projectOne(current.strength, PILLAR_RESPONSIVENESS.strength, weeks, c),
    cardio: projectOne(current.cardio, PILLAR_RESPONSIVENESS.cardio, weeks, c),
  };
}

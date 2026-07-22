/**
 * Fitness → combat scaling (Milestone 7 progression bridge).
 *
 * Design contract (master prompt): Evo Rating shapes Champion identity but
 * must never decide battles — total fitness-derived combat variation is
 * hard-capped (BALANCE.fitness.rankedMaxTotalAdvantage, 10–15% band).
 *
 * Pure module: takes plain ratings, no provider/profile imports. The
 * services layer adapts FitnessProfile → FitnessRatings so the engine never
 * depends on the integration boundary.
 *
 * Mapping (one clean effect per sub-rating):
 *   strength     → champion attack damage (basic attacks + ability damage)
 *   cardio       → ability cooldown (higher cardio = faster cooldowns)
 *   muscularity  → champion max health
 *   leanness     → champion move speed
 *   aesthetics   → ultimate charge rate (morale/aura)
 *
 * Each sub-rating maps its 0..100 value around the baseline (50) onto at
 * most 1/5 of the total advantage budget, so even a maxed profile stays
 * exactly within the cap. Multipliers of 1 mean "no effect".
 */
import type { BalanceConfig } from '../../content/balance';

export interface FitnessRatings {
  strength: number;
  cardio: number;
  muscularity: number;
  leanness: number;
  aesthetics: number;
}

export interface ChampionFitnessScaling {
  attackDamageMult: number;
  maxHealthMult: number;
  moveSpeedMult: number;
  /** <1 = faster cooldowns (applied to ability cooldown ticks). */
  abilityCooldownMult: number;
  /** >1 = faster ultimate charge accrual. */
  ultimateChargeMult: number;
}

export const NEUTRAL_SCALING: ChampionFitnessScaling = {
  attackDamageMult: 1,
  maxHealthMult: 1,
  moveSpeedMult: 1,
  abilityCooldownMult: 1,
  ultimateChargeMult: 1,
};

/** Number of sub-ratings sharing the total advantage budget. */
const RATING_COUNT = 5;

function clampRating(value: number, balance: BalanceConfig): number {
  const { minRating, maxRating } = balance.fitness;
  if (!Number.isFinite(value)) return balance.fitness.baselineRating;
  return Math.min(maxRating, Math.max(minRating, value));
}

/** Maps one rating to a multiplier within its share of the advantage budget. */
function ratingToMult(value: number, balance: BalanceConfig, invert: boolean): number {
  const { baselineRating, minRating, maxRating, rankedMaxTotalAdvantage } = balance.fitness;
  const perStatBudget = rankedMaxTotalAdvantage / RATING_COUNT;
  const clamped = clampRating(value, balance);
  const halfSpan = Math.max(baselineRating - minRating, maxRating - baselineRating);
  const deviation = (clamped - baselineRating) / halfSpan; // -1..1
  const mult = 1 + deviation * perStatBudget;
  // Inverted stats (cooldowns): better rating = LOWER multiplier.
  return invert ? 2 - mult : mult;
}

/**
 * Computes capped champion scaling from fitness ratings. Total advantage
 * (sum of |mult - 1| across all five stats) never exceeds
 * rankedMaxTotalAdvantage — enforced by construction and re-checked here
 * defensively.
 */
export function computeFitnessScaling(
  ratings: FitnessRatings,
  balance: BalanceConfig
): ChampionFitnessScaling {
  const scaling: ChampionFitnessScaling = {
    attackDamageMult: ratingToMult(ratings.strength, balance, false),
    abilityCooldownMult: ratingToMult(ratings.cardio, balance, true),
    maxHealthMult: ratingToMult(ratings.muscularity, balance, false),
    moveSpeedMult: ratingToMult(ratings.leanness, balance, false),
    ultimateChargeMult: ratingToMult(ratings.aesthetics, balance, false),
  };

  // Defensive re-cap: if content/balance edits ever push the sum over the
  // budget, scale all deviations down proportionally instead of shipping an
  // over-cap advantage.
  const totalAdvantage =
    Math.abs(scaling.attackDamageMult - 1) +
    Math.abs(1 - scaling.abilityCooldownMult) +
    Math.abs(scaling.maxHealthMult - 1) +
    Math.abs(scaling.moveSpeedMult - 1) +
    Math.abs(scaling.ultimateChargeMult - 1);
  const cap = balance.fitness.rankedMaxTotalAdvantage;
  if (totalAdvantage > cap && totalAdvantage > 0) {
    const shrink = cap / totalAdvantage;
    return {
      attackDamageMult: 1 + (scaling.attackDamageMult - 1) * shrink,
      abilityCooldownMult: 1 + (scaling.abilityCooldownMult - 1) * shrink,
      maxHealthMult: 1 + (scaling.maxHealthMult - 1) * shrink,
      moveSpeedMult: 1 + (scaling.moveSpeedMult - 1) * shrink,
      ultimateChargeMult: 1 + (scaling.ultimateChargeMult - 1) * shrink,
    };
  }
  return scaling;
}

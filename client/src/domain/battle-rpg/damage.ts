import type { GymCondition } from './conditions';
import { effectiveDefence, effectiveEvasion, hasStatus } from './status';
import { styleEffectiveness, styleMultiplier, styleOfChampion, styleOfMove, type Effectiveness } from './style';
import type { BattleMove, Combatant, Rng } from './types';

/**
 * THE DAMAGE FORMULA (centralised — the ONLY place damage is computed).
 *
 *   raw = basePower
 *       × powerModifier      (attacker power vs a 20 baseline)
 *       × defenceModifier    (target defence — always matters, never 0)
 *       × conditionalMod     (execute / bleed / damaged / combo)
 *       × variance           (0.9–1.1, small)
 *       × critModifier       (1 or critMultiplier)
 *
 * Tuning target: base HP ~110; a reliable attack lands ~14–20 after defence,
 * heavies ~26–36, finishers more under their condition — so a standard
 * battle runs ~6–12 turns. Damage is clamped ≥ 1 and never negative.
 */

export interface DamageResult {
  damage: number;
  crit: boolean;
  hit: boolean;
  /** Style-triangle verdict, for the consequence beat ("It's super effective!"). */
  effectiveness: Effectiveness;
}

const POWER_BASELINE = 20;

/** Defence softens damage on a diminishing curve: mod = baseline/(baseline+def). */
function defenceModifier(defence: number): number {
  const B = 26;
  return B / (B + Math.max(0, defence));
}

export function computeDamage(
  move: BattleMove,
  attacker: Combatant,
  defender: Combatant,
  rng: Rng,
  opts: { forceCrit?: boolean; hitOverride?: boolean; condition?: GymCondition | null } = {}
): DamageResult {
  if (move.basePower <= 0) return { damage: 0, crit: false, hit: true, effectiveness: 'neutral' };

  const powerMod = attacker.stats.power / POWER_BASELINE;
  const defMod = defenceModifier(effectiveDefence(defender));

  // Conditional bonuses.
  let conditional = 1;
  const cond = move.conditional;
  if (cond) {
    if (cond.kind === 'execute_below' && cond.threshold != null) {
      if (defender.stats.currentHealth / defender.stats.maxHealth <= cond.threshold) conditional *= cond.multiplier;
    } else if (cond.kind === 'stronger_if_bleeding') {
      if (hasStatus(defender, 'bleed')) conditional *= cond.multiplier;
    } else if (cond.kind === 'stronger_if_damaged') {
      const missing = 1 - attacker.stats.currentHealth / attacker.stats.maxHealth;
      conditional *= 1 + (cond.multiplier - 1) * missing; // scales with damage taken
    }
  }

  // Velocity Crash scales partly with speed.
  if (move.id === 'velocity_crash') conditional *= 0.8 + attacker.stats.speed / 40;
  // Shadow Step combo bonus.
  if (attacker.comboArmed) conditional *= 1.35;

  // The style triangle (style.ts): FORCE > FORM > FLOW > FORCE.
  const effectiveness = styleEffectiveness(styleOfMove(move), styleOfChampion(defender.championId));
  const styleMod = styleMultiplier(effectiveness);

  // Gym condition: heavy iron amplifies heavies/ultimates for both sides.
  const condMult =
    opts.condition?.heavyMult && (move.category === 'heavy' || move.category === 'ultimate')
      ? opts.condition.heavyMult
      : 1;

  const variance = 0.9 + rng() * 0.2; // 0.9–1.1

  const critChance = attacker.stats.critChance + (opts.condition?.critBonus ?? 0);
  const crit = opts.forceCrit ?? rng() < critChance;
  const critMod = crit ? attacker.stats.critMultiplier : 1;

  const raw = move.basePower * powerMod * defMod * conditional * styleMod * condMult * variance * critMod;
  const damage = Math.max(1, Math.round(raw));
  return { damage, crit, hit: true, effectiveness };
}

/** Does the move connect? Accuracy vs the defender's evasion. */
export function rollHit(move: BattleMove, defender: Combatant, rng: Rng, forceHit = false): boolean {
  if (forceHit || move.target === 'self' || move.basePower <= 0) return true;
  const chance = Math.max(0.4, move.accuracy - effectiveEvasion(defender));
  return rng() < chance;
}

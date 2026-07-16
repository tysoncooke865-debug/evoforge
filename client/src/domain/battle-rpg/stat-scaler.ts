import { CHAMPIONS } from './champions';
import type { BattleStats, ChampionId, ScalingContext } from './types';

/**
 * THE CONVERSION LAYER (single source of truth for combat stats).
 *
 * combatStat = archetypeBase × (1 + scaledPlayerContribution)
 *
 * Real EvoForge stats (0–100) contribute a CONTROLLED 0–20% each — never
 * becoming damage directly. Mapping (per the brief):
 *   SIZE → health, defence, stagger resistance
 *   AES  → precision, crit chance, counter effectiveness
 *   STR  → power, guard breaking, heavy power
 *   CND  → speed, stamina, stamina regen, status resistance
 *
 * Opponents are NORMALISED toward the player's combat power so a fight is
 * competitive across Evo Ratings — raw stats give identity + small edges,
 * never an impossible wall.
 */

export interface PlayerCombatInput {
  size: number; // 0..100
  aes: number;
  str: number;
  cnd: number;
}

/** Each real stat adds at most this fraction to its related combat stats. */
const MAX_CONTRIB = 0.2;

const pct = (v: number) => Math.max(0, Math.min(100, v)) / 100;

function withCurrent(s: Omit<BattleStats, 'currentHealth' | 'currentStamina'>): BattleStats {
  return { ...s, currentHealth: s.maxHealth, currentStamina: s.maxStamina };
}

/** Round the derived stats so battles are readable (integers where sensible). */
function tidy(s: BattleStats): BattleStats {
  return {
    ...s,
    maxHealth: Math.round(s.maxHealth),
    currentHealth: Math.round(s.currentHealth),
    maxStamina: Math.round(s.maxStamina),
    currentStamina: Math.round(s.currentStamina),
    power: Math.round(s.power * 10) / 10,
    defence: Math.round(s.defence * 10) / 10,
    speed: Math.round(s.speed * 10) / 10,
    precision: Math.round(s.precision * 10) / 10,
    staminaRegen: Math.round(s.staminaRegen),
    evasion: Math.round(s.evasion * 100) / 100,
    critChance: Math.round(s.critChance * 100) / 100,
    critMultiplier: Math.round(s.critMultiplier * 100) / 100,
  };
}

/** A coarse scalar for "how strong is this stat block" — used to normalise. */
export function combatPower(s: BattleStats): number {
  return s.maxHealth * 0.5 + s.power * 3 + s.defence * 2 + s.speed * 1.5 + s.precision + s.maxStamina * 0.3;
}

function applyPlayerContribution(
  base: Omit<BattleStats, 'currentHealth' | 'currentStamina'>,
  p: PlayerCombatInput
): BattleStats {
  const size = pct(p.size);
  const aes = pct(p.aes);
  const str = pct(p.str);
  const cnd = pct(p.cnd);
  const boost = (v: number, by: number) => v * (1 + MAX_CONTRIB * by);
  return withCurrent({
    maxHealth: boost(base.maxHealth, size),
    maxStamina: boost(base.maxStamina, cnd),
    power: boost(base.power, str),
    defence: boost(base.defence, size),
    speed: boost(base.speed, cnd),
    precision: boost(base.precision, aes),
    // Crit/evasion get half the swing so RNG never dominates.
    evasion: Math.min(0.4, base.evasion * (1 + (MAX_CONTRIB / 2) * cnd)),
    critChance: Math.min(0.5, base.critChance * (1 + (MAX_CONTRIB / 2) * aes)),
    critMultiplier: base.critMultiplier,
    staminaRegen: boost(base.staminaRegen, cnd),
  });
}

export interface ScaleOptions {
  /** Gym/rival difficulty: >1 tougher, <1 easier. Clamped. */
  difficulty?: number;
}

/**
 * Build a battle-ready stat block for a champion.
 *
 * - `player` non-null → the athlete's own champion (real stats applied).
 * - `player` null → an opponent; normalised toward `targetPower` (the
 *   player's combat power) × context/difficulty, so it is competitive.
 */
export function createBattleStats(
  championId: ChampionId,
  player: PlayerCombatInput | null,
  context: ScalingContext,
  opts: ScaleOptions & { targetPower?: number } = {}
): BattleStats {
  const def = CHAMPIONS[championId];
  if (player) {
    return tidy(applyPlayerContribution(def.base, player));
  }

  // Opponent path: start from the archetype base, then normalise to the
  // player's combat power so no one is walled out by raw stats.
  const raw = withCurrent(def.base);
  const target = opts.targetPower ?? combatPower(raw);
  const ownPower = combatPower(raw);

  const contextMult =
    context === 'training' ? 1.0 : context === 'rival' ? 1.03 : context === 'gym' ? 1.08 : 1.15;
  const difficulty = Math.max(0.7, Math.min(1.3, (opts.difficulty ?? 1) * contextMult));
  // Ratio to hit the target power, clamped so identity survives normalisation.
  const ratio = Math.max(0.7, Math.min(1.4, (target * difficulty) / ownPower));

  const scaled: BattleStats = {
    maxHealth: raw.maxHealth * ratio,
    currentHealth: raw.maxHealth * ratio,
    maxStamina: raw.maxStamina,
    currentStamina: raw.maxStamina,
    power: raw.power * ratio,
    defence: raw.defence * ratio,
    speed: raw.speed * (0.85 + 0.15 * ratio), // speed swings less than power
    precision: raw.precision,
    evasion: raw.evasion,
    critChance: raw.critChance,
    critMultiplier: raw.critMultiplier,
    staminaRegen: raw.staminaRegen,
  };
  return tidy(scaled);
}

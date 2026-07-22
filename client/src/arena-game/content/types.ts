/**
 * Content schema types. All game content (cards, champions, synergies) is
 * data-driven and validated at load time — see validate.ts.
 */
import type {
  AvatarPath,
  CardCategory,
  CardEffects,
  CombatStats,
  TargetRule,
  UnitTag,
} from '../game-engine/types';

export interface CardDefinition {
  /** Unique, stable identifier, kebab-case (e.g. 'forge-recruit'). */
  id: string;
  name: string;
  description: string;
  category: CardCategory;
  /** Forge Energy cost, 1..10. */
  energyCost: number;
  target: TargetRule;
  tags: UnitTag[];
  /** Present iff category === 'fighter'. */
  unit?: {
    stats: CombatStats;
    /** How many copies deploy per card play (e.g. 2 recruits). */
    deployCount: number;
    /**
     * Autobattler behaviour:
     *  - 'default': engage nearest enemy in aggro range, else march at the core
     *  - 'core-only': ignore units, march straight at the enemy core
     *  - 'healer': heal the most-wounded ally in range instead of attacking
     *  - 'shielder': grant capped shields to the frontmost ally in range
     */
    behavior?: 'default' | 'core-only' | 'healer' | 'shielder';
  };
  /** Present iff category !== 'fighter'. */
  effects?: CardEffects;
  /** Free-form tags used by balance tooling and the AI ('win-condition', 'defense', ...). */
  balanceTags: string[];
  /**
   * Upgrade behaviour. Upgrades are disabled during early milestones but the
   * schema exists so save data and balance records stay forward-compatible.
   */
  upgrade: {
    enabled: boolean;
    /** Per-level multiplier applied to damage/health when enabled. */
    statMultPerLevel: number;
  };
  /** Placeholder art key — maps to a temporary visual (color/icon), not a file. */
  art: string;
}

export type AbilityId = string;

export interface ChampionAbilityDefinition {
  id: AbilityId;
  name: string;
  description: string;
  cooldownTicks: number;
  effects: CardEffects;
  /** 'active' = manually triggered; 'ultimate' = uses charge instead of cooldown. */
  kind: 'active' | 'ultimate';
}

export interface ChampionDefinition {
  id: string;
  name: string;
  path: AvatarPath;
  role: string;
  description: string;
  stats: CombatStats;
  tags: UnitTag[];
  ability: ChampionAbilityDefinition;
  ultimate: ChampionAbilityDefinition;
  /** Ultimate charge gained per point of damage dealt / taken. */
  ultimateChargePerDamageDealt: number;
  ultimateChargePerDamageTaken: number;
  /** Charge required to fire the ultimate. */
  ultimateChargeRequired: number;
  /** Animation state names the renderer may use (placeholder-driven for now). */
  animationStates: string[];
  art: string;
}

/**
 * Mid-match augment payload (M6). Exactly one effect kind per augment —
 * data-driven so no augment has bespoke engine code beyond these five
 * interpreters:
 *  - 'team-aura': permanent-for-battle team-wide aura (same layer as
 *    synergies), folded into the per-tick aura recompute.
 *  - 'energy-regen': multiplies Forge Energy regeneration.
 *  - 'heal-pulse': heals every living combatant on the team every
 *    intervalTicks after the choice.
 *  - 'core-repair': one-shot own-core heal, applied when chosen.
 *  - 'deploy-shield': fighters spawned after the choice start shielded.
 */
export type AugmentEffect =
  | {
      kind: 'team-aura';
      attackDamageMult?: number;
      moveSpeedMult?: number;
      healingMult?: number;
      armorFlat?: number;
    }
  | { kind: 'energy-regen'; regenMult: number }
  | { kind: 'heal-pulse'; amount: number; intervalTicks: number }
  | { kind: 'core-repair'; amount: number }
  | { kind: 'deploy-shield'; amount: number };

export interface AugmentDefinition {
  /** Unique, stable identifier, kebab-case. */
  id: string;
  name: string;
  description: string;
  effect: AugmentEffect;
}

export interface SynergyDefinition {
  id: string;
  name: string;
  description: string;
  tag: UnitTag | 'mixed-paths';
  /** Number of distinct tagged combatants required on a team. */
  threshold: number;
  /** Stat modifiers applied to qualifying friendly combatants while active. */
  bonus: {
    armorFlat?: number;
    moveSpeedMult?: number;
    healingMult?: number;
    attackDamageMult?: number;
  };
}

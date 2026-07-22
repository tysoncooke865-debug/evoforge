/**
 * Shared engine-facing types used by both content definitions and the
 * battle simulation. Pure TypeScript — no React Native imports allowed
 * anywhere under src/game-engine.
 */

/** Autobattler synergy / identity tags. Path tags are EvoForge's live
 *  BranchV2 slugs (minus the retired 'hybrid'). */
export type UnitTag =
  | 'aesthetic'
  | 'titan'
  | 'mass'
  | 'shredder'
  | 'cardio'
  | 'brawler'
  | 'ranged'
  | 'support'
  | 'tech';

export const ALL_UNIT_TAGS: readonly UnitTag[] = [
  'aesthetic',
  'titan',
  'mass',
  'shredder',
  'cardio',
  'brawler',
  'ranged',
  'support',
  'tech',
];

/**
 * The FIVE official Avatar Paths — exactly EvoForge's live `BranchV2` roster
 * ('hybrid' is retired). Champion identity, synergy path counting and the
 * provider's Origin mapping all key off these slugs.
 */
export type AvatarPath = 'aesthetic' | 'titan' | 'mass' | 'shredder' | 'cardio';

export const ALL_AVATAR_PATHS: readonly AvatarPath[] = [
  'aesthetic',
  'titan',
  'mass',
  'shredder',
  'cardio',
];

export type LaneId = 0 | 1;

export type TeamId = 'player' | 'opponent';

/**
 * Combat statistics for a deployable unit or Champion.
 * Distances are in arena units (lane length is defined in balance config);
 * times are in simulation ticks.
 */
export interface CombatStats {
  maxHealth: number;
  /** Damage per basic attack. */
  attackDamage: number;
  /** Ticks between basic attacks. */
  attackIntervalTicks: number;
  /** Attack range in arena units. Melee and ranged use different ranges. */
  attackRange: number;
  /** Arena units moved per tick. */
  moveSpeedPerTick: number;
  /** True for ranged attackers (affects range rules and some synergies). */
  isRanged: boolean;
}

/** What a card is allowed to target when played. */
export type TargetRule =
  | 'deploy-lane' // fighters: choose a lane + deploy position
  | 'friendly-unit' // techniques/equipment on own units
  | 'enemy-unit' // techniques on enemy units
  | 'any-unit'
  | 'friendly-champion'
  | 'no-target'; // instant global effect

export type CardCategory = 'fighter' | 'technique' | 'equipment';

/**
 * Numeric effect payload for technique and equipment cards.
 * All fields optional; validation enforces that at least one is set for
 * non-fighter cards. Data-driven so no per-card React components exist.
 */
export interface CardEffects {
  /** Instant damage to target (or all enemies in radius if radius set). */
  damage?: number;
  /** Instant healing. */
  heal?: number;
  /** Shield points absorbing damage. */
  shield?: number;
  /** Area-of-effect radius in arena units (0 / undefined = single target). */
  radius?: number;
  /** Stun duration in ticks. */
  stunTicks?: number;
  /** Buff/debuff duration in ticks for the stat modifiers below. */
  durationTicks?: number;
  /** Multiplier applied to attack damage while active (e.g. 1.3). */
  attackDamageMult?: number;
  /** Multiplier applied to move speed while active. */
  moveSpeedMult?: number;
  /** Multiplier applied to attack interval while active (<1 = faster). */
  attackIntervalMult?: number;
  /** Flat max-health bonus while active (equipment). */
  bonusMaxHealth?: number;
  /** Energy refunded to the caster (techniques like Second Wind). */
  energyRefund?: number;
  /**
   * Multiplier on damage taken while active (<1 = damage reduction, >1 =
   * vulnerability). Applied in damageUnit before shields. Champion stances
   * use this; no card ships it yet.
   */
  damageTakenMult?: number;
  /**
   * Champion ultimates: after the listed damage, a surviving target left
   * below this fraction of its base max health is executed outright.
   */
  executeBelowHealthFraction?: number;
  /**
   * Champion-only: summon `count` deploys of an existing fighter card at the
   * caster's position (Mass Monster's ultimate). Deterministic — reuses
   * spawnUnitsForCard; validated against the card catalog at content load.
   * No card ships this effect (cards keep numeric-only payloads).
   */
  summon?: { cardId: string; count: number };
}

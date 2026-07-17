import type { BranchV2 } from '@/domain/branches-v2';

/**
 * BATTLE RPG (Tyson beta, 2026-07-16) — a Pokémon-inspired turn-based 1v1
 * battle system, DISTINCT from the existing byte-pinned BLITZ engine
 * (domain/battle). Everything here is pure and deterministic: the resolver
 * threads an RNG so tests are exact and the UI just renders events.
 */

export type ChampionId = 'aesthetic' | 'titan' | 'apex' | 'shredded';

/** Which real avatar branch each archetype borrows its sprite from. */
export type SpriteBranch = BranchV2;

export type MoveCategory =
  | 'attack'
  | 'heavy'
  | 'technique'
  | 'defence'
  | 'recovery'
  | 'buff'
  | 'debuff'
  | 'ultimate';

export type AnimationType =
  | 'quick'
  | 'heavy'
  | 'technique'
  | 'defence'
  | 'buff'
  | 'recovery'
  | 'ultimate';

export type StatusKind = 'bleed' | 'stagger' | 'guard_break' | 'overclocked' | 'perfect_form';

/** A status effect instance on a combatant. */
export interface BattleStatus {
  kind: StatusKind;
  turnsLeft: number;
  /** Effect strength (bleed dmg/turn, defence mult delta, etc.). */
  magnitude: number;
}

/** A single move effect (buff/debuff/status/heal/stamina), applied on hit. */
export interface MoveEffect {
  kind:
    | 'apply_status' // to target or self
    | 'buff_self' // transient stat multiplier via a status
    | 'restore_stamina'
    | 'restore_health'
    | 'lower_defence'
    | 'heal_self';
  status?: StatusKind;
  target: 'self' | 'opponent';
  /** Turns the status/buff lasts (statuses). */
  duration?: number;
  /** Amount (stamina/health) or magnitude (status). */
  amount?: number;
  /** 0..1 chance the effect lands (defaults 1). */
  chance?: number;
}

export interface BattleMove {
  id: string;
  name: string;
  description: string;
  category: MoveCategory;
  requiredChampion: ChampionId;
  staminaCost: number;
  /** 0 for non-damaging moves. */
  basePower: number;
  /** 0..1 hit chance before evasion. */
  accuracy: number;
  /** Higher acts first regardless of speed. */
  priority: number;
  /** Turns before re-use (0 = none). */
  cooldown: number;
  effects: MoveEffect[];
  animationType: AnimationType;
  target: 'opponent' | 'self';
  /** Theme colour token key for the button/trail. */
  theme: 'accent' | 'epic' | 'legendary' | 'danger' | 'success' | 'rare';
  /** Conditional bonus: e.g. execute below a health fraction. */
  conditional?: {
    kind: 'execute_below' | 'stronger_if_bleeding' | 'stronger_if_damaged' | 'combo_bonus';
    /** For execute_below: 0..1 hp fraction. */
    threshold?: number;
    /** Damage multiplier applied when the condition holds. */
    multiplier: number;
  };
  /** Damage hits more than once (RapidStrike). */
  multiHit?: { times: number; chance: number };
}

export interface BattleStats {
  maxHealth: number;
  currentHealth: number;
  maxStamina: number;
  currentStamina: number;
  power: number;
  defence: number;
  speed: number;
  precision: number; // accuracy + crit contribution
  evasion: number; // 0..1-ish, chance to dodge
  critChance: number; // 0..1
  critMultiplier: number;
  staminaRegen: number;
}

/** A combatant in an active battle. */
export interface Combatant {
  championId: ChampionId;
  name: string;
  spriteBranch: SpriteBranch;
  spriteStage: number;
  stats: BattleStats;
  statuses: BattleStatus[];
  /** moveId -> turns until usable again. */
  cooldowns: Record<string, number>;
  /** Set true once the combatant has taken any damage (Titan Breaker). */
  tookDamage: boolean;
  /** Combo flag armed by Shadow Step for the next offensive move. */
  comboArmed: boolean;
  /** One-turn defensive stance (Counter Pose / Iron Guard). `mult` scales
   *  incoming damage; `counter` returns that fraction of melee damage.
   *  Consumed + cleared at end of turn — kept off the status list on
   *  purpose (the 5 named statuses are the only displayed ones). */
  guard: { mult: number; counter: number } | null;
}

export type BattleMode = 'training' | 'rival' | 'gym' | 'versus' | 'challenge' | 'ghost';
export type ScalingContext = 'training' | 'rival' | 'gym' | 'futureRanked';

export type BattlePhase =
  | 'awaiting_player'
  | 'resolving'
  | 'victory'
  | 'defeat';

export type EventKind =
  | 'move'
  | 'damage'
  | 'crit'
  | 'miss'
  | 'heal'
  | 'stamina'
  | 'status_apply'
  | 'status_tick'
  | 'status_expire'
  | 'no_stamina'
  | 'defeated'
  | 'info';

/** One atomic thing that happened, for the UI to animate + narrate. */
export interface BattleEvent {
  kind: EventKind;
  /** 'player' | 'opponent' — who the event is ABOUT. */
  side: 'player' | 'opponent';
  message: string;
  /** Damage/heal/stamina amount, when relevant. */
  amount?: number;
  animationType?: AnimationType;
  status?: StatusKind;
}

export interface BattleRewards {
  coins: number;
  forgeXp: number;
  badgeId?: string;
  firstClear?: boolean;
}

export interface BattleState {
  battleId: string;
  mode: BattleMode;
  turnNumber: number;
  phase: BattlePhase;
  player: Combatant;
  opponent: Combatant;
  /** Newest-last log of everything that has happened. */
  log: BattleEvent[];
  /** Events produced by the LAST resolved turn (for animation playback). */
  lastTurnEvents: BattleEvent[];
  winner: 'player' | 'opponent' | null;
  /** Running tallies for the result screen. */
  stats: { playerDamage: number; opponentDamage: number; crits: number };
  rewards: BattleRewards | null;
  isResolvingTurn: boolean;
}

export type AiPersonality = 'balanced' | 'aggressive' | 'defensive';

export interface AIProfile {
  personality: AiPersonality;
}

export interface GymDefinition {
  id: string;
  name: string;
  leaderName: string;
  leaderTitle: string;
  championId: ChampionId;
  ai: AiPersonality;
  theme: string;
  description: string;
  recommendedRating: number;
  badgeId: string;
  reward: { coins: number; forgeXp: number };
}

export interface RivalDefinition {
  id: string;
  name: string;
  championId: ChampionId;
  ai: AiPersonality;
}

/** A pure random source, threaded for deterministic tests. */
export type Rng = () => number;

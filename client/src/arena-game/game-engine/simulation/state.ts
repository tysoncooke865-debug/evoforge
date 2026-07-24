/**
 * Battle state model. Pure data — mutated only by the tick pipeline and
 * event application. Deterministic: identical config + events + seed always
 * produce identical states, tick for tick.
 *
 * Coordinates: one axis per lane, x in [0, laneLength]. The player core sits
 * at x = 0, the opponent core at x = laneLength. Player units march in +x,
 * opponent units in -x. Cores are lane-agnostic (reachable from both lanes).
 */
import type { BalanceConfig } from '../../content/balance';
import { getChampionById } from '../../content/champions';
import {
  isValidChampionScaling,
  type ChampionFitnessScaling,
} from '../balance/fitness-scaling';
import { initTeamCards, TeamCardsState } from '../cards/deck';
import { championSpawnX, spawnChampion } from '../entities/spawn';
import { SeededRng } from '../random/rng';
// Runtime-only usage inside createBattle (the module cycle with synergies.ts
// is init-safe: neither module calls the other during initialization).
import { recomputeAuras } from '../synergies/synergies';
import type { CombatStats, LaneId, TeamId } from '../types';

export type EntityId = number;

export type UnitBehavior = 'default' | 'core-only' | 'healer' | 'shielder';

/** Timed stat modifier from techniques, equipment, abilities or synergies. */
export interface ActiveModifier {
  sourceId: string; // card/ability id, for debugging and stacking rules
  expiresAtTick: number;
  attackDamageMult?: number;
  moveSpeedMult?: number;
  attackIntervalMult?: number;
  bonusMaxHealth?: number;
  /** Multiplier on damage taken (<1 = reduction). Applied in damageUnit. */
  damageTakenMult?: number;
}

/**
 * Champion-only runtime state. Content numbers the combat/tick code needs
 * (charge rates, respawn delay) are copied here at spawn so the engine core
 * never has to look up content definitions mid-battle.
 */
export interface ChampionState {
  definitionId: string;
  /**
   * True for the team's captain — the ONLY champion that champion-ability /
   * champion-ultimate commands route to (M9). Borrowed champions are false:
   * they AUTO-CAST their signature ability in the tick pipeline and never
   * spend ultimate charge (charge accrues but is never used — simplified).
   */
  commandable: boolean;
  /** Ticks until the active ability is ready. 0 = ready. */
  abilityCooldownTicks: number;
  /** Ultimate charge, 0..chargeRequired (capped). */
  ultimateCharge: number;
  /** First tick the champion is alive again; null while alive. */
  respawnAtTick: number | null;
  chargePerDamageDealt: number;
  chargePerDamageTaken: number;
  chargeRequired: number;
  /** Ability cooldown duration for THIS champion (fitness-scaled at spawn). */
  abilityCooldownTotalTicks: number;
  respawnDelayTicks: number;
  /** Stance Shift uses so far (Aesthetics): even = Bulwark next, odd = Assault. */
  stanceShifts: number;
  /**
   * Arena 2.0 player-control runtime state (championControl). These are mutated
   * ONLY by the arena2 `champion-basic-attack` / `champion-lane-switch` commands,
   * which Arena 1.0 never issues — so in 1.0 they stay at their spawn defaults.
   * They are deliberately NOT digested (like the config-derived fields above):
   * their gameplay EFFECTS are already digested (combo damage → `health`,
   * lane switch → `lane`, hastened attack → `attackCooldownTicks`), and keeping
   * the raw counters out of the digest keeps 1.0 records byte-identical. See
   * commands/champion-control.ts + ARENA_2.0_REDESIGN.md §14.
   */
  comboCount: number;
  /** Sim tick of the last accepted basic-attack tap (combo window / rate-limit). */
  lastBasicAttackTick: number;
  /** Damage multiplier the next champion strike consumes (null = none pending). */
  pendingComboMult: number | null;
  /** First tick a lane-switch is allowed again (cooldown). */
  laneSwitchReadyTick: number;
  /**
   * P10 gym presentation: the owning gym member's display name for borrowed
   * champions — display/attribution metadata copied from the squad config at
   * spawn. Never feeds the simulation, never digested (like spawnX).
   * Undefined for captains and non-squad champions.
   */
  ownerName?: string;
  /**
   * Passive hooks copied from content at spawn (config-derived constants —
   * not digested, like chargeRequired/respawnDelayTicks). Zero/null when the
   * champion's passive uses other mechanisms (spawn bake / team aura).
   */
  passiveArmorFlat: number;
  passiveLowHealthBonus: { belowHealthFraction: number; damageMult: number } | null;
  /**
   * Where this champion spawned (and respawns). Captains use the standard
   * spawn offset; borrowed champions are staggered behind it (M9) so squads
   * never stack. Config-derived constant — not digested (like chargeRequired).
   */
  spawnX: number;
}

export interface UnitState {
  id: EntityId;
  team: TeamId;
  kind: 'unit' | 'champion';
  /** Content id: card id for units, champion id for champions. */
  contentId: string;
  behavior: UnitBehavior;
  lane: LaneId;
  x: number;
  health: number;
  baseMaxHealth: number;
  shield: number;
  base: CombatStats;
  /** Ticks until the next attack is allowed. 0 = ready. */
  attackCooldownTicks: number;
  targetId: EntityId | null;
  stunUntilTick: number;
  modifiers: ActiveModifier[];
  alive: boolean;
  /** Tick the unit was spawned — for debugging and stable ordering. */
  spawnedAtTick: number;
  /** Present iff kind === 'champion'. */
  champion?: ChampionState;
}

export interface CoreState {
  id: EntityId;
  team: TeamId;
  x: number;
  health: number;
  maxHealth: number;
}

/** Per-team mid-match augment bookkeeping (M6). This IS gameplay state (not
 *  derivable) — offered/chosen ids and the choice tick go into the digest. */
export interface TeamAugmentState {
  /** The augment ids offered to this team; null until the offer tick. */
  offeredIds: string[] | null;
  /** The augment this team chose (must be among offeredIds); null = none yet. */
  chosenId: string | null;
  /** Tick the choice was applied (heal pulses anchor here); null = none yet. */
  chosenAtTick: number | null;
}

export interface TeamState {
  team: TeamId;
  playerId: string;
  energy: number;
  /**
   * Hand + card cycle when the team fights with a deck (M4+). Null means no
   * deck constraint — any fighter card may be deployed (dev tools, old tests).
   */
  cards: TeamCardsState | null;
  augment: TeamAugmentState;
}

/**
 * Recomputed team-wide aura layer (M6): synergy bonuses derived from LIVING
 * team composition plus the chosen augment's permanent bonuses. DERIVED state
 * — recomputed at the end of every tick from digested state, so it is NOT
 * part of the replay digest; activation/deactivation transitions are logged
 * ('synergy-on'/'synergy-off'). Consumers read the snapshot computed at the
 * end of the previous tick — composition changes take effect one tick later,
 * uniformly for every consumer (deterministic).
 */
export interface TeamAuras {
  /** Currently active synergy ids, in content order. */
  activeSynergyIds: string[];
  /** Flat damage reduction per hit for frontline (melee) combatants. */
  armorFlat: number;
  /** Multiplier on healing received by this team's units. */
  healingMult: number;
  /** Multiplier on this team's move speed (folded into effectiveStats). */
  moveSpeedMult: number;
  /** Multiplier on this team's attack damage (folded into effectiveStats). */
  attackDamageMult: number;
  /** Multiplier on this team's Forge Energy regeneration (augment). */
  energyRegenMult: number;
  /** Shield granted to fighters this team deploys (augment). */
  deployShield: number;
  /** Periodic team-wide heal (augment); null when none. */
  healPulse: { amount: number; intervalTicks: number } | null;
}

export function neutralTeamAuras(): TeamAuras {
  return {
    activeSynergyIds: [],
    armorFlat: 0,
    healingMult: 1,
    moveSpeedMult: 1,
    attackDamageMult: 1,
    energyRegenMult: 1,
    deployShield: 0,
    healPulse: null,
  };
}

export type BattlePhase = 'main' | 'sudden-death' | 'finished';

export type BattleOutcomeReason =
  | 'core-destroyed'
  | 'timeout-core-health'
  | 'sudden-death'
  | 'draw';

export interface BattleOutcome {
  winner: TeamId | 'draw';
  reason: BattleOutcomeReason;
  endTick: number;
  playerCoreHealth: number;
  opponentCoreHealth: number;
}

export interface BattleState {
  balanceVersion: string;
  seed: number;
  tick: number;
  phase: BattlePhase;
  /** Set when sudden death begins. */
  suddenDeathEndsAtTick: number | null;
  rng: SeededRng;
  nextEntityId: EntityId;
  units: UnitState[];
  cores: Record<TeamId, CoreState>;
  teams: Record<TeamId, TeamState>;
  /** Derived aura layer, recomputed each tick — see TeamAuras (not digested). */
  auras: Record<TeamId, TeamAuras>;
  outcome: BattleOutcome | null;
  /** Structured log of notable events for debugging/replay verification. */
  log: BattleLogEntry[];
}

export interface BattleLogEntry {
  tick: number;
  type: string;
  detail: string;
}

/** The team's commandable champion (M9 squads). */
export interface SquadCaptainConfig {
  championId: string;
  /** Fitness-derived scaling for the captain (see championScaling docs). */
  scaling?: ChampionFitnessScaling;
}

/**
 * A borrowed gym member's champion (M9): spawns at battle start in its
 * configured lane, staggered behind the captain, fights automatically and
 * AUTO-CASTS its signature ability (never ultimates). displayName and
 * sourcePlayerId are display/attribution metadata — they never feed the
 * simulation (and are therefore not digested).
 */
export interface BorrowedChampionConfig {
  championId: string;
  /** Fitness-derived scaling from the OWNING member's ratings. */
  scaling?: ChampionFitnessScaling;
  lane: LaneId;
  displayName?: string;
  /** The gym member this champion was borrowed from (contribution stats). */
  sourcePlayerId?: string;
}

/**
 * Full squad shape (M9): exactly one commandable captain plus up to
 * BALANCE.gym.maxBorrowed borrowed champions. When present it supersedes the
 * legacy championId/championScaling fields (championLane still positions the
 * captain). Legacy configs normalize to this shape internally — see
 * normalizeTeamSquad.
 */
export interface TeamSquadConfig {
  captain: SquadCaptainConfig;
  borrowed: BorrowedChampionConfig[];
}

export interface BattleTeamConfig {
  playerId: string;
  /**
   * Deck of exactly BALANCE.cards.deckSize distinct card ids. When present,
   * the team can only play cards from its rotating hand. Callers must
   * pre-validate with validateDeck — createBattle throws on structural
   * violations (replay loaders validate before constructing battles).
   */
  deckCardIds?: readonly string[];
  /**
   * Champion fielded by this team, spawned at battle start in front of its
   * own core. Must be a valid champion id — createBattle throws on unknown
   * ids (replay loaders validate before constructing battles).
   */
  championId?: string;
  /** Lane the champion spawns in. Default 0. */
  championLane?: LaneId;
  /**
   * Fitness-derived champion scaling (M7). Computed OUTSIDE the engine from
   * the EvoForgePlayerProvider's FitnessProfile via computeFitnessScaling —
   * already capped to the ranked advantage band. Omitted = neutral.
   * Part of BattleConfig, so records replay it exactly.
   */
  championScaling?: ChampionFitnessScaling;
  /**
   * Multi-champion squad (M9). Takes precedence over championId /
   * championScaling when present; pre-M9 configs without it keep working
   * unchanged (backward compatible — records must still verify).
   */
  squad?: TeamSquadConfig;
}

export interface BattleConfig {
  seed: number;
  player: BattleTeamConfig;
  opponent: BattleTeamConfig;
}

export const TEAMS: readonly TeamId[] = ['player', 'opponent'];

/**
 * Normalizes a team config to the M9 squad shape: `squad` wins when present;
 * otherwise the legacy championId/championLane/championScaling fields become
 * a captain with no borrowed champions; no champion at all yields null.
 * The captain's lane always comes from championLane (default 0) — the squad
 * shape deliberately has no captain lane field.
 */
export function normalizeTeamSquad(
  config: BattleTeamConfig
): { captain: SquadCaptainConfig; captainLane: LaneId; borrowed: BorrowedChampionConfig[] } | null {
  const captainLane: LaneId = config.championLane ?? 0;
  if (config.squad) {
    return {
      captain: config.squad.captain,
      captainLane,
      borrowed: Array.isArray(config.squad.borrowed) ? config.squad.borrowed : [],
    };
  }
  if (config.championId) {
    return {
      captain: { championId: config.championId, scaling: config.championScaling },
      captainLane,
      borrowed: [],
    };
  }
  return null;
}

export function enemyOf(team: TeamId): TeamId {
  return team === 'player' ? 'opponent' : 'player';
}

/** March direction along x for a team. */
export function directionOf(team: TeamId): 1 | -1 {
  return team === 'player' ? 1 : -1;
}

export function createBattle(config: BattleConfig, balance: BalanceConfig): BattleState {
  const rng = new SeededRng(config.seed);
  // Deck shuffles consume the battle RNG in a fixed order (player first) —
  // part of the deterministic battle setup.
  const playerCards = config.player.deckCardIds
    ? initTeamCards(config.player.deckCardIds, balance, rng)
    : null;
  const opponentCards = config.opponent.deckCardIds
    ? initTeamCards(config.opponent.deckCardIds, balance, rng)
    : null;
  const state: BattleState = {
    balanceVersion: balance.balanceVersion,
    seed: config.seed,
    tick: 0,
    phase: 'main',
    suddenDeathEndsAtTick: null,
    rng,
    nextEntityId: 3, // 1 and 2 are the cores
    units: [],
    cores: {
      player: {
        id: 1,
        team: 'player',
        x: 0,
        health: balance.core.maxHealth,
        maxHealth: balance.core.maxHealth,
      },
      opponent: {
        id: 2,
        team: 'opponent',
        x: balance.arena.laneLength,
        health: balance.core.maxHealth,
        maxHealth: balance.core.maxHealth,
      },
    },
    teams: {
      player: {
        team: 'player',
        playerId: config.player.playerId,
        energy: balance.energy.startingEnergy,
        cards: playerCards,
        augment: { offeredIds: null, chosenId: null, chosenAtTick: null },
      },
      opponent: {
        team: 'opponent',
        playerId: config.opponent.playerId,
        energy: balance.energy.startingEnergy,
        cards: opponentCards,
        augment: { offeredIds: null, chosenId: null, chosenAtTick: null },
      },
    },
    // Neutral placeholder — recomputed below once champions have spawned so
    // tick 1 already sees champion passives (and any squad synergies) instead
    // of a synthetic empty-team snapshot. The tick pipeline then recomputes
    // at the end of every tick as before.
    auras: { player: neutralTeamAuras(), opponent: neutralTeamAuras() },
    outcome: null,
    log: [],
  };
  // Champions spawn in a fixed order (player first, captain before borrowed)
  // — part of deterministic battle setup, like the deck shuffles above.
  for (const team of TEAMS) {
    const teamConfig = team === 'player' ? config.player : config.opponent;
    const squad = normalizeTeamSquad(teamConfig);
    if (!squad) continue;
    if (squad.borrowed.length > balance.gym.maxBorrowed) {
      throw new Error(
        `too many borrowed champions (${squad.borrowed.length} > ${balance.gym.maxBorrowed})`
      );
    }
    const captainDef = getChampionById(squad.captain.championId);
    if (!captainDef) {
      throw new Error(`unknown champion '${squad.captain.championId}'`);
    }
    // Scaling from untrusted record configs must be structurally complete and
    // finite inside the engine sanity bounds — a 1e999 (Infinity after JSON
    // parse) or partial scaling would bake NaN/Infinity into champion stats
    // and silently corrupt the battle (P4 fix). Throwing matches the deck /
    // champion-id contract: untrusted-data consumers wrap createBattle.
    if (squad.captain.scaling !== undefined && !isValidChampionScaling(squad.captain.scaling)) {
      throw new Error(`invalid champion scaling for ${team} captain`);
    }
    spawnChampion(state, balance, captainDef, team, squad.captainLane, squad.captain.scaling, {
      commandable: true,
    });
    // Borrowed champions spawn in their configured lanes, staggered one
    // unitSpacing per slot BEHIND the captain's spawn offset (toward the own
    // core) so squads never stack at the spawn point.
    const dir = directionOf(team);
    const captainX = championSpawnX(balance, team);
    squad.borrowed.forEach((borrowed, index) => {
      const definition = getChampionById(borrowed.championId);
      if (!definition) {
        throw new Error(`unknown champion '${borrowed.championId}'`);
      }
      if (borrowed.lane !== 0 && borrowed.lane !== 1) {
        throw new Error(`invalid borrowed champion lane ${String(borrowed.lane)}`);
      }
      if (borrowed.scaling !== undefined && !isValidChampionScaling(borrowed.scaling)) {
        throw new Error(`invalid champion scaling for ${team} borrowed champion`);
      }
      const spawnX = Math.min(
        balance.arena.laneLength,
        Math.max(0, captainX - dir * balance.arena.unitSpacing * (index + 1))
      );
      spawnChampion(state, balance, definition, team, borrowed.lane, borrowed.scaling, {
        commandable: false,
        spawnX,
        ownerName: borrowed.displayName,
      });
    });
  }
  // Initial aura snapshot from the REAL starting composition: champion
  // passives (and full-squad synergies) are live from tick 1 instead of
  // arriving one tick late off a synthetic empty snapshot. Deterministic —
  // derived purely from the spawns above. Via recomputeAuras (not bare
  // computeTeamAuras) so synergies active from spawn (full-squad tags) log
  // their tick-0 'synergy-on' — otherwise a later death emits an orphan
  // 'synergy-off' with no matching activation (passives-review fix).
  recomputeAuras(state);
  return state;
}

export function logEvent(state: BattleState, type: string, detail: string): void {
  state.log.push({ tick: state.tick, type, detail });
}

export function getUnit(state: BattleState, id: EntityId): UnitState | undefined {
  return state.units.find((u) => u.id === id);
}

export function livingUnits(state: BattleState): UnitState[] {
  return state.units.filter((u) => u.alive);
}

/**
 * Effective stats after modifiers. Never returns negative/zero intervals.
 * Pass the unit's team auras (`state.auras[unit.team]`) to fold the synergy/
 * augment attack-damage and move-speed multipliers in; omitting the parameter
 * keeps pre-aura behaviour (existing tests, max-health clamping paths — auras
 * never touch max health).
 */
export function effectiveStats(
  unit: UnitState,
  tick: number,
  aura?: Pick<TeamAuras, 'attackDamageMult' | 'moveSpeedMult'>
): CombatStats {
  let damageMult = aura?.attackDamageMult ?? 1;
  let speedMult = aura?.moveSpeedMult ?? 1;
  let intervalMult = 1;
  let bonusHealth = 0;
  for (const mod of unit.modifiers) {
    if (mod.expiresAtTick <= tick) continue;
    if (mod.attackDamageMult !== undefined) damageMult *= mod.attackDamageMult;
    if (mod.moveSpeedMult !== undefined) speedMult *= mod.moveSpeedMult;
    if (mod.attackIntervalMult !== undefined) intervalMult *= mod.attackIntervalMult;
    if (mod.bonusMaxHealth !== undefined) bonusHealth += mod.bonusMaxHealth;
  }
  return {
    maxHealth: unit.baseMaxHealth + bonusHealth,
    attackDamage: unit.base.attackDamage * damageMult,
    attackIntervalTicks: Math.max(1, Math.round(unit.base.attackIntervalTicks * intervalMult)),
    attackRange: unit.base.attackRange,
    moveSpeedPerTick: unit.base.moveSpeedPerTick * speedMult,
    isRanged: unit.base.isRanged,
  };
}

export function isStunned(unit: UnitState, tick: number): boolean {
  return unit.stunUntilTick > tick;
}

/**
 * Applies a timed modifier with a refresh-by-sourceId stacking policy:
 * re-applying the same source REPLACES the previous instance (refreshing its
 * duration) instead of stacking multiplicatively without bound.
 *
 * Temporary-vitality accounting for bonusMaxHealth: only the increase over
 * the replaced instance's bonus is granted as current health; a shrink (or
 * unchanged refresh) never grants and health is re-clamped to the new
 * effective max.
 */
export function applyModifierWithRefresh(
  unit: UnitState,
  mod: ActiveModifier,
  tick: number
): void {
  let previousBonus = 0;
  const kept: ActiveModifier[] = [];
  for (const existing of unit.modifiers) {
    if (existing.sourceId === mod.sourceId) {
      if (existing.expiresAtTick > tick) previousBonus += existing.bonusMaxHealth ?? 0;
      continue; // dropped (replaced), expired ones pruned too
    }
    kept.push(existing);
  }
  unit.modifiers = kept;
  unit.modifiers.push(mod);

  const newBonus = mod.bonusMaxHealth ?? 0;
  if (newBonus > previousBonus) {
    unit.health += newBonus - previousBonus;
  } else if (newBonus < previousBonus) {
    const max = effectiveStats(unit, tick).maxHealth;
    if (unit.health > max) unit.health = max;
  }
}

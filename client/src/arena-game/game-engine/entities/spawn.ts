/**
 * Entity spawning. Ids are allocated sequentially from battle state so they
 * are unique per battle and deterministic.
 */
import type { CardDefinition, ChampionDefinition } from '../../content/types';
import type { BalanceConfig } from '../../content/balance';
import { ChampionFitnessScaling, NEUTRAL_SCALING } from '../balance/fitness-scaling';
import { BattleState, directionOf, logEvent, UnitState } from '../simulation/state';
import type { LaneId, TeamId } from '../types';

/** Where a team's champion spawns (and respawns): just in front of its core. */
export function championSpawnX(balance: BalanceConfig, team: TeamId): number {
  const offset = balance.champion.spawnOffsetFromCore;
  return team === 'player' ? offset : balance.arena.laneLength - offset;
}

/**
 * Spawns a team's Champion at battle start. Champions are regular units to
 * the tick pipeline ('default' behavior) plus a champion sub-state carrying
 * ability cooldown, ultimate charge and respawn bookkeeping. Content numbers
 * the engine core needs later (charge rates, respawn delay) are copied onto
 * that sub-state here so combat/tick never import content.
 */
export interface SpawnChampionOptions {
  /**
   * Whether champion-ability/ultimate commands route to this champion (the
   * team captain). Borrowed squad champions (M9) pass false and auto-cast
   * their ability instead. Default true (pre-M9 behaviour).
   */
  commandable?: boolean;
  /**
   * Spawn (and respawn) x override — borrowed champions stagger behind the
   * captain's spawn offset. Default: the standard championSpawnX.
   */
  spawnX?: number;
  /**
   * P10: owning gym member's display name for borrowed champions —
   * display/attribution only (copied onto ChampionState.ownerName, never
   * simulated, never digested).
   */
  ownerName?: string;
}

export function spawnChampion(
  state: BattleState,
  balance: BalanceConfig,
  champion: ChampionDefinition,
  team: TeamId,
  lane: LaneId,
  scaling: ChampionFitnessScaling = NEUTRAL_SCALING,
  options: SpawnChampionOptions = {}
): UnitState {
  const x = options.spawnX ?? championSpawnX(balance, team);
  const commandable = options.commandable ?? true;
  // Fitness scaling (M7) is baked in at spawn: stats, the ability cooldown
  // duration and the charge accrual rates all carry their multipliers here,
  // so combat/tick/events never consult scaling again. Scaling arrives via
  // BattleConfig (already capped), so replays reproduce it exactly.
  // Champion passives (five-champion pass) bake in the same way: spawn-time
  // effects multiply here; per-hit hooks are copied onto the champion
  // sub-state so combat never consults content mid-battle.
  const passive = champion.passive.effects;
  const scaledMaxHealth = Math.round(
    champion.stats.maxHealth * scaling.maxHealthMult * (passive.spawnMaxHealthMult ?? 1)
  );
  const unit: UnitState = {
    id: state.nextEntityId++,
    team,
    kind: 'champion',
    contentId: champion.id,
    behavior: 'default',
    lane,
    x,
    health: scaledMaxHealth,
    baseMaxHealth: scaledMaxHealth,
    shield: 0,
    base: {
      ...champion.stats,
      maxHealth: scaledMaxHealth,
      attackDamage: champion.stats.attackDamage * scaling.attackDamageMult,
      moveSpeedPerTick: champion.stats.moveSpeedPerTick * scaling.moveSpeedMult,
    },
    attackCooldownTicks: 0,
    targetId: null,
    stunUntilTick: 0,
    modifiers: [],
    alive: true,
    spawnedAtTick: state.tick,
    champion: {
      definitionId: champion.id,
      commandable,
      abilityCooldownTicks: 0,
      ultimateCharge: 0,
      respawnAtTick: null,
      chargePerDamageDealt: champion.ultimateChargePerDamageDealt * scaling.ultimateChargeMult,
      chargePerDamageTaken: champion.ultimateChargePerDamageTaken * scaling.ultimateChargeMult,
      chargeRequired: champion.ultimateChargeRequired,
      abilityCooldownTotalTicks: Math.max(
        1,
        Math.round(champion.ability.cooldownTicks * scaling.abilityCooldownMult)
      ),
      respawnDelayTicks: balance.champion.respawnTicks,
      stanceShifts: 0,
      // Arena 2.0 player-control state (see ChampionState docs) — inert in 1.0.
      comboCount: 0,
      lastBasicAttackTick: -9999,
      pendingComboMult: null,
      laneSwitchReadyTick: 0,
      passiveArmorFlat: passive.selfArmorFlat ?? 0,
      passiveLowHealthBonus: passive.lowHealthBonus
        ? { ...passive.lowHealthBonus }
        : null,
      spawnX: x,
      ownerName: options.ownerName,
    },
  };
  state.units.push(unit);
  logEvent(
    state,
    'champion-spawn',
    `${team} fielded ${champion.id}${commandable ? '' : ' (borrowed)'} lane ${lane} @${x}`
  );
  return unit;
}

/** Spawns the units for a fighter card at position x. Returns spawned units. */
export function spawnUnitsForCard(
  state: BattleState,
  balance: BalanceConfig,
  card: CardDefinition,
  team: TeamId,
  lane: LaneId,
  x: number
): UnitState[] {
  if (!card.unit) throw new Error(`card '${card.id}' is not a fighter`);
  const spawned: UnitState[] = [];
  const dir = directionOf(team);
  // Prefab Shielding augment: fighters deploy pre-shielded (aura layer).
  const deployShield = state.auras[team].deployShield;
  // Multi-unit deploys fan out behind the deploy point. Shift the base point
  // so the whole fan fits inside the lane — clamping individual offsets would
  // stack units at exactly the same x at lane edges, which unitSpacing exists
  // to prevent.
  const span = (card.unit.deployCount - 1) * balance.arena.unitSpacing;
  const baseX =
    dir === 1
      ? clamp(x, span, balance.arena.laneLength)
      : clamp(x, 0, balance.arena.laneLength - span);
  for (let i = 0; i < card.unit.deployCount; i++) {
    const offset = i * balance.arena.unitSpacing * -dir;
    const px = clamp(baseX + offset, 0, balance.arena.laneLength);
    const unit: UnitState = {
      id: state.nextEntityId++,
      team,
      kind: 'unit',
      contentId: card.id,
      behavior: card.unit.behavior ?? 'default',
      lane,
      x: px,
      health: card.unit.stats.maxHealth,
      baseMaxHealth: card.unit.stats.maxHealth,
      shield: deployShield,
      base: { ...card.unit.stats },
      attackCooldownTicks: 0,
      targetId: null,
      stunUntilTick: 0,
      modifiers: [],
      alive: true,
      spawnedAtTick: state.tick,
    };
    state.units.push(unit);
    spawned.push(unit);
  }
  logEvent(state, 'spawn', `${team} deployed ${card.id} x${card.unit.deployCount} lane ${lane} @${x}`);
  return spawned;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

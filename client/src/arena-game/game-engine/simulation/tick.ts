/**
 * The tick pipeline — one fixed-order pass per simulation tick:
 *
 *   1. advance clock
 *   2. revive champions whose respawn tick has arrived
 *   3. create the augment offer (at exactly the offer tick)
 *   4. apply scheduled commands for this tick
 *   5. regenerate Forge Energy (augment regen aura applies)
 *   6. apply periodic augment effects (heal pulse)
 *   7. expire modifiers
 *   8. units act in ascending entity-id order (retarget → attack or move)
 *   9. resolve outcome (core destroyed / timeout / sudden death)
 *  10. recompute the team aura layer from living composition + augments
 *
 * The fixed order is what guarantees determinism; never reorder these steps
 * or iterate over anything with nondeterministic ordering. Step 10 runs LAST
 * so every consumer during a tick reads one consistent snapshot (composition
 * as of the previous tick's end) and the post-tick invariant check sees
 * fresh auras.
 */
import type { BalanceConfig } from '../../content/balance';
import { autoCastBorrowedAbility } from '../abilities/champion-abilities';
import { applyAugmentPulses, offerAugments } from '../augments/augments';
import { addShield, damageCore, damageUnit, healUnit } from '../combat/combat';
import { recomputeAuras } from '../synergies/synergies';
import { acquireTarget, distanceBetween } from '../targeting/targeting';
import {
  applyScheduledCommands,
  RejectedCommand,
  ScheduledCommand,
} from './events';
import {
  BattleState,
  directionOf,
  effectiveStats,
  isStunned,
  logEvent,
  UnitState,
} from './state';

export function advanceTick(
  state: BattleState,
  balance: BalanceConfig,
  commands: readonly ScheduledCommand[] = [],
  rejected: RejectedCommand[] = []
): void {
  if (state.phase === 'finished') return;

  state.tick++;

  // Respawns run before commands so a champion reviving this tick can
  // already receive ability commands and act (respawnAtTick is the first
  // tick it is alive again).
  respawnChampions(state, balance);

  offerAugments(state, balance);

  applyScheduledCommands(state, balance, commands, rejected);

  regenerateEnergy(state, balance);
  applyAugmentPulses(state);
  expireModifiers(state);

  // Units act in ascending id order (stable and deterministic).
  for (const unit of state.units) {
    if (!unit.alive) continue;
    if (unit.attackCooldownTicks > 0) unit.attackCooldownTicks--;
    // Ability cooldown recovers while alive (stunned included, like the
    // attack cooldown); it freezes while the champion is down.
    if (unit.champion && unit.champion.abilityCooldownTicks > 0) {
      unit.champion.abilityCooldownTicks--;
    }
    if (isStunned(unit, state.tick)) continue;
    // Borrowed squad champions (M9) auto-cast their signature ability when
    // it is ready and has valid targets, then act normally this tick (like a
    // captain whose ability command applied earlier in the pipeline). Stun
    // suppresses auto-casts: they are engine-driven unit behaviour, not
    // player commands.
    autoCastBorrowedAbility(state, balance, unit);
    actUnit(state, balance, unit);
  }

  resolveOutcome(state, balance);
  recomputeAuras(state);
}

/**
 * Revives dead champions whose respawn tick has arrived: at their own spawn
 * position (captains beside the core, borrowed champions at their staggered
 * slot — respawn works identically for both), at the configured health
 * fraction, with combat state fully cleared (shield, modifiers, stun,
 * target, attack cooldown). Ability cooldown and ultimate charge persist
 * through death.
 */
function respawnChampions(state: BattleState, balance: BalanceConfig): void {
  for (const unit of state.units) {
    const champ = unit.champion;
    if (!champ || unit.alive || champ.respawnAtTick === null) continue;
    if (state.tick < champ.respawnAtTick) continue;
    unit.alive = true;
    unit.health = balance.champion.respawnHealthFraction * unit.baseMaxHealth;
    unit.x = champ.spawnX;
    unit.shield = 0;
    unit.modifiers = [];
    unit.stunUntilTick = 0;
    unit.targetId = null;
    unit.attackCooldownTicks = 0;
    champ.respawnAtTick = null;
    logEvent(
      state,
      'champion-respawn',
      `${unit.team} ${unit.contentId}#${unit.id} respawned at ${unit.health} health`
    );
  }
}

function regenerateEnergy(state: BattleState, balance: BalanceConfig): void {
  const { max, regenPerTick, finalMinuteRegenMult, finalMinuteStartTick } = balance.energy;
  const mult = state.tick >= finalMinuteStartTick ? finalMinuteRegenMult : 1;
  for (const team of ['player', 'opponent'] as const) {
    const t = state.teams[team];
    // energyRegenMult is the augment aura (1 unless Forge Conduits is chosen).
    t.energy = Math.min(max, t.energy + regenPerTick * mult * state.auras[team].energyRegenMult);
  }
}

function expireModifiers(state: BattleState): void {
  for (const unit of state.units) {
    if (unit.modifiers.length === 0) continue;
    unit.modifiers = unit.modifiers.filter((m) => m.expiresAtTick > state.tick);
    // Bonus max health may have expired — clamp health to current effective max.
    const max = effectiveStats(unit, state.tick).maxHealth;
    if (unit.health > max) unit.health = max;
  }
}

function actUnit(state: BattleState, balance: BalanceConfig, unit: UnitState): void {
  const stats = effectiveStats(unit, state.tick, state.auras[unit.team]);
  const target = acquireTarget(state, balance, unit, stats.attackRange);

  if (target === null) {
    march(state, balance, unit, stats.moveSpeedPerTick);
    return;
  }

  if (target.kind === 'unit') {
    const dist = distanceBetween(unit.x, target.unit.x);
    if (dist <= stats.attackRange) {
      if (unit.attackCooldownTicks === 0) {
        if (unit.behavior === 'healer') {
          // Healer and target share a team; healing scales with that team's aura.
          const healed = healUnit(
            target.unit,
            stats.attackDamage,
            state.auras[target.unit.team].healingMult
          );
          if (healed > 0) {
            logEvent(
              state,
              'heal',
              `${unit.contentId}#${unit.id} healed ${target.unit.contentId}#${target.unit.id} for ${healed}`
            );
            logEvent(
              state,
              'fx',
              `heal|${target.unit.lane}|${Math.round(target.unit.x)}|${Math.round(healed)}|${target.unit.team}`
            );
          }
        } else if (unit.behavior === 'shielder') {
          // Grant up to attackDamage shield, never exceeding the cap the
          // targeting pass selected against.
          const cap = stats.attackDamage * balance.units.shielderShieldCapMult;
          const grant = Math.min(stats.attackDamage, Math.max(0, cap - target.unit.shield));
          if (grant > 0) {
            addShield(target.unit, grant);
            logEvent(
              state,
              'shield',
              `${unit.contentId}#${unit.id} shielded ${target.unit.contentId}#${target.unit.id} for ${grant}`
            );
          }
        } else {
          // damageUnit clears every reference to the target if this kills it.
          // Arena 2.0: a champion consumes any pending combo multiplier here.
          damageUnit(
            state,
            target.unit,
            championStrikeDamage(unit, stats.attackDamage),
            `${unit.contentId}#${unit.id}`,
            unit
          );
        }
        unit.attackCooldownTicks = stats.attackIntervalTicks;
      }
    } else {
      moveToward(balance, unit, target.unit.x, stats.moveSpeedPerTick);
    }
    return;
  }

  // Core target
  const dist = distanceBetween(unit.x, target.core.x);
  if (dist <= stats.attackRange) {
    if (unit.attackCooldownTicks === 0) {
      damageCore(
        state,
        target.core,
        championStrikeDamage(unit, stats.attackDamage),
        `${unit.contentId}#${unit.id}`,
        unit
      );
      unit.attackCooldownTicks = stats.attackIntervalTicks;
    }
  } else {
    march(state, balance, unit, stats.moveSpeedPerTick);
  }
}

/** Arena 2.0: apply and consume a champion's pending combo multiplier on its
 *  strike. A non-champion (or a champion with no pending combo — i.e. every
 *  Arena 1.0 battle) returns the base damage unchanged, so 1.0 is untouched. */
function championStrikeDamage(unit: UnitState, base: number): number {
  const champ = unit.champion;
  if (champ && champ.pendingComboMult != null) {
    const mult = champ.pendingComboMult;
    champ.pendingComboMult = null;
    return base * mult;
  }
  return base;
}

/** March toward the enemy core along the lane. */
function march(state: BattleState, balance: BalanceConfig, unit: UnitState, speed: number): void {
  const dir = directionOf(unit.team);
  unit.x = clamp(unit.x + dir * speed, 0, balance.arena.laneLength);
}

function moveToward(balance: BalanceConfig, unit: UnitState, targetX: number, speed: number): void {
  const delta = targetX - unit.x;
  const step = Math.sign(delta) * Math.min(Math.abs(delta), speed);
  unit.x = clamp(unit.x + step, 0, balance.arena.laneLength);
}

function resolveOutcome(state: BattleState, balance: BalanceConfig): void {
  const playerCore = state.cores.player;
  const opponentCore = state.cores.opponent;

  const finish = (
    winner: 'player' | 'opponent' | 'draw',
    reason: 'core-destroyed' | 'timeout-core-health' | 'sudden-death' | 'draw'
  ) => {
    state.phase = 'finished';
    state.outcome = {
      winner,
      reason,
      endTick: state.tick,
      playerCoreHealth: playerCore.health,
      opponentCoreHealth: opponentCore.health,
    };
    logEvent(state, 'battle-end', `${winner} (${reason})`);
  };

  // 1. Core destruction (both destroyed in one tick = draw; effectively
  //    impossible with sequential unit actions but must not crash).
  if (playerCore.health <= 0 && opponentCore.health <= 0) {
    finish('draw', 'draw');
    return;
  }
  if (opponentCore.health <= 0) {
    finish('player', 'core-destroyed');
    return;
  }
  if (playerCore.health <= 0) {
    finish('opponent', 'core-destroyed');
    return;
  }

  if (state.phase === 'main' && state.tick >= balance.battle.durationTicks) {
    if (playerCore.health > opponentCore.health) {
      finish('player', 'timeout-core-health');
    } else if (opponentCore.health > playerCore.health) {
      finish('opponent', 'timeout-core-health');
    } else {
      state.phase = 'sudden-death';
      state.suddenDeathEndsAtTick = state.tick + balance.battle.suddenDeathTicks;
      logEvent(state, 'sudden-death', `starts, ends at tick ${state.suddenDeathEndsAtTick}`);
    }
    return;
  }

  if (state.phase === 'sudden-death') {
    // Cores entered sudden death equal; first blood decides.
    if (playerCore.health !== opponentCore.health) {
      finish(playerCore.health > opponentCore.health ? 'player' : 'opponent', 'sudden-death');
      return;
    }
    if (state.suddenDeathEndsAtTick !== null && state.tick >= state.suddenDeathEndsAtTick) {
      finish('draw', 'draw');
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

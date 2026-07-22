/**
 * Technique and equipment card effects — data-driven interpretation of
 * CardEffects payloads. All health/shield/stun/modifier changes route through
 * the combat module so clamping and death handling stay in one place.
 *
 * AoE semantics: `radius` is measured along the lane axis WITHIN the target's
 * lane. Cross-lane recipient selection is a Champion feature — the ability
 * module builds its own recipient lists and shares applyEffectPayload below.
 */
import type { BalanceConfig } from '../../content/balance';
import type { CardDefinition } from '../../content/types';
import { addShield, damageUnit, healUnit } from '../combat/combat';
import {
  applyModifierWithRefresh,
  BattleState,
  logEvent,
  UnitState,
} from '../simulation/state';
import type { CardEffects, TeamId } from '../types';

export type CardTarget =
  | { kind: 'unit'; unitId: number }
  | { kind: 'none' };

export type EffectResult = { ok: true } | { ok: false; reason: string };

/** Units eligible for the positive / negative halves of an effect payload. */
export interface EffectRecipients {
  /** Receive heal/shield/buffs (must be the caster's team to apply). */
  allies: UnitState[];
  /** Receive damage/stun/debuffs (must be the enemy team to apply). */
  enemies: UnitState[];
}

export interface EffectPayloadOptions {
  /** Stamped on modifiers as sourceId (card or ability id). */
  sourceId: string;
  /** Label for damage logs (e.g. 'card:overload', 'ability:phase-dash'). */
  damageLabel: string;
  /** Attacking unit, for ultimate-charge attribution. Omit for ultimates. */
  damageSource?: UnitState;
}

/** Finds living units in the target's lane within radius (inclusive). */
function unitsInRadius(
  state: BattleState,
  center: UnitState,
  radius: number,
  team: TeamId | 'any'
): UnitState[] {
  return state.units.filter(
    (u) =>
      u.alive &&
      u.lane === center.lane &&
      Math.abs(u.x - center.x) <= radius &&
      (team === 'any' || u.team === team)
  );
}

/**
 * Validates a card target against the card's target rule WITHOUT mutating
 * state. Callers validate, then pay energy, then apply — so a bad target
 * never costs energy and a paid card always resolves.
 */
export function validateCardTarget(
  state: BattleState,
  card: CardDefinition,
  casterTeam: TeamId,
  target: CardTarget
): EffectResult {
  if (!card.effects) return { ok: false, reason: `card '${card.id}' has no effects` };

  // The target arrives from untrusted replay/record data: it can be null,
  // missing entirely, or a primitive. Shape-guard BEFORE reading .kind so a
  // poisoned play-card command is rejected, never thrown (P4 fix — a null
  // target used to TypeError out of the tick pipeline in live ghost battles).
  if (!target || typeof target !== 'object' || target.kind !== 'unit') {
    // The initial 20-card set has no 'no-target' cards; champion abilities
    // route through their own command types. Reject to keep behaviour explicit.
    return { ok: false, reason: `card '${card.id}' requires a unit target` };
  }

  const unit = state.units.find((u) => u.id === target.unitId);
  if (!unit || !unit.alive) return { ok: false, reason: 'target is gone' };

  const isFriendly = unit.team === casterTeam;
  switch (card.target) {
    case 'friendly-unit':
      if (!isFriendly) return { ok: false, reason: 'must target a friendly unit' };
      break;
    case 'enemy-unit':
      if (isFriendly) return { ok: false, reason: 'must target an enemy unit' };
      break;
    case 'friendly-champion':
      if (!isFriendly || unit.kind !== 'champion')
        return { ok: false, reason: 'must target your Champion' };
      break;
    case 'any-unit':
      break;
    default:
      return { ok: false, reason: `card '${card.id}' cannot target units` };
  }
  return { ok: true };
}

/**
 * Core interpreter for a CardEffects payload against explicit recipient
 * lists. Shared by card plays (lane-scoped AoE around the target) and
 * champion abilities (which build their own recipient sets — self, in-lane,
 * cross-lane or global). Team guards stay load-bearing: with radius 0 a card
 * passes the single target in BOTH lists and the guards decide which half of
 * the payload applies to it.
 */
export function applyEffectPayload(
  state: BattleState,
  balance: BalanceConfig,
  effects: CardEffects,
  casterTeam: TeamId,
  recipients: EffectRecipients,
  options: EffectPayloadOptions
): void {
  const { allies, enemies } = recipients;

  if (effects.damage) {
    for (const enemy of enemies) {
      if (enemy.team === casterTeam) continue;
      damageUnit(state, enemy, effects.damage, options.damageLabel, options.damageSource);
    }
  }
  if (effects.stunTicks) {
    for (const enemy of enemies) {
      if (enemy.team === casterTeam) continue;
      enemy.stunUntilTick = Math.max(enemy.stunUntilTick, state.tick + effects.stunTicks);
    }
  }
  if (effects.heal) {
    for (const ally of allies) {
      if (ally.team !== casterTeam) continue;
      // Healing received scales with the receiving team's aura (M6 synergy).
      const healed = healUnit(ally, effects.heal, state.auras[ally.team].healingMult);
      if (healed > 0) {
        logEvent(
          state,
          'fx',
          `heal|${ally.lane}|${Math.round(ally.x)}|${Math.round(healed)}|${ally.team}`
        );
      }
    }
  }
  if (effects.shield) {
    for (const ally of allies) {
      if (ally.team !== casterTeam) continue;
      addShield(ally, effects.shield);
    }
  }

  // Timed stat modifiers. Debuff-style modifiers (slows, vulnerability) go on
  // enemies, buffs on allies — decided per field by which side the
  // multiplier favours.
  const duration = effects.durationTicks ?? 0;
  if (duration > 0) {
    const expiresAtTick = state.tick + duration;
    const buff = {
      sourceId: options.sourceId,
      expiresAtTick,
      ...(effects.attackDamageMult !== undefined && effects.attackDamageMult >= 1
        ? { attackDamageMult: effects.attackDamageMult }
        : {}),
      ...(effects.attackIntervalMult !== undefined && effects.attackIntervalMult <= 1
        ? { attackIntervalMult: effects.attackIntervalMult }
        : {}),
      ...(effects.moveSpeedMult !== undefined && effects.moveSpeedMult >= 1
        ? { moveSpeedMult: effects.moveSpeedMult }
        : {}),
      ...(effects.damageTakenMult !== undefined && effects.damageTakenMult <= 1
        ? { damageTakenMult: effects.damageTakenMult }
        : {}),
      ...(effects.bonusMaxHealth !== undefined ? { bonusMaxHealth: effects.bonusMaxHealth } : {}),
    };
    const debuff = {
      sourceId: options.sourceId,
      expiresAtTick,
      ...(effects.attackDamageMult !== undefined && effects.attackDamageMult < 1
        ? { attackDamageMult: effects.attackDamageMult }
        : {}),
      ...(effects.attackIntervalMult !== undefined && effects.attackIntervalMult > 1
        ? { attackIntervalMult: effects.attackIntervalMult }
        : {}),
      ...(effects.moveSpeedMult !== undefined && effects.moveSpeedMult < 1
        ? { moveSpeedMult: effects.moveSpeedMult }
        : {}),
      ...(effects.damageTakenMult !== undefined && effects.damageTakenMult > 1
        ? { damageTakenMult: effects.damageTakenMult }
        : {}),
    };
    const buffHasFields = Object.keys(buff).length > 2;
    const debuffHasFields = Object.keys(debuff).length > 2;
    // Refresh-by-sourceId stacking: re-casting the same card/ability
    // refreshes its modifier instead of stacking without bound; temporary
    // vitality for bonusMaxHealth is granted once, not per cast.
    if (buffHasFields) {
      for (const ally of allies) {
        if (ally.team !== casterTeam) continue;
        applyModifierWithRefresh(ally, { ...buff }, state.tick);
      }
    }
    if (debuffHasFields) {
      for (const enemy of enemies) {
        if (enemy.team === casterTeam) continue;
        applyModifierWithRefresh(enemy, { ...debuff }, state.tick);
      }
    }
  }

  if (effects.energyRefund) {
    const team = state.teams[casterTeam];
    team.energy = Math.min(balance.energy.max, team.energy + effects.energyRefund);
  }
}

/**
 * Applies a card's effects. Target must have been validated with
 * validateCardTarget; returns a rejection only for race conditions that
 * cannot happen through applyCommand's validate→pay→apply sequence.
 */
export function applyCardEffects(
  state: BattleState,
  balance: BalanceConfig,
  card: CardDefinition,
  casterTeam: TeamId,
  target: CardTarget
): EffectResult {
  const effects = card.effects;
  // Mirror validateCardTarget's shape guard (defense in depth for any future
  // caller that skips validation): never dereference an untrusted target.
  if (!effects || !target || typeof target !== 'object' || target.kind !== 'unit') {
    return { ok: false, reason: 'applyCardEffects called without validation' };
  }
  const unit = state.units.find((u) => u.id === target.unitId);
  if (!unit || !unit.alive) return { ok: false, reason: 'target is gone' };

  const radius = effects.radius ?? 0;
  // Positive effects hit the caster's team, negative effects the enemy's —
  // resolved around the target unit, within its lane.
  const allies = radius > 0 ? unitsInRadius(state, unit, radius, casterTeam) : [unit];
  const enemies =
    radius > 0
      ? unitsInRadius(state, unit, radius, casterTeam === 'player' ? 'opponent' : 'player')
      : [unit];

  applyEffectPayload(state, balance, effects, casterTeam, { allies, enemies }, {
    sourceId: card.id,
    damageLabel: `card:${card.id}`,
  });

  logEvent(
    state,
    'card-effect',
    `${casterTeam} played ${card.id} on ${unit.contentId}#${unit.id} (lane ${unit.lane})`
  );
  return { ok: true };
}

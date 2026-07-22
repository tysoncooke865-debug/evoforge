/**
 * Champion ability and ultimate behaviours (Milestone 5).
 *
 * Numerics are data-driven (ChampionAbilityDefinition.effects, interpreted
 * through the shared applyEffectPayload); what lives here is each ability's
 * recipient/targeting rule and any movement/stance mechanics. Every handler
 * exposes validate (pure — used both by the command layer before paying the
 * cooldown/charge and by the live controller for instant UI feedback) and
 * apply (mutates state; only called after validate passed).
 *
 * Semantics decisions (tested):
 *  - Titan's Quake Stomp / Seismic Smash and the Mass Monster's Gravity Well
 *    are ground effects centered on the champion and hit BOTH lanes within
 *    radius (card AoE stays lane-scoped; cross-lane areas are deliberately a
 *    champion-only feature).
 *  - Mass Uprising summons existing fighter cards via spawnUnitsForCard —
 *    first in the champion's lane, then alternating — at the champion's x.
 *    Always valid (spawning needs no targets); summons inherit deploy-shield
 *    auras like any fighter.
 *  - Phase Dash / Final Cut target living enemies (units and champions) in
 *    the champion's lane within aggro range. Furthest / lowest-current-health
 *    respectively, ties broken by lower entity id.
 *  - Final Cut executes when the target SURVIVES the listed damage but is
 *    left below executeBelowHealthFraction of its base max health — the
 *    threshold is checked AFTER the hit, and the execute kills through
 *    shields.
 *  - Stance Shift alternates starting with Bulwark (even stanceShifts count
 *    = Bulwark). A new stance replaces the previous stance modifier.
 *  - Abilities may be used while stunned (they are player commands, like
 *    cards); a dead champion can use nothing.
 *  - Damage dealt by an ACTIVE ability charges the ultimate; damage dealt by
 *    the ultimate itself does not (no self-recharging ultimates).
 */
import type { BalanceConfig } from '../../content/balance';
import { getCardById } from '../../content/cards';
import { getChampionById } from '../../content/champions';
import type { ChampionAbilityDefinition } from '../../content/types';
import { applyEffectPayload } from '../cards/effects';
import { damageUnit } from '../combat/combat';
import { spawnUnitsForCard } from '../entities/spawn';
import { BattleState, enemyOf, logEvent, UnitState } from '../simulation/state';
import type { CardEffects, LaneId, TeamId } from '../types';

export type AbilityCheck = { ok: true } | { ok: false; reason: string };

const OK: AbilityCheck = { ok: true };
const NO_VALID_TARGETS: AbilityCheck = { ok: false, reason: 'no valid targets' };

/** The team's champion unit (alive or down), or null if none was fielded. */
export function findTeamChampion(state: BattleState, team: TeamId): UnitState | null {
  for (const unit of state.units) {
    if (unit.kind === 'champion' && unit.team === team) return unit;
  }
  return null;
}

/**
 * The team's CAPTAIN — the single commandable champion (M9). champion-ability
 * and champion-ultimate commands route here only; borrowed champions are
 * never commandable.
 */
export function findTeamCaptain(state: BattleState, team: TeamId): UnitState | null {
  for (const unit of state.units) {
    if (unit.kind === 'champion' && unit.team === team && unit.champion?.commandable) return unit;
  }
  return null;
}

/**
 * Borrowed-champion auto-cast (M9): an alive, non-stunned, NON-commandable
 * champion with its signature ability off cooldown casts it automatically
 * whenever the ability's own validation passes (same validate → pay → apply
 * sequence as the command path, so a no-target tick never wastes the
 * cooldown). Purely engine-driven and deterministic — no AI, no RNG — so
 * replays reproduce auto-casts by construction. Borrowed champions never use
 * their ultimate: charge accrues (combat hooks are champion-generic) but is
 * never spent — simplified build, documented in PROGRESS/KNOWN_ISSUES.
 *
 * Called from the tick pipeline's unit-action loop (ascending entity-id
 * order), right before the unit's normal action — mirroring how a captain
 * that used its ability this tick still attacks/moves afterwards.
 */
export function autoCastBorrowedAbility(
  state: BattleState,
  balance: BalanceConfig,
  unit: UnitState
): void {
  const champ = unit.champion;
  if (!champ || champ.commandable || !unit.alive) return;
  if (champ.abilityCooldownTicks > 0) return;
  const definition = getChampionById(champ.definitionId);
  if (!definition) return; // unreachable: spawn validated the id
  // Auto-casts use the TACTICAL validation (autoCastValidate when a handler
  // defines one, its normal validate otherwise): an always-valid ability like
  // Lane Shift needs an intent gate here or a borrowed champion fires it on
  // cooldown forever (P4 fix — the Cardio Machine lane ping-pong).
  if (!validateChampionAutoCast(state, balance, unit, definition.ability).ok) return;
  champ.abilityCooldownTicks = champ.abilityCooldownTotalTicks;
  applyChampionAbility(state, balance, unit, definition.ability);
  logEvent(state, 'auto-ability', `${unit.team} ${unit.contentId}#${unit.id} auto-cast`);
}

interface EnemyQuery {
  /** Max |x - champion.x| (omit for unlimited). */
  radius?: number;
  /** Restrict to the champion's lane. */
  sameLane?: boolean;
}

/** Living enemies (units and champions) around the champion. */
function livingEnemiesNear(state: BattleState, champion: UnitState, query: EnemyQuery): UnitState[] {
  const enemyTeam = enemyOf(champion.team);
  return state.units.filter(
    (u) =>
      u.alive &&
      u.team === enemyTeam &&
      (!query.sameLane || u.lane === champion.lane) &&
      (query.radius === undefined || Math.abs(u.x - champion.x) <= query.radius)
  );
}

/** Furthest unit from the champion; ties broken by lower entity id. */
function furthestFrom(champion: UnitState, units: readonly UnitState[]): UnitState {
  let best = units[0];
  let bestDist = Math.abs(best.x - champion.x);
  for (const u of units) {
    const d = Math.abs(u.x - champion.x);
    if (d > bestDist || (d === bestDist && u.id < best.id)) {
      best = u;
      bestDist = d;
    }
  }
  return best;
}

/** Lowest current health; ties broken by lower entity id. */
function lowestHealth(units: readonly UnitState[]): UnitState {
  let best = units[0];
  for (const u of units) {
    if (u.health < best.health || (u.health === best.health && u.id < best.id)) best = u;
  }
  return best;
}

function abilityLabel(ability: ChampionAbilityDefinition): string {
  return `ability:${ability.id}`;
}

interface AbilityHandler {
  validate(
    state: BattleState,
    balance: BalanceConfig,
    champion: UnitState,
    ability: ChampionAbilityDefinition
  ): AbilityCheck;
  /**
   * Optional AUTO-CAST-ONLY gate: consulted instead of `validate` by
   * autoCastBorrowedAbility (and by the opponent AI via
   * validateChampionAutoCast) for abilities whose unconditional validity is
   * fine for a deliberate human command but degenerate on a cooldown loop
   * (Lane Shift). Commanded casts — captain commands and their UI
   * pre-validation — never consult this: a human's tactical choice stays
   * unconditional. Must be pure and deterministic like `validate`.
   */
  autoCastValidate?(
    state: BattleState,
    balance: BalanceConfig,
    champion: UnitState,
    ability: ChampionAbilityDefinition
  ): AbilityCheck;
  apply(
    state: BattleState,
    balance: BalanceConfig,
    champion: UnitState,
    ability: ChampionAbilityDefinition
  ): void;
}

/**
 * Tactical gate for auto-cast Lane Shift: shift ONLY to join combat — the
 * champion's CURRENT lane must hold no living enemy within aggro range
 * (nothing to fight here) AND the OTHER lane must hold at least one living
 * enemy within aggro range of the champion's x (a fight to join at this
 * position). Ping-pong is structurally impossible: immediately after a
 * shift, the destination lane has an in-range enemy, so the gate fails until
 * that fight resolves — at which point shifting again is genuinely correct.
 * Pure state reads, no RNG, order-independent — deterministic and
 * replay-identical by construction.
 */
export function laneShiftJoinsCombat(
  state: BattleState,
  balance: BalanceConfig,
  champion: UnitState
): boolean {
  const range = balance.arena.aggroRange;
  const inCurrentLane = livingEnemiesNear(state, champion, {
    radius: range,
    sameLane: true,
  });
  if (inCurrentLane.length > 0) return false;
  const enemyTeam = enemyOf(champion.team);
  return state.units.some(
    (u) =>
      u.alive &&
      u.team === enemyTeam &&
      u.lane !== champion.lane &&
      Math.abs(u.x - champion.x) <= range
  );
}

/** Ground AoE (Titan, Mass Monster): everything hostile within radius of the
 *  champion, BOTH lanes. */
function groundAoeTargets(
  state: BattleState,
  champion: UnitState,
  ability: ChampionAbilityDefinition
): UnitState[] {
  return livingEnemiesNear(state, champion, { radius: ability.effects.radius ?? 0 });
}

/** In-lane targets within aggro range for Shredder's ability and ultimate. */
function shredderTargets(
  state: BattleState,
  balance: BalanceConfig,
  champion: UnitState
): UnitState[] {
  return livingEnemiesNear(state, champion, { radius: balance.arena.aggroRange, sameLane: true });
}

const HANDLERS: Record<string, AbilityHandler> = {
  'titan-quake-stomp': {
    validate: (state, _balance, champion, ability) =>
      groundAoeTargets(state, champion, ability).length > 0 ? OK : NO_VALID_TARGETS,
    apply: (state, balance, champion, ability) => {
      const enemies = groundAoeTargets(state, champion, ability);
      applyEffectPayload(state, balance, ability.effects, champion.team, { allies: [], enemies }, {
        sourceId: ability.id,
        damageLabel: abilityLabel(ability),
        damageSource: champion,
      });
      logEvent(state, 'ability', `${champion.contentId}#${champion.id} stomped ${enemies.length} enemies`);
    },
  },

  'titan-ground-smash': {
    validate: (state, _balance, champion, ability) =>
      groundAoeTargets(state, champion, ability).length > 0 ? OK : NO_VALID_TARGETS,
    apply: (state, balance, champion, ability) => {
      const enemies = groundAoeTargets(state, champion, ability);
      // No damageSource: an ultimate never charges the next one.
      applyEffectPayload(state, balance, ability.effects, champion.team, { allies: [], enemies }, {
        sourceId: ability.id,
        damageLabel: abilityLabel(ability),
      });
      logEvent(state, 'ultimate', `${champion.contentId}#${champion.id} smashed ${enemies.length} enemies`);
    },
  },

  'mass-gravity-well': {
    // Area denial, not burst: slows every enemy in the ground area (both
    // lanes) — applyEffectPayload routes moveSpeedMult < 1 as an enemy
    // debuff with refresh-by-sourceId stacking.
    validate: (state, _balance, champion, ability) =>
      groundAoeTargets(state, champion, ability).length > 0 ? OK : NO_VALID_TARGETS,
    apply: (state, balance, champion, ability) => {
      const enemies = groundAoeTargets(state, champion, ability);
      applyEffectPayload(state, balance, ability.effects, champion.team, { allies: [], enemies }, {
        sourceId: ability.id,
        damageLabel: abilityLabel(ability),
        damageSource: champion,
      });
      logEvent(state, 'ability', `${champion.contentId}#${champion.id} slowed ${enemies.length} enemies`);
    },
  },

  'mass-summon': {
    // Summoning needs no targets — always castable once charged.
    validate: () => OK,
    apply: (state, balance, champion, ability) => {
      const summon = ability.effects.summon;
      if (!summon) return; // unreachable: content validation pins the payload
      const card = getCardById(summon.cardId);
      if (!card?.unit) return; // unreachable: content validation pins the card
      for (let i = 0; i < summon.count; i++) {
        // First summon holds the champion's lane, then alternate — sustained
        // area presence across the arena rather than one stacked blob.
        const lane: LaneId = i % 2 === 0 ? champion.lane : champion.lane === 0 ? 1 : 0;
        spawnUnitsForCard(state, balance, card, champion.team, lane, champion.x);
      }
      logEvent(
        state,
        'ultimate',
        `${champion.contentId}#${champion.id} summoned ${summon.count}x ${summon.cardId}`
      );
    },
  },

  'cardio-lane-shift': {
    // Commanded shifts stay a free tactical choice (always valid); the
    // auto-cast path is gated on joining combat (P4 fix — see
    // laneShiftJoinsCombat for why this cannot ping-pong).
    validate: () => OK,
    autoCastValidate: (state, balance, champion) =>
      laneShiftJoinsCombat(state, balance, champion)
        ? OK
        : { ok: false, reason: 'no combat to join in the other lane' },
    apply: (state, _balance, champion) => {
      champion.lane = champion.lane === 0 ? 1 : 0;
      champion.targetId = null; // retarget cleanly in the new lane
      logEvent(
        state,
        'ability',
        `${champion.contentId}#${champion.id} shifted to lane ${champion.lane}`
      );
    },
  },

  'cardio-overclock': {
    validate: () => OK,
    apply: (state, balance, champion, ability) => {
      applyEffectPayload(
        state,
        balance,
        ability.effects,
        champion.team,
        { allies: [champion], enemies: [] },
        { sourceId: ability.id, damageLabel: abilityLabel(ability) }
      );
      logEvent(state, 'ultimate', `${champion.contentId}#${champion.id} overclocked`);
    },
  },

  'shredder-phase-dash': {
    validate: (state, balance, champion) =>
      shredderTargets(state, balance, champion).length > 0 ? OK : NO_VALID_TARGETS,
    apply: (state, balance, champion, ability) => {
      const target = furthestFrom(champion, shredderTargets(state, balance, champion));
      champion.x = target.x;
      champion.targetId = target.id;
      logEvent(
        state,
        'ability',
        `${champion.contentId}#${champion.id} dashed to ${target.contentId}#${target.id}`
      );
      damageUnit(state, target, ability.effects.damage ?? 0, abilityLabel(ability), champion);
    },
  },

  'shredder-execute': {
    validate: (state, balance, champion) =>
      shredderTargets(state, balance, champion).length > 0 ? OK : NO_VALID_TARGETS,
    apply: (state, balance, champion, ability) => {
      const target = lowestHealth(shredderTargets(state, balance, champion));
      logEvent(
        state,
        'ultimate',
        `${champion.contentId}#${champion.id} struck ${target.contentId}#${target.id}`
      );
      // No damageSource: ultimates never charge the next one.
      damageUnit(state, target, ability.effects.damage ?? 0, abilityLabel(ability));
      const threshold = ability.effects.executeBelowHealthFraction ?? 0;
      if (threshold > 0 && target.alive && target.health < threshold * target.baseMaxHealth) {
        logEvent(state, 'execute', `${target.contentId}#${target.id} executed`);
        // Lethal through any shield.
        damageUnit(state, target, target.shield + target.health, `${abilityLabel(ability)}:execute`);
      }
    },
  },

  'aesthetic-stance-shift': {
    validate: () => OK,
    apply: (state, balance, champion, ability) => {
      const champ = champion.champion;
      if (!champ) return; // unreachable: only champions route here
      const bulwark = champ.stanceShifts % 2 === 0;
      champ.stanceShifts++;
      // A new stance replaces the previous one immediately.
      champion.modifiers = champion.modifiers.filter((m) => m.sourceId !== ability.id);
      const stanceEffects: CardEffects = bulwark
        ? {
            durationTicks: ability.effects.durationTicks,
            damageTakenMult: ability.effects.damageTakenMult,
          }
        : {
            durationTicks: ability.effects.durationTicks,
            attackDamageMult: ability.effects.attackDamageMult,
          };
      applyEffectPayload(
        state,
        balance,
        stanceEffects,
        champion.team,
        { allies: [champion], enemies: [] },
        { sourceId: ability.id, damageLabel: abilityLabel(ability) }
      );
      logEvent(
        state,
        'ability',
        `${champion.contentId}#${champion.id} stance: ${bulwark ? 'bulwark' : 'assault'}`
      );
    },
  },

  'aesthetic-rally': {
    validate: () => OK, // the champion itself is always a living ally
    apply: (state, balance, champion, ability) => {
      const allies = state.units.filter((u) => u.alive && u.team === champion.team);
      applyEffectPayload(
        state,
        balance,
        ability.effects,
        champion.team,
        { allies, enemies: [] },
        { sourceId: ability.id, damageLabel: abilityLabel(ability) }
      );
      logEvent(
        state,
        'ultimate',
        `${champion.contentId}#${champion.id} rallied ${allies.length} allies`
      );
    },
  },
};

/**
 * Validates an ability/ultimate WITHOUT mutating state — used by the command
 * layer before paying the cooldown/charge (a rejected ability never wastes
 * either) and by the live controller for pre-queue UI feedback.
 */
export function validateChampionAbility(
  state: BattleState,
  balance: BalanceConfig,
  champion: UnitState,
  ability: ChampionAbilityDefinition
): AbilityCheck {
  const handler = HANDLERS[ability.id];
  if (!handler) return { ok: false, reason: `unknown ability '${ability.id}'` };
  return handler.validate(state, balance, champion, ability);
}

/**
 * Validation for AUTOMATIC casts — borrowed-champion auto-casts and the
 * opponent AI's queue-time tactics: the handler's autoCastValidate when
 * defined, falling back to its normal validate (bit-identical for every
 * ability without a tactical gate). Commanded casts keep using
 * validateChampionAbility unchanged.
 */
export function validateChampionAutoCast(
  state: BattleState,
  balance: BalanceConfig,
  champion: UnitState,
  ability: ChampionAbilityDefinition
): AbilityCheck {
  const handler = HANDLERS[ability.id];
  if (!handler) return { ok: false, reason: `unknown ability '${ability.id}'` };
  return (handler.autoCastValidate ?? handler.validate)(state, balance, champion, ability);
}

/** Applies an ability/ultimate. Only call after validateChampionAbility passed. */
export function applyChampionAbility(
  state: BattleState,
  balance: BalanceConfig,
  champion: UnitState,
  ability: ChampionAbilityDefinition
): void {
  HANDLERS[ability.id]?.apply(state, balance, champion, ability);
}

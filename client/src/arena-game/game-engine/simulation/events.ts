/**
 * Battle commands — the ONLY way player/AI input enters the simulation.
 * A battle is fully described by (config, balance, scheduled commands),
 * which is what makes replays and ghost battles possible.
 *
 * Invalid commands are rejected (never throw): the UI pre-validates, the AI
 * should not emit them, and replays must fail safely.
 */
import type { BalanceConfig } from '../../content/balance';
import { getAugmentById } from '../../content/augments';
import { getCardById } from '../../content/cards';
import { getChampionById } from '../../content/champions';
import type { LaneId, TeamId } from '../types';
import {
  applyChampionAbility,
  findTeamCaptain,
  validateChampionAbility,
} from '../abilities/champion-abilities';
import { applyAugmentChoice } from '../augments/augments';
import { cycleCard } from '../cards/deck';
import { applyCardEffects, CardTarget, validateCardTarget } from '../cards/effects';
import { spawnUnitsForCard } from '../entities/spawn';
import { BattleState, logEvent } from './state';

export type BattleCommand =
  | {
      type: 'deploy-card';
      team: TeamId;
      cardId: string;
      lane: LaneId;
      /** Deploy position along the lane axis. */
      x: number;
    }
  | {
      /** Play a technique/equipment card at a target. */
      type: 'play-card';
      team: TeamId;
      cardId: string;
      target: CardTarget;
    }
  | {
      /** Trigger the team's champion active ability (no explicit target —
       *  each ability resolves its own targets around the champion). */
      type: 'champion-ability';
      team: TeamId;
    }
  | {
      /** Trigger the team's champion ultimate (consumes full charge). */
      type: 'champion-ultimate';
      team: TeamId;
    }
  | {
      /** Choose one of the team's offered mid-match augments (M6). Valid only
       *  after the offer exists, only from that team's offered ids, once. */
      type: 'choose-augment';
      team: TeamId;
      augmentId: string;
    }
  | { type: 'noop'; team: TeamId };

export interface ScheduledCommand {
  /** Simulation tick at which the command executes (>= 1). */
  tick: number;
  command: BattleCommand;
}

export type CommandResult = { ok: true } | { ok: false; reason: string };

export function validateDeployPosition(
  balance: BalanceConfig,
  team: TeamId,
  x: number
): CommandResult {
  const { laneLength, deployZoneDepth, coreExclusionRadius } = balance.arena;
  const min = team === 'player' ? 0 : laneLength - deployZoneDepth;
  const max = team === 'player' ? deployZoneDepth : laneLength;
  if (!Number.isFinite(x) || x < min || x > max) {
    return { ok: false, reason: `deploy position ${x} outside deploy zone [${min}, ${max}]` };
  }
  const enemyCoreX = team === 'player' ? laneLength : 0;
  if (Math.abs(x - enemyCoreX) < coreExclusionRadius) {
    return { ok: false, reason: 'cannot deploy beside the enemy Forge Core' };
  }
  return { ok: true };
}

/**
 * Validates and applies a command against the current state.
 * Mutates state on success only.
 */
/**
 * Float tolerance for energy affordability: iterative regen accumulation can
 * leave energy at e.g. 1.9999999999999976 on the exact tick rational math says
 * a 2-cost card is affordable. Never lets a player pay more than epsilon less.
 */
const ENERGY_EPSILON = 1e-9;

export function applyCommand(
  state: BattleState,
  balance: BalanceConfig,
  command: BattleCommand
): CommandResult {
  if (state.phase === 'finished') return { ok: false, reason: 'battle already finished' };

  // Commands can arrive from untrusted replay/network data — TypeScript's
  // union types protect compile-time callers only. Validate everything.
  if (command.team !== 'player' && command.team !== 'opponent') {
    return { ok: false, reason: `invalid team '${String((command as { team?: unknown }).team)}'` };
  }

  switch (command.type) {
    case 'noop':
      return { ok: true };

    case 'deploy-card': {
      const card = getCardById(command.cardId);
      if (!card) return { ok: false, reason: `unknown card '${command.cardId}'` };
      if (card.category !== 'fighter' || !card.unit) {
        // Techniques/equipment go through 'play-card' with a target.
        // The unit-presence check also guards against malformed content
        // reaching spawnUnitsForCard after energy has been deducted.
        return { ok: false, reason: `card '${card.id}' is not a deployable unit` };
      }
      if (command.lane !== 0 && command.lane !== 1) {
        return { ok: false, reason: `invalid lane ${command.lane}` };
      }
      const pos = validateDeployPosition(balance, command.team, command.x);
      if (!pos.ok) return pos;

      const teamState = state.teams[command.team];
      if (teamState.cards && !teamState.cards.hand.includes(card.id)) {
        return { ok: false, reason: `card '${card.id}' is not in hand` };
      }
      if (teamState.energy < card.energyCost - ENERGY_EPSILON) {
        return {
          ok: false,
          reason: `not enough energy (${teamState.energy.toFixed(2)} < ${card.energyCost})`,
        };
      }
      teamState.energy = Math.max(0, teamState.energy - card.energyCost);
      if (teamState.cards) cycleCard(teamState.cards, card.id);
      spawnUnitsForCard(state, balance, card, command.team, command.lane, command.x);
      return { ok: true };
    }

    case 'play-card': {
      const card = getCardById(command.cardId);
      if (!card) return { ok: false, reason: `unknown card '${command.cardId}'` };
      if (card.category === 'fighter') {
        return { ok: false, reason: `fighter card '${card.id}' must use deploy-card` };
      }
      const teamState = state.teams[command.team];
      if (teamState.cards && !teamState.cards.hand.includes(card.id)) {
        return { ok: false, reason: `card '${card.id}' is not in hand` };
      }
      if (teamState.energy < card.energyCost - ENERGY_EPSILON) {
        return {
          ok: false,
          reason: `not enough energy (${teamState.energy.toFixed(2)} < ${card.energyCost})`,
        };
      }
      // Validate target → pay → apply, so a bad target never costs energy
      // and an energy refund effect lands after the cost is deducted.
      const valid = validateCardTarget(state, card, command.team, command.target);
      if (!valid.ok) return valid;
      teamState.energy = Math.max(0, teamState.energy - card.energyCost);
      if (teamState.cards) cycleCard(teamState.cards, card.id);
      const applied = applyCardEffects(state, balance, card, command.team, command.target);
      if (!applied.ok) {
        // Unreachable through this sequence; loudly log if it ever happens.
        logEvent(state, 'effect-apply-failed', `${card.id}: ${applied.reason}`);
      }
      return { ok: true };
    }

    case 'champion-ability':
    case 'champion-ultimate': {
      // Commands route to the CAPTAIN only (M9): borrowed champions are not
      // commandable — they auto-cast in the tick pipeline instead.
      const unit = findTeamCaptain(state, command.team);
      if (!unit || !unit.champion) return { ok: false, reason: 'no champion in this battle' };
      if (!unit.alive) return { ok: false, reason: 'champion is down' };
      const definition = getChampionById(unit.contentId);
      if (!definition) return { ok: false, reason: `unknown champion '${unit.contentId}'` };

      if (command.type === 'champion-ability') {
        if (unit.champion.abilityCooldownTicks > 0) {
          return {
            ok: false,
            reason: `ability on cooldown (${unit.champion.abilityCooldownTicks} ticks)`,
          };
        }
        // Validate targets → pay the cooldown → apply, so an ability with no
        // valid targets never wastes its cooldown.
        const valid = validateChampionAbility(state, balance, unit, definition.ability);
        if (!valid.ok) return valid;
        unit.champion.abilityCooldownTicks = unit.champion.abilityCooldownTotalTicks;
        applyChampionAbility(state, balance, unit, definition.ability);
        return { ok: true };
      }

      if (unit.champion.ultimateCharge < unit.champion.chargeRequired) {
        return { ok: false, reason: 'ultimate not charged' };
      }
      // Validate targets → pay the charge → apply (charge is never wasted).
      const valid = validateChampionAbility(state, balance, unit, definition.ultimate);
      if (!valid.ok) return valid;
      unit.champion.ultimateCharge = 0;
      applyChampionAbility(state, balance, unit, definition.ultimate);
      return { ok: true };
    }

    case 'choose-augment': {
      const teamState = state.teams[command.team];
      const offered = teamState.augment.offeredIds;
      if (offered === null) return { ok: false, reason: 'no augment offer yet' };
      if (teamState.augment.chosenId !== null) {
        return { ok: false, reason: 'augment already chosen' };
      }
      // augmentId can arrive from untrusted replay data — validate the shape
      // and membership before trusting it as an id.
      if (typeof command.augmentId !== 'string' || !offered.includes(command.augmentId)) {
        return {
          ok: false,
          reason: `augment '${String(command.augmentId)}' was not offered to ${command.team}`,
        };
      }
      if (!getAugmentById(command.augmentId)) {
        // Unreachable when the offer came from the engine; guards stale replays.
        return { ok: false, reason: `unknown augment '${command.augmentId}'` };
      }
      applyAugmentChoice(state, command.team, command.augmentId);
      return { ok: true };
    }

    default: {
      // Compile-time exhaustiveness: adding a BattleCommand variant without a
      // case above turns this assignment into a type error.
      const _exhaustive: never = command;
      void _exhaustive;
      const t = (command as { type?: unknown }).type;
      return { ok: false, reason: `unknown command type '${String(t)}'` };
    }
  }
}

export interface RejectedCommand {
  tick: number;
  command: BattleCommand;
  reason: string;
}

/**
 * Applies all commands scheduled for the current tick, preserving array
 * order for same-tick commands (deterministic).
 */
export function applyScheduledCommands(
  state: BattleState,
  balance: BalanceConfig,
  commands: readonly ScheduledCommand[],
  rejected: RejectedCommand[]
): void {
  for (const scheduled of commands) {
    if (scheduled.tick !== state.tick) continue;
    const result = applyCommand(state, balance, scheduled.command);
    if (!result.ok) {
      rejected.push({ tick: scheduled.tick, command: scheduled.command, reason: result.reason });
      logEvent(state, 'command-rejected', `${scheduled.command.type}: ${result.reason}`);
    }
  }
}

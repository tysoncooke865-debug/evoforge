/**
 * Ghost battles (M8) — fight a past self. A ghost opponent is the PLAYER
 * side of a stored BattleRecord replayed as the opponent team of a fresh
 * battle: the ghost keeps the record's deck, champion (and lane) and
 * fitness-derived scaling, and its recorded commands are transformed and
 * pre-scheduled into the new battle's command log. No AI is involved.
 *
 * Transform rules:
 *  - every recorded PLAYER command → team 'opponent'; ticks are kept
 *  - deploy-card: x is mirrored across the lane axis (x' = laneLength - x;
 *    lane unchanged). The player zone [0, deployZoneDepth] maps exactly onto
 *    the opponent zone [laneLength - deployZoneDepth, laneLength], and the
 *    mirrored point can never enter the enemy-core exclusion radius, so a
 *    valid recorded deploy position is always a valid ghost deploy position.
 *  - play-card: team swap only. The target unit id resolves against the NEW
 *    battle's entities; when it does not name a valid target the engine
 *    rejects the command (see rejection policy below).
 *  - champion-ability / champion-ultimate: team swap only.
 *  - choose-augment: team swap + the ghost re-picks from ITS OWN offer via a
 *    deterministic rule — the FIRST id of the offer — because offers are
 *    drawn from the battle RNG and therefore differ per battle seed. The
 *    ghost's offer is predicted at build time by replaying the real offer
 *    draw (offerAugments) against a scratch copy of the ghost battle; this
 *    is exact as long as nothing consumes battle RNG between battle creation
 *    and the offer tick (currently true: the only consumers are the deck
 *    shuffles at creation and the offer draw itself). If a future RNG
 *    consumer breaks the prediction, the command is simply rejected at
 *    runtime — fail-soft.
 *
 * Rejection policy (reliability over fidelity): the new battle unfolds
 * differently from the recorded one — energy timing, hand rotation (fresh
 * seed → fresh deck shuffle), champion cooldown/charge and entity ids all
 * diverge — so some ghost commands are rejected by the simulation's normal
 * validation. Rejections are recorded and the battle simply continues; a
 * ghost battle can never throw, stall or corrupt state, and its command log
 * still replays digest-identically through runBattle.
 */
import type { BalanceConfig } from '../../content/balance';
import { offerAugments } from '../../game-engine/augments/augments';
import type { ChampionFitnessScaling } from '../../game-engine/balance/fitness-scaling';
import type {
  BattleCommand,
  ScheduledCommand,
} from '../../game-engine/simulation/events';
import type { BattleRecord } from '../../game-engine/simulation/replay';
import { BattleConfig, createBattle } from '../../game-engine/simulation/state';
import type { LaneId } from '../../game-engine/types';

/** Mirror a deploy position across the lane axis (player zone ↔ opponent zone). */
export function mirrorDeployX(x: number, balance: BalanceConfig): number {
  return balance.arena.laneLength - x;
}

/** The player side of the ghost battle (the live human's own setup). */
export interface GhostPlayerSide {
  deckCardIds?: readonly string[];
  championId?: string;
  championLane?: LaneId;
  championScaling?: ChampionFitnessScaling;
}

export type GhostSetupResult =
  | { ok: true; config: BattleConfig; commands: ScheduledCommand[] }
  | { ok: false; reason: string };

/**
 * Predicts the augment offer the ghost (opponent team) will receive in a
 * battle created from `config`, by running the REAL offer-draw code against
 * a scratch battle. Returns null when prediction is impossible (e.g. the
 * config cannot construct). See the module docs for why this is exact today.
 */
export function predictGhostAugmentOffer(
  config: BattleConfig,
  balance: BalanceConfig
): string[] | null {
  try {
    const scratch = createBattle(config, balance);
    scratch.tick = balance.augment.offerTick;
    offerAugments(scratch, balance);
    return scratch.teams.opponent.augment.offeredIds;
  } catch {
    return null;
  }
}

/**
 * Transforms the record's player commands into the ghost's pre-scheduled
 * command list (see module docs for the exact rules). Never mutates the
 * record; malformed/unknown entries from untrusted data are skipped (the
 * engine would reject them anyway).
 */
export function transformGhostCommands(
  record: BattleRecord,
  ghostConfig: BattleConfig,
  balance: BalanceConfig
): ScheduledCommand[] {
  // Compute the offer prediction lazily — only records containing a player
  // augment choice need it.
  let predictedOffer: string[] | null | undefined;

  const out: ScheduledCommand[] = [];
  if (!Array.isArray(record.commands)) return out; // untrusted data
  for (const scheduled of record.commands) {
    // Untrusted arrays can contain null/non-object elements.
    if (!scheduled || typeof scheduled !== 'object') continue;
    const c = scheduled.command;
    if (!c || typeof c !== 'object' || c.team !== 'player') continue; // only the player side becomes the ghost
    if (!Number.isInteger(scheduled.tick) || scheduled.tick < 1) continue; // untrusted data

    let command: BattleCommand;
    switch (c.type) {
      case 'deploy-card':
        command = {
          type: 'deploy-card',
          team: 'opponent',
          cardId: c.cardId,
          lane: c.lane,
          x: mirrorDeployX(c.x, balance),
        };
        break;
      case 'play-card':
        command = { type: 'play-card', team: 'opponent', cardId: c.cardId, target: c.target };
        break;
      case 'champion-ability':
        command = { type: 'champion-ability', team: 'opponent' };
        break;
      case 'champion-ultimate':
        command = { type: 'champion-ultimate', team: 'opponent' };
        break;
      case 'choose-augment': {
        if (predictedOffer === undefined) {
          predictedOffer = predictGhostAugmentOffer(ghostConfig, balance);
        }
        command = {
          type: 'choose-augment',
          team: 'opponent',
          // Deterministic re-pick: first id of the ghost's OWN offer. Falls
          // back to the recorded id (rejected at runtime) if prediction failed.
          augmentId: predictedOffer?.[0] ?? c.augmentId,
        };
        break;
      }
      case 'noop':
        command = { type: 'noop', team: 'opponent' };
        break;
      default:
        continue; // unknown command type from untrusted data — skip
    }
    out.push({ tick: scheduled.tick, command });
  }
  return out;
}

/**
 * Builds the full ghost battle setup: fresh seed, the live player's own side,
 * and the record's player side (deck/champion/lane/scaling — a ghost keeps
 * its fitness-derived build) as the opponent under playerId
 * 'ghost-<original playerId>'. Fails safely (never throws) on records whose
 * balance version differs or whose config cannot construct a battle.
 */
export function buildGhostBattleSetup(
  record: BattleRecord,
  seed: number,
  playerId: string,
  playerSide: GhostPlayerSide,
  balance: BalanceConfig
): GhostSetupResult {
  if (record.balanceVersion !== balance.balanceVersion) {
    return {
      ok: false,
      reason: `recording is from balance ${record.balanceVersion} (current ${balance.balanceVersion})`,
    };
  }
  const ghostTeam = record.config.player;
  const config: BattleConfig = {
    seed,
    player: {
      playerId,
      deckCardIds: playerSide.deckCardIds,
      championId: playerSide.championId,
      championLane: playerSide.championLane,
      championScaling: playerSide.championScaling,
    },
    opponent: {
      playerId: `ghost-${ghostTeam.playerId}`,
      deckCardIds: ghostTeam.deckCardIds,
      championId: ghostTeam.championId,
      championLane: ghostTeam.championLane,
      championScaling: ghostTeam.championScaling,
      // M9: a gym-war record's ghost keeps its full squad (captain +
      // borrowed) — the borrowed champions auto-cast engine-side, so the
      // recorded captain commands still route correctly after team swap.
      squad: ghostTeam.squad,
    },
  };
  // createBattle throws on structurally invalid decks/champions; untrusted
  // records must fail safely instead (same contract as verifyBattleRecord).
  try {
    createBattle(config, balance);
  } catch (e) {
    return {
      ok: false,
      reason: `ghost setup failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return { ok: true, config, commands: transformGhostCommands(record, config, balance) };
}

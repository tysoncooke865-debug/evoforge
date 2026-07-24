/**
 * Live battle controller — pure TS orchestration of a real-time battle on top
 * of the deterministic engine. No React/RN imports; the store drives it on a
 * timer and screens render snapshots.
 *
 * Design rule for determinism: player and scripted-opponent commands are
 * QUEUED for the next tick and applied by the engine's own command path, so
 * the recorded command log replayed through runBattle reproduces the live
 * battle exactly (verified by tests).
 */
import { AiDifficulty, BALANCE, CHAMPIONS, getCardById, getChampionById } from '../../content';
import {
  findTeamCaptain,
  validateChampionAbility,
} from '../../game-engine/abilities/champion-abilities';
import {
  applyCommand,
  BattleCommand,
  CommandResult,
  RejectedCommand,
  ScheduledCommand,
  validateDeployPosition,
} from '../../game-engine/simulation/events';
import type { ChampionFitnessScaling } from '../../game-engine/balance/fitness-scaling';
import type { BattleRecord } from '../../game-engine/simulation/replay';
import { computeDigest } from '../../game-engine/simulation/run';
import {
  BattleConfig,
  BattleState,
  createBattle,
  TeamSquadConfig,
} from '../../game-engine/simulation/state';
import { advanceTick } from '../../game-engine/simulation/tick';
import { SeededRng } from '../../game-engine/random/rng';
import type { LaneId } from '../../game-engine/types';
import { buildGhostBattleSetup } from './ghost';
import {
  createOpponentAiRuntime,
  OpponentAiRuntime,
  runOpponentAi,
} from './opponent-ai';

export interface LiveBattle {
  config: BattleConfig;
  state: BattleState;
  /** Every accepted-for-scheduling command — the replay record. */
  commandLog: ScheduledCommand[];
  /** Commands rejected at apply time (shown as UI feedback). */
  rejected: RejectedCommand[];
  /** Separate RNG stream for the opponent AI (never the battle's own). */
  opponentRng: SeededRng;
  /** Opponent AI decision-quality tier (never stat boosts). */
  aiDifficulty: AiDifficulty;
  /** Opponent AI bookkeeping (decision cadence, ultimate hold timer). */
  ai: OpponentAiRuntime;
  /**
   * Who drives the opponent team: 'ai' runs the opponent AI each tick;
   * 'ghost' (M8) replays a pre-scheduled command list already merged into
   * commandLog at creation — no AI ever runs.
   */
  opponentKind: 'ai' | 'ghost';
  /** Display name for the opponent side (M9: enemy gym name in Gym Wars). */
  opponentDisplayName?: string;
}

export interface LiveBattleOptions {
  /** Player's deck (8 validated card ids). Omit for free-deploy dev battles. */
  playerDeckCardIds?: readonly string[];
  /** Opponent's deck. Omit for the free-pool fighter-only opponent. */
  opponentDeckCardIds?: readonly string[];
  /**
   * Player's champion. When set, the opponent also fields a champion, picked
   * deterministically from the roster via the opponent RNG (recorded in the
   * config, so replays reproduce it). Omit for champion-less battles.
   */
  playerChampionId?: string;
  /**
   * Fitness-derived champion scaling for the player (M7), computed from the
   * EvoForgePlayerProvider's FitnessProfile — already capped. The AI opponent
   * always fights with neutral scaling.
   */
  playerChampionScaling?: ChampionFitnessScaling;
  /** Opponent AI tier. Defaults to 'standard'. */
  aiDifficulty?: AiDifficulty;
  /**
   * Full player squad (M9 Gym Wars): captain + borrowed gym members. When
   * set it supersedes playerChampionId/playerChampionScaling.
   */
  playerSquad?: TeamSquadConfig;
  /**
   * Full opponent squad (M9 Gym Wars): the enemy gym's fitness-scaled
   * champions. When set, the deterministic random opponent-champion pick is
   * skipped — the squad IS the opponent's champion lineup (still driven by
   * the opponent AI at the configured difficulty).
   */
  opponentSquad?: TeamSquadConfig;
  /** Opponent player id override (M9: 'gym-<enemy gym id>'). */
  opponentPlayerId?: string;
  /** Opponent display name for records/UI (M9: the enemy gym's name). */
  opponentDisplayName?: string;
  /** Arena 2.0 (P3): enable the formation anti-overlap sim. Default false (1.0). */
  formation?: boolean;
}

export function createLiveBattle(
  seed: number,
  playerId: string,
  options: LiveBattleOptions = {}
): LiveBattle {
  const opponentRng = new SeededRng((seed ^ 0x9e3779b9) >>> 0);
  // Consumed before any other opponent roll, only when a champion battle
  // without an explicit opponent squad is requested — champion-less battles
  // and squad (Gym War) battles keep their own RNG stream shapes.
  const opponentChampionId =
    options.playerChampionId && !options.opponentSquad
      ? opponentRng.pick(CHAMPIONS).id
      : undefined;
  const aiDifficulty = options.aiDifficulty ?? 'standard';
  const config: BattleConfig = {
    seed,
    formation: options.formation ?? false,
    player: options.playerSquad
      ? {
          playerId,
          deckCardIds: options.playerDeckCardIds,
          squad: options.playerSquad,
        }
      : {
          playerId,
          deckCardIds: options.playerDeckCardIds,
          championId: options.playerChampionId,
          championScaling: options.playerChampionScaling,
        },
    opponent: options.opponentSquad
      ? {
          playerId: options.opponentPlayerId ?? `ai-${aiDifficulty}`,
          deckCardIds: options.opponentDeckCardIds,
          squad: options.opponentSquad,
        }
      : {
          playerId: options.opponentPlayerId ?? `ai-${aiDifficulty}`,
          deckCardIds: options.opponentDeckCardIds,
          championId: opponentChampionId,
        },
  };
  return {
    config,
    state: createBattle(config, BALANCE),
    commandLog: [],
    rejected: [],
    opponentRng,
    aiDifficulty,
    ai: createOpponentAiRuntime(opponentRng, aiDifficulty),
    opponentKind: 'ai',
    opponentDisplayName: options.opponentDisplayName,
  };
}

export type GhostLiveResult = { ok: true; live: LiveBattle } | { ok: false; reason: string };

/**
 * Creates a live GHOST battle (M8) from a stored BattleRecord: a fresh seed,
 * the live player's own setup, and the record's player side replayed as the
 * opponent via a pre-scheduled command list merged into the command log at
 * start (see features/arena/ghost.ts for the transform semantics and the
 * rejection policy). No opponent AI runs; the battle needs no provider or
 * network — it is fully offline. Fails safely (never throws) on unusable
 * records.
 */
export function createGhostLiveBattle(
  record: BattleRecord,
  seed: number,
  playerId: string,
  options: LiveBattleOptions = {}
): GhostLiveResult {
  const setup = buildGhostBattleSetup(
    record,
    seed,
    playerId,
    {
      deckCardIds: options.playerDeckCardIds,
      championId: options.playerChampionId,
      championScaling: options.playerChampionScaling,
    },
    BALANCE
  );
  if (!setup.ok) return setup;
  let state: BattleState;
  try {
    state = createBattle(setup.config, BALANCE);
  } catch (e) {
    // Unreachable (buildGhostBattleSetup already constructed once) — but a
    // ghost start must never throw.
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  // The AI runtime fields are kept for structural compatibility (debug
  // display, shared code paths) but never consulted while opponentKind is
  // 'ghost'.
  const opponentRng = new SeededRng((seed ^ 0x9e3779b9) >>> 0);
  const aiDifficulty = options.aiDifficulty ?? 'standard';
  return {
    ok: true,
    live: {
      config: setup.config,
      state,
      commandLog: [...setup.commands],
      rejected: [],
      opponentRng,
      aiDifficulty,
      ai: createOpponentAiRuntime(opponentRng, aiDifficulty),
      opponentKind: 'ghost',
    },
  };
}

/**
 * Queue a player deploy for the next tick. Pre-validates for immediate UI
 * feedback; final validation happens in the engine at apply time.
 */
export function queuePlayerDeploy(
  live: LiveBattle,
  cardId: string,
  lane: LaneId,
  x: number
): CommandResult {
  if (live.state.phase === 'finished') return { ok: false, reason: 'battle is over' };
  const card = getCardById(cardId);
  if (!card) return { ok: false, reason: `unknown card '${cardId}'` };
  const pos = validateDeployPosition(BALANCE, 'player', x);
  if (!pos.ok) return pos;
  if (live.state.teams.player.energy < card.energyCost - 1e-9) {
    return { ok: false, reason: 'Not enough Forge Energy' };
  }
  const command: BattleCommand = { type: 'deploy-card', team: 'player', cardId, lane, x };
  live.commandLog.push({ tick: live.state.tick + 1, command });
  return { ok: true };
}

/**
 * Queue a player technique/equipment play for the next tick.
 * Target selection UX: the UI passes a lane; the controller resolves a
 * sensible deterministic target (see resolveCardTargetForLane).
 */
export function queuePlayerPlayCard(
  live: LiveBattle,
  cardId: string,
  targetUnitId: number
): CommandResult {
  if (live.state.phase === 'finished') return { ok: false, reason: 'battle is over' };
  const card = getCardById(cardId);
  if (!card) return { ok: false, reason: `unknown card '${cardId}'` };
  if (live.state.teams.player.energy < card.energyCost - 1e-9) {
    return { ok: false, reason: 'Not enough Forge Energy' };
  }
  const command: BattleCommand = {
    type: 'play-card',
    team: 'player',
    cardId,
    target: { kind: 'unit', unitId: targetUnitId },
  };
  live.commandLog.push({ tick: live.state.tick + 1, command });
  return { ok: true };
}

/**
 * Queue the player champion's active ability or ultimate for the next tick.
 * Pre-validates against the current state (cooldown/charge/targets) for
 * immediate UI feedback — so a rejected press never wastes the cooldown or
 * charge; the engine re-validates authoritatively at apply time.
 */
function queueChampionCommand(
  live: LiveBattle,
  type: 'champion-ability' | 'champion-ultimate'
): CommandResult {
  if (live.state.phase === 'finished') return { ok: false, reason: 'battle is over' };
  // Commands route to the CAPTAIN only (M9) — borrowed champions auto-cast.
  const unit = findTeamCaptain(live.state, 'player');
  if (!unit || !unit.champion) return { ok: false, reason: 'no champion in this battle' };
  if (!unit.alive) return { ok: false, reason: 'Champion is down' };
  const definition = getChampionById(unit.contentId);
  if (!definition) return { ok: false, reason: `unknown champion '${unit.contentId}'` };
  if (type === 'champion-ability' && unit.champion.abilityCooldownTicks > 0) {
    return { ok: false, reason: 'Ability on cooldown' };
  }
  if (type === 'champion-ultimate' && unit.champion.ultimateCharge < unit.champion.chargeRequired) {
    return { ok: false, reason: 'Ultimate not charged' };
  }
  const ability = type === 'champion-ability' ? definition.ability : definition.ultimate;
  const valid = validateChampionAbility(live.state, BALANCE, unit, ability);
  if (!valid.ok) return valid;
  live.commandLog.push({ tick: live.state.tick + 1, command: { type, team: 'player' } });
  return { ok: true };
}

export function queueChampionAbility(live: LiveBattle): CommandResult {
  return queueChampionCommand(live, 'champion-ability');
}

export function queueChampionUltimate(live: LiveBattle): CommandResult {
  return queueChampionCommand(live, 'champion-ultimate');
}

/** Arena 2.0: queue a player basic-attack tap on the champion. The engine
 *  re-validates the rate-limit authoritatively at apply time. */
export function queueChampionBasicAttack(live: LiveBattle): CommandResult {
  if (live.state.phase === 'finished') return { ok: false, reason: 'battle is over' };
  const unit = findTeamCaptain(live.state, 'player');
  if (!unit || !unit.champion) return { ok: false, reason: 'no champion in this battle' };
  if (!unit.alive) return { ok: false, reason: 'Champion is down' };
  live.commandLog.push({ tick: live.state.tick + 1, command: { type: 'champion-basic-attack', team: 'player' } });
  return { ok: true };
}

/** Arena 2.0: queue a lane switch for the player champion (pre-checks cooldown). */
export function queueChampionLaneSwitch(live: LiveBattle): CommandResult {
  if (live.state.phase === 'finished') return { ok: false, reason: 'battle is over' };
  const unit = findTeamCaptain(live.state, 'player');
  if (!unit || !unit.champion) return { ok: false, reason: 'no champion in this battle' };
  if (!unit.alive) return { ok: false, reason: 'Champion is down' };
  if (live.state.tick < unit.champion.laneSwitchReadyTick) {
    return { ok: false, reason: 'Lane switch on cooldown' };
  }
  live.commandLog.push({ tick: live.state.tick + 1, command: { type: 'champion-lane-switch', team: 'player' } });
  return { ok: true };
}

/**
 * Deterministic default target for a technique/equipment card in a lane:
 *  - heal/shield cards → the most-wounded friendly unit in the lane
 *    (falling back to the frontmost friendly unit for pure buffs)
 *  - enemy-target cards → the enemy unit closest to the player core
 *    (the most immediate threat)
 * Returns null when the lane has no valid target.
 */
export function resolveCardTargetForLane(
  live: LiveBattle,
  cardId: string,
  lane: LaneId
): number | null {
  const card = getCardById(cardId);
  if (!card || card.category === 'fighter') return null;
  const units = live.state.units.filter((u) => u.alive && u.lane === lane);

  if (card.target === 'enemy-unit' || card.target === 'any-unit') {
    let best: { id: number; x: number } | null = null;
    for (const u of units) {
      if (u.team !== 'opponent') continue;
      if (!best || u.x < best.x || (u.x === best.x && u.id < best.id)) best = { id: u.id, x: u.x };
    }
    if (best) return best.id;
    if (card.target === 'enemy-unit') return null;
  }

  const friendlies = units.filter((u) => u.team === 'player');
  if (friendlies.length === 0) return null;
  const wantsWounded = Boolean(card.effects?.heal || card.effects?.shield);
  if (wantsWounded) {
    const wounded = friendlies
      .filter((u) => u.health < u.baseMaxHealth)
      .sort((a, b) => a.health / a.baseMaxHealth - b.health / b.baseMaxHealth || a.id - b.id);
    if (wounded.length > 0) return wounded[0].id;
  }
  // Frontmost friendly (deepest into enemy territory) benefits most from buffs.
  return friendlies.sort((a, b) => b.x - a.x || a.id - b.id)[0].id;
}

/**
 * Queue the player's mid-match augment choice for the next tick. Pre-validates
 * against current state AND pending queued choices for immediate UI feedback;
 * the engine re-validates authoritatively at apply time.
 */
export function queueChooseAugment(live: LiveBattle, augmentId: string): CommandResult {
  if (live.state.phase === 'finished') return { ok: false, reason: 'battle is over' };
  const augment = live.state.teams.player.augment;
  if (augment.offeredIds === null) return { ok: false, reason: 'No augment offer yet' };
  if (augment.chosenId !== null) return { ok: false, reason: 'Augment already chosen' };
  if (!augment.offeredIds.includes(augmentId)) {
    return { ok: false, reason: 'That augment was not offered' };
  }
  // A second tap before the first queued choice applies must not double-queue.
  const pending = live.commandLog.some(
    (c) =>
      c.tick > live.state.tick &&
      c.command.type === 'choose-augment' &&
      c.command.team === 'player'
  );
  if (pending) return { ok: false, reason: 'Augment already chosen' };
  live.commandLog.push({
    tick: live.state.tick + 1,
    command: { type: 'choose-augment', team: 'player', augmentId },
  });
  return { ok: true };
}

/** Advance the live battle by `ticks` simulation ticks (AI runs before each). */
export function stepLiveBattle(live: LiveBattle, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    if (live.state.phase === 'finished') return;
    // The AI queues commands for the NEXT tick, outside the sim — a recorded
    // commandLog replays digest-identically without the AI (see opponent-ai).
    // Ghost battles (M8) have no AI: the ghost's commands were pre-scheduled
    // into commandLog at creation.
    if (live.opponentKind === 'ai') {
      runOpponentAi(live.state, live.commandLog, live.opponentRng, live.ai, live.aiDifficulty);
    }
    advanceTick(live.state, BALANCE, live.commandLog, live.rejected);
  }
}

/** Digest of the current live state — for the debug panel and replay checks. */
export function liveDigest(live: LiveBattle): number {
  return computeDigest(live.state);
}

/**
 * Direct-apply helper used by tests to compare a live battle against the
 * headless runner. Not used by the UI.
 */
export function applyDirect(live: LiveBattle, command: BattleCommand): CommandResult {
  return applyCommand(live.state, BALANCE, command);
}

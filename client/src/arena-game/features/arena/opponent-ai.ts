/**
 * Opponent AI (M6) — deterministic, decision-quality tiers, NO hidden stat
 * boosts. Replaces the M3 drip script.
 *
 * Architecture: the AI lives OUTSIDE the simulation. It reads the live
 * battle state, consumes its own SeededRng stream (derived from the battle
 * seed by the controller — never the battle's own RNG) and queues ordinary
 * BattleCommands for the NEXT tick into the shared command log. A recorded
 * commandLog therefore replays digest-identically through runBattle without
 * the AI present, and difficulty changes decision quality only — every
 * command passes the same engine validation as a human player's.
 *
 * Command-safety guarantee (rejected === [] in AI-only battles): commands
 * queued at tick T for T+1 apply at the START of T+1, before any unit acts —
 * nothing can invalidate a queue-time-validated command in between except an
 * earlier same-tick command, and the only same-tick commands ahead of the
 * AI's are the (harmless) augment choice or, in mixed battles, the human's.
 * The AI queues at most one energy spend per decision and decisions are >= 2
 * ticks apart, so its energy can only have grown by apply time.
 *
 * Heuristics (all tunables in BALANCE.ai):
 *  - Lane threat = enemy units past the midline, weighted by remaining
 *    health+shield, depth and DPS. The most threatened lane is defended with
 *    a role-appropriate card from HAND: swarm → AoE technique or bulkiest
 *    fighter; tank → highest-damage fighter; fast runner → ranged fighter.
 *  - Heals target the most wounded own combatant; buffs/shields the
 *    frontmost pusher; support fighters (healer/shielder) deploy behind an
 *    existing push.
 *  - Pressure goes to the weaker enemy lane, keeping an energy reserve at
 *    higher difficulties (reserve is ignored while defending).
 *  - Champion ability fires when combat is nearby and validation passes;
 *    the ultimate when enemies clump near the champion, the own core is
 *    under threat, or charge has been full for a while.
 *  - A 'mistake' (deterministic-RNG-chosen) degrades the decision: wrong
 *    lane and a random affordable card instead of the best one.
 *  - Training: slow decisions, no counters, no techniques, no champion use,
 *    random lanes — genuinely beatable, but never cheating.
 */
import {
  AiDifficulty,
  AiDifficultyConfig,
  AUGMENTS,
  BALANCE,
  CARDS,
  getCardById,
  getChampionById,
} from '../../content';
import type { CardDefinition } from '../../content/types';
import {
  findTeamCaptain,
  validateChampionAbility,
  validateChampionAutoCast,
} from '../../game-engine/abilities/champion-abilities';
import { SeededRng } from '../../game-engine/random/rng';
import type { ScheduledCommand } from '../../game-engine/simulation/events';
import type { BattleState, UnitState } from '../../game-engine/simulation/state';
import type { LaneId } from '../../game-engine/types';

/** Fighters playable by deckless opponents (legacy free-pool mode). */
const FIGHTER_POOL: readonly string[] = CARDS.filter((c) => c.category === 'fighter').map(
  (c) => c.id
);

export interface OpponentAiRuntime {
  /** Next tick at which the AI evaluates the battle. */
  nextDecisionTick: number;
  /** Tick the ultimate charge became full; null while not full. */
  ultimateFullSinceTick: number | null;
}

export function createOpponentAiRuntime(
  rng: SeededRng,
  difficulty: AiDifficulty
): OpponentAiRuntime {
  const cfg = BALANCE.ai.difficulties[difficulty];
  return {
    nextDecisionTick: cfg.decisionIntervalTicks + rng.nextInt(0, cfg.decisionJitterTicks),
    ultimateFullSinceTick: null,
  };
}

interface LaneThreat {
  lane: LaneId;
  score: number;
  count: number;
  biggestHealth: number;
  fastestSpeed: number;
  /** Deepest (largest-x) threatening enemy position. */
  frontX: number;
}

/** Threat posed by player units past the midline of one lane. */
function laneThreat(state: BattleState, lane: LaneId): LaneThreat {
  const { laneLength } = BALANCE.arena;
  const midline = laneLength * BALANCE.ai.threatMidlineFraction;
  const threat: LaneThreat = { lane, score: 0, count: 0, biggestHealth: 0, fastestSpeed: 0, frontX: midline };
  for (const u of state.units) {
    if (!u.alive || u.team !== 'player' || u.lane !== lane || u.x < midline) continue;
    const dps =
      (u.base.attackDamage / Math.max(1, u.base.attackIntervalTicks)) * BALANCE.ticksPerSecond;
    const depth = (u.x - midline) / Math.max(1, laneLength - midline); // 0..1
    threat.score += ((u.health + u.shield) * (0.5 + 0.5 * depth)) / 10 + dps;
    threat.count++;
    threat.biggestHealth = Math.max(threat.biggestHealth, u.health + u.shield);
    threat.fastestSpeed = Math.max(threat.fastestSpeed, u.base.moveSpeedPerTick);
    threat.frontX = Math.max(threat.frontX, u.x);
  }
  return threat;
}

/** Total player strength per lane (all living units incl. champion). */
function playerLaneStrength(state: BattleState, lane: LaneId): number {
  let total = 0;
  for (const u of state.units) {
    if (u.alive && u.team === 'player' && u.lane === lane) total += u.health + u.shield;
  }
  return total;
}

function fighterCard(id: string): CardDefinition | undefined {
  const card = getCardById(id);
  return card && card.category === 'fighter' && card.unit ? card : undefined;
}

/**
 * Best fighter by a scoring rule; ties broken by hand order (deterministic).
 * Negative scores mean "ineligible" — a selector like "ranged only" returns
 * -1 for melee so callers can fall back to another rule.
 */
function bestFighter(
  ids: readonly string[],
  score: (card: CardDefinition) => number
): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const id of ids) {
    const card = fighterCard(id);
    if (!card) continue;
    const s = score(card);
    if (s < 0) continue;
    if (s > bestScore) {
      best = id;
      bestScore = s;
    }
  }
  return best;
}

/** Frontmost own pusher: opponent units march toward x=0, so minimum x wins. */
function frontmostOwnPush(state: BattleState): UnitState | null {
  const midline = BALANCE.arena.laneLength * BALANCE.ai.threatMidlineFraction;
  let best: UnitState | null = null;
  for (const u of state.units) {
    if (!u.alive || u.team !== 'opponent' || u.x > midline) continue;
    if (best === null || u.x < best.x || (u.x === best.x && u.id < best.id)) best = u;
  }
  return best;
}

/** Most wounded own combatant below the wounded threshold; id tie-break. */
function mostWoundedOwn(state: BattleState): UnitState | null {
  let best: UnitState | null = null;
  let bestFraction = BALANCE.ai.healWoundedFraction;
  for (const u of state.units) {
    if (!u.alive || u.team !== 'opponent') continue;
    const fraction = u.health / u.baseMaxHealth;
    if (fraction < bestFraction || (fraction === bestFraction && best !== null && u.id < best.id)) {
      best = u;
      bestFraction = fraction;
    }
  }
  return best;
}

/**
 * Densest clump anchor for an offensive AoE in a lane: the player unit with
 * the most player units within `radius` of it; ties → lower id.
 */
function clumpTarget(state: BattleState, lane: LaneId, radius: number): UnitState | null {
  const enemies = state.units.filter((u) => u.alive && u.team === 'player' && u.lane === lane);
  let best: UnitState | null = null;
  let bestCount = 0;
  for (const anchor of enemies) {
    const count = enemies.filter((u) => Math.abs(u.x - anchor.x) <= radius).length;
    if (count > bestCount || (count === bestCount && best !== null && anchor.id < best.id)) {
      best = anchor;
      bestCount = count;
    }
  }
  return best;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Opponent deploy zone along x: [laneLength - deployZoneDepth, laneLength]. */
function deployZone(): { min: number; max: number } {
  const { laneLength, deployZoneDepth } = BALANCE.arena;
  return { min: laneLength - deployZoneDepth, max: laneLength };
}

function queue(commandLog: ScheduledCommand[], tick: number, command: ScheduledCommand['command']): void {
  commandLog.push({ tick, command });
}

/**
 * One AI evaluation pass. Call once per tick BEFORE advanceTick (the live
 * controller does); cheap out-of-cadence except for the augment choice.
 */
export function runOpponentAi(
  state: BattleState,
  commandLog: ScheduledCommand[],
  rng: SeededRng,
  runtime: OpponentAiRuntime,
  difficulty: AiDifficulty
): void {
  if (state.phase === 'finished') return;
  const cfg = BALANCE.ai.difficulties[difficulty];
  const nextTick = state.tick + 1;

  // Augment choice runs outside the decision cadence so it is never starved:
  // the AI ALWAYS chooses, deterministically, shortly after the offer.
  // (The queued command applies on the very next tick, so this cannot
  // double-queue.)
  const augment = state.teams.opponent.augment;
  if (
    augment.offeredIds !== null &&
    augment.chosenId === null &&
    state.tick >= BALANCE.augment.offerTick + cfg.augmentChoiceDelayTicks
  ) {
    // Deterministic preference: AUGMENTS content order is the priority order.
    const pick = AUGMENTS.map((a) => a.id).find((id) => augment.offeredIds!.includes(id));
    if (pick) {
      queue(commandLog, nextTick, { type: 'choose-augment', team: 'opponent', augmentId: pick });
    }
  }

  if (state.tick < runtime.nextDecisionTick) return;
  runtime.nextDecisionTick =
    state.tick + cfg.decisionIntervalTicks + rng.nextInt(0, cfg.decisionJitterTicks);

  if (cfg.usesChampion && maybeUseChampion(state, commandLog, runtime, cfg, nextTick)) {
    // A champion command this decision does not preclude a card action —
    // champion commands cost no energy.
  }

  cardAction(state, commandLog, rng, cfg, nextTick);
}

/** Returns true if a champion command was queued. */
function maybeUseChampion(
  state: BattleState,
  commandLog: ScheduledCommand[],
  runtime: OpponentAiRuntime,
  cfg: AiDifficultyConfig,
  nextTick: number
): boolean {
  // The AI commands its CAPTAIN only (M9): borrowed squad champions
  // auto-cast inside the engine and take no commands from anyone.
  const champion = findTeamCaptain(state, 'opponent');
  if (!champion || !champion.champion || !champion.alive) {
    runtime.ultimateFullSinceTick = null;
    return false;
  }
  const definition = getChampionById(champion.contentId);
  if (!definition) return false;

  const full = champion.champion.ultimateCharge >= champion.champion.chargeRequired;
  if (!full) runtime.ultimateFullSinceTick = null;
  else if (runtime.ultimateFullSinceTick === null) runtime.ultimateFullSinceTick = state.tick;

  const enemiesNearChampion = state.units.filter(
    (u) =>
      u.alive &&
      u.team === 'player' &&
      Math.abs(u.x - champion.x) <= BALANCE.arena.aggroRange
  ).length;

  if (full && validateChampionAbility(state, BALANCE, champion, definition.ultimate).ok) {
    const coreThreatened =
      state.cores.opponent.health <=
      cfg.ultimateCoreThreatFraction * state.cores.opponent.maxHealth;
    const heldLong =
      runtime.ultimateFullSinceTick !== null &&
      state.tick - runtime.ultimateFullSinceTick >= cfg.ultimateHoldTicks;
    if (enemiesNearChampion >= cfg.ultimateClumpSize || coreThreatened || heldLong) {
      queue(commandLog, nextTick, { type: 'champion-ultimate', team: 'opponent' });
      return true;
    }
  }

  // Active ability: only when combat is actually nearby AND the ability's
  // tactical auto-cast gate passes. enemiesNearChampion is lane-blind, which
  // for Lane Shift used to mean shifting away from the very enemy the
  // captain was fighting (P4 fix) — validateChampionAutoCast applies the
  // same join-combat gate as borrowed auto-casts (Lane Shift only fires to
  // JOIN a fight in the other lane, never mid-fight) and falls back to the
  // normal validate for the other champions (bit-identical behaviour).
  if (
    enemiesNearChampion > 0 &&
    champion.champion.abilityCooldownTicks === 0 &&
    validateChampionAutoCast(state, BALANCE, champion, definition.ability).ok
  ) {
    queue(commandLog, nextTick, { type: 'champion-ability', team: 'opponent' });
    return true;
  }
  return false;
}

/** The card play for this decision (at most one energy spend). */
function cardAction(
  state: BattleState,
  commandLog: ScheduledCommand[],
  rng: SeededRng,
  cfg: AiDifficultyConfig,
  nextTick: number
): void {
  const teamState = state.teams.opponent;
  const energy = teamState.energy;
  const hand = teamState.cards?.hand ?? null;
  const fighterIds = (hand ?? FIGHTER_POOL).filter((id) => fighterCard(id) !== undefined);
  const affordableFighters = fighterIds.filter(
    (id) => (getCardById(id) as CardDefinition).energyCost <= energy
  );
  const zone = deployZone();
  const mistake = cfg.mistakeChance > 0 && rng.chance(cfg.mistakeChance);

  const deployFighter = (cardId: string, lane: LaneId, x: number): void => {
    queue(commandLog, nextTick, {
      type: 'deploy-card',
      team: 'opponent',
      cardId,
      lane,
      x: clamp(x, zone.min, zone.max),
    });
  };

  // Training-style non-reactive play: a random affordable fighter on a
  // random lane, mid-zone. No counters, no techniques.
  if (!cfg.reactsToThreats) {
    if (affordableFighters.length === 0) return;
    const cardId = rng.pick(affordableFighters);
    const lane = rng.nextInt(0, 1) as LaneId;
    deployFighter(cardId, lane, zone.min + BALANCE.arena.deployZoneDepth / 2 - rng.nextInt(0, 10));
    return;
  }

  // 1. DEFEND the most threatened lane (energy reserve is ignored: losing the
  //    core is worse than a thin bank).
  const threats = [laneThreat(state, 0), laneThreat(state, 1)];
  const worst = threats[0].score >= threats[1].score ? threats[0] : threats[1];
  if (worst.score >= BALANCE.ai.threatTriggerScore) {
    // Swarm push → AoE technique on the densest clump.
    if (cfg.usesTechniques && hand && worst.count >= BALANCE.ai.swarmCountThreshold) {
      const aoeId = hand.find((id) => {
        const card = getCardById(id);
        return (
          card !== undefined &&
          card.category !== 'fighter' &&
          card.target === 'enemy-unit' &&
          (card.effects?.damage ?? 0) > 0 &&
          (card.effects?.radius ?? 0) > 0 &&
          card.energyCost <= energy
        );
      });
      if (aoeId) {
        const radius = getCardById(aoeId)!.effects!.radius!;
        const target = clumpTarget(state, worst.lane, radius);
        if (target) {
          queue(commandLog, nextTick, {
            type: 'play-card',
            team: 'opponent',
            cardId: aoeId,
            target: { kind: 'unit', unitId: target.id },
          });
          return;
        }
      }
    }
    if (affordableFighters.length > 0) {
      let cardId: string | null;
      if (worst.fastestSpeed >= BALANCE.ai.fastThreatSpeed) {
        // Fast runner → ranged counter (melee cannot catch it); fall back to
        // damage if no ranged fighter is available.
        cardId =
          bestFighter(affordableFighters, (c) => (c.unit!.stats.isRanged ? c.unit!.stats.attackDamage : -1)) ??
          bestFighter(affordableFighters, (c) => c.unit!.stats.attackDamage);
      } else if (worst.biggestHealth >= BALANCE.ai.tankHealthThreshold) {
        // Tank push → highest damage to burn it down.
        cardId = bestFighter(affordableFighters, (c) => c.unit!.stats.attackDamage);
      } else if (worst.count >= BALANCE.ai.swarmCountThreshold) {
        // Swarm push → bulkiest blocker.
        cardId = bestFighter(affordableFighters, (c) => c.unit!.stats.maxHealth);
      } else {
        // General defence → strongest (most expensive) fighter.
        cardId = bestFighter(affordableFighters, (c) => c.energyCost);
      }
      if (cardId) {
        let lane = worst.lane;
        let chosen = cardId;
        if (mistake) {
          lane = (1 - lane) as LaneId;
          chosen = rng.pick(affordableFighters);
        }
        // Intercept just behind the deepest attacker (clamped into the zone).
        deployFighter(chosen, lane, worst.frontX + 2);
        return;
      }
    }
  }

  // 2. HEAL a wounded push (techniques; also the friendly-champion heal).
  if (cfg.usesTechniques && hand) {
    const wounded = mostWoundedOwn(state);
    if (wounded) {
      const healId = hand.find((id) => {
        const card = getCardById(id);
        if (!card || card.category === 'fighter' || (card.effects?.heal ?? 0) <= 0) return false;
        if (card.energyCost > energy) return false;
        if (card.target === 'friendly-unit') return true;
        return card.target === 'friendly-champion' && wounded.kind === 'champion';
      });
      if (healId) {
        queue(commandLog, nextTick, {
          type: 'play-card',
          team: 'opponent',
          cardId: healId,
          target: { kind: 'unit', unitId: wounded.id },
        });
        return;
      }
    }
  }

  // 3. Support an existing push (reserve respected from here on).
  const spendable = energy - cfg.energyReserve;
  const push = frontmostOwnPush(state);
  if (push && cfg.usesTechniques && hand) {
    // Buff/shield the frontmost pusher (equipment and non-heal techniques).
    const buffId = hand.find((id) => {
      const card = getCardById(id);
      return (
        card !== undefined &&
        card.category !== 'fighter' &&
        card.target === 'friendly-unit' &&
        (card.effects?.heal ?? 0) === 0 &&
        card.energyCost <= spendable
      );
    });
    if (buffId) {
      queue(commandLog, nextTick, {
        type: 'play-card',
        team: 'opponent',
        cardId: buffId,
        target: { kind: 'unit', unitId: push.id },
      });
      return;
    }
  }
  const affordableWithReserve = fighterIds.filter(
    (id) => (getCardById(id) as CardDefinition).energyCost <= spendable
  );
  if (affordableWithReserve.length === 0) return;
  if (push) {
    // Healer/shielder fighters deploy behind the push lane.
    const supportId = affordableWithReserve.find((id) => {
      const behavior = fighterCard(id)?.unit?.behavior;
      return behavior === 'healer' || behavior === 'shielder';
    });
    if (supportId) {
      deployFighter(supportId, push.lane, push.x + BALANCE.ai.supportBehindOffset);
      return;
    }
  }

  // 4. PRESSURE the weaker enemy lane with the strongest affordable fighter.
  let lane: LaneId = cfg.targetsWeakerLane
    ? playerLaneStrength(state, 0) <= playerLaneStrength(state, 1)
      ? 0
      : 1
    : (rng.nextInt(0, 1) as LaneId);
  let cardId = bestFighter(affordableWithReserve, (c) => c.energyCost);
  if (!cardId) return;
  if (mistake) {
    lane = (1 - lane) as LaneId;
    cardId = rng.pick(affordableWithReserve);
  }
  deployFighter(
    cardId,
    lane,
    zone.min + BALANCE.arena.deployZoneDepth / 2 - rng.nextInt(0, 10)
  );
}

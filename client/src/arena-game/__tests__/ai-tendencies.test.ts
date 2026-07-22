/**
 * P10 — champion-path tendency tests for the opponent AI.
 *
 * Style follows opponent-ai.test.ts's P4 Lane Shift suite: craft a battle
 * state (createBattle + spawnUnitsForCard), force a decision this tick, and
 * assert on the queued commands. Every tendency gets a hold case and a cast
 * case on near-identical states, plus tier-scaling coverage: training
 * (tier 0) ignores champions entirely, standard follows tendencies with a
 * deterministic seeded 0.75 roll (both branches exercised and PREDICTED from
 * the RNG state), advanced always follows.
 *
 * Opening variety (P10) is covered at the bottom: openings must differ
 * across seeds (lane + first card) while staying identical per seed.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE, getCardById } from '../content';
import type { AiDifficulty } from '../content';
import {
  createLiveBattle,
  stepLiveBattle,
} from '../features/arena/battle-controller';
import {
  createOpponentAiRuntime,
  OpponentAiRuntime,
  runOpponentAi,
} from '../features/arena/opponent-ai';
import { TENDENCY } from '../features/arena/champion-tendencies';
import { findTeamChampion } from '../game-engine/abilities/champion-abilities';
import { spawnUnitsForCard } from '../game-engine/entities/spawn';
import { SeededRng } from '../game-engine/random/rng';
import type { ScheduledCommand } from '../game-engine/simulation/events';
import { createBattle } from '../game-engine/simulation/state';
import type { BattleState, UnitState } from '../game-engine/simulation/state';
import type { LaneId } from '../game-engine/types';
import { DEFAULT_DECK_CARD_IDS } from '../services/persistence/save';

/** Opponent captain spawns at lane 0, x = laneLength - spawnOffsetFromCore = 94. */
function captainState(championId: string): { state: BattleState; captain: UnitState } {
  const state = createBattle(
    {
      seed: 20260723,
      player: { playerId: 'p1' },
      opponent: { playerId: 'ai', championId },
    },
    BALANCE
  );
  state.tick = 50; // before the augment offer; decision forced in decide()
  const captain = findTeamChampion(state, 'opponent')!;
  expect(captain.champion?.commandable).toBe(true);
  return { state, captain };
}

/** One enemy unit for the opponent captain to consider. */
function spawnEnemy(state: BattleState, cardId: string, lane: LaneId, x: number): UnitState {
  return spawnUnitsForCard(state, BALANCE, getCardById(cardId)!, 'player', lane, x)[0];
}

/** Forces one AI decision on the crafted state; returns the queued commands. */
function decide(
  state: BattleState,
  difficulty: AiDifficulty,
  mutateRuntime?: (runtime: OpponentAiRuntime) => void,
  rngSeed = 7
): ScheduledCommand[] {
  const log: ScheduledCommand[] = [];
  const rng = new SeededRng(rngSeed);
  const runtime = createOpponentAiRuntime(rng, difficulty);
  runtime.nextDecisionTick = state.tick; // force a decision this tick
  mutateRuntime?.(runtime);
  runOpponentAi(state, log, rng, runtime, difficulty);
  return log;
}

function has(log: ScheduledCommand[], type: 'champion-ability' | 'champion-ultimate'): boolean {
  return log.some((c) => c.command.type === type);
}

describe('Titan tendencies — Quake Stomp clumps/combos, Seismic Smash clumps', () => {
  it('holds Quake Stomp on a single enemy in radius while the ultimate is far off', () => {
    const { state, captain } = captainState('champion-titan');
    spawnEnemy(state, 'titan-guard', 0, captain.x - 8); // inside stomp radius 10
    const log = decide(state, 'advanced');
    expect(has(log, 'champion-ability')).toBe(false);
    expect(has(log, 'champion-ultimate')).toBe(false);
  });

  it('stomps when >= stompMinTargets enemies are inside the stomp radius', () => {
    const { state, captain } = captainState('champion-titan');
    spawnEnemy(state, 'titan-guard', 0, captain.x - 8);
    spawnEnemy(state, 'titan-guard', 0, captain.x - 6);
    expect(TENDENCY.titan.stompMinTargets).toBe(2);
    const log = decide(state, 'advanced');
    expect(has(log, 'champion-ability')).toBe(true);
  });

  it('stomps a single enemy once the ultimate is near-ready (stun -> smash combo)', () => {
    const { state, captain } = captainState('champion-titan');
    spawnEnemy(state, 'titan-guard', 0, captain.x - 8);
    const champ = captain.champion!;
    champ.ultimateCharge = TENDENCY.titan.comboUltimateChargeFraction * champ.chargeRequired;
    const log = decide(state, 'advanced');
    expect(has(log, 'champion-ability')).toBe(true);
  });

  it('holds a full Seismic Smash until >= smashMinTargets enemies sit inside ITS radius', () => {
    const { state, captain } = captainState('champion-titan');
    // Both within aggroRange (baseline clump of 2 would fire), one within the
    // smash radius 14, none within the stomp radius 10.
    spawnEnemy(state, 'titan-guard', 0, captain.x - 12);
    spawnEnemy(state, 'titan-guard', 0, captain.x - 20);
    captain.champion!.ultimateCharge = captain.champion!.chargeRequired;
    const hold = decide(state, 'advanced');
    expect(has(hold, 'champion-ultimate')).toBe(false);

    const clumped = captainState('champion-titan');
    spawnEnemy(clumped.state, 'titan-guard', 0, clumped.captain.x - 12);
    spawnEnemy(clumped.state, 'titan-guard', 0, clumped.captain.x - 14);
    clumped.captain.champion!.ultimateCharge = clumped.captain.champion!.chargeRequired;
    const cast = decide(clumped.state, 'advanced');
    expect(has(cast, 'champion-ultimate')).toBe(true);
  });
});

describe('Mass Monster tendencies — defensive Gravity Well, summon when pushed', () => {
  it('holds Gravity Well on one weak enemy while its lane is calm', () => {
    const { state, captain } = captainState('champion-mass');
    spawnEnemy(state, 'support-drone', 0, captain.x - 8); // in well radius; tiny threat
    const log = decide(state, 'advanced');
    expect(has(log, 'champion-ability')).toBe(false);
  });

  it('casts Gravity Well when its lane is genuinely losing (threat above trigger)', () => {
    const { state, captain } = captainState('champion-mass');
    spawnEnemy(state, 'heavy-tank', 0, captain.x - 10);
    spawnEnemy(state, 'heavy-tank', 0, captain.x - 12);
    const log = decide(state, 'advanced');
    expect(has(log, 'champion-ability')).toBe(true);
  });

  it('fires Mass Uprising defensively when pushed, below the baseline clump size', () => {
    const { state, captain } = captainState('champion-mass');
    // ONE deep heavy tank: enemiesNearChampion = 1 < advanced ultimateClumpSize
    // (baseline would hold) but the lane threat is far above the trigger.
    spawnEnemy(state, 'heavy-tank', 0, captain.x - 10);
    captain.champion!.ultimateCharge = captain.champion!.chargeRequired;
    expect(BALANCE.ai.difficulties.advanced.ultimateClumpSize).toBeGreaterThan(1);
    const log = decide(state, 'advanced');
    expect(has(log, 'champion-ultimate')).toBe(true);
  });
});

describe('Shredder tendencies — Final Cut held for a kill/execute', () => {
  function threeTanks(): { state: BattleState; captain: UnitState; tanks: UnitState[] } {
    const { state, captain } = captainState('champion-shredder');
    const tanks = [
      spawnEnemy(state, 'heavy-tank', 0, captain.x - 4),
      spawnEnemy(state, 'heavy-tank', 0, captain.x - 6),
      spawnEnemy(state, 'heavy-tank', 0, captain.x - 8),
    ];
    captain.champion!.ultimateCharge = captain.champion!.chargeRequired;
    return { state, captain, tanks };
  }

  it('holds a full Final Cut against healthy targets even in a baseline-sized clump', () => {
    const { state } = threeTanks(); // 3 near enemies satisfies EVERY tier's clump size
    const log = decide(state, 'advanced');
    expect(has(log, 'champion-ultimate')).toBe(false);
    // It still fights: Phase Dash (no hold tendency) fires on the same state.
    expect(has(log, 'champion-ability')).toBe(true);
  });

  it('fires Final Cut once the lowest-health target lands in execute range', () => {
    const { state, tanks } = threeTanks();
    // 300 - 250 = 50 < 0.3 * 1100 → the execute finishes the target.
    tanks[0].health = 300;
    const log = decide(state, 'advanced');
    expect(has(log, 'champion-ultimate')).toBe(true);
  });

  it('fires Final Cut on an outright lethal target', () => {
    const { state, tanks } = threeTanks();
    tanks[1].health = 200; // <= 250 damage: dead before the execute check
    const log = decide(state, 'advanced');
    expect(has(log, 'champion-ultimate')).toBe(true);
  });

  it('standard tier follows the tendency per its deterministic 0.75 roll — both branches predicted and observed', () => {
    const follow = BALANCE.ai.difficulties.standard.tendencyFollowChance;
    expect(follow).toBeGreaterThan(0);
    expect(follow).toBeLessThan(1);
    const { state } = threeTanks(); // healthy targets: followed = hold, baseline = cast
    let followed = 0;
    let reverted = 0;
    for (let seed = 1; seed <= 40; seed++) {
      // Predict the follow roll without consuming the real stream: mulberry32
      // state fully determines the sequence, so a probe seeded from getState()
      // replays it. Draw 1 is runOpponentAi's decision-cadence jitter; draw 2
      // is the tendency-follow roll.
      const rng = new SeededRng(seed);
      const runtime = createOpponentAiRuntime(rng, 'standard');
      runtime.nextDecisionTick = state.tick;
      const probe = new SeededRng(rng.getState());
      probe.next();
      const follows = probe.next() < follow;
      const log: ScheduledCommand[] = [];
      runOpponentAi(state, log, rng, runtime, 'standard');
      expect(has(log, 'champion-ultimate'), `seed ${seed}`).toBe(!follows);
      if (follows) followed++;
      else reverted++;
    }
    // The scan genuinely exercised both branches.
    expect(followed).toBeGreaterThan(0);
    expect(reverted).toBeGreaterThan(0);
  });

  it('tier 0 vs top tier on the same state: training queues no champion command at all, advanced acts', () => {
    const { state } = threeTanks();
    const training = decide(state, 'training');
    expect(has(training, 'champion-ability')).toBe(false);
    expect(has(training, 'champion-ultimate')).toBe(false);
    const advanced = decide(state, 'advanced');
    expect(has(advanced, 'champion-ability')).toBe(true); // dash — but Final Cut stays held
    expect(has(advanced, 'champion-ultimate')).toBe(false);
  });
});

describe('Cardio Machine tendencies — Overclock only in an engaged fight', () => {
  it('holds a full Overclock while walking alone, even past the held-long valve', () => {
    const { state, captain } = captainState('champion-cardio');
    captain.champion!.ultimateCharge = captain.champion!.chargeRequired;
    const holdTicks = BALANCE.ai.difficulties.advanced.ultimateHoldTicks;
    const log = decide(state, 'advanced', (runtime) => {
      runtime.ultimateFullSinceTick = state.tick - holdTicks - 1; // baseline would fire
    });
    expect(has(log, 'champion-ultimate')).toBe(false);
  });

  it('fires Overclock once an enemy is engaged in its lane', () => {
    const { state, captain } = captainState('champion-cardio');
    spawnEnemy(state, 'titan-guard', 0, captain.x - 4);
    captain.champion!.ultimateCharge = captain.champion!.chargeRequired;
    const log = decide(state, 'advanced');
    expect(has(log, 'champion-ultimate')).toBe(true);
  });
});

describe('Aesthetics tendencies — stance timing and squad rallies', () => {
  it('holds Bulwark at full health against a lone enemy', () => {
    const { state, captain } = captainState('champion-aesthetic');
    spawnEnemy(state, 'support-drone', 0, captain.x - 4);
    expect(captain.champion!.stanceShifts % 2).toBe(0); // next stance: Bulwark
    const log = decide(state, 'advanced');
    expect(has(log, 'champion-ability')).toBe(false);
  });

  it('casts Bulwark when low, and when focused by multiple enemies', () => {
    const low = captainState('champion-aesthetic');
    spawnEnemy(low.state, 'support-drone', 0, low.captain.x - 4);
    low.captain.health = TENDENCY.aesthetic.bulwarkHealthFraction * low.captain.baseMaxHealth;
    expect(has(decide(low.state, 'advanced'), 'champion-ability')).toBe(true);

    const focused = captainState('champion-aesthetic');
    spawnEnemy(focused.state, 'support-drone', 0, focused.captain.x - 4);
    spawnEnemy(focused.state, 'support-drone', 0, focused.captain.x - 6);
    expect(has(decide(focused.state, 'advanced'), 'champion-ability')).toBe(true);
  });

  it('casts Assault while winning trades, holds it while low', () => {
    const winning = captainState('champion-aesthetic');
    spawnEnemy(winning.state, 'support-drone', 0, winning.captain.x - 4);
    winning.captain.champion!.stanceShifts = 1; // next stance: Assault
    expect(has(decide(winning.state, 'advanced'), 'champion-ability')).toBe(true);

    const low = captainState('champion-aesthetic');
    spawnEnemy(low.state, 'support-drone', 0, low.captain.x - 4);
    low.captain.champion!.stanceShifts = 1;
    low.captain.health = 0.4 * low.captain.baseMaxHealth;
    expect(has(decide(low.state, 'advanced'), 'champion-ability')).toBe(false);
  });

  it('holds Forge Rally without a squad, fires it with allies on the field', () => {
    const alone = captainState('champion-aesthetic');
    // forge-recruit deploys 2 units: satisfies the advanced baseline clump.
    spawnUnitsForCard(alone.state, BALANCE, getCardById('forge-recruit')!, 'player', 0, alone.captain.x - 4);
    alone.captain.champion!.ultimateCharge = alone.captain.champion!.chargeRequired;
    const hold = decide(alone.state, 'advanced');
    expect(has(hold, 'champion-ultimate')).toBe(false);

    const squad = captainState('champion-aesthetic');
    spawnUnitsForCard(squad.state, BALANCE, getCardById('forge-recruit')!, 'player', 0, squad.captain.x - 4);
    spawnEnemyProofAllies(squad.state, squad.captain);
    squad.captain.champion!.ultimateCharge = squad.captain.champion!.chargeRequired;
    const cast = decide(squad.state, 'advanced');
    expect(has(cast, 'champion-ultimate')).toBe(true);
  });

  function spawnEnemyProofAllies(state: BattleState, captain: UnitState): void {
    // rallyMinAllies living allied units besides the captain.
    for (let i = 0; i < TENDENCY.aesthetic.rallyMinAllies; i++) {
      spawnUnitsForCard(
        state,
        BALANCE,
        getCardById('titan-guard')!,
        'opponent',
        (i % 2) as LaneId,
        captain.x + 2 + i * 2
      );
    }
  }
});

describe('P10 opening variety — seed-varied, per-seed deterministic openings', () => {
  interface OpeningDeploy {
    lane: LaneId;
    cardId: string;
    x: number;
    tick: number;
  }

  /** Opponent deploys queued inside the opening window against a passive player. */
  function openingDeploys(seed: number): OpeningDeploy[] {
    const live = createLiveBattle(seed, 'p1', {
      playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
      opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
      playerChampionId: 'champion-titan',
      aiDifficulty: 'advanced',
    });
    stepLiveBattle(live, BALANCE.ai.openingWindowTicks);
    const deploys: OpeningDeploy[] = [];
    for (const { tick, command } of live.commandLog) {
      if (command.type === 'deploy-card' && command.team === 'opponent' && tick <= BALANCE.ai.openingWindowTicks) {
        deploys.push({ lane: command.lane, cardId: command.cardId, x: command.x, tick });
      }
    }
    return deploys;
  }

  it('openings differ across seeds: both lanes and multiple first cards appear', () => {
    const firstLanes = new Set<number>();
    const firstCards = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const deploys = openingDeploys(seed);
      expect(deploys.length, `seed ${seed} deployed in the opening`).toBeGreaterThan(0);
      firstLanes.add(deploys[0].lane);
      firstCards.add(deploys[0].cardId);
    }
    expect([...firstLanes].sort()).toEqual([0, 1]);
    expect(firstCards.size).toBeGreaterThanOrEqual(2);
  });

  it('the same seed opens identically every time', () => {
    expect(openingDeploys(5)).toEqual(openingDeploys(5));
    expect(openingDeploys(11)).toEqual(openingDeploys(11));
  });
});

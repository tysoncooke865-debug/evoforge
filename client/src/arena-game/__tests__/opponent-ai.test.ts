/**
 * Milestone 6 tests — the opponent AI. Pure TS (controller + engine).
 *
 * Covers: per-difficulty headless battles to completion (deterministic,
 * zero invariant violations, zero rejected commands), full replay fidelity
 * of live battles including AI + augments + synergies, the no-cheating
 * guarantee (no modifiers beyond legitimately played sources, no energy
 * beyond regen), deterministic augment choice, difficulty separation, and
 * training being genuinely beatable where advanced is not.
 */
import { describe, expect, it } from 'vitest';
import { AUGMENTS, BALANCE, getCardById, getChampionById } from '../content';
import type { AiDifficulty } from '../content';
import {
  createLiveBattle,
  LiveBattle,
  liveDigest,
  queueChampionAbility,
  queueChampionUltimate,
  queueChooseAugment,
  queuePlayerDeploy,
  stepLiveBattle,
} from '../features/arena/battle-controller';
import {
  createOpponentAiRuntime,
  runOpponentAi,
} from '../features/arena/opponent-ai';
import { findTeamChampion } from '../game-engine/abilities/champion-abilities';
import { SeededRng } from '../game-engine/random/rng';
import type { ScheduledCommand } from '../game-engine/simulation/events';
import { runBattle } from '../game-engine/simulation/run';
import { createBattle } from '../game-engine/simulation/state';
import { DEFAULT_DECK_CARD_IDS } from '../services/persistence/save';

const WORST_TICKS = BALANCE.battle.durationTicks + BALANCE.battle.suddenDeathTicks + 20;
const MAX_STEPS = Math.ceil(WORST_TICKS / 25) + 10;
const ALL_DIFFICULTIES: readonly AiDifficulty[] = ['training', 'standard', 'advanced'];

function aiOnlyBattle(seed: number, difficulty: AiDifficulty): LiveBattle {
  const live = createLiveBattle(seed, 'p1', {
    playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
    opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
    playerChampionId: 'champion-titan',
    aiDifficulty: difficulty,
  });
  let steps = 0;
  while (live.state.phase !== 'finished' && steps++ < MAX_STEPS) {
    stepLiveBattle(live, 25);
  }
  return live;
}

/**
 * A fixed, deterministic player script: defend with hand fighters, use the
 * champion, take the first offered augment. Same inputs at the same ticks
 * regardless of difficulty — used to compare difficulties fairly.
 */
function defendedBattle(seed: number, difficulty: AiDifficulty, championId: string): LiveBattle {
  const live = createLiveBattle(seed, 'p1', {
    playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
    opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
    playerChampionId: championId,
    aiDifficulty: difficulty,
  });
  let steps = 0;
  while (live.state.phase !== 'finished' && steps++ < MAX_STEPS) {
    stepLiveBattle(live, 25);
    queueChampionAbility(live);
    queueChampionUltimate(live);
    const offered = live.state.teams.player.augment.offeredIds;
    if (offered && live.state.teams.player.augment.chosenId === null) {
      queueChooseAugment(live, offered[0]);
    }
    const hand = live.state.teams.player.cards?.hand ?? [];
    const fighter = hand.find((id) => {
      const card = getCardById(id);
      return card?.category === 'fighter' && card.energyCost <= live.state.teams.player.energy;
    });
    if (fighter) queuePlayerDeploy(live, fighter, (steps % 2) as 0 | 1, 15);
  }
  return live;
}

describe('per-difficulty AI battles run headless to completion', () => {
  for (const difficulty of ALL_DIFFICULTIES) {
    it(`${difficulty}: finishes, emits only valid commands, replays digest-identically`, () => {
      const live = aiOnlyBattle(20260722, difficulty);
      expect(live.state.phase).toBe('finished');
      // The AI never produced a rejected command.
      expect(live.rejected).toEqual([]);
      // Every AI command targets its own team through the public union.
      for (const { command } of live.commandLog) {
        expect(command.team).toBe('opponent');
        expect([
          'deploy-card',
          'play-card',
          'champion-ability',
          'champion-ultimate',
          'choose-augment',
        ]).toContain(command.type);
      }
      // Replay fidelity: the recorded command log reproduces the battle
      // without the AI present, with zero invariant violations on any tick.
      const rerun = runBattle(live.config, live.commandLog, BALANCE);
      expect(rerun.digest).toBe(liveDigest(live));
      expect(rerun.outcome).toEqual(live.state.outcome);
      expect(rerun.invariantViolations).toEqual([]);
      expect(rerun.stalled).toBe(false);
    });

    it(`${difficulty}: same seed twice produces identical digests`, () => {
      expect(liveDigest(aiOnlyBattle(4242, difficulty))).toBe(
        liveDigest(aiOnlyBattle(4242, difficulty))
      );
    });
  }

  it('difficulties genuinely differ (same seed, different digests and pace)', () => {
    const training = aiOnlyBattle(20260722, 'training');
    const advanced = aiOnlyBattle(20260722, 'advanced');
    expect(liveDigest(training)).not.toBe(liveDigest(advanced));
    // Against a passive player, advanced closes the game out faster.
    expect(advanced.state.outcome!.endTick).toBeLessThan(training.state.outcome!.endTick);
  });

  it('training plays fighters only — no techniques, no champion commands', () => {
    const live = aiOnlyBattle(20260722, 'training');
    for (const { command } of live.commandLog) {
      expect(command.type).toBe('deploy-card');
    }
  });

  it('standard and advanced use techniques and the champion (ability + ultimate)', () => {
    for (const difficulty of ['standard', 'advanced'] as const) {
      const live = defendedBattle(555, difficulty, 'champion-titan');
      const types = new Set(
        live.commandLog.map((c) => c.command).filter((c) => c.team === 'opponent').map((c) => c.type)
      );
      expect(types.has('play-card'), difficulty).toBe(true);
      expect(types.has('champion-ability'), difficulty).toBe(true);
      expect(types.has('champion-ultimate'), difficulty).toBe(true);
      expect(live.rejected).toEqual([]);
    }
  });
});

describe('the AI never cheats', () => {
  it('grants no modifiers beyond legitimately played sources and no energy beyond regen', () => {
    const live = createLiveBattle(555, 'p1', {
      playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
      opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
      playerChampionId: 'champion-titan',
      aiDifficulty: 'advanced',
    });
    // Sources that MAY legally place modifiers on units in this battle:
    // cards either side actually plays (checked incrementally below),
    // and both champions' abilities/ultimates.
    const playerChampion = getChampionById('champion-titan')!;
    const opponentChampion = getChampionById(
      findTeamChampion(live.state, 'opponent')!.contentId
    )!;
    const allowedSources = new Set<string>([
      playerChampion.ability.id,
      playerChampion.ultimate.id,
      opponentChampion.ability.id,
      opponentChampion.ultimate.id,
    ]);
    const { regenPerTick, finalMinuteRegenMult, startingEnergy } = BALANCE.energy;

    let steps = 0;
    while (live.state.phase !== 'finished' && steps++ < MAX_STEPS) {
      stepLiveBattle(live, 25);
      for (const { command } of live.commandLog) {
        if (command.type === 'play-card' || command.type === 'deploy-card') {
          allowedSources.add(command.cardId);
        }
      }
      // Checked mid-battle, not just at the end: every live modifier on every
      // unit traces back to a played card, a champion ability or an augment.
      for (const unit of live.state.units) {
        for (const modifier of unit.modifiers) {
          expect(
            allowedSources.has(modifier.sourceId) || modifier.sourceId.startsWith('augment:'),
            `unexpected modifier source '${modifier.sourceId}' on ${unit.contentId}`
          ).toBe(true);
        }
      }
      // Energy stays within what regen can possibly have produced (loose
      // upper bound: max multipliers the whole time — the 1.1 regen augment
      // AND the Cardio Machine's 1.05 Perpetual Motion passive), on top of
      // the engine invariant that already caps it at the energy maximum.
      const bound =
        startingEnergy +
        live.state.tick * regenPerTick * finalMinuteRegenMult * 1.1 * 1.05 +
        1e-6;
      expect(live.state.teams.opponent.energy).toBeLessThanOrEqual(
        Math.min(BALANCE.energy.max + 1e-9, bound)
      );
    }
    expect(live.state.phase).toBe('finished');
    expect(live.rejected).toEqual([]);
  });
});

describe('AI augment choice', () => {
  function craftedState() {
    const state = createBattle(
      { seed: 1, player: { playerId: 'p1' }, opponent: { playerId: 'p2' } },
      BALANCE
    );
    state.tick = BALANCE.augment.offerTick + BALANCE.ai.difficulties.standard.augmentChoiceDelayTicks;
    state.teams.opponent.augment.offeredIds = [
      'kinetic-treads',
      'core-reconstruction',
      'nano-repair-swarm',
    ];
    return state;
  }

  it('always chooses, deterministically, by content-order priority', () => {
    const state = craftedState();
    const rng = new SeededRng(1);
    const runtime = createOpponentAiRuntime(rng, 'standard');
    runtime.nextDecisionTick = state.tick + 1000; // isolate the augment logic
    const log: ScheduledCommand[] = [];
    runOpponentAi(state, log, rng, runtime, 'standard');
    expect(log.length).toBe(1);
    const command = log[0].command;
    expect(log[0].tick).toBe(state.tick + 1);
    expect(command.type).toBe('choose-augment');
    if (command.type === 'choose-augment') {
      // Earliest offered id in AUGMENTS content order.
      const priority = AUGMENTS.map((a) => a.id);
      expect(command.augmentId).toBe('nano-repair-swarm');
      expect(priority.indexOf('nano-repair-swarm')).toBeLessThan(priority.indexOf('kinetic-treads'));
    }
  });

  it('waits out the difficulty delay and never re-chooses', () => {
    const early = craftedState();
    early.tick -= 1; // one tick before the delay elapses
    const rng = new SeededRng(1);
    const runtime = createOpponentAiRuntime(rng, 'standard');
    runtime.nextDecisionTick = early.tick + 1000;
    const log: ScheduledCommand[] = [];
    runOpponentAi(early, log, rng, runtime, 'standard');
    expect(log).toEqual([]);

    const chosen = craftedState();
    chosen.teams.opponent.augment.chosenId = 'kinetic-treads';
    chosen.teams.opponent.augment.chosenAtTick = chosen.tick - 1;
    runOpponentAi(chosen, log, rng, runtime, 'standard');
    expect(log).toEqual([]);
  });

  it('chooses in a real long battle (offer crossed live)', () => {
    const live = defendedBattle(777, 'training', 'champion-aesthetic');
    expect(live.state.outcome!.endTick).toBeGreaterThan(BALANCE.augment.offerTick);
    const opponentAugment = live.state.teams.opponent.augment;
    expect(opponentAugment.chosenId).not.toBeNull();
    // The deterministic priority pick among what was actually offered.
    const expected = AUGMENTS.map((a) => a.id).find((id) =>
      opponentAugment.offeredIds!.includes(id)
    );
    expect(opponentAugment.chosenId).toBe(expected);
  });
});

describe('full replay fidelity: AI + augments + synergies in one live battle', () => {
  it('replays digest-identically with zero violations, and is deterministic', () => {
    const play = () => defendedBattle(777, 'training', 'champion-aesthetic');
    const live = play();
    expect(live.state.phase).toBe('finished');
    expect(live.rejected).toEqual([]);
    // The battle actually exercised all three systems.
    expect(live.state.teams.player.augment.chosenId).not.toBeNull();
    expect(live.state.teams.opponent.augment.chosenId).not.toBeNull();
    expect(live.state.log.some((l) => l.type === 'synergy-on')).toBe(true);
    // Replay through the headless runner without any AI present.
    const rerun = runBattle(live.config, live.commandLog, BALANCE);
    expect(rerun.digest).toBe(liveDigest(live));
    expect(rerun.outcome).toEqual(live.state.outcome);
    expect(rerun.invariantViolations).toEqual([]);
    // Determinism of the whole live pipeline.
    expect(liveDigest(play())).toBe(liveDigest(live));
  });
});

describe('training is genuinely beatable', () => {
  it('the same simple player script beats training but loses to advanced', () => {
    const vsTraining = defendedBattle(555, 'training', 'champion-titan');
    expect(vsTraining.state.outcome!.winner).toBe('player');
    const vsAdvanced = defendedBattle(555, 'advanced', 'champion-titan');
    expect(vsAdvanced.state.outcome!.winner).toBe('opponent');
  });
});

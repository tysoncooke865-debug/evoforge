/**
 * Milestone 8 tests — ghost battles: command transform correctness (team
 * swap, x mirroring incl. deploy-zone boundaries, augment re-pick), full
 * ghost battles headless to completion with zero invariant violations and
 * digest-identical reruns, and offline operation (no provider calls).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../content';
import {
  createGhostLiveBattle,
  liveDigest,
  queuePlayerDeploy,
  stepLiveBattle,
} from '../features/arena/battle-controller';
import { createBattleStore } from '../features/arena/battle-store';
import {
  buildGhostBattleSetup,
  mirrorDeployX,
  predictGhostAugmentOffer,
  transformGhostCommands,
} from '../features/arena/ghost';
import type { ScheduledCommand } from '../game-engine/simulation/events';
import { validateDeployPosition } from '../game-engine/simulation/events';
import {
  BATTLE_RECORD_SCHEMA_VERSION,
  BattleRecord,
  verifyBattleRecord,
} from '../game-engine/simulation/replay';
import { runBattle } from '../game-engine/simulation/run';
import type { BattleConfig } from '../game-engine/simulation/state';
import type {
  BattleResult,
  EvoForgePlayerProvider,
  FitnessProfile,
  GymProfile,
  PlayerProfile,
} from '../integration/evoforge/types';
import { loadBattleRecords } from '../services/persistence/battle-records';
import { MemoryStorage } from '../services/persistence/storage';
import { DEFAULT_DECK_CARD_IDS } from '../services/persistence/save';

const { laneLength, deployZoneDepth } = BALANCE.arena;
const WORST_CASE_TICKS = BALANCE.battle.durationTicks + BALANCE.battle.suddenDeathTicks + 20;

/** Builds a real, verifiable record by running the battle headless. */
function makeRecord(config: BattleConfig, commands: ScheduledCommand[]): BattleRecord {
  const result = runBattle(config, commands, BALANCE);
  expect(result.stalled).toBe(false);
  expect(result.invariantViolations).toEqual([]);
  return {
    schemaVersion: BATTLE_RECORD_SCHEMA_VERSION,
    balanceVersion: BALANCE.balanceVersion,
    seed: config.seed,
    config,
    playerSnapshot: { playerId: config.player.playerId, displayName: 'Original', championId: config.player.championId ?? null, rankPoints: 50 },
    opponentSnapshot: { playerId: config.opponent.playerId, displayName: 'Foe', championId: config.opponent.championId ?? null, rankPoints: 0 },
    commands,
    outcome: result.outcome,
    digest: result.digest,
    recordedAt: '2026-07-22T00:00:00.000Z',
  };
}

describe('ghost command transform', () => {
  const config: BattleConfig = {
    seed: 20260801,
    player: { playerId: 'p1', deckCardIds: DEFAULT_DECK_CARD_IDS, championId: 'champion-titan' },
    opponent: { playerId: 'foe', deckCardIds: DEFAULT_DECK_CARD_IDS, championId: 'champion-speedster' },
  };

  // Hand-written command stream exercising every command type, including
  // deploy-zone boundary positions and entries that must be filtered out.
  const commands: ScheduledCommand[] = [
    { tick: 20, command: { type: 'deploy-card', team: 'player', cardId: 'forge-recruit', lane: 0, x: 0 } },
    { tick: 30, command: { type: 'deploy-card', team: 'player', cardId: 'titan-guard', lane: 1, x: deployZoneDepth } },
    { tick: 40, command: { type: 'deploy-card', team: 'player', cardId: 'neon-boxer', lane: 0, x: 17.5 } },
    { tick: 50, command: { type: 'play-card', team: 'player', cardId: 'overload', target: { kind: 'unit', unitId: 5 } } },
    { tick: 60, command: { type: 'champion-ability', team: 'player' } },
    { tick: 70, command: { type: 'champion-ultimate', team: 'player' } },
    { tick: 1801, command: { type: 'choose-augment', team: 'player', augmentId: 'augment-original-pick' } },
    // Opponent commands must never become ghost commands.
    { tick: 25, command: { type: 'deploy-card', team: 'opponent', cardId: 'forge-recruit', lane: 0, x: 90 } },
    // Malformed tick from untrusted data must be skipped.
    { tick: 0.5, command: { type: 'noop', team: 'player' } },
  ];

  function ghostConfigFor(record: BattleRecord): BattleConfig {
    const setup = buildGhostBattleSetup(record, 999, 'p2', { deckCardIds: DEFAULT_DECK_CARD_IDS }, BALANCE);
    expect(setup.ok).toBe(true);
    if (!setup.ok) throw new Error('unreachable');
    return setup.config;
  }

  function makeTransformRecord(): BattleRecord {
    // Transform tests need a structurally valid record, not a verified one.
    return {
      ...makeRecord(config, []),
      commands,
    };
  }

  it('team-swaps every player command, keeps ticks, drops opponent/malformed entries', () => {
    const record = makeTransformRecord();
    const ghostConfig = ghostConfigFor(record);
    const transformed = transformGhostCommands(record, ghostConfig, BALANCE);

    expect(transformed.length).toBe(7); // 9 entries minus opponent + malformed tick
    for (const c of transformed) expect(c.command.team).toBe('opponent');
    expect(transformed.map((c) => c.tick)).toEqual([20, 30, 40, 50, 60, 70, 1801]);
    expect(transformed.map((c) => c.command.type)).toEqual([
      'deploy-card',
      'deploy-card',
      'deploy-card',
      'play-card',
      'champion-ability',
      'champion-ultimate',
      'choose-augment',
    ]);
    // The source record is never mutated.
    expect(record.commands[0].command.team).toBe('player');
  });

  it('mirrors deploy x across the lane axis and keeps the lane', () => {
    const record = makeTransformRecord();
    const ghostConfig = ghostConfigFor(record);
    const transformed = transformGhostCommands(record, ghostConfig, BALANCE);
    const deploys = transformed.filter((c) => c.command.type === 'deploy-card');
    const positions = deploys.map((c) => (c.command.type === 'deploy-card' ? c.command.x : NaN));
    const lanes = deploys.map((c) => (c.command.type === 'deploy-card' ? c.command.lane : -1));

    expect(positions).toEqual([laneLength, laneLength - deployZoneDepth, laneLength - 17.5]);
    expect(lanes).toEqual([0, 1, 0]);
  });

  it('mirrored positions are VALID opponent deploys, including both zone boundaries', () => {
    // The player zone [0, deployZoneDepth] must map exactly onto the
    // opponent zone [laneLength - deployZoneDepth, laneLength].
    for (const x of [0, 1e-9, 5, deployZoneDepth / 2, deployZoneDepth - 0.001, deployZoneDepth]) {
      expect(validateDeployPosition(BALANCE, 'player', x).ok).toBe(true);
      const mirrored = mirrorDeployX(x, BALANCE);
      expect(validateDeployPosition(BALANCE, 'opponent', mirrored).ok).toBe(true);
    }
    expect(mirrorDeployX(0, BALANCE)).toBe(laneLength);
    expect(mirrorDeployX(deployZoneDepth, BALANCE)).toBe(laneLength - deployZoneDepth);
  });

  it('re-picks the augment from the ghost\'s OWN offer (first offered id)', () => {
    const record = makeTransformRecord();
    const ghostConfig = ghostConfigFor(record);
    const predicted = predictGhostAugmentOffer(ghostConfig, BALANCE);
    expect(predicted).not.toBeNull();
    expect(predicted!.length).toBe(BALANCE.augment.choiceCount);

    const transformed = transformGhostCommands(record, ghostConfig, BALANCE);
    const choice = transformed.find((c) => c.command.type === 'choose-augment');
    expect(choice).toBeDefined();
    if (choice && choice.command.type === 'choose-augment') {
      expect(choice.command.augmentId).toBe(predicted![0]);
      expect(choice.command.augmentId).not.toBe('augment-original-pick');
    }
  });

  it('the ghost config carries the record\'s player deck/champion/scaling under ghost-<id>', () => {
    const scaled: BattleConfig = {
      ...config,
      player: {
        ...config.player,
        championLane: 1,
        championScaling: {
          attackDamageMult: 1.05,
          abilityCooldownMult: 0.97,
          maxHealthMult: 1.02,
          moveSpeedMult: 1.01,
          ultimateChargeMult: 1.03,
        },
      },
    };
    const record = { ...makeRecord(scaled, []), commands: [] };
    const setup = buildGhostBattleSetup(record, 424242, 'p2', {}, BALANCE);
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;
    expect(setup.config.seed).toBe(424242);
    expect(setup.config.opponent.playerId).toBe('ghost-p1');
    expect(setup.config.opponent.deckCardIds).toEqual(DEFAULT_DECK_CARD_IDS);
    expect(setup.config.opponent.championId).toBe('champion-titan');
    expect(setup.config.opponent.championLane).toBe(1);
    expect(setup.config.opponent.championScaling).toEqual(scaled.player.championScaling);
    expect(setup.config.player.playerId).toBe('p2');
  });

  it('fails safely on balance-version mismatch and on unusable configs', () => {
    const record = makeTransformRecord();
    const stale = { ...record, balanceVersion: '0.0.1' };
    const staleResult = buildGhostBattleSetup(stale, 1, 'p2', {}, BALANCE);
    expect(staleResult.ok).toBe(false);
    if (!staleResult.ok) expect(staleResult.reason).toContain('balance');

    const badDeck: BattleRecord = {
      ...record,
      config: { ...record.config, player: { playerId: 'p1', deckCardIds: ['forge-recruit'] } },
    };
    const badResult = buildGhostBattleSetup(badDeck, 1, 'p2', {}, BALANCE);
    expect(badResult.ok).toBe(false);
  });
});

describe('ghost battles — full runs', () => {
  it('runs headless to completion: zero invariant violations, digest-identical rerun, no ghost deploy rejections', () => {
    // Deckless source battle: without a hand constraint every mirrored ghost
    // deploy is guaranteed accepted (energy timelines match), which lets us
    // assert the strongest form of transform validity.
    const sourceConfig: BattleConfig = {
      seed: 777,
      player: { playerId: 'p1' },
      opponent: { playerId: 'foe' },
    };
    const sourceCommands: ScheduledCommand[] = [
      { tick: 20, command: { type: 'deploy-card', team: 'player', cardId: 'forge-recruit', lane: 0, x: 10 } },
      { tick: 120, command: { type: 'deploy-card', team: 'player', cardId: 'titan-guard', lane: 1, x: 0 } },
      { tick: 400, command: { type: 'deploy-card', team: 'player', cardId: 'cardio-runner', lane: 0, x: deployZoneDepth } },
      { tick: 900, command: { type: 'deploy-card', team: 'player', cardId: 'drone-archer', lane: 1, x: 25 } },
    ];
    const record = makeRecord(sourceConfig, sourceCommands);

    const created = createGhostLiveBattle(record, 31337, 'p2');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const live = created.live;

    // The human player fights back through the normal command path.
    stepLiveBattle(live, 30);
    expect(queuePlayerDeploy(live, 'neon-boxer', 0, 12).ok).toBe(true);
    stepLiveBattle(live, WORST_CASE_TICKS);
    expect(live.state.phase).toBe('finished');

    // Every pre-scheduled ghost command landed (deckless → nothing to reject).
    expect(live.rejected).toEqual([]);

    // The live command log replays digest-identically through runBattle,
    // with zero invariant violations — the M8 fidelity requirement.
    const rerun = runBattle(live.config, live.commandLog, BALANCE);
    expect(rerun.stalled).toBe(false);
    expect(rerun.invariantViolations).toEqual([]);
    expect(rerun.digest).toBe(liveDigest(live));
    expect(rerun.outcome).toEqual(live.state.outcome);
  });

  it('ghost battles are deterministic: same record + same seed → identical digests', () => {
    const sourceConfig: BattleConfig = {
      seed: 555,
      player: { playerId: 'p1', deckCardIds: DEFAULT_DECK_CARD_IDS, championId: 'champion-titan' },
      opponent: { playerId: 'foe', deckCardIds: DEFAULT_DECK_CARD_IDS, championId: 'champion-speedster' },
    };
    const sourceCommands: ScheduledCommand[] = [
      { tick: 20, command: { type: 'deploy-card', team: 'player', cardId: 'forge-recruit', lane: 0, x: 10 } },
      { tick: 300, command: { type: 'champion-ability', team: 'player' } },
    ];
    const record = makeRecord(sourceConfig, sourceCommands);

    function playGhost(): number {
      const created = createGhostLiveBattle(record, 20262026, 'p2', {
        playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
        playerChampionId: 'champion-hybrid',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error('unreachable');
      stepLiveBattle(created.live, WORST_CASE_TICKS);
      expect(created.live.state.phase).toBe('finished');
      return liveDigest(created.live);
    }

    expect(playGhost()).toBe(playGhost());
  });

  it('the ghost chooses the first augment of its OWN runtime offer', () => {
    // Two idle armies never breach a core, so the battle crosses the offer
    // tick; the recorded player choice at offerTick+2 becomes the ghost's
    // re-picked choice.
    const sourceConfig: BattleConfig = {
      seed: 4242,
      player: { playerId: 'p1' },
      opponent: { playerId: 'foe' },
    };
    // Learn the original player's offer with a probe run (choose-augment
    // consumes no RNG, so offers are identical across the two runs).
    const probe = runBattle(sourceConfig, [], BALANCE);
    const originalOffer = probe.state.teams.player.augment.offeredIds;
    expect(originalOffer).not.toBeNull();

    const sourceCommands: ScheduledCommand[] = [
      {
        tick: BALANCE.augment.offerTick + 2,
        command: { type: 'choose-augment', team: 'player', augmentId: originalOffer![0] },
      },
    ];
    const record = makeRecord(sourceConfig, sourceCommands);

    const setup = buildGhostBattleSetup(record, 616161, 'p2', {}, BALANCE);
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;

    const ghostRun = runBattle(setup.config, setup.commands, BALANCE);
    expect(ghostRun.invariantViolations).toEqual([]);
    const opponentAugment = ghostRun.state.teams.opponent.augment;
    expect(opponentAugment.offeredIds).not.toBeNull();
    // Chosen, from its own offer, via the deterministic first-offered rule.
    expect(opponentAugment.chosenId).toBe(opponentAugment.offeredIds![0]);
    expect(opponentAugment.chosenAtTick).toBe(BALANCE.augment.offerTick + 2);
  });
});

describe('ghost battles — offline store flow', () => {
  function makeThrowingProvider(): { provider: EvoForgePlayerProvider; calls: string[] } {
    const calls: string[] = [];
    const provider: EvoForgePlayerProvider = {
      async getCurrentPlayer(): Promise<PlayerProfile> {
        calls.push('getCurrentPlayer');
        throw new Error('ghost battles must not touch the provider');
      },
      async getFitnessProfile(): Promise<FitnessProfile> {
        calls.push('getFitnessProfile');
        throw new Error('ghost battles must not touch the provider');
      },
      async getGymProfile(): Promise<GymProfile | null> {
        calls.push('getGymProfile');
        return null;
      },
      async getGymMembers() {
        calls.push('getGymMembers');
        return [];
      },
      async listRivalGyms() {
        calls.push('listRivalGyms');
        return [];
      },
      async recordBattleResult(result: BattleResult): Promise<void> {
        calls.push(`recordBattleResult:${result.mode}`);
      },
    };
    return { provider, calls };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs fully offline (zero provider calls) and persists a ghost-mode record that verifies', async () => {
    const sourceConfig: BattleConfig = {
      seed: 888,
      player: { playerId: 'p1' },
      opponent: { playerId: 'foe' },
    };
    const record = makeRecord(sourceConfig, [
      { tick: 20, command: { type: 'deploy-card', team: 'player', cardId: 'forge-recruit', lane: 0, x: 10 } },
      { tick: 200, command: { type: 'deploy-card', team: 'player', cardId: 'titan-guard', lane: 1, x: 5 } },
    ]);

    const { provider, calls } = makeThrowingProvider();
    const storage = new MemoryStorage();
    const store = createBattleStore({ current: provider }, { current: storage });

    const started = store.getState().startGhost(record, 121212, 'p2');
    expect(started.ok).toBe(true);
    expect(store.getState().mode).toBe('ghost');

    await vi.advanceTimersByTimeAsync((WORST_CASE_TICKS + 100) * 50);
    expect(store.getState().status).toBe('finished');
    await vi.advanceTimersByTimeAsync(10); // flush the persist chain

    // Fully offline: the provider was never consulted for anything.
    expect(calls).toEqual([]);

    // But the ghost battle itself WAS recorded — with snapshots derived from
    // the source record, and it verifies like any other record.
    const stored = await loadBattleRecords(storage);
    expect(stored.length).toBe(1);
    const ghostRecord = stored[0];
    expect(ghostRecord.debug?.mode).toBe('ghost');
    expect(ghostRecord.debug?.aiDifficulty).toBeNull();
    expect(ghostRecord.config.opponent.playerId).toBe('ghost-p1');
    expect(ghostRecord.opponentSnapshot.playerId).toBe('ghost-p1');
    expect(ghostRecord.opponentSnapshot.displayName).toBe('Ghost of Original');
    expect(ghostRecord.playerSnapshot.displayName).toBe('Original');
    const verified = verifyBattleRecord(ghostRecord, BALANCE);
    expect(verified.ok).toBe(true);

    store.getState().stop();
  });

  it('startGhost fails safely on an unusable record without touching store state', () => {
    const sourceConfig: BattleConfig = {
      seed: 999,
      player: { playerId: 'p1' },
      opponent: { playerId: 'foe' },
    };
    const record = { ...makeRecord(sourceConfig, []), balanceVersion: '0.0.1' };

    const { provider, calls } = makeThrowingProvider();
    const store = createBattleStore({ current: provider }, { current: new MemoryStorage() });

    const started = store.getState().startGhost(record, 1, 'p2');
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.reason).toContain('balance');
    expect(store.getState().status).toBe('idle');
    expect(store.getState().live).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('null/non-object command elements (Opus replay-review fuzz)', () => {
  it('transformGhostCommands and buildGhostBattleSetup skip poisoned entries without throwing', () => {
    const config: BattleConfig = {
      seed: 555,
      player: { playerId: 'p1' },
      opponent: { playerId: 'ai-standard' },
    };
    const commands: ScheduledCommand[] = [
      { tick: 20, command: { type: 'deploy-card', team: 'player', cardId: 'forge-recruit', lane: 0, x: 10 } },
    ];
    const record = makeRecord(config, commands);
    // Poison the array the way hostile JSON could.
    const poisoned = {
      ...record,
      commands: [
        null,
        42,
        {},
        { tick: 5 },
        { tick: 6, command: null },
        ...record.commands,
      ] as unknown as ScheduledCommand[],
    };
    const transformed = transformGhostCommands(poisoned, {
      seed: 1,
      player: { playerId: 'p2' },
      opponent: { playerId: 'ghost-p1' },
    }, BALANCE);
    // Only the one legitimate player command survives, team-swapped.
    expect(transformed.length).toBe(1);
    expect(transformed[0].command.team).toBe('opponent');

    const setup = buildGhostBattleSetup(poisoned, 2, 'p2', {}, BALANCE);
    expect(setup.ok).toBe(true); // skips garbage, never throws
  });

  it('runBattle skips null schedule entries without throwing', () => {
    const config: BattleConfig = {
      seed: 556,
      player: { playerId: 'p1' },
      opponent: { playerId: 'p2' },
    };
    const poisoned = [null, 7, { tick: NaN }] as unknown as ScheduledCommand[];
    const result = runBattle(config, poisoned, BALANCE);
    expect(result.stalled).toBe(false);
    expect(['player', 'opponent', 'draw']).toContain(result.outcome.winner);
  });
});

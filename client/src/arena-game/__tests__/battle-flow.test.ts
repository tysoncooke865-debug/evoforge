/**
 * Milestone 3 tests — pure TS only (controller + store), no React/RN import.
 * Verifies the live battle path replays identically through the headless
 * runner, is itself deterministic, rejects invalid commands with clear
 * reasons, restart fully isolates old/new battles, and the store records a
 * battle result exactly once via an injected provider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../content';
import {
  createLiveBattle,
  liveDigest,
  queuePlayerDeploy,
  stepLiveBattle,
} from '../features/arena/battle-controller';
import { createBattleStore } from '../features/arena/battle-store';
import { runBattle } from '../game-engine/simulation/run';
import type {
  BattleResult,
  EvoForgePlayerProvider,
  FitnessProfile,
  GymProfile,
  PlayerProfile,
} from '../integration/evoforge/types';

const SEED = 42;
const PLAYER_ID = 'p1';
const OPPONENT_ID = 'scripted-opponent';

/** Enough ticks to guarantee any battle has reached 'finished' (timeout + sudden death + margin). */
const WORST_CASE_TICKS = BALANCE.battle.durationTicks + BALANCE.battle.suddenDeathTicks + 20;

describe('live battle replay fidelity', () => {
  it('stepped headless to completion matches runBattle(config, commandLog, BALANCE)', () => {
    const live = createLiveBattle(SEED, PLAYER_ID);

    stepLiveBattle(live, 20);
    expect(queuePlayerDeploy(live, 'forge-recruit', 0, 10).ok).toBe(true);

    stepLiveBattle(live, 80);
    expect(queuePlayerDeploy(live, 'titan-guard', 1, 5).ok).toBe(true);

    stepLiveBattle(live, 300);
    expect(queuePlayerDeploy(live, 'cardio-runner', 0, 20).ok).toBe(true);

    stepLiveBattle(live, WORST_CASE_TICKS);

    expect(live.state.phase).toBe('finished');
    expect(live.rejected).toEqual([]); // every scripted deploy above must actually land

    const rerun = runBattle(
      { seed: SEED, player: { playerId: PLAYER_ID }, opponent: { playerId: OPPONENT_ID } },
      live.commandLog,
      BALANCE
    );

    expect(rerun.outcome).toEqual(live.state.outcome);
    expect(rerun.digest).toBe(liveDigest(live));
  });

  it('same seed and same player inputs at the same ticks produce identical digests', () => {
    function playThrough(): { digest: number; outcome: unknown } {
      const live = createLiveBattle(SEED, PLAYER_ID);
      stepLiveBattle(live, 20);
      queuePlayerDeploy(live, 'forge-recruit', 0, 10);
      stepLiveBattle(live, 80);
      queuePlayerDeploy(live, 'titan-guard', 1, 5);
      stepLiveBattle(live, WORST_CASE_TICKS);
      return { digest: liveDigest(live), outcome: live.state.outcome };
    }

    const a = playThrough();
    const b = playThrough();
    expect(a.digest).toBe(b.digest);
    expect(a.outcome).toEqual(b.outcome);
  });
});

describe('queuePlayerDeploy rejections', () => {
  it('rejects once the battle is finished', () => {
    const live = createLiveBattle(SEED, PLAYER_ID);
    stepLiveBattle(live, WORST_CASE_TICKS);
    expect(live.state.phase).toBe('finished');

    const result = queuePlayerDeploy(live, 'forge-recruit', 0, 10);
    expect(result).toEqual({ ok: false, reason: 'battle is over' });
  });

  it('rejects a deploy position outside the deploy zone', () => {
    const live = createLiveBattle(SEED, PLAYER_ID);
    const result = queuePlayerDeploy(live, 'forge-recruit', 0, 50);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/outside deploy zone/);
  });

  it('rejects a card that costs more than the current Forge Energy', () => {
    const live = createLiveBattle(SEED, PLAYER_ID);
    expect(BALANCE.energy.startingEnergy).toBeLessThan(6); // heavy-tank costs 6
    const result = queuePlayerDeploy(live, 'heavy-tank', 0, 10);
    expect(result).toEqual({ ok: false, reason: 'Not enough Forge Energy' });
  });
});

describe('battle store restart', () => {
  it('produces a fresh, independent battle; the old battle keeps its state', () => {
    const store = createBattleStore();
    store.getState().start(1, PLAYER_ID);
    const liveA = store.getState().live!;
    stepLiveBattle(liveA, 50);
    expect(liveA.state.tick).toBe(50);

    store.getState().restart(2, PLAYER_ID);
    const liveB = store.getState().live!;

    expect(liveB).not.toBe(liveA);
    expect(liveB.state.tick).toBe(0);
    expect(liveA.state.tick).toBe(50); // untouched by restart

    const state = store.getState();
    expect(state.status).toBe('running');
    expect(state.version).toBe(0);
    expect(state.selectedCardId).toBeNull();
    expect(state.lastRejection).toBeNull();

    store.getState().stop();
  });
});

describe('battle store result recording', () => {
  function makeFakeProvider(): { provider: EvoForgePlayerProvider; calls: BattleResult[] } {
    const calls: BattleResult[] = [];
    const provider: EvoForgePlayerProvider = {
      async getCurrentPlayer(): Promise<PlayerProfile> {
        throw new Error('not used by this test');
      },
      async getFitnessProfile(): Promise<FitnessProfile> {
        throw new Error('not used by this test');
      },
      async getGymProfile(): Promise<GymProfile | null> {
        return null;
      },
      async getGymMembers() {
        return [];
      },
      async listRivalGyms() {
        return [];
      },
      async recordBattleResult(result: BattleResult): Promise<void> {
        calls.push(result);
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

  it('records the result exactly once, through the injected provider, when the battle finishes', async () => {
    const { provider, calls } = makeFakeProvider();
    const store = createBattleStore({ current: provider });

    store.getState().start(SEED, PLAYER_ID);
    expect(store.getState().status).toBe('running');

    // Advance well past the worst-case battle length so the loop's own
    // setInterval drives it all the way to 'finished'.
    const totalMs = (WORST_CASE_TICKS + 100) * 50;
    await vi.advanceTimersByTimeAsync(totalMs);

    expect(store.getState().status).toBe('finished');
    expect(calls.length).toBe(1);
    expect(calls[0].playerId).toBe(PLAYER_ID);
    expect(calls[0].mode).toBe('standard');
    expect(calls[0].balanceVersion).toBe(BALANCE.balanceVersion);

    // The loop is stopped on finish; further elapsed time must not re-record.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.length).toBe(1);

    store.getState().stop();
  });
});

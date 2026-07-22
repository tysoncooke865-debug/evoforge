/**
 * Milestone 8 tests — replay-viewer stepping logic. The pure replay player
 * must advance a record's schedule in ANY chunk size (the viewer steps N
 * ticks per frame depending on speed) and land on exactly the state one-shot
 * runBattle produces — same digest, same outcome, same rejections.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../content';
import {
  createReplayPlayer,
  replayDigest,
  replayFinished,
  stepReplay,
} from '../features/arena/replay-player';
import type { ScheduledCommand } from '../game-engine/simulation/events';
import {
  BATTLE_RECORD_SCHEMA_VERSION,
  BattleRecord,
  verifyBattleRecord,
} from '../game-engine/simulation/replay';
import { runBattle } from '../game-engine/simulation/run';
import type { BattleConfig } from '../game-engine/simulation/state';
import { DEFAULT_DECK_CARD_IDS } from '../services/persistence/save';

function makeRecord(): BattleRecord {
  const config: BattleConfig = {
    seed: 20260722,
    player: { playerId: 'p1', deckCardIds: DEFAULT_DECK_CARD_IDS, championId: 'champion-titan' },
    opponent: {
      playerId: 'o1',
      deckCardIds: DEFAULT_DECK_CARD_IDS,
      championId: 'champion-shredder',
    },
  };
  const commands: ScheduledCommand[] = [
    { tick: 20, command: { type: 'deploy-card', team: 'player', cardId: 'forge-recruit', lane: 0, x: 10 } },
    { tick: 60, command: { type: 'deploy-card', team: 'opponent', cardId: 'forge-recruit', lane: 0, x: 90 } },
    { tick: 200, command: { type: 'champion-ability', team: 'player' } },
    { tick: 400, command: { type: 'deploy-card', team: 'player', cardId: 'cardio-runner', lane: 1, x: 20 } },
  ];
  const result = runBattle(config, commands, BALANCE);
  return {
    schemaVersion: BATTLE_RECORD_SCHEMA_VERSION,
    balanceVersion: BALANCE.balanceVersion,
    seed: config.seed,
    config,
    playerSnapshot: { playerId: 'p1', displayName: 'Tester', championId: 'champion-titan', rankPoints: 0 },
    opponentSnapshot: { playerId: 'o1', displayName: 'Rival', championId: 'champion-shredder', rankPoints: 0 },
    commands,
    outcome: result.outcome,
    digest: result.digest,
    recordedAt: '2026-07-22T00:00:00.000Z',
  };
}

describe('replay player stepping', () => {
  it('advancing in any chunk size reproduces the one-shot runBattle digest and outcome', () => {
    const record = makeRecord();
    expect(verifyBattleRecord(record, BALANCE).ok).toBe(true);

    // Chunk sizes covering all viewer speeds (1x/2x/4x per 50ms frame) plus
    // catch-up bursts and an uneven size.
    for (const chunk of [1, 2, 4, 7, 20]) {
      const built = createReplayPlayer(record);
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      const player = built.player;

      let guard = 0;
      while (!replayFinished(player)) {
        stepReplay(player, chunk);
        if (++guard > 100000) throw new Error('replay player failed to finish');
      }

      expect(replayDigest(player)).toBe(record.digest);
      expect(player.state.outcome).toEqual(record.outcome);
      expect(player.state.tick).toBe(record.outcome.endTick);
    }
  });

  it('stepping past the end is a harmless no-op', () => {
    const record = makeRecord();
    const built = createReplayPlayer(record);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const player = built.player;

    stepReplay(player, 1_000_000); // way past the end in one call
    expect(replayFinished(player)).toBe(true);
    const digestAtEnd = replayDigest(player);

    expect(stepReplay(player, 50)).toBe(0);
    expect(replayDigest(player)).toBe(digestAtEnd);
    expect(player.state.outcome).toEqual(record.outcome);
  });

  it('restarting from the record reproduces the exact same playback', () => {
    const record = makeRecord();
    const a = createReplayPlayer(record);
    const b = createReplayPlayer(record);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    stepReplay(a.player, 500);
    stepReplay(b.player, 250);
    stepReplay(b.player, 250);
    expect(replayDigest(a.player)).toBe(replayDigest(b.player));
    expect(a.player.state.tick).toBe(b.player.state.tick);
  });

  it('fails safely (no throw) on a record whose config cannot construct a battle', () => {
    const record = makeRecord();
    const broken: BattleRecord = {
      ...record,
      config: {
        ...record.config,
        player: { playerId: 'p1', deckCardIds: ['forge-recruit'] }, // invalid deck size
      },
    };
    const built = createReplayPlayer(broken);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toContain('replay failed to start');
  });
});

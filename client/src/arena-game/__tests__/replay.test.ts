import { describe, expect, it } from 'vitest';
import { BALANCE } from '../content';
import type { ScheduledCommand } from '../game-engine/simulation/events';
import {
  BATTLE_RECORD_SCHEMA_VERSION,
  BattleRecord,
  parseBattleRecord,
  serializeBattleRecord,
  verifyBattleRecord,
} from '../game-engine/simulation/replay';
import { runBattle } from '../game-engine/simulation/run';
import { DEFAULT_DECK_CARD_IDS } from '../services/persistence/save';

function makeRecord(): BattleRecord {
  const config = {
    seed: 20260722,
    player: { playerId: 'p1', deckCardIds: DEFAULT_DECK_CARD_IDS },
    opponent: { playerId: 'ghost-1', deckCardIds: DEFAULT_DECK_CARD_IDS },
  };
  const commands: ScheduledCommand[] = [
    { tick: 20, command: { type: 'deploy-card', team: 'player', cardId: 'forge-recruit', lane: 0, x: 10 } },
    { tick: 30, command: { type: 'deploy-card', team: 'opponent', cardId: 'forge-recruit', lane: 0, x: 90 } },
    { tick: 400, command: { type: 'deploy-card', team: 'player', cardId: 'cardio-runner', lane: 1, x: 20 } },
  ];
  const result = runBattle(config, commands, BALANCE);
  return {
    schemaVersion: BATTLE_RECORD_SCHEMA_VERSION,
    balanceVersion: BALANCE.balanceVersion,
    seed: config.seed,
    config,
    playerSnapshot: { playerId: 'p1', displayName: 'Tester', championId: null, rankPoints: 0 },
    opponentSnapshot: { playerId: 'ghost-1', displayName: 'Ghost', championId: null, rankPoints: 0 },
    commands,
    outcome: result.outcome,
    digest: result.digest,
    recordedAt: '2026-07-22T00:00:00.000Z',
  };
}

describe('battle records', () => {
  it('serialize → parse → verify round-trips and reproduces the battle', () => {
    const record = makeRecord();
    const parsed = parseBattleRecord(serializeBattleRecord(record));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const verified = verifyBattleRecord(parsed.record, BALANCE);
    expect(verified).toEqual({ ok: true, outcome: record.outcome, digest: record.digest });
  });

  it('detects a tampered command stream (digest mismatch)', () => {
    const record = makeRecord();
    // Attacker nudges one deploy a few units forward.
    const tampered: BattleRecord = {
      ...record,
      commands: record.commands.map((c, i) =>
        i === 0 && c.command.type === 'deploy-card'
          ? { ...c, command: { ...c.command, x: c.command.x + 5 } }
          : c
      ),
    };
    const verified = verifyBattleRecord(tampered, BALANCE);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toContain('digest mismatch');
  });

  it('detects a tampered outcome (claimed win, actual loss)', () => {
    const record = makeRecord();
    const tampered: BattleRecord = { ...record, digest: record.digest ^ 0xdeadbeef };
    const verified = verifyBattleRecord(tampered, BALANCE);
    expect(verified.ok).toBe(false);
  });

  it('refuses to verify across balance versions', () => {
    const record = { ...makeRecord(), balanceVersion: '0.0.1' };
    const verified = verifyBattleRecord(record, BALANCE);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toContain('balance version mismatch');
  });

  it('parses fail safely on garbage', () => {
    expect(parseBattleRecord('{not json').ok).toBe(false);
    expect(parseBattleRecord('null').ok).toBe(false);
    expect(parseBattleRecord('42').ok).toBe(false);
    expect(parseBattleRecord(JSON.stringify({ schemaVersion: 99 })).ok).toBe(false);
    expect(
      parseBattleRecord(JSON.stringify({ schemaVersion: 1, balanceVersion: '0.3.0' })).ok
    ).toBe(false);
  });

  it('rejects records whose config seed disagrees with the top-level seed', () => {
    const record = makeRecord();
    const mangled = { ...record, seed: record.seed + 1 };
    const parsed = parseBattleRecord(serializeBattleRecord(mangled));
    expect(parsed.ok).toBe(false);
  });

  it('accepts the optional M8 fields (recordId, debug) and round-trips them', () => {
    const record: BattleRecord = {
      ...makeRecord(),
      recordId: 'battle-20260722-1234',
      debug: { rejectedCount: 3, mode: 'ghost', aiDifficulty: null },
    };
    const parsed = parseBattleRecord(serializeBattleRecord(record));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.record.recordId).toBe('battle-20260722-1234');
    expect(parsed.record.debug).toEqual({ rejectedCount: 3, mode: 'ghost', aiDifficulty: null });
    // Optional fields never affect verification (they are outside the sim).
    expect(verifyBattleRecord(parsed.record, BALANCE).ok).toBe(true);
  });

  it('still accepts records WITHOUT the optional M8 fields', () => {
    const record = makeRecord(); // no recordId, no debug
    expect(record.recordId).toBeUndefined();
    const parsed = parseBattleRecord(serializeBattleRecord(record));
    expect(parsed.ok).toBe(true);
  });

  it('rejects malformed optional fields when present', () => {
    const base = makeRecord();
    const badId = { ...base, recordId: 42 };
    expect(parseBattleRecord(JSON.stringify(badId)).ok).toBe(false);

    const badDebugs: unknown[] = [
      'debug-me',
      { rejectedCount: 'many', mode: 'standard', aiDifficulty: null },
      { rejectedCount: 0, mode: 'time-travel', aiDifficulty: null },
      { rejectedCount: 0, mode: 'standard', aiDifficulty: 7 },
    ];
    for (const debug of badDebugs) {
      const bad = { ...base, debug };
      expect(parseBattleRecord(JSON.stringify(bad)).ok).toBe(false);
    }
  });

  it('a record with an invalid deck fails verification safely (no throw)', () => {
    const record = makeRecord();
    const bad: BattleRecord = {
      ...record,
      config: {
        ...record.config,
        player: { playerId: 'p1', deckCardIds: ['forge-recruit'] }, // invalid deck size
      },
    };
    const verified = verifyBattleRecord(bad, BALANCE);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toContain('replay failed to run');
  });
});

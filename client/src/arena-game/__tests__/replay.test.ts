import { describe, expect, it } from 'vitest';
import { BALANCE } from '../content';
import type { ScheduledCommand } from '../game-engine/simulation/events';
import {
  BATTLE_RECORD_SCHEMA_VERSION,
  BattleRecord,
  MAX_RECORD_COMMANDS,
  parseBattleRecord,
  serializeBattleRecord,
  validateBattleRecordValue,
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

  it('caps the command count — hostile padding cannot stall re-simulation (P4)', () => {
    // Re-sim cost is O(ticks × commands); an unbounded record could freeze
    // the UI thread for minutes. The cap is orders of magnitude above any
    // legitimate battle (~20 commands/minute, 4-minute max).
    const record = makeRecord();
    const noop = { tick: 1, command: { type: 'noop', team: 'player' } };
    const atCap = {
      ...record,
      commands: Array.from({ length: MAX_RECORD_COMMANDS }, () => noop),
    };
    expect(validateBattleRecordValue(atCap).ok).toBe(true); // boundary passes
    const overCap = {
      ...record,
      commands: Array.from({ length: MAX_RECORD_COMMANDS + 1 }, () => noop),
    };
    const rejected = validateBattleRecordValue(overCap);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toContain('too many commands');
  });

  it('rejects non-finite, out-of-bounds or partial champion scaling in any config slot (P4)', () => {
    const record = makeRecord();
    const neutral = {
      attackDamageMult: 1,
      maxHealthMult: 1,
      moveSpeedMult: 1,
      abilityCooldownMult: 1,
      ultimateChargeMult: 1,
    };
    const withPlayerScaling = (championScaling: unknown) => ({
      ...record,
      config: { ...record.config, player: { ...record.config.player, championScaling } },
    });

    // Well-formed scaling still parses.
    expect(validateBattleRecordValue(withPlayerScaling(neutral)).ok).toBe(true);

    // 1e999 in raw JSON parses to Infinity — the exact hostile vector.
    const json = serializeBattleRecord(withPlayerScaling(neutral) as unknown as BattleRecord)
      .replace('"maxHealthMult":1', '"maxHealthMult":1e999');
    const hostile = parseBattleRecord(json);
    expect(hostile.ok).toBe(false);
    if (!hostile.ok) expect(hostile.reason).toContain('champion scaling');

    const badScalings: unknown[] = [
      { ...neutral, maxHealthMult: Infinity },
      { ...neutral, attackDamageMult: NaN },
      { ...neutral, moveSpeedMult: -1 },
      { ...neutral, abilityCooldownMult: 0 }, // below the sanity floor
      { ...neutral, ultimateChargeMult: 1000 }, // above the sanity ceiling
      { maxHealthMult: 1.05 }, // partial: missing fields multiply as NaN
      'scale-me',
      42,
    ];
    for (const scaling of badScalings) {
      expect(
        validateBattleRecordValue(withPlayerScaling(scaling)).ok,
        JSON.stringify(scaling)
      ).toBe(false);
    }

    // Squad slots are validated too (captain + borrowed).
    const squadRecord = {
      ...record,
      config: {
        ...record.config,
        opponent: {
          ...record.config.opponent,
          squad: {
            captain: { championId: 'champion-titan', scaling: neutral },
            borrowed: [
              {
                championId: 'champion-cardio',
                lane: 1,
                scaling: { ...neutral, maxHealthMult: Infinity },
              },
            ],
          },
        },
      },
    };
    expect(validateBattleRecordValue(squadRecord).ok).toBe(false);
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

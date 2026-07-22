/**
 * Milestone 8 tests — battle-record persistence (ring buffer under one
 * storage key, versioned envelope, fail-safe loading) and the battle store's
 * recording behaviour (standard battles persist a verifiable record;
 * tutorial battles never do).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../content';
import {
  BATTLE_RECORD_SCHEMA_VERSION,
  BattleRecord,
  verifyBattleRecord,
} from '../game-engine/simulation/replay';
import { createBattleStore } from '../features/arena/battle-store';
import type {
  BattleResult,
  EvoForgePlayerProvider,
  FitnessProfile,
  GymProfile,
  PlayerProfile,
} from '../integration/evoforge/types';
import {
  appendBattleRecord,
  BATTLE_RECORDS_KEY,
  BATTLE_RECORDS_VERSION,
  battleRecordKey,
  clearBattleRecords,
  estimateBattleRecordsSize,
  loadBattleRecords,
  MAX_BATTLE_RECORDS,
} from '../services/persistence/battle-records';
import { KeyValueStorage, MemoryStorage } from '../services/persistence/storage';

/** A structurally valid record with fabricated numbers — persistence tests
 *  only need parse-validity, not verification-validity. */
function makeStoredRecord(n: number): BattleRecord {
  return {
    schemaVersion: BATTLE_RECORD_SCHEMA_VERSION,
    balanceVersion: BALANCE.balanceVersion,
    seed: n,
    config: { seed: n, player: { playerId: 'p1' }, opponent: { playerId: 'o1' } },
    playerSnapshot: { playerId: 'p1', displayName: 'Tester', championId: null, rankPoints: 0 },
    opponentSnapshot: { playerId: 'o1', displayName: 'Rival', championId: null, rankPoints: 0 },
    commands: [],
    outcome: {
      winner: 'draw',
      reason: 'draw',
      endTick: 100,
      playerCoreHealth: 1,
      opponentCoreHealth: 1,
    },
    digest: n,
    recordedAt: '2026-07-22T00:00:00.000Z',
    recordId: `r-${n}`,
  };
}

describe('battle-record ring buffer', () => {
  it('appends and loads round-trip, oldest first', async () => {
    const storage = new MemoryStorage();
    await appendBattleRecord(storage, makeStoredRecord(1));
    await appendBattleRecord(storage, makeStoredRecord(2));
    const loaded = await loadBattleRecords(storage);
    expect(loaded.map((r) => r.recordId)).toEqual(['r-1', 'r-2']);
    expect(loaded[0]).toEqual(makeStoredRecord(1));
  });

  it(`caps at ${MAX_BATTLE_RECORDS} records, dropping the oldest`, async () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < MAX_BATTLE_RECORDS + 2; i++) {
      await appendBattleRecord(storage, makeStoredRecord(i));
    }
    const loaded = await loadBattleRecords(storage);
    expect(loaded.length).toBe(MAX_BATTLE_RECORDS);
    expect(loaded[0].recordId).toBe('r-2'); // r-0 and r-1 rotated out
    expect(loaded[loaded.length - 1].recordId).toBe(`r-${MAX_BATTLE_RECORDS + 1}`);
  });

  it('corrupt data loads as an empty list (never throws)', async () => {
    for (const garbage of ['{not json', 'null', '42', '{"foo":1}', '{"version":"x","records":[]}']) {
      const storage = new MemoryStorage();
      await storage.setItem(BATTLE_RECORDS_KEY, garbage);
      expect(await loadBattleRecords(storage)).toEqual([]);
    }
  });

  it('a storage backend that throws loads as an empty list', async () => {
    const broken: KeyValueStorage = {
      async getItem() {
        throw new Error('disk on fire');
      },
      async setItem() {},
      async removeItem() {},
      async getAllKeys() {
        return [];
      },
    };
    expect(await loadBattleRecords(broken)).toEqual([]);
    expect(await estimateBattleRecordsSize(broken)).toBe(0);
  });

  it('invalid records inside a valid envelope are dropped, valid ones kept', async () => {
    const storage = new MemoryStorage();
    const envelope = {
      version: BATTLE_RECORDS_VERSION,
      records: [makeStoredRecord(7), { schemaVersion: 99 }, 'garbage', null],
    };
    await storage.setItem(BATTLE_RECORDS_KEY, JSON.stringify(envelope));
    const loaded = await loadBattleRecords(storage);
    expect(loaded.map((r) => r.recordId)).toEqual(['r-7']);
  });

  it('refuses a newer envelope version: loads empty and append will not clobber it', async () => {
    const storage = new MemoryStorage();
    const newer = JSON.stringify({
      version: BATTLE_RECORDS_VERSION + 1,
      records: [{ futureField: true }],
    });
    await storage.setItem(BATTLE_RECORDS_KEY, newer);

    expect(await loadBattleRecords(storage)).toEqual([]);

    const result = await appendBattleRecord(storage, makeStoredRecord(1));
    expect(result).toEqual([]);
    // The newer build's data is untouched.
    expect(await storage.getItem(BATTLE_RECORDS_KEY)).toBe(newer);
  });

  it('clearBattleRecords empties the buffer', async () => {
    const storage = new MemoryStorage();
    await appendBattleRecord(storage, makeStoredRecord(1));
    await clearBattleRecords(storage);
    expect(await loadBattleRecords(storage)).toEqual([]);
    expect(await estimateBattleRecordsSize(storage)).toBe(0);
  });

  it('battleRecordKey prefers recordId and falls back to a deterministic composite', () => {
    const withId = makeStoredRecord(1);
    expect(battleRecordKey(withId)).toBe('r-1');
    const withoutId: BattleRecord = { ...withId };
    delete withoutId.recordId;
    expect(battleRecordKey(withoutId)).toBe(`${withoutId.seed}@${withoutId.recordedAt}`);
  });
});

describe('battle store recording (M8)', () => {
  function makeFakeProvider(): { provider: EvoForgePlayerProvider; results: BattleResult[] } {
    const results: BattleResult[] = [];
    const provider: EvoForgePlayerProvider = {
      async getCurrentPlayer(): Promise<PlayerProfile> {
        return {
          playerId: 'p1',
          displayName: 'Recorder',
          championId: 'champion-titan',
          rankPoints: 120,
        };
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
        results.push(result);
      },
    };
    return { provider, results };
  }

  const WORST_CASE_TICKS = BALANCE.battle.durationTicks + BALANCE.battle.suddenDeathTicks + 20;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a finished standard battle persists a record that verifies (balanceVersion + seed included)', async () => {
    const { provider } = makeFakeProvider();
    const storage = new MemoryStorage();
    const store = createBattleStore({ current: provider }, { current: storage });

    const SEED = 987654;
    store.getState().start(SEED, 'p1');
    await vi.advanceTimersByTimeAsync((WORST_CASE_TICKS + 100) * 50);
    expect(store.getState().status).toBe('finished');
    await vi.advanceTimersByTimeAsync(10); // flush the async persist chain

    const records = await loadBattleRecords(storage);
    expect(records.length).toBe(1);
    const record = records[0];

    // Acceptance criteria: the record carries balanceVersion + seed and
    // reproduces the battle bit-for-bit.
    expect(record.balanceVersion).toBe(BALANCE.balanceVersion);
    expect(record.seed).toBe(SEED);
    expect(record.schemaVersion).toBe(BATTLE_RECORD_SCHEMA_VERSION);
    const verified = verifyBattleRecord(record, BALANCE);
    expect(verified).toEqual({ ok: true, outcome: record.outcome, digest: record.digest });

    // Snapshots: player from the provider profile, opponent as the AI.
    expect(record.playerSnapshot).toEqual({
      playerId: 'p1',
      displayName: 'Recorder',
      championId: 'champion-titan',
      rankPoints: 120,
    });
    expect(record.opponentSnapshot.playerId).toBe('ai-standard');

    // Debug block: standard mode, real difficulty, rejection count.
    expect(record.debug).toEqual({ rejectedCount: 0, mode: 'standard', aiDifficulty: 'standard' });
    // Prefix is deterministic; the suffix makes same-seed battles collision-
    // proof for storage lookup (Opus replay-review finding).
    expect(record.recordId).toMatch(
      new RegExp(`^battle-${SEED}-${record.outcome.endTick}-[a-z0-9]+$`)
    );

    store.getState().stop();
  });

  it('a second finished battle appends a second record (and only one per battle)', async () => {
    const { provider } = makeFakeProvider();
    const storage = new MemoryStorage();
    const store = createBattleStore({ current: provider }, { current: storage });

    store.getState().start(11, 'p1');
    await vi.advanceTimersByTimeAsync((WORST_CASE_TICKS + 100) * 50);
    store.getState().restart(22, 'p1');
    await vi.advanceTimersByTimeAsync((WORST_CASE_TICKS + 100) * 50);
    await vi.advanceTimersByTimeAsync(10);

    const records = await loadBattleRecords(storage);
    expect(records.map((r) => r.seed)).toEqual([11, 22]);

    store.getState().stop();
  });

  it('tutorial battles are NOT recorded as battle records', async () => {
    const { provider, results } = makeFakeProvider();
    const storage = new MemoryStorage();
    const store = createBattleStore({ current: provider }, { current: storage });

    store.getState().start(555, 'p1', { aiDifficulty: 'training' }, 'tutorial');
    await vi.advanceTimersByTimeAsync((WORST_CASE_TICKS + 100) * 50);
    expect(store.getState().status).toBe('finished');
    await vi.advanceTimersByTimeAsync(10);

    expect(await loadBattleRecords(storage)).toEqual([]);
    // The provider still hears about the battle (as a tutorial result).
    expect(results.length).toBe(1);
    expect(results[0].mode).toBe('tutorial');

    store.getState().stop();
  });
});

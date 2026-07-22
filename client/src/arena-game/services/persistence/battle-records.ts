/**
 * Battle-record persistence (M8) — a ring buffer of the last
 * MAX_BATTLE_RECORDS finished battles under a single storage key, wrapped in
 * a versioned envelope `{ version: 1, records: [...] }`.
 *
 * Fail-safe rules (mirroring save.ts):
 *  - Loading NEVER throws: corrupt/missing/malformed data → empty list.
 *  - An envelope from a NEWER app build is refused on load (empty list) and
 *    appendBattleRecord will not overwrite it — running an old build must
 *    never destroy a newer build's data.
 *  - Individual records inside a valid envelope are re-validated with the
 *    same untrusted-data validator replays use; invalid entries are dropped.
 *
 * Consumers depend on the KeyValueStorage interface only (AsyncStorage in
 * the app, MemoryStorage in tests) — never on AsyncStorage directly.
 */
import {
  BattleRecord,
  validateBattleRecordValue,
} from '../../game-engine/simulation/replay';
import type { KeyValueStorage } from './storage';

export const BATTLE_RECORDS_KEY = 'evoforge-arena/battle-records';
export const BATTLE_RECORDS_VERSION = 1;
/** Ring-buffer capacity: only the most recent records are kept. */
export const MAX_BATTLE_RECORDS = 10;

interface BattleRecordsEnvelope {
  version: number;
  records: BattleRecord[];
}

/** Parses the stored envelope; null means "unusable" (corrupt or missing). */
function parseEnvelope(raw: string | null): { version: number; records: unknown[] } | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const env = parsed as Partial<BattleRecordsEnvelope>;
  if (typeof env.version !== 'number' || !Array.isArray(env.records)) return null;
  return { version: env.version, records: env.records };
}

/**
 * Loads all stored records, oldest first. Corrupt data, storage errors and
 * newer-version envelopes all yield an empty list — never a throw.
 */
export async function loadBattleRecords(storage: KeyValueStorage): Promise<BattleRecord[]> {
  let raw: string | null = null;
  try {
    raw = await storage.getItem(BATTLE_RECORDS_KEY);
  } catch {
    return [];
  }
  const envelope = parseEnvelope(raw);
  if (envelope === null || envelope.version !== BATTLE_RECORDS_VERSION) return [];
  const records: BattleRecord[] = [];
  for (const entry of envelope.records) {
    const result = validateBattleRecordValue(entry);
    if (result.ok) records.push(result.record);
  }
  return records;
}

/**
 * Appends a record, dropping the oldest beyond MAX_BATTLE_RECORDS, and
 * returns the new list. Refuses (no-op) when the stored envelope comes from
 * a newer app build — an old build must not clobber newer data. Storage
 * write errors propagate (callers decide how loudly to fail).
 */
export async function appendBattleRecord(
  storage: KeyValueStorage,
  record: BattleRecord
): Promise<BattleRecord[]> {
  let raw: string | null = null;
  try {
    raw = await storage.getItem(BATTLE_RECORDS_KEY);
  } catch {
    raw = null; // unreadable ≠ newer; treat as empty and rewrite below
  }
  const envelope = parseEnvelope(raw);
  if (envelope !== null && envelope.version > BATTLE_RECORDS_VERSION) {
    return []; // newer build's data — leave it untouched
  }
  const records: BattleRecord[] = [];
  if (envelope !== null && envelope.version === BATTLE_RECORDS_VERSION) {
    for (const entry of envelope.records) {
      const result = validateBattleRecordValue(entry);
      if (result.ok) records.push(result.record);
    }
  }
  records.push(record);
  const kept = records.slice(-MAX_BATTLE_RECORDS);
  const next: BattleRecordsEnvelope = { version: BATTLE_RECORDS_VERSION, records: kept };
  await storage.setItem(BATTLE_RECORDS_KEY, JSON.stringify(next));
  return kept;
}

export async function clearBattleRecords(storage: KeyValueStorage): Promise<void> {
  await storage.removeItem(BATTLE_RECORDS_KEY);
}

/** Approximate stored size in bytes (UTF-16 code units ≈ bytes for JSON). */
export async function estimateBattleRecordsSize(storage: KeyValueStorage): Promise<number> {
  try {
    const raw = await storage.getItem(BATTLE_RECORDS_KEY);
    return raw === null ? 0 : raw.length;
  } catch {
    return 0;
  }
}

/**
 * Stable display/lookup key for a record: its recordId when present, else a
 * deterministic composite. Both battle-log (link) and the replay/ghost
 * loaders (lookup) derive keys with this same function.
 */
export function battleRecordKey(record: BattleRecord): string {
  return record.recordId ?? `${record.seed}@${record.recordedAt}`;
}

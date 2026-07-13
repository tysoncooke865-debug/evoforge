import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildSetRow, type SetInput } from '@/domain/set-save';
import { inferMuscleGroup } from '@/domain/workouts';
import { XP_PER_SET } from '@/domain/xp';

import { supabase } from './supabase';

/**
 * TRANSFORM P2 — the offline-first set queue. LOG SET must never wait for
 * the network and must never lose a set to connectivity or a force-close.
 *
 * Design, constrained by the XP contract (flat 10 XP/set, append-only
 * ledger, edits never re-grant):
 *  - INSERTS ONLY ride the queue. The client mints the row id (UUID), so
 *    the UI/battle verdict knows its rowId immediately and a retried
 *    insert collides on the PRIMARY KEY -> treated as already-synced.
 *    Duplicate sets through retries are therefore impossible by
 *    construction. UPDATES (rare, contract-sensitive) stay direct.
 *  - The XP grant fires AFTER a confirmed insert, exactly like the direct
 *    path; the (user_id, source_table, source_id) unique index absorbs
 *    re-grants on retry, and migration 002's re-runnable backfill remains
 *    the orphan collector of last resort.
 *  - Queue rows live in AsyncStorage (durable, <250ms) and are flushed on
 *    app start, on reconnect, after each enqueue, and every 30s while
 *    anything is pending.
 *
 * Sync states: pending -> synced | failed_permanent (4xx validation).
 * Network failures stay pending forever (retryable); only a server-side
 * rejection surfaces to the athlete.
 */

const KEY = 'evoforge-set-queue-v1';
const FLUSH_INTERVAL_MS = 30_000;

export interface QueuedSet {
  /** Client-minted workout_log row id — THE idempotency key. */
  id: string;
  input: SetInput;
  /** ISO timestamp the set was performed (drives the stored row). */
  timestamp: string;
  /** STAGE 1: resolved AT ENQUEUE (a custom exercise's muscle lives in the
   *  athlete's user_exercises, which the flush — a plain module, no React —
   *  cannot read). Absent on rows queued before this shipped: those fall back
   *  to inferMuscleGroup, exactly the behaviour they were enqueued under. */
  muscle?: string;
  state: 'pending' | 'failed_permanent';
  attempts: number;
  lastError?: string;
}

type Listener = (pending: number) => void;
const listeners = new Set<Listener>();
let flushing = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function readQueue(): Promise<QueuedSet[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedSet[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(rows: QueuedSet[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(rows));
  for (const l of listeners) l(rows.filter((r) => r.state === 'pending').length);
}

export function onQueueChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).filter((r) => r.state === 'pending').length;
}

/** Durably record the set locally. Returns once storage has it (<250ms). */
export async function enqueueSet(
  id: string,
  input: SetInput,
  timestamp: string,
  muscle?: string
): Promise<void> {
  const rows = await readQueue();
  rows.push({ id, input, timestamp, muscle, state: 'pending', attempts: 0 });
  await writeQueue(rows);
  ensureTimer();
  void flushQueue();
}

/** True if the row's failure is a validation rejection (never retryable). */
function isPermanent(message: string): boolean {
  return /violates|invalid|constraint|denied|permission|policy/i.test(message) && !/network|fetch|timeout/i.test(message);
}

/** Push every pending row. Safe to call anytime; single-flight. */
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const rows = await readQueue();
    let changed = false;
    for (const row of rows) {
      if (row.state !== 'pending') continue;
      // Identical row shape to the direct path (buildSetRow), plus OUR id.
      const built = {
        id: row.id,
        ...buildSetRow(row.input, row.muscle ?? inferMuscleGroup(row.input.exercise), row.timestamp),
      };
      const { error } = await supabase.from('workout_log').insert(built);
      row.attempts += 1;
      if (!error || /duplicate|unique|already exists/i.test(error.message)) {
        // Inserted now, or inserted on a previous attempt (PK collision).
        // Grant XP exactly like the direct path; unique index dedupes.
        const { error: grantError } = await supabase.from('xp_events').insert({
          kind: 'set',
          amount: XP_PER_SET,
          source_table: 'workout_log',
          source_id: row.id,
          created_at: row.timestamp,
        });
        if (grantError && !/duplicate|unique/i.test(grantError.message)) {
          // Set is safe; ledger will catch up via the 002 backfill.
        }
        rows.splice(rows.indexOf(row), 1);
        changed = true;
      } else if (isPermanent(error.message)) {
        row.state = 'failed_permanent';
        row.lastError = error.message;
        changed = true;
      } else {
        changed = true; // attempts bump
      }
    }
    if (changed) await writeQueue(rows);
    if (!rows.some((r) => r.state === 'pending')) stopTimer();
  } finally {
    flushing = false;
  }
}

function ensureTimer(): void {
  if (timer !== null) return;
  timer = setInterval(() => void flushQueue(), FLUSH_INTERVAL_MS);
}

function stopTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** Boot hook: resume flushing after a cold start / reconnect. */
export function initSetQueue(): void {
  void pendingCount().then((n) => {
    if (n > 0) {
      ensureTimer();
      void flushQueue();
    }
  });
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => void flushQueue());
  }
}

/** Sign-out hygiene: pending sets belong to the signed-out athlete. */
export async function clearSetQueue(): Promise<void> {
  stopTimer();
  await AsyncStorage.removeItem(KEY);
}

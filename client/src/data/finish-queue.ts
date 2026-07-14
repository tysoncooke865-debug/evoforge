import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';

/**
 * TRAIN_PAGE_V2 — FINISHING A WORKOUT MUST NOT BE LOSABLE.
 *
 * A finish used to be fire-and-forget: offline, the insert failed, a toast said
 * so, and that was the end of it — the athlete's decision to stop evaporated
 * while their SETS, which ride a durable queue, survived. The two must be equally
 * hard to lose; a set that outlives the workout it belongs to is nonsense.
 *
 * Same shape as set-queue.ts (durable, flush on boot / reconnect / 30s), with one
 * simplification: the marker's identity IS (user, date, workout), and migration
 * 017's unique index enforces it. So the queue CANNOT double-finish — a retry
 * that lands twice collides on the index, and a collision means "already
 * finished", which is success. There is no id to mint and nothing to reconcile.
 *
 * Cleared on sign-out (auth-context, the every-cache-layer doctrine): a pending
 * finish belongs to the athlete who signed out.
 */

const KEY = 'evoforge-finish-queue-v1';
const FLUSH_INTERVAL_MS = 30_000;

export interface QueuedFinish {
  date: string;
  workout: string;
  /** When the athlete tapped FINISH — not when it synced. */
  finishedAt: string;
  attempts: number;
}

type Listener = (pending: number) => void;
const listeners = new Set<Listener>();
let flushing = false;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * THE SIGN-OUT RACE (found by its own test, 2026-07-14).
 *
 * A flush READS the queue, awaits the network, then WRITES the survivors back.
 * If the athlete signs out in that window, clearFinishQueue() wipes storage —
 * and the in-flight flush then RESURRECTS it. The next athlete on the device
 * inherits a pending finish, and RLS attributes the insert to WHOEVER IS
 * SIGNED IN: the previous athlete's workout would be filed against the new
 * one's account.
 *
 * The generation counter closes it: a clear bumps it, and any flush that
 * started before the bump refuses to write.
 */
let generation = 0;

async function readQueue(): Promise<QueuedFinish[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedFinish[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(rows: QueuedFinish[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(rows));
  for (const l of listeners) l(rows.length);
}

export function onFinishQueueChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function pendingFinishes(): Promise<QueuedFinish[]> {
  return readQueue();
}

/** Durably record the decision locally. Returns once storage has it. */
export async function enqueueFinish(date: string, workout: string): Promise<void> {
  const rows = await readQueue();
  // The same workout twice is the same decision — dedupe on its identity.
  if (rows.some((r) => r.date === date && r.workout === workout)) return;
  rows.push({ date, workout, finishedAt: new Date().toISOString(), attempts: 0 });
  await writeQueue(rows);
  ensureTimer();
  void flushFinishQueue();
}

/** True when the failure is the server saying no — never retryable. */
function isPermanent(message: string): boolean {
  return (
    /violates|invalid|constraint|denied|permission|policy/i.test(message) &&
    !/network|fetch|timeout|duplicate|unique/i.test(message)
  );
}

/** Push every pending finish. Safe to call anytime; single-flight. */
export async function flushFinishQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  const gen = generation;
  try {
    const rows = await readQueue();
    if (rows.length === 0) {
      stopTimer();
      return;
    }
    const survivors: QueuedFinish[] = [];
    for (const row of rows) {
      const { error } = await supabase
        .from('workout_sessions')
        .insert({ date: row.date, workout: row.workout, finished_at: row.finishedAt });

      // Inserted now, or inserted on an earlier attempt (the unique index).
      // A duplicate is SUCCESS: the workout is finished, which is all we wanted.
      if (!error || /duplicate|unique|already exists/i.test(error.message)) continue;

      if (isPermanent(error.message)) continue; // the server said no; retrying cannot help
      survivors.push({ ...row, attempts: row.attempts + 1 });
    }
    // Somebody signed out while we were on the network. These finishes are not
    // this athlete's, and writing them back would hand them to the next one.
    if (gen !== generation) return;
    await writeQueue(survivors);
    if (survivors.length === 0) stopTimer();
  } finally {
    flushing = false;
  }
}

function ensureTimer(): void {
  if (timer !== null) return;
  timer = setInterval(() => void flushFinishQueue(), FLUSH_INTERVAL_MS);
}

function stopTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** Boot hook: resume after a cold start; also re-flush on reconnect. */
export function initFinishQueue(): void {
  void readQueue().then((rows) => {
    if (rows.length > 0) {
      ensureTimer();
      void flushFinishQueue();
    }
  });
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => void flushFinishQueue());
  }
}

/** Sign-out hygiene: a pending finish belongs to the athlete who signed out. */
export async function clearFinishQueue(): Promise<void> {
  generation += 1; // any in-flight flush must now refuse to write
  stopTimer();
  await AsyncStorage.removeItem(KEY);
}

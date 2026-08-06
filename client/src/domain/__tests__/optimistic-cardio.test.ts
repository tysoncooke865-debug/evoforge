import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { weekTotals } from '../cardio-stats';
import {
  applyOptimisticCardio,
  cardioLogKey,
  isOptimisticCardioId,
  optimisticCardioRow,
} from '../optimistic-cardio';
import { completedSessions } from '../session-stats';

/**
 * THE STALE CARDIO SUMMARY (Tyson, 2026-08-06: "the confirmation appears but
 * the summary can still show zero sessions until a reload").
 *
 * Driven against a REAL QueryClient, because the bug was never in the shape of
 * the row — it was in when the cache learns about it. The rollback cases are
 * the ones that matter: a placeholder that survives a failed save outlives the
 * error toast and becomes a session that never happened.
 */

const USER = 'athlete-1';
const KEY = cardioLogKey(USER) as never;
const NOW = new Date('2026-08-06T09:30:00.000Z');
const TODAY = '2026-08-06';

const input = { type: 'Run', minutes: 30, distanceKm: 5 };

const existing = [
  {
    id: 'real-1',
    date: '2026-08-04',
    type: 'Bike',
    minutes: 20,
    distance_km: 8,
    timestamp: '2026-08-04T07:00:00',
  },
];

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const rowsIn = (qc: QueryClient) => (qc.getQueryData(KEY) ?? []) as Record<string, unknown>[];

describe('the summary updates in the same frame as the confirmation', () => {
  it('the row is in the cache BEFORE the network is asked', () => {
    const qc = client();
    qc.setQueryData(KEY, existing as never);

    applyOptimisticCardio(qc, USER, input, NOW);

    const rows = rowsIn(qc);
    expect(rows).toHaveLength(2);
    expect(rows[1].type).toBe('Run');
    expect(rows[1].minutes).toBe(30);
  });

  it('THE BUG: the weekly session count and minutes both move immediately', () => {
    const qc = client();
    qc.setQueryData(KEY, [] as never);
    expect(weekTotals([], TODAY).sessions).toBe(0);

    applyOptimisticCardio(qc, USER, input, NOW);

    const after = weekTotals(rowsIn(qc) as never, TODAY);
    expect(after.sessions).toBe(1);
    expect(after.minutes).toBe(30);
  });

  it('the canonical session count sees it too — one cache entry feeds them all', () => {
    const qc = client();
    qc.setQueryData(KEY, [] as never);
    applyOptimisticCardio(qc, USER, input, NOW);

    const stats = completedSessions({ workoutRows: [], cardioRows: rowsIn(qc) as never });
    expect(stats.cardio).toBe(1);
    expect(stats.days).toBe(1);
  });

  it('lands in RECENT SESSIONS newest-last, matching the hook’s ordering', () => {
    const qc = client();
    qc.setQueryData(KEY, existing as never);
    applyOptimisticCardio(qc, USER, input, NOW);

    const rows = rowsIn(qc);
    expect(String(rows[rows.length - 1].timestamp) > String(rows[0].timestamp)).toBe(true);
  });

  it('files under the LOCAL calendar day, exactly as the insert does', () => {
    const row = optimisticCardioRow(input, NOW);
    const localDay = new Date(NOW.getTime() - NOW.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 10);
    // A placeholder filed under a different day than its real row would move
    // the session between weeks the moment the refetch landed.
    expect(row.date).toBe(localDay);
  });
});

describe('rollback', () => {
  it('a failed save leaves the cache exactly as it was', () => {
    const qc = client();
    qc.setQueryData(KEY, existing as never);
    const snapshot = qc.getQueryData(KEY);

    const { previous } = applyOptimisticCardio(qc, USER, input, NOW);
    expect(rowsIn(qc)).toHaveLength(2);

    qc.setQueryData(KEY, previous as never); // what onError does

    expect(qc.getQueryData(KEY)).toEqual(snapshot);
    expect(rowsIn(qc)).toHaveLength(1);
  });

  it('no optimistic row can survive a failed save', () => {
    const qc = client();
    qc.setQueryData(KEY, existing as never);
    const { previous } = applyOptimisticCardio(qc, USER, input, NOW);
    qc.setQueryData(KEY, previous as never);

    expect(rowsIn(qc).every((r) => !isOptimisticCardioId(r.id))).toBe(true);
    const stats = completedSessions({ workoutRows: [], cardioRows: rowsIn(qc) as never });
    expect(stats.cardio).toBe(1); // only the pre-existing real session
  });

  it('the rolled-back week reads what it read before the attempt', () => {
    const qc = client();
    qc.setQueryData(KEY, [] as never);
    const { previous } = applyOptimisticCardio(qc, USER, input, NOW);
    qc.setQueryData(KEY, previous as never);
    expect(weekTotals(rowsIn(qc) as never, TODAY).sessions).toBe(0);
  });
});

describe('it never paints into a list that has not loaded', () => {
  it('an empty cache is left alone — one row would read as all of history', () => {
    const qc = client();
    const { previous } = applyOptimisticCardio(qc, USER, input, NOW);
    expect(previous).toBeUndefined();
    expect(qc.getQueryData(KEY)).toBeUndefined();
  });
});

describe('the placeholder is identifiable', () => {
  it('an optimistic id is marked; a server id is not', () => {
    expect(isOptimisticCardioId(optimisticCardioRow(input, NOW).id)).toBe(true);
    expect(isOptimisticCardioId('a3f1e0c2-0000-4000-8000-000000000000')).toBe(false);
    expect(isOptimisticCardioId(undefined)).toBe(false);
  });

  it('is idempotent — the same input and clock give the same row', () => {
    expect(optimisticCardioRow(input, NOW)).toEqual(optimisticCardioRow(input, NOW));
  });
});

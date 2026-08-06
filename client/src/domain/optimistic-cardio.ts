/**
 * THE OPTIMISTIC CARDIO ROW (Tyson, 2026-08-06: "the confirmation appears but
 * the summary can still show zero sessions until a reload").
 *
 * Invalidation alone is a PROMISE of freshness, not freshness: the refetch is
 * a second round trip, and until it lands the athlete reads "0 SESSIONS"
 * underneath a toast that says the session saved. Contradicting yourself on
 * screen is worse than being slow.
 *
 * Pure and in domain/ on purpose — data/mutations.ts pulls React Native in, so
 * nothing there can be unit-tested. An optimistic update whose ROLLBACK is
 * never falsified is a bug waiting to happen: a placeholder that survives a
 * failed save outlives the error toast and becomes a session that never was.
 */

import { safeNum } from './physique-ratings';
import { localIso } from './today';

/** The fields the optimistic row needs — a structural subset of CardioInput. */
export interface OptimisticCardioInput {
  type: string;
  minutes: number;
  distanceKm: number;
}

/** Marked so a row that is still only a promise is never mistaken for a
 *  stored one. */
export const optimisticCardioId = (timestamp: string): string => `optimistic:${timestamp}`;

export const isOptimisticCardioId = (id: unknown): boolean =>
  typeof id === 'string' && id.startsWith('optimistic:');

export const cardioLogKey = (userId: string | null): unknown[] => ['cardio_log', userId];

/** The placeholder, shaped exactly like a `cardio_log` row the hook returns. */
export function optimisticCardioRow(
  input: OptimisticCardioInput,
  now: Date
): Record<string, unknown> {
  const timestamp = now.toISOString().slice(0, 19);
  return {
    id: optimisticCardioId(timestamp),
    // The LOCAL calendar day, the same one the insert writes — a placeholder
    // filed under a different day than the row it stands in for would move
    // the session between weeks when the refetch lands.
    date: localIso(now),
    type: input.type,
    minutes: safeNum(input.minutes, 0),
    distance_km: safeNum(input.distanceKm, 0),
    timestamp,
  };
}

/** The minimum of a QueryClient this needs — keeps domain/ free of the dep. */
export interface CardioCache {
  getQueryData: (key: never) => unknown;
  setQueryData: (key: never, rows: never) => unknown;
}

/**
 * Write the placeholder; return the snapshot to roll back to.
 *
 * `previous === undefined` means the list has not loaded yet: paint NOTHING,
 * because a lone optimistic row in an empty cache reads as "this is all your
 * history" and would flash the athlete's whole log away.
 */
export function applyOptimisticCardio<T>(
  cache: CardioCache,
  userId: string | null,
  input: OptimisticCardioInput,
  now: Date
): { previous: T[] | undefined } {
  const key = cardioLogKey(userId) as never;
  const previous = cache.getQueryData(key) as T[] | undefined;
  if (previous === undefined) return { previous: undefined };
  // Ascending by timestamp, matching useCardioLog's ordering contract.
  cache.setQueryData(key, [...previous, optimisticCardioRow(input, now)] as never);
  return { previous };
}

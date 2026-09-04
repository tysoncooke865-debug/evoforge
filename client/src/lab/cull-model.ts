/**
 * CULL — the pure half (the registry-meta / switcher-model split, same
 * reason: vitest pins the whole contract with no browser and no RN graph).
 *
 * Culling is BATCH-LEVEL (2026-09-04): a round that lost should stop
 * competing for attention as one decision, not seven. CURRENT is never
 * cullable — it has no cull affordance at all — so the stored grammar only
 * admits batch keys, and every variant-scoped key from the pre-batch era
 * (`home/clarity`, even a hand-typed `home/baseline`) is silently dropped
 * by the parser. That IS the migration: nothing legitimate was stored in
 * the old grammar (batches did not exist; baselines were never meant to be
 * culled), so tightening the shape retires the old keys with no storage
 * versioning.
 *
 * Deleting source files is a commit, not a button — the lab is a static
 * export and cannot rewrite the repo it was built from. So CULL hides the
 * batch on the spot and the gallery lists it under PENDING REMOVAL, the
 * work list for the deletion commit (which also resets the page's
 * lastBatchNumber to 0 when it empties the list — registry-meta.ts).
 *
 * A culled batch is hidden, NOT forgotten: RESTORE brings it back, and
 * nothing here touches the registry. The registry stays the only truth
 * about what exists — a stored key whose batch was deleted is ignored.
 */

/** The localStorage key. One entry, a JSON array of 'page/batch-<n>' keys.
 *  Unchanged from the variant-cull era: the value grammar migrated, the
 *  address did not (a rename would strand every device's culls). */
export const LAB_CULL_STORAGE_KEY = 'evoforge-lab-culled';

/** The stored identity of one batch. */
export function batchCullKey(page: string, batchNumber: number): string {
  return `${page}/batch-${batchNumber}`;
}

/** Shape of a stored key: page slug + a 1-based batch number, exactly. The
 *  tight grammar is what silently retires every pre-batch variant key, and
 *  what keeps a hand-edited entry from widening into a match. */
const KEY_SHAPE = /^[a-z0-9-]+\/batch-[1-9][0-9]*$/;

/**
 * Stored string → the culled list. TOTAL: every failure answers "nothing is
 * culled" rather than throwing, because this runs during the gallery's
 * render and a corrupt entry must never be able to blank the lab. Garbage
 * entries are dropped individually — one bad key does not discard the rest.
 */
export function parseCulled(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((k): k is string => typeof k === 'string' && KEY_SHAPE.test(k));
}

export function serializeCulled(keys: readonly string[]): string {
  return JSON.stringify(keys);
}

/** Cull one batch. Idempotent, and append-order stable so the PENDING
 *  REMOVAL list reads in the order the calls were made. */
export function withCulledBatch(
  keys: readonly string[],
  page: string,
  batchNumber: number
): string[] {
  const key = batchCullKey(page, batchNumber);
  return keys.includes(key) ? [...keys] : [...keys, key];
}

/** Restore one batch, leaving every other cull untouched. */
export function withoutCulledBatch(
  keys: readonly string[],
  page: string,
  batchNumber: number
): string[] {
  const key = batchCullKey(page, batchNumber);
  return keys.filter((k) => k !== key);
}

export function isBatchCulled(
  keys: readonly string[],
  page: string,
  batchNumber: number
): boolean {
  return keys.includes(batchCullKey(page, batchNumber));
}

/**
 * The durable layer's pure core (cull-sync.ts is the impure shell): merge
 * the device's list with the database's. Union, order-stable — local order
 * first (the developer's own recent decisions stay where they were), then
 * remote-only keys in remote order. `toPush` is what the device knows that
 * the database does not; pushing it is what makes a cull made offline (or
 * signed out) durable on the next signed-in gallery mount.
 */
export function mergeCulled(
  local: readonly string[],
  remote: readonly string[]
): { merged: string[]; toPush: string[] } {
  const localSet = new Set(local);
  const remoteSet = new Set(remote);
  return {
    merged: [...local, ...remote.filter((k) => !localSet.has(k))],
    toPush: local.filter((k) => !remoteSet.has(k)),
  };
}

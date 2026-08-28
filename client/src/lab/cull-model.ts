/**
 * CULL — the pure half (the registry-meta / switcher-model split, same
 * reason: vitest pins the whole contract with no browser and no RN graph).
 *
 * A design that lost its round should stop competing for attention the
 * moment the call is made, but deleting source files is a commit, not a
 * button — the lab is a static export and cannot rewrite the repo it was
 * built from. So CULL is a two-step: this model hides the variant on the
 * spot (per device, localStorage), and the gallery lists what is hidden
 * under PENDING REMOVAL so the follow-up deletion commit has a work list.
 *
 * A culled variant is hidden, NOT forgotten: RESTORE brings it back, and
 * nothing here touches the registry. The registry stays the only truth
 * about what exists.
 */

/** The localStorage key. One entry, a JSON array of 'page/variant' keys. */
export const LAB_CULL_STORAGE_KEY = 'evoforge-lab-culled';

/** The stored identity of one variant. */
export function cullKey(page: string, variant: string): string {
  return `${page}/${variant}`;
}

/** Shape of a stored key: exactly the slug grammar the registry pins, so a
 *  hand-edited or half-written entry can never widen into a match. */
const KEY_SHAPE = /^[a-z0-9-]+\/[a-z0-9-]+$/;

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

/** Cull one variant. Idempotent, and append-order stable so the PENDING
 *  REMOVAL list reads in the order the calls were made. */
export function withCulled(keys: readonly string[], page: string, variant: string): string[] {
  const key = cullKey(page, variant);
  return keys.includes(key) ? [...keys] : [...keys, key];
}

/** Restore one variant, leaving every other cull untouched. */
export function withoutCulled(keys: readonly string[], page: string, variant: string): string[] {
  const key = cullKey(page, variant);
  return keys.filter((k) => k !== key);
}

export function isCulled(keys: readonly string[], page: string, variant: string): boolean {
  return keys.includes(cullKey(page, variant));
}

import { useSyncExternalStore } from 'react';

import {
  LAB_CULL_STORAGE_KEY,
  parseCulled,
  serializeCulled,
  withCulled,
  withoutCulled,
} from './cull-model';

/**
 * CULL — the impure half: localStorage plus a subscription so every card and
 * the tab strip repaint together the instant a variant is culled.
 *
 * WEB ONLY, on purpose and without apology. The lab is a browser tool (the
 * gallery is a URL you type; the deploy is a Pages branch), and localStorage
 * does not exist under React Native. Every access is guarded, so on native
 * the whole mechanism degrades to "nothing is ever culled" rather than
 * throwing — the same shape as the error-screen's storage guard.
 */

function available(): boolean {
  return typeof localStorage !== 'undefined';
}

function readRaw(): string | null {
  if (!available()) return null;
  try {
    return localStorage.getItem(LAB_CULL_STORAGE_KEY);
  } catch {
    // Private-mode / disabled storage. Nothing is culled; nothing breaks.
    return null;
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// useSyncExternalStore compares snapshots by IDENTITY and re-renders until
// two agree, so a fresh array every call is an infinite loop. Parse only
// when the underlying string actually changed, and hand back the SAME array
// otherwise. EMPTY is a module constant for the same reason.
const EMPTY: string[] = [];
let cache: { raw: string | null; value: string[] } = { raw: null, value: EMPTY };

function getSnapshot(): string[] {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, value: raw === null ? EMPTY : parseCulled(raw) };
  return cache.value;
}

/** The server/native snapshot: a stable empty list (see the guard above). */
function getServerSnapshot(): string[] {
  return EMPTY;
}

function write(next: string[]): void {
  if (!available()) return;
  try {
    localStorage.setItem(LAB_CULL_STORAGE_KEY, serializeCulled(next));
  } catch {
    // Storage full or blocked: the cull simply does not persist. The
    // listeners still fire, so the UI stays honest for this page view.
  }
  for (const listener of listeners) listener();
}

/** Hide a variant across the gallery and the tab strip, persistently. */
export function cull(page: string, variant: string): void {
  write(withCulled(getSnapshot(), page, variant));
}

/** Undo a cull. */
export function uncull(page: string, variant: string): void {
  write(withoutCulled(getSnapshot(), page, variant));
}

/** The culled keys, reactive. */
export function useCulled(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

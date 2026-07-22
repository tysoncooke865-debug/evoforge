/**
 * Beta feedback log (M10) — a local, capped list of feedback entries under a
 * single storage key, wrapped in a versioned envelope
 * `{ version: 1, entries: [...] }`. Mirrors battle-records.ts.
 *
 * Fail-safe rules:
 *  - Loading NEVER throws: corrupt/missing/malformed data → empty list.
 *  - An envelope from a NEWER app build is refused on load (empty list) and
 *    appendFeedbackEntry will not overwrite it — running an old build must
 *    never destroy a newer build's data.
 *  - Individual entries inside a valid envelope are re-validated; invalid
 *    entries are dropped rather than poisoning the list.
 *
 * Consumers depend on the KeyValueStorage interface only (AsyncStorage in
 * the app, MemoryStorage in tests) — never on AsyncStorage directly.
 */
import type { KeyValueStorage } from '../persistence/storage';

export const FEEDBACK_LOG_KEY = 'evoforge-arena/feedback-log';
export const FEEDBACK_LOG_VERSION = 1;
/** Cap on stored entries: the oldest rotate out beyond this. */
export const MAX_FEEDBACK_ENTRIES = 50;
/** Cap on a single message's length (characters, after trimming). */
export const MAX_FEEDBACK_MESSAGE_LENGTH = 2000;

export const FEEDBACK_CATEGORIES = ['bug', 'balance', 'idea'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export interface FeedbackEntry {
  /** Unique id (collision-proof within a device via timestamp + sequence). */
  id: string;
  category: FeedbackCategory;
  message: string;
  /** ISO timestamp of when the entry was written. */
  createdAt: string;
  /** Balance version the feedback was filed against (context for triage). */
  balanceVersion: string;
}

interface FeedbackEnvelope {
  version: number;
  entries: FeedbackEntry[];
}

export function isValidFeedbackEntry(value: unknown): value is FeedbackEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Partial<FeedbackEntry>;
  if (typeof e.id !== 'string' || e.id.length === 0) return false;
  if (!FEEDBACK_CATEGORIES.includes(e.category as FeedbackCategory)) return false;
  if (typeof e.message !== 'string' || e.message.length === 0) return false;
  if (typeof e.createdAt !== 'string' || Number.isNaN(Date.parse(e.createdAt))) return false;
  if (typeof e.balanceVersion !== 'string') return false;
  return true;
}

/** Parses the stored envelope; null means "unusable" (corrupt or missing). */
function parseEnvelope(raw: string | null): { version: number; entries: unknown[] } | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const env = parsed as Partial<FeedbackEnvelope>;
  if (typeof env.version !== 'number' || !Array.isArray(env.entries)) return null;
  return { version: env.version, entries: env.entries };
}

/** Monotonic per-session sequence so same-millisecond entries get unique ids. */
let entrySequence = 0;

/**
 * Builds a validated entry from raw user input. Returns null when the message
 * is empty after trimming — the caller should treat that as "nothing to send".
 * Whitespace is preserved inside the message (multi-line reports are fine);
 * only leading/trailing whitespace is trimmed and the length capped.
 */
export function createFeedbackEntry(
  category: FeedbackCategory,
  message: string,
  balanceVersion: string,
  now: Date = new Date()
): FeedbackEntry | null {
  const trimmed = message.trim().slice(0, MAX_FEEDBACK_MESSAGE_LENGTH);
  if (trimmed.length === 0) return null;
  if (!FEEDBACK_CATEGORIES.includes(category)) return null;
  entrySequence += 1;
  return {
    id: `fb-${now.getTime()}-${entrySequence}`,
    category,
    message: trimmed,
    createdAt: now.toISOString(),
    balanceVersion,
  };
}

/**
 * Loads all stored entries, oldest first. Corrupt data, storage errors and
 * newer-version envelopes all yield an empty list — never a throw.
 */
export async function loadFeedbackEntries(storage: KeyValueStorage): Promise<FeedbackEntry[]> {
  let raw: string | null = null;
  try {
    raw = await storage.getItem(FEEDBACK_LOG_KEY);
  } catch {
    return [];
  }
  const envelope = parseEnvelope(raw);
  if (envelope === null || envelope.version !== FEEDBACK_LOG_VERSION) return [];
  const entries: FeedbackEntry[] = [];
  for (const entry of envelope.entries) {
    if (isValidFeedbackEntry(entry)) entries.push(entry);
  }
  return entries;
}

/**
 * Appends an entry, dropping the oldest beyond MAX_FEEDBACK_ENTRIES, and
 * returns the new list. Refuses (no-op, returns []) when the stored envelope
 * comes from a newer app build. Storage write errors propagate (callers
 * decide how loudly to fail).
 */
export async function appendFeedbackEntry(
  storage: KeyValueStorage,
  entry: FeedbackEntry
): Promise<FeedbackEntry[]> {
  let raw: string | null = null;
  try {
    raw = await storage.getItem(FEEDBACK_LOG_KEY);
  } catch {
    raw = null; // unreadable ≠ newer; treat as empty and rewrite below
  }
  const envelope = parseEnvelope(raw);
  if (envelope !== null && envelope.version > FEEDBACK_LOG_VERSION) {
    return []; // newer build's data — leave it untouched
  }
  const entries: FeedbackEntry[] = [];
  if (envelope !== null && envelope.version === FEEDBACK_LOG_VERSION) {
    for (const stored of envelope.entries) {
      if (isValidFeedbackEntry(stored)) entries.push(stored);
    }
  }
  entries.push(entry);
  const kept = entries.slice(-MAX_FEEDBACK_ENTRIES);
  const next: FeedbackEnvelope = { version: FEEDBACK_LOG_VERSION, entries: kept };
  await storage.setItem(FEEDBACK_LOG_KEY, JSON.stringify(next));
  return kept;
}

export async function clearFeedbackLog(storage: KeyValueStorage): Promise<void> {
  await storage.removeItem(FEEDBACK_LOG_KEY);
}

/**
 * Renders the stored entries as a shareable plain-text blob (newest first —
 * the most recent feedback is what a beta conversation is usually about).
 */
export function exportFeedbackText(entries: readonly FeedbackEntry[]): string {
  const header = `EvoForge Arena — beta feedback (${entries.length} ${
    entries.length === 1 ? 'entry' : 'entries'
  })`;
  if (entries.length === 0) {
    return `${header}\n\nNo feedback recorded yet.`;
  }
  const blocks = [...entries]
    .reverse()
    .map(
      (entry, i) =>
        `${i + 1}. [${entry.category.toUpperCase()}] ${entry.createdAt} (balance ${
          entry.balanceVersion
        })\n${entry.message}`
    );
  return `${header}\n\n${blocks.join('\n\n')}`;
}

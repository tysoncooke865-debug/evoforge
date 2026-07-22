/**
 * M10 tests — beta feedback log persistence: append/list round trip, entry
 * cap, corrupt-safe loading, newer-version refusal (load AND append), entry
 * creation sanitisation, and the export text shape.
 */
import { describe, expect, it } from 'vitest';
import {
  appendFeedbackEntry,
  clearFeedbackLog,
  createFeedbackEntry,
  exportFeedbackText,
  FEEDBACK_LOG_KEY,
  FEEDBACK_LOG_VERSION,
  FeedbackEntry,
  isValidFeedbackEntry,
  loadFeedbackEntries,
  MAX_FEEDBACK_ENTRIES,
  MAX_FEEDBACK_MESSAGE_LENGTH,
} from '../services/feedback/feedback-log';
import { KeyValueStorage, MemoryStorage } from '../services/persistence/storage';

function makeEntry(n: number): FeedbackEntry {
  return {
    id: `fb-test-${n}`,
    category: n % 2 === 0 ? 'bug' : 'idea',
    message: `entry number ${n}`,
    createdAt: '2026-07-22T00:00:00.000Z',
    balanceVersion: '0.5.0',
  };
}

/** Storage whose reads/writes always throw — the fail-safe worst case. */
class ThrowingStorage implements KeyValueStorage {
  async getItem(): Promise<string | null> {
    throw new Error('read failed');
  }
  async setItem(): Promise<void> {
    throw new Error('write failed');
  }
  async removeItem(): Promise<void> {
    throw new Error('remove failed');
  }
  async getAllKeys(): Promise<string[]> {
    throw new Error('keys failed');
  }
}

describe('createFeedbackEntry', () => {
  it('builds a valid entry from raw input, trimming outer whitespace', () => {
    const entry = createFeedbackEntry('bug', '  the lane froze  \n', '0.5.0');
    expect(entry).not.toBeNull();
    expect(entry!.message).toBe('the lane froze');
    expect(entry!.category).toBe('bug');
    expect(entry!.balanceVersion).toBe('0.5.0');
    expect(isValidFeedbackEntry(entry)).toBe(true);
  });

  it('preserves interior newlines (multi-line reports)', () => {
    const entry = createFeedbackEntry('idea', 'line one\nline two', '0.5.0');
    expect(entry!.message).toBe('line one\nline two');
  });

  it('rejects empty and whitespace-only messages as null', () => {
    expect(createFeedbackEntry('bug', '', '0.5.0')).toBeNull();
    expect(createFeedbackEntry('bug', '   \n\t ', '0.5.0')).toBeNull();
  });

  it('caps overlong messages at MAX_FEEDBACK_MESSAGE_LENGTH', () => {
    const entry = createFeedbackEntry('balance', 'x'.repeat(MAX_FEEDBACK_MESSAGE_LENGTH + 500), '0.5.0');
    expect(entry!.message.length).toBe(MAX_FEEDBACK_MESSAGE_LENGTH);
  });

  it('gives distinct ids to entries created at the same instant', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    const a = createFeedbackEntry('bug', 'first', '0.5.0', now);
    const b = createFeedbackEntry('bug', 'second', '0.5.0', now);
    expect(a!.id).not.toBe(b!.id);
    expect(a!.createdAt).toBe(now.toISOString());
  });
});

describe('feedback log persistence', () => {
  it('appends and loads round-trip, oldest first', async () => {
    const storage = new MemoryStorage();
    await appendFeedbackEntry(storage, makeEntry(1));
    await appendFeedbackEntry(storage, makeEntry(2));
    const loaded = await loadFeedbackEntries(storage);
    expect(loaded.map((e) => e.id)).toEqual(['fb-test-1', 'fb-test-2']);
    expect(loaded[0]).toEqual(makeEntry(1));
  });

  it(`caps at ${MAX_FEEDBACK_ENTRIES} entries, dropping the oldest`, async () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < MAX_FEEDBACK_ENTRIES + 3; i++) {
      await appendFeedbackEntry(storage, makeEntry(i));
    }
    const loaded = await loadFeedbackEntries(storage);
    expect(loaded.length).toBe(MAX_FEEDBACK_ENTRIES);
    expect(loaded[0].id).toBe('fb-test-3'); // 0..2 rotated out
    expect(loaded[loaded.length - 1].id).toBe(`fb-test-${MAX_FEEDBACK_ENTRIES + 2}`);
  });

  it('corrupt data loads as an empty list (never throws)', async () => {
    for (const garbage of [
      '{not json',
      'null',
      '42',
      '"string"',
      '{"foo":1}',
      '{"version":"x","entries":[]}',
      '{"version":1,"entries":"nope"}',
    ]) {
      const storage = new MemoryStorage();
      await storage.setItem(FEEDBACK_LOG_KEY, garbage);
      await expect(loadFeedbackEntries(storage)).resolves.toEqual([]);
    }
  });

  it('a throwing storage backend loads as an empty list', async () => {
    await expect(loadFeedbackEntries(new ThrowingStorage())).resolves.toEqual([]);
  });

  it('invalid entries inside a valid envelope are dropped individually', async () => {
    const storage = new MemoryStorage();
    const envelope = {
      version: FEEDBACK_LOG_VERSION,
      entries: [
        makeEntry(1),
        null,
        42,
        { id: '', category: 'bug', message: 'x', createdAt: '2026-07-22T00:00:00.000Z', balanceVersion: '0.5.0' },
        { ...makeEntry(2), category: 'rant' }, // unknown category
        { ...makeEntry(3), message: '' }, // empty message
        { ...makeEntry(4), createdAt: 'not-a-date' },
        makeEntry(5),
      ],
    };
    await storage.setItem(FEEDBACK_LOG_KEY, JSON.stringify(envelope));
    const loaded = await loadFeedbackEntries(storage);
    expect(loaded.map((e) => e.id)).toEqual(['fb-test-1', 'fb-test-5']);
  });

  it('refuses a newer-version envelope on load AND never clobbers it on append', async () => {
    const storage = new MemoryStorage();
    const newer = JSON.stringify({
      version: FEEDBACK_LOG_VERSION + 1,
      entries: [{ future: true }],
    });
    await storage.setItem(FEEDBACK_LOG_KEY, newer);

    await expect(loadFeedbackEntries(storage)).resolves.toEqual([]);
    const appended = await appendFeedbackEntry(storage, makeEntry(1));
    expect(appended).toEqual([]);
    // The newer build's data must be byte-identical afterwards.
    await expect(storage.getItem(FEEDBACK_LOG_KEY)).resolves.toBe(newer);
  });

  it('clearFeedbackLog removes the stored key', async () => {
    const storage = new MemoryStorage();
    await appendFeedbackEntry(storage, makeEntry(1));
    await clearFeedbackLog(storage);
    await expect(storage.getItem(FEEDBACK_LOG_KEY)).resolves.toBeNull();
    await expect(loadFeedbackEntries(storage)).resolves.toEqual([]);
  });
});

describe('exportFeedbackText', () => {
  it('renders newest-first numbered blocks with category, date, balance and message', () => {
    const entries = [makeEntry(1), makeEntry(2)]; // stored oldest first
    const text = exportFeedbackText(entries);
    expect(text).toContain('EvoForge Arena — beta feedback (2 entries)');
    // Newest first: entry 2 becomes block 1.
    expect(text).toContain('1. [BUG] 2026-07-22T00:00:00.000Z (balance 0.5.0)\nentry number 2');
    expect(text).toContain('2. [IDEA] 2026-07-22T00:00:00.000Z (balance 0.5.0)\nentry number 1');
    expect(text.indexOf('entry number 2')).toBeLessThan(text.indexOf('entry number 1'));
  });

  it('uses singular wording and a placeholder appropriately', () => {
    expect(exportFeedbackText([makeEntry(1)])).toContain('(1 entry)');
    const empty = exportFeedbackText([]);
    expect(empty).toContain('(0 entries)');
    expect(empty).toContain('No feedback recorded yet.');
  });
});

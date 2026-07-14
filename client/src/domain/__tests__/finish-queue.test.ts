import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The finish queue's contract. The queue itself talks to AsyncStorage and
 * Supabase, so both are faked here — what is under test is the RULE SET, which
 * is where a durable queue is usually wrong:
 *
 *   - a duplicate is SUCCESS (the workout is finished; that is all we wanted),
 *   - a network failure RETRIES,
 *   - a server rejection does NOT retry forever,
 *   - the same workout cannot be queued twice.
 */

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
  },
}));

let insertResult: { error: { message: string } | null } = { error: null };
const inserts: unknown[] = [];
vi.mock('../../data/supabase', () => ({
  supabase: {
    from: () => ({
      insert: async (row: unknown) => {
        inserts.push(row);
        return insertResult;
      },
    }),
  },
}));

const { clearFinishQueue, enqueueFinish, flushFinishQueue, pendingFinishes } = await import(
  '../../data/finish-queue'
);

/** enqueueFinish kicks a flush of its own (fire-and-forget). Let it land before
 *  asserting, or the test races the very single-flight guard that stops the
 *  queue double-posting. */
const settle = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
  await settle();
  await flushFinishQueue();
  await settle();
};

beforeEach(async () => {
  store.clear();
  inserts.length = 0;
  insertResult = { error: null };
  await clearFinishQueue();
});

describe('the finish queue', () => {
  it('a successful flush empties the queue', async () => {
    await enqueueFinish('2026-07-14', 'Legs');
    await flush();
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    expect(await pendingFinishes()).toEqual([]);
  });

  it('THE SAME WORKOUT CANNOT BE QUEUED TWICE — it is one decision', async () => {
    insertResult = { error: { message: 'network request failed' } };
    await enqueueFinish('2026-07-14', 'Legs');
    await enqueueFinish('2026-07-14', 'Legs');
    expect(await pendingFinishes()).toHaveLength(1);
  });

  it('A DUPLICATE IS SUCCESS: already finished IS finished', async () => {
    insertResult = { error: { message: 'duplicate key value violates unique constraint' } };
    await enqueueFinish('2026-07-14', 'Legs');
    await flush();
    // The row is gone from the queue — it did not sit there retrying forever
    // against a server that already agrees with it.
    expect(await pendingFinishes()).toEqual([]);
  });

  it('a NETWORK failure keeps the finish and retries it', async () => {
    insertResult = { error: { message: 'Failed to fetch' } };
    await enqueueFinish('2026-07-14', 'Legs');
    await flush();
    const pending = await pendingFinishes();
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBeGreaterThan(0);

    // ...and when the network comes back, it lands.
    insertResult = { error: null };
    await flush();
    expect(await pendingFinishes()).toEqual([]);
  });

  it('a SERVER REJECTION is dropped, not retried forever', async () => {
    insertResult = { error: { message: 'new row violates row-level security policy' } };
    await enqueueFinish('2026-07-14', 'Legs');
    await flush();
    expect(await pendingFinishes()).toEqual([]);
  });

  it('the queued finish carries WHEN THE ATHLETE TAPPED, not when it synced', async () => {
    insertResult = { error: { message: 'Failed to fetch' } };
    await enqueueFinish('2026-07-14', 'Legs');
    const [row] = await pendingFinishes();
    expect(row.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    insertResult = { error: null };
    await flush();
    expect(inserts[inserts.length - 1]).toMatchObject({
      date: '2026-07-14',
      workout: 'Legs',
      finished_at: row.finishedAt,
    });
  });

  it('sign-out clears it', async () => {
    insertResult = { error: { message: 'Failed to fetch' } };
    await enqueueFinish('2026-07-14', 'Legs');
    await clearFinishQueue();
    expect(await pendingFinishes()).toEqual([]);
  });
});

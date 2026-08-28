/**
 * Analytics emitter pins (docs/ORIGIN_ANALYTICS.md): fire-and-forget, a
 * rejected insert is swallowed (never gates a flow), ratings are bucketed,
 * and the Page Lab emits NOTHING.
 * Falsified: an awaited/throwing track fails the 'does not throw' test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ratingBand, track, touchActivity } from '../analytics';

const insert = vi.fn();
const rpc = vi.fn();
vi.mock('../supabase', () => ({
  supabase: {
    from: () => ({ insert }),
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

afterEach(() => {
  delete process.env.EXPO_PUBLIC_PAGE_LAB;
  vi.clearAllMocks();
});

describe('track()', () => {
  it('inserts the event and never throws on rejection', async () => {
    insert.mockResolvedValueOnce({ error: null });
    expect(() => track('origin_selected', { origin_id: 'titan' })).not.toThrow();
    await Promise.resolve();
    expect(insert).toHaveBeenCalledWith({ event_name: 'origin_selected', props: { origin_id: 'titan' } });

    insert.mockRejectedValueOnce(new Error('offline'));
    expect(() => track('origin_binding_failed', { reason: 'network' })).not.toThrow();
    // Let the rejection flush — nothing may propagate.
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe('the Page Lab emits nothing', () => {
  it('track() and touchActivity() are inert on a lab build', async () => {
    // A lab variant renders REAL shared components, so the emitter is the only
    // place this can be stopped without forking src/ui. Un-guarded, merely
    // OPENING a Home variant writes analytics_events under whatever session
    // sits beneath the lab's fake one — polluting the funnel these events
    // exist to measure. ForgeCacheCard's mount-time daily_checkin_viewed is
    // the case that made this load-bearing (it fires as soon as the seeded
    // forge_cache_state makes the card render).
    process.env.EXPO_PUBLIC_PAGE_LAB = '1';
    track('daily_checkin_viewed', { rung: 4 });
    touchActivity(true, 1000);
    await new Promise((r) => setTimeout(r, 10));
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('still emits on a normal build', async () => {
    // The guard must not silence the real app — falsify it by removing the
    // flag and watching the same call land.
    insert.mockResolvedValueOnce({ error: null });
    track('daily_checkin_viewed', { rung: 4 });
    await Promise.resolve();
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe('ratingBand()', () => {
  it('buckets into decades, never the exact value', () => {
    expect(ratingBand(46)).toBe('40s');
    expect(ratingBand(0)).toBe('00s');
    expect(ratingBand(99)).toBe('90s');
    expect(ratingBand(130)).toBe('90s');
    expect(ratingBand(-5)).toBe('00s');
    expect(ratingBand(null)).toBeNull();
    expect(ratingBand(Number.NaN)).toBeNull();
  });
});

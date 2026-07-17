/**
 * Analytics emitter pins (docs/ORIGIN_ANALYTICS.md): fire-and-forget, a
 * rejected insert is swallowed (never gates a flow), ratings are bucketed.
 * Falsified: an awaited/throwing track fails the 'does not throw' test.
 */

import { describe, expect, it, vi } from 'vitest';

import { ratingBand, track } from '../analytics';

const insert = vi.fn();
vi.mock('../supabase', () => ({
  supabase: {
    from: () => ({ insert }),
  },
}));

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

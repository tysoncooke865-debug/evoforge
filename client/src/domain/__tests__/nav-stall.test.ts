import { describe, expect, it } from 'vitest';

import {
  NAV_STALL_CEILING_MS,
  NAV_STALL_FLOOR_MS,
  NAV_STALL_MAX_REPORTS,
  navBeaconExhausted,
  shouldReportStall,
} from '../nav-stall';

const base = {
  gapMs: 3000,
  hidden: false,
  wasHiddenSinceLastBeat: false,
  sent: 0,
  elapsedMs: 1000,
};

describe('nav stall — the false positives that made the old data useless', () => {
  it('rejects the ~1s throttled tick that was 74.5% of every report ever sent', () => {
    // Browsers clamp timers to 1/second while hidden. The old beacon reported
    // ≥700ms, so this bucket dominated the dataset on EVERY route.
    for (const gapMs of [700, 900, 1001, 1099, 1400]) {
      expect(shouldReportStall({ ...base, gapMs })).toBe(false);
    }
  });

  it('rejects a gap measured while the document was hidden', () => {
    expect(shouldReportStall({ ...base, hidden: true })).toBe(false);
  });

  it('rejects a gap whose window merely TOUCHED a hidden document', () => {
    // Backgrounded and returned between two beats: the gap is sleep, not jank.
    expect(shouldReportStall({ ...base, hidden: false, wasHiddenSinceLastBeat: true })).toBe(false);
  });

  it('rejects a multi-hour "stall" — that is a suspended tab, not a blocked thread', () => {
    expect(shouldReportStall({ ...base, gapMs: NAV_STALL_CEILING_MS + 1 })).toBe(false);
    expect(shouldReportStall({ ...base, gapMs: 867_308 })).toBe(false);
  });
});

describe('nav stall — what it should still catch', () => {
  it('reports a real, visible, multi-second block', () => {
    expect(shouldReportStall({ ...base, gapMs: 3000 })).toBe(true);
    expect(shouldReportStall({ ...base, gapMs: NAV_STALL_FLOOR_MS })).toBe(true);
    expect(shouldReportStall({ ...base, gapMs: NAV_STALL_CEILING_MS })).toBe(true);
  });

  it('reports the 2443ms /workout stall that was real in the old data', () => {
    expect(shouldReportStall({ ...base, gapMs: 2443 })).toBe(true);
  });
});

describe('nav stall — the beacon still stops itself', () => {
  it('is exhausted after its report budget', () => {
    expect(navBeaconExhausted(NAV_STALL_MAX_REPORTS, 0)).toBe(true);
    expect(navBeaconExhausted(NAV_STALL_MAX_REPORTS - 1, 0)).toBe(false);
  });

  it('is exhausted after ten minutes of clean running', () => {
    expect(navBeaconExhausted(0, 10 * 60 * 1000 + 1)).toBe(true);
    expect(navBeaconExhausted(0, 60_000)).toBe(false);
  });

  it('refuses to report once exhausted, however bad the gap', () => {
    expect(shouldReportStall({ ...base, gapMs: 9000, sent: NAV_STALL_MAX_REPORTS })).toBe(false);
    expect(shouldReportStall({ ...base, gapMs: 9000, elapsedMs: 11 * 60 * 1000 })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { TTI_CEILING_MS, interactiveSpanMs } from '../activation-tti';

describe('activation TTI — a span it can trust', () => {
  it('measures a plain span', () => {
    expect(interactiveSpanMs({ startedAt: 1_000, now: 3_400, hiddenDuringSpan: false })).toBe(2_400);
  });

  it('reports a genuinely instant span as 0, not as unknown', () => {
    // The funnel's "never 0" rule is about UNKNOWN. A warm cache that settled
    // inside the same millisecond really did take 0 ms, and reporting that as
    // null would delete every fast device from the average.
    expect(interactiveSpanMs({ startedAt: 1_000, now: 1_000, hiddenDuringSpan: false })).toBe(0);
  });

  it('accepts the span right up to the ceiling', () => {
    expect(
      interactiveSpanMs({ startedAt: 0, now: TTI_CEILING_MS, hiddenDuringSpan: false })
    ).toBe(TTI_CEILING_MS);
  });
});

describe('activation TTI — the refusals', () => {
  it('refuses a span that was never stamped', () => {
    // A cold boot or a deep link. Unknown, not instant.
    expect(interactiveSpanMs({ startedAt: null, now: 3_000, hiddenDuringSpan: false })).toBeNull();
  });

  it('refuses any span that touched a hidden document', () => {
    // THE nav-stall lesson (2026-07-25): 74.5% of every "freeze" that beacon
    // ever reported was a backgrounded tab's throttled timer. A span across a
    // hidden document measures the athlete's phone call, not this app.
    expect(interactiveSpanMs({ startedAt: 1_000, now: 3_000, hiddenDuringSpan: true })).toBeNull();
  });

  it('refuses a backwards device clock rather than reporting 0', () => {
    expect(interactiveSpanMs({ startedAt: 9_000, now: 4_000, hiddenDuringSpan: false })).toBeNull();
  });

  it('refuses anything past the ceiling — that is a suspended tab', () => {
    expect(
      interactiveSpanMs({ startedAt: 0, now: TTI_CEILING_MS + 1, hiddenDuringSpan: false })
    ).toBeNull();
    // 10 hours: iOS PWAs suspend without always firing pagehide.
    expect(
      interactiveSpanMs({ startedAt: 0, now: 36_000_000, hiddenDuringSpan: false })
    ).toBeNull();
  });

  it('refuses non-finite clocks', () => {
    expect(interactiveSpanMs({ startedAt: NaN, now: 1_000, hiddenDuringSpan: false })).toBeNull();
    expect(interactiveSpanMs({ startedAt: 1_000, now: Infinity, hiddenDuringSpan: false })).toBeNull();
  });
});

describe('activation TTI — the ceiling is the work order window', () => {
  it('is 60 seconds', () => {
    // "the first 60 seconds after onboarding completes" (WO-006). Changing it
    // changes what every historical row meant — pin it.
    expect(TTI_CEILING_MS).toBe(60_000);
  });
});

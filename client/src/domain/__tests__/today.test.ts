import { afterEach, describe, expect, it, vi } from 'vitest';

import { localIso, todayIso } from '../today';

afterEach(() => {
  vi.useRealTimers();
});

describe('todayIso — the athlete’s calendar day, not the server’s', () => {
  it('THE BUG: 8am Tuesday east of Greenwich is TUESDAY, not Monday', () => {
    // The instant: 2026-07-14 08:00 in UTC+10 == 2026-07-13 22:00 UTC.
    // toISOString().slice(0,10) says "2026-07-13" — Monday — so Train showed
    // Monday as today and marked Tuesday's session UPCOMING, while the athlete
    // stood in the gym on Tuesday morning.
    const instant = new Date('2026-07-13T22:00:00Z');
    vi.setSystemTime(instant);

    // What the old code did:
    expect(instant.toISOString().slice(0, 10)).toBe('2026-07-13');

    // What the athlete's phone says, in a UTC+10 timezone. We cannot change the
    // test runner's zone, so assert the RULE directly: the local calendar
    // fields are what we read.
    expect(todayIso()).toBe(localIso(instant));
    expect(todayIso()).toBe(
      `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(
        instant.getDate()
      ).padStart(2, '0')}`
    );
  });

  it('localIso never shifts a date across midnight', () => {
    // 00:30 local on the 14th is the 14th, whatever UTC thinks.
    const d = new Date(2026, 6, 14, 0, 30, 0);
    expect(localIso(d)).toBe('2026-07-14');
  });

  it('localIso never shifts a late-night date forward either', () => {
    const d = new Date(2026, 6, 14, 23, 45, 0);
    expect(localIso(d)).toBe('2026-07-14');
  });

  it('pads single-digit months and days', () => {
    expect(localIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('todayIso is always a well-formed calendar date', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

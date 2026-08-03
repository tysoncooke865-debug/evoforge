import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WINDOW_DAYS,
  MIN_SESSIONS,
  estimateEvoPerSession,
  formatEvoEstimate,
  type EvoRateSnapshot,
} from '../evo-per-session';

/**
 * This number appears on the app's primary CTA and is ABOUT the app's headline
 * statistic, so its refusals matter more than its arithmetic. Every branch that
 * returns null is pinned: those are the cases where showing a decimal would be
 * a fabrication rather than an estimate.
 */

const TODAY = '2026-08-03';
const daysAgo = (n: number): string => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString();
const dateAgo = (n: number): string => daysAgo(n).slice(0, 10);

const snaps = (...pairs: [rating: number, days: number][]): EvoRateSnapshot[] =>
  pairs.map(([displayedRating, d]) => ({ displayedRating, atIso: daysAgo(d) }));

const trainingDays = (n: number, from = 1): string[] =>
  Array.from({ length: n }, (_, i) => dateAgo(from + i * 3));

describe('estimateEvoPerSession', () => {
  it('is gain divided by DISTINCT training days, to one decimal', () => {
    // 46 now, 42 ninety days ago = +4 across 10 training days = 0.4/session.
    const r = estimateEvoPerSession({
      currentRating: 46,
      snapshots: snaps([42, 90], [44, 40]),
      trainingDates: trainingDays(10),
      todayIso: TODAY,
    });
    expect(r).not.toBeNull();
    expect(r!.perSession).toBe(0.4);
    expect(r!.sessions).toBe(10);
    expect(r!.gain).toBe(4);
  });

  it('counts a repeated date ONCE — the unit is days trained, not rows', () => {
    const r = estimateEvoPerSession({
      currentRating: 50,
      snapshots: snaps([46, 60], [48, 20]),
      trainingDates: [...trainingDays(8), dateAgo(1), dateAgo(1), dateAgo(4)],
      todayIso: TODAY,
    });
    expect(r!.sessions).toBe(8);
  });

  it('REFUSES when the rating did not go up — no "+0.0 EVO" on a CTA', () => {
    expect(
      estimateEvoPerSession({
        currentRating: 46,
        snapshots: snaps([46, 90], [46, 30]),
        trainingDates: trainingDays(12),
        todayIso: TODAY,
      })
    ).toBeNull();
    expect(
      estimateEvoPerSession({
        currentRating: 44,
        snapshots: snaps([46, 90], [45, 30]),
        trainingDates: trainingDays(12),
        todayIso: TODAY,
      })
    ).toBeNull();
  });

  it('REFUSES on a single snapshot — there is nothing to subtract', () => {
    expect(
      estimateEvoPerSession({
        currentRating: 46,
        snapshots: snaps([40, 60]),
        trainingDates: trainingDays(12),
        todayIso: TODAY,
      })
    ).toBeNull();
  });

  it(`REFUSES below ${MIN_SESSIONS} training days — that is noise, not a rate`, () => {
    const withN = (n: number) =>
      estimateEvoPerSession({
        currentRating: 46,
        snapshots: snaps([42, 90], [44, 30]),
        trainingDates: trainingDays(n),
        todayIso: TODAY,
      });
    expect(withN(MIN_SESSIONS - 1)).toBeNull();
    expect(withN(MIN_SESSIONS)).not.toBeNull();
  });

  it('ignores snapshots and training days OUTSIDE the window', () => {
    const r = estimateEvoPerSession({
      currentRating: 46,
      // The 30-rating reading is 400 days old: it must not become the baseline.
      snapshots: snaps([30, 400], [44, 100], [45, 20]),
      trainingDates: [...trainingDays(6), dateAgo(500), dateAgo(600)],
      todayIso: TODAY,
      windowDays: DEFAULT_WINDOW_DAYS,
    });
    expect(r!.gain).toBe(2); // 46 - 44, not 46 - 30
    expect(r!.sessions).toBe(6);
  });

  it('never rounds a real gain away to nothing', () => {
    // +1 across 40 sessions is 0.025 — floored to 0.1, never 0.0.
    const r = estimateEvoPerSession({
      currentRating: 46,
      snapshots: snaps([45, 100], [45, 50]),
      trainingDates: Array.from({ length: 40 }, (_, i) => dateAgo(i + 1)),
      todayIso: TODAY,
    });
    expect(r!.perSession).toBe(0.1);
  });

  it('survives garbage without inventing a number', () => {
    expect(
      estimateEvoPerSession({
        currentRating: Number.NaN,
        snapshots: snaps([40, 60], [44, 20]),
        trainingDates: trainingDays(10),
        todayIso: TODAY,
      })
    ).toBeNull();
    expect(
      estimateEvoPerSession({
        currentRating: 46,
        snapshots: [
          { displayedRating: Number.NaN, atIso: daysAgo(60) },
          { displayedRating: 44, atIso: 'not-a-date' },
        ],
        trainingDates: trainingDays(10),
        todayIso: TODAY,
      })
    ).toBeNull();
    expect(
      estimateEvoPerSession({
        currentRating: 46,
        snapshots: snaps([42, 60], [44, 20]),
        trainingDates: ['', 'nope', dateAgo(2)],
        todayIso: TODAY,
      })
    ).toBeNull(); // only one valid day, under MIN_SESSIONS
    expect(
      estimateEvoPerSession({
        currentRating: 46,
        snapshots: snaps([42, 60], [44, 20]),
        trainingDates: trainingDays(10),
        todayIso: 'not-a-date',
      })
    ).toBeNull();
  });

  it('a brand-new athlete gets nothing rather than a default', () => {
    expect(
      estimateEvoPerSession({
        currentRating: 12,
        snapshots: [],
        trainingDates: [],
        todayIso: TODAY,
      })
    ).toBeNull();
  });
});

describe('formatEvoEstimate', () => {
  it('always shows one decimal so the pill never jitters in width', () => {
    expect(formatEvoEstimate(0.4)).toBe('+0.4');
    expect(formatEvoEstimate(1)).toBe('+1.0');
    expect(formatEvoEstimate(0.1)).toBe('+0.1');
  });
});

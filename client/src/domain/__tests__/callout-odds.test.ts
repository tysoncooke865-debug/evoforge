import { describe, expect, it } from 'vitest';

import { ODDS_MAX, ODDS_MIN, estimateCallOdds, oddsLine } from '../callout-odds';
import type { WorkoutRow } from '../summary';

const TODAY = '2026-08-08';

const row = (date: string, weight: number, reps: number, set = 1, exercise = 'Bench Press'): WorkoutRow => ({
  date,
  workout: 'Push 1 - Strength',
  exercise,
  set,
  weight,
  reps,
  timestamp: `${date}T10:0${set}:00`,
});

/** N days before TODAY, as an ISO date. */
const ago = (days: number): string => {
  const d = new Date(Date.parse(`${TODAY}T00:00:00Z`) - days * 86_400_000);
  return d.toISOString().slice(0, 10);
};

const odds = (rows: WorkoutRow[], target = { loadMode: 'external' as const, weightKg: 100, reps: 5 }) =>
  estimateCallOdds({ rows, exercise: 'Bench Press', target, todayIso: TODAY });

describe('the estimate never claims more than it knows', () => {
  it('an athlete with no history sits at the middle and says EARLY ESTIMATE', () => {
    const o = odds([]);
    expect(o.hitProbability).toBe(0.5);
    expect(o.early).toBe(true);
    expect(o.evidence.recent_best).toBeNull();
  });

  it('one distant set is barely evidence at all', () => {
    const o = odds([row(ago(200), 140, 5)]);
    expect(o.early).toBe(true);
    // Wildly stronger than the call, and still nowhere near certainty.
    expect(o.hitProbability).toBeLessThan(0.75);
  });

  it('a deep, recent, comfortably stronger history is confident but never certain', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(ago(i * 4 + 1), 130, 8, (i % 3) + 1));
    const o = odds(rows);
    expect(o.hitProbability).toBeGreaterThan(0.8);
    expect(o.hitProbability).toBeLessThanOrEqual(ODDS_MAX);
    expect(o.early).toBe(false);
  });

  it('a hopeless call is discouraging but never impossible', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(ago(i * 4 + 1), 50, 5, (i % 3) + 1));
    const o = odds(rows);
    expect(o.hitProbability).toBeGreaterThanOrEqual(ODDS_MIN);
    expect(o.hitProbability).toBeLessThan(0.2);
  });

  it('the clamp holds against absurd inputs in both directions', () => {
    const strong = odds(Array.from({ length: 40 }, (_, i) => row(ago(i + 1), 400, 12, (i % 3) + 1)));
    const weak = odds(Array.from({ length: 40 }, (_, i) => row(ago(i + 1), 2.5, 1, (i % 3) + 1)));
    expect(strong.hitProbability).toBeLessThanOrEqual(ODDS_MAX);
    expect(weak.hitProbability).toBeGreaterThanOrEqual(ODDS_MIN);
  });

  it('hit and miss always add to one', () => {
    for (const rows of [[], [row(ago(3), 100, 5)], [row(ago(3), 200, 10)]]) {
      const o = odds(rows);
      expect(o.hitProbability + o.missProbability).toBeCloseTo(1, 5);
    }
  });
});

describe('the same session is evidence', () => {
  const base = Array.from({ length: 10 }, (_, i) => row(ago(i * 5 + 5), 100, 5, (i % 3) + 1));
  // Comfortably stronger than the call, so the estimate sits off both clamps
  // and fatigue has room to be visible.
  const strong = Array.from({ length: 20 }, (_, i) => row(ago(i * 4 + 4), 120, 5, (i % 3) + 1));

  it('sets already done today drag the estimate down a little', () => {
    const fresh = odds(strong);
    // Warm-ups: they cost energy without meeting the call, so only fatigue moves.
    const tired = odds([...strong, row(TODAY, 60, 12, 1), row(TODAY, 60, 12, 2), row(TODAY, 60, 12, 3)]);
    expect(tired.hitProbability).toBeLessThan(fresh.hitProbability);
  });

  it('but having ALREADY met the call today survives the confidence shrink', () => {
    const proved = odds([...base, row(TODAY, 100, 6, 1)]);
    expect(proved.hitProbability).toBeGreaterThanOrEqual(0.72);
    expect(proved.evidence.today).toEqual(['100 kg × 6']);
  });

  it('and it survives it even for an athlete with almost no history', () => {
    const novice = odds([row(TODAY, 100, 7, 1)]);
    expect(novice.hitProbability).toBeGreaterThanOrEqual(0.72);
    // Still honest about how little is known.
    expect(novice.early).toBe(true);
  });

  it('today\'s sets never count as the "recent best" — that is what came before', () => {
    const o = odds([row(ago(7), 90, 7), row(TODAY, 200, 10)]);
    expect(o.evidence.recent_best).toBe('90 kg × 7');
  });
});

describe('the trend nudges, and refuses to exist on thin data', () => {
  it('null with fewer than four sessions', () => {
    expect(odds([row(ago(3), 100, 5), row(ago(10), 100, 5)]).trend).toBeNull();
  });

  it('improving when the recent sessions are heavier', () => {
    const o = odds([
      row(ago(3), 120, 5), row(ago(10), 118, 5), row(ago(17), 116, 5),
      row(ago(24), 100, 5), row(ago(31), 99, 5), row(ago(38), 98, 5),
    ]);
    expect(o.trend).toBe('improving');
  });

  it('declining when they are lighter', () => {
    const o = odds([
      row(ago(3), 98, 5), row(ago(10), 99, 5), row(ago(17), 100, 5),
      row(ago(24), 118, 5), row(ago(31), 119, 5), row(ago(38), 120, 5),
    ]);
    expect(o.trend).toBe('declining');
  });

  it('stable when nothing much has moved', () => {
    const o = odds([
      row(ago(3), 100, 5), row(ago(10), 100, 5), row(ago(17), 101, 5),
      row(ago(24), 100, 5), row(ago(31), 100, 5), row(ago(38), 99, 5),
    ]);
    expect(o.trend).toBe('stable');
  });
});

describe('bodyweight work is judged as reps, never as a fabricated kilogram', () => {
  const bwTarget = { loadMode: 'bodyweight' as const, weightKg: null, reps: 8 };
  const pullups = (n: number, reps: number) =>
    Array.from({ length: n }, (_, i) => row(ago(i * 4 + 2), 0, reps, (i % 3) + 1, 'Pull-Up'));

  const bwOdds = (rows: WorkoutRow[]) =>
    estimateCallOdds({ rows, exercise: 'Pull-Up', target: bwTarget, todayIso: TODAY });

  it('an athlete who does twelve is likely to do eight', () => {
    const o = bwOdds(pullups(12, 12));
    expect(o.hitProbability).toBeGreaterThan(0.7);
  });

  it('an athlete who does five is not', () => {
    const o = bwOdds(pullups(12, 5));
    expect(o.hitProbability).toBeLessThan(0.3);
  });

  it('never reports a 0 kg estimate as a certainty of failure', () => {
    const o = bwOdds(pullups(12, 8));
    expect(o.hitProbability).toBeGreaterThan(ODDS_MIN);
    expect(o.evidence.recent_best).toBe('BW × 8');
  });

  it('the evidence names the target in words', () => {
    expect(bwOdds(pullups(4, 8)).evidence.target).toBe('BW × 8+');
  });
});

describe('the receipt is small and true', () => {
  it('carries what WHY THESE ODDS prints and nothing else', () => {
    const o = odds([row(ago(7), 90, 7), row(ago(14), 92, 6), row(TODAY, 90, 8, 1)]);
    expect(Object.keys(o.evidence).sort()).toEqual(
      ['early', 'recent_best', 'sets_seen', 'target', 'today', 'trend']
    );
    // Best by estimated 1RM, not by the biggest number: 90 × 7 beats 92 × 6.
    expect(o.evidence.recent_best).toBe('90 kg × 7');
    expect(o.evidence.sets_seen).toBe(3);
  });

  it('is versioned, so a later model can be told apart from this one', () => {
    expect(odds([]).modelVersion).toBe('callout-odds-v1');
  });

  it('the one line Train shows', () => {
    expect(oddsLine({ ...odds([]), hitProbability: 0.63, missProbability: 0.37 }))
      .toBe('HIT 63% · MISS 37%');
  });
});

describe('another exercise is not evidence about this one', () => {
  it('ignores rows for a different lift entirely', () => {
    const o = odds([
      row(ago(2), 300, 10, 1, 'Leg Press'),
      row(ago(3), 280, 10, 2, 'Leg Press'),
    ]);
    expect(o.hitProbability).toBe(0.5);
    expect(o.evidence.sets_seen).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';

import {
  execDimensions,
  execHealthScore,
  healthBand,
  type ExecHealthInput,
} from '../exec-health';

/** Production, 2026-07-25 — the numbers the exec report was written from. */
const today: ExecHealthInput = {
  post: { signed_up: 10, profiled: 10, origins: 8, activated: 3 },
  lifetime: { signed_up: 27, profiled: 24, origins: 12, activated: 10, trained_2d: 6, trained_4d: 2 },
  watchdogHealthy: true,
  testsGreen: true,
  pushSubscribers: 1,
};

describe('exec health — the real numbers', () => {
  it('scores today somewhere in the poor band, not flattering', () => {
    const score = execHealthScore(today);
    expect(score).toBeGreaterThan(30);
    expect(score).toBeLessThan(60);
    expect(healthBand(score)).toBe('poor');
  });

  it('reads activation from the POST-ORIGIN cohort, never lifetime', () => {
    // 3/10 = 30% (current product), NOT 10/27 = 37% (both products mixed).
    // Mixing the cohorts is what produced the wrong diagnosis on 2026-07-24.
    const activation = execDimensions(today).find((d) => d.key === 'activation');
    expect(activation?.actual).toBe('30%');
  });

  it('reads depth from lifetime, because two weeks cannot show a 4-day habit', () => {
    const depth = execDimensions(today).find((d) => d.key === 'depth');
    expect(depth?.actual).toBe('7%'); // 2/27
  });

  it('weights sum to 100 so the score is a real percentage', () => {
    expect(execDimensions(today).reduce((n, d) => n + d.weight, 0)).toBe(100);
  });
});

describe('exec health — the score actually moves', () => {
  it('rises when activation rises', () => {
    const better = { ...today, post: { ...today.post, activated: 6 } };
    expect(execHealthScore(better)).toBeGreaterThan(execHealthScore(today));
  });

  it('falls hard the moment nothing is watching production', () => {
    // The 2026-07-21 state: a 46-hour outage nobody saw.
    const blind = { ...today, watchdogHealthy: false };
    expect(execHealthScore(blind)).toBeLessThan(execHealthScore(today));
  });

  it('falls when the suite goes red', () => {
    expect(execHealthScore({ ...today, testsGreen: false })).toBeLessThan(execHealthScore(today));
  });
});

describe('exec health — it cannot produce a nonsense number', () => {
  it('survives a completely empty product without NaN or divide-by-zero', () => {
    const empty: ExecHealthInput = {
      post: { signed_up: 0, profiled: 0, origins: 0, activated: 0 },
      lifetime: { signed_up: 0, profiled: 0, origins: 0, activated: 0, trained_2d: 0, trained_4d: 0 },
      watchdogHealthy: false,
      testsGreen: false,
      pushSubscribers: 0,
    };
    const score = execHealthScore(empty);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(0);
    for (const d of execDimensions(empty)) expect(Number.isFinite(d.score)).toBe(true);
  });

  it('caps at 100 when a target is beaten, rather than reporting 340%', () => {
    const stellar: ExecHealthInput = {
      post: { signed_up: 10, profiled: 10, origins: 10, activated: 10 },
      lifetime: { signed_up: 10, profiled: 10, origins: 10, activated: 10, trained_2d: 10, trained_4d: 10 },
      watchdogHealthy: true,
      testsGreen: true,
      pushSubscribers: 100,
    };
    expect(execHealthScore(stellar)).toBe(100);
    for (const d of execDimensions(stellar)) expect(d.score).toBeLessThanOrEqual(100);
  });
});

describe('exec health — bands', () => {
  it('labels the ranges', () => {
    expect(healthBand(0)).toBe('critical');
    expect(healthBand(39)).toBe('critical');
    expect(healthBand(40)).toBe('poor');
    expect(healthBand(59)).toBe('poor');
    expect(healthBand(60)).toBe('fair');
    expect(healthBand(80)).toBe('good');
  });
});

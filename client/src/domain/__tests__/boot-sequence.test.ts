import { describe, expect, it } from 'vitest';

import {
  BOOT_HARD_CAP_MS,
  BOOT_REDUCED_MS,
  BOOT_STAGES,
  BOOT_TOTAL_MS,
  FORGE_ENVIRONMENTS,
  STAGE,
  bootProgress,
  forgeEnvironmentFor,
  seg,
  stageAt,
  stageStartMs,
  type BootStage,
} from '../boot-sequence';

/**
 * This runs before anything else the athlete sees, so the properties that
 * matter are the ones about TIME: that it ends, that it ends inside the
 * budget, and that the second deadline is genuinely later than the first.
 */

describe('the launch budget', () => {
  it('sits inside the brief’s 2.3–2.8s window', () => {
    expect(BOOT_TOTAL_MS).toBeGreaterThanOrEqual(2300);
    expect(BOOT_TOTAL_MS).toBeLessThanOrEqual(2800);
  });

  it('never exceeds the ~3s maximum launch time, cap included', () => {
    expect(BOOT_TOTAL_MS).toBeLessThan(3000);
    // The hard cap is a FAILSAFE for a throttled timer, not a second budget —
    // it must be comfortably later than the sequence or it would cut it short.
    expect(BOOT_HARD_CAP_MS).toBeGreaterThan(BOOT_TOTAL_MS + 1000);
  });

  it('reduced motion is a shorter sequence, not the same one', () => {
    expect(BOOT_REDUCED_MS).toBeLessThan(BOOT_TOTAL_MS / 2);
    expect(BOOT_REDUCED_MS).toBeGreaterThan(0);
  });
});

describe('the stage table', () => {
  it('is contiguous and exhaustive — no frame without a stage', () => {
    expect(BOOT_STAGES[0][1]).toBe(0);
    expect(BOOT_STAGES[BOOT_STAGES.length - 1][2]).toBe(1);
    for (let i = 1; i < BOOT_STAGES.length; i++) {
      expect(BOOT_STAGES[i][1], `gap before ${BOOT_STAGES[i][0]}`).toBe(BOOT_STAGES[i - 1][2]);
    }
  });

  it('is strictly ordered — every stage has real duration', () => {
    for (const [name, from, to] of BOOT_STAGES) {
      expect(to, name).toBeGreaterThan(from);
    }
  });

  it('lands each beat where the brief asks for it', () => {
    // "1.0s a massive cyber hammer strikes"
    expect(stageStartMs('strike')).toBeGreaterThanOrEqual(950);
    expect(stageStartMs('strike')).toBeLessThanOrEqual(1050);
    // "1.1s the logo is forged together"
    expect(stageStartMs('forge')).toBeGreaterThanOrEqual(1050);
    expect(stageStartMs('forge')).toBeLessThanOrEqual(1150);
    // "1.8s ... the tagline is laser-etched"
    expect(stageStartMs('etch')).toBeGreaterThanOrEqual(1750);
    expect(stageStartMs('etch')).toBeLessThanOrEqual(1850);
    // "2.5s the logo breaks apart"
    expect(stageStartMs('open')).toBeGreaterThanOrEqual(2400);
    expect(stageStartMs('open')).toBeLessThanOrEqual(2600);
  });

  it('the strike is a MOMENT, not a phase', () => {
    const [from, to] = STAGE.strike;
    expect(Math.round((to - from) * BOOT_TOTAL_MS)).toBeLessThanOrEqual(150);
  });
});

describe('stageAt', () => {
  const cases: [number, BootStage][] = [
    [-1, 'ember'],
    [0, 'ember'],
    [0.1, 'ember'],
    [0.2, 'spiral'],
    [0.38, 'strike'],
    [0.5, 'forge'],
    [0.8, 'etch'],
    [0.95, 'open'],
    [1, 'open'],
    [2, 'open'],
  ];
  for (const [t, stage] of cases) {
    it(`t=${t} → ${stage}`, () => expect(stageAt(t)).toBe(stage));
  }

  it('agrees with the table at every boundary', () => {
    for (const [name, from] of BOOT_STAGES) {
      expect(stageAt(from), `${name} start`).toBe(name);
    }
  });

  it('never returns undefined for any position in the sequence', () => {
    for (let i = 0; i <= 100; i++) {
      expect(stageAt(i / 100)).toBeTruthy();
    }
  });
});

describe('seg and bootProgress', () => {
  it('seg clamps at both ends rather than running negative or past one', () => {
    expect(seg(0, 0.2, 0.6)).toBe(0);
    expect(seg(0.4, 0.2, 0.6)).toBeCloseTo(0.5, 6);
    expect(seg(0.9, 0.2, 0.6)).toBe(1);
  });

  it('bootProgress clamps — a late timer must not overshoot the animation', () => {
    expect(bootProgress(-50)).toBe(0);
    expect(bootProgress(BOOT_TOTAL_MS / 2)).toBeCloseTo(0.5, 6);
    expect(bootProgress(BOOT_TOTAL_MS * 3)).toBe(1);
  });
});

describe('forge environments', () => {
  it('offers the five the brief names', () => {
    expect(FORGE_ENVIRONMENTS.map((e) => e.key)).toEqual([
      'cyber',
      'ancient',
      'space',
      'volcanic',
      'frozen',
    ]);
  });

  it('is stable within a day and changes across consecutive days', () => {
    expect(forgeEnvironmentFor('2026-08-03').key).toBe(forgeEnvironmentFor('2026-08-03').key);
    const week = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'];
    for (let i = 1; i < week.length; i++) {
      expect(forgeEnvironmentFor(week[i]).key, week[i]).not.toBe(forgeEnvironmentFor(week[i - 1]).key);
    }
  });

  it('reaches every environment across a month — none is unreachable', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 31; d++) {
      seen.add(forgeEnvironmentFor(`2026-08-${String(d).padStart(2, '0')}`).key);
    }
    expect(seen.size).toBe(FORGE_ENVIRONMENTS.length);
  });

  it('names TOKENS, never hex — the palette stays the single source of truth', () => {
    for (const e of FORGE_ENVIRONMENTS) {
      expect(e.ember, e.key).not.toMatch(/^#/);
      expect(e.halo, e.key).not.toMatch(/^#/);
      expect(e.label).toBe(e.label.toUpperCase());
    }
  });
});

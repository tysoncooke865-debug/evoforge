import { describe, expect, it } from 'vitest';

import {
  attributeLines,
  bodyfatScale,
  mainWeakness,
  massSplit,
  physiqueTier,
  scanProgress,
  scoreOutOf100,
  topStrength,
} from '../oracle';

describe('physiqueTier — the game band over a /15 score', () => {
  it('maps each band by its floor', () => {
    expect(physiqueTier(0).tier).toBe('FORGING');
    expect(physiqueTier(5.9).tier).toBe('FORGING');
    expect(physiqueTier(6).tier).toBe('RISING');
    expect(physiqueTier(9).tier).toBe('SHREDDED');
    expect(physiqueTier(12).tier).toBe('ELITE');
    expect(physiqueTier(14).tier).toBe('MYTHIC');
    expect(physiqueTier(15).tier).toBe('MYTHIC');
  });

  it('a non-finite score reads as the floor tier, never throws', () => {
    expect(physiqueTier(Number.NaN).tier).toBe('FORGING');
  });
});

describe('scoreOutOf100 — the same rating on a 100 face', () => {
  it('scales /15 to /100, rounded and clamped', () => {
    expect(scoreOutOf100(15)).toBe(100);
    expect(scoreOutOf100(12)).toBe(80);
    expect(scoreOutOf100(0)).toBe(0);
    expect(scoreOutOf100(7.5)).toBe(50);
  });

  it('never escapes 0–100', () => {
    expect(scoreOutOf100(99)).toBe(100);
    expect(scoreOutOf100(-4)).toBe(0);
  });
});

describe('attribute lines — strength and weakness', () => {
  const lines = attributeLines({ muscularity_score: 11, leanness_score: 7, symmetry_score: 9 });

  it('lists the three real sub-scores in order', () => {
    expect(lines.map((l) => l.key)).toEqual(['muscularity', 'leanness', 'symmetry']);
  });

  it('top strength is the highest, main weakness the lowest', () => {
    expect(topStrength(lines)?.key).toBe('muscularity');
    expect(mainWeakness(lines)?.key).toBe('leanness');
  });

  it('empty in → null out (guards over an empty set)', () => {
    expect(topStrength([])).toBeNull();
    expect(mainWeakness([])).toBeNull();
  });

  it('a tie resolves to the first in display order', () => {
    const flat = attributeLines({ muscularity_score: 8, leanness_score: 8, symmetry_score: 8 });
    expect(topStrength(flat)?.key).toBe('muscularity');
    expect(mainWeakness(flat)?.key).toBe('muscularity');
  });
});

describe('bodyfatScale — label and marker never disagree', () => {
  it('bands the axis', () => {
    expect(bodyfatScale(8).band).toBe('SHREDDED');
    expect(bodyfatScale(13).band).toBe('ATHLETIC');
    expect(bodyfatScale(18).band).toBe('AVERAGE');
    expect(bodyfatScale(28).band).toBe('HIGH');
  });

  it('places the marker along 4–35% and clamps the extremes', () => {
    expect(bodyfatScale(4).markerPct).toBe(0);
    expect(bodyfatScale(35).markerPct).toBe(1);
    expect(bodyfatScale(2).markerPct).toBe(0);
    expect(bodyfatScale(40).markerPct).toBe(1);
    expect(bodyfatScale(19.5).markerPct).toBeCloseTo(0.5, 5);
  });
});

describe('massSplit — omit rather than fabricate a frame', () => {
  it('splits a known weight by bf%', () => {
    expect(massSplit(80, 15)).toEqual({ fatKg: 12, leanKg: 68 });
  });

  it('null weight → null (no invented 77 kg here)', () => {
    expect(massSplit(null, 15)).toBeNull();
  });

  it('garbage bf → null', () => {
    expect(massSplit(80, 0)).toBeNull();
    expect(massSplit(80, 120)).toBeNull();
  });
});

describe('scanProgress — the honest before/current comparison', () => {
  const rows = [
    { physique_score: 8, muscularity_score: 7, leanness_score: 6, symmetry_score: 8 },
    { physique_score: 9, muscularity_score: 8, leanness_score: 7, symmetry_score: 8 },
    { physique_score: 11, muscularity_score: 10, leanness_score: 9, symmetry_score: 9 },
  ];

  it('deltas run first → latest', () => {
    const p = scanProgress(rows, [22, 18, 14]);
    expect(p.scans).toBe(3);
    expect(p.muscularityDelta).toBe(3);
    expect(p.physiqueDelta).toBe(3);
    // Body fat: a DROP is the win, so first − latest is positive.
    expect(p.bfDelta).toBe(8);
  });

  it('one scan → no deltas (nothing to compare)', () => {
    const p = scanProgress([rows[0]], [22]);
    expect(p.scans).toBe(1);
    expect(p.muscularityDelta).toBeNull();
    expect(p.bfDelta).toBeNull();
  });

  it('empty → zero scans, all null', () => {
    const p = scanProgress([], []);
    expect(p).toMatchObject({ scans: 0, physiqueDelta: null, bfDelta: null });
  });
});

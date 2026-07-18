/**
 * ORACLE_REDESIGN — the pure presentation maths for the AI analysis page.
 * No react, no supabase, no wall-clock. The AI returns /15 sub-scores and a
 * /15 overall; the page speaks in tiers and a 0–100 face. Everything a screen
 * shows about a verdict is derived HERE so it can be tested against the ranges.
 */

/** A named band for a physique score — the game layer over a raw number. */
export type PhysiqueTier = 'FORGING' | 'RISING' | 'SHREDDED' | 'ELITE' | 'MYTHIC';

export interface TierBand {
  tier: PhysiqueTier;
  /** Token KEY for the tier's colour — resolved through the theme at render. */
  colourKey: 'text-dim' | 'accent' | 'success' | 'epic' | 'mythic';
}

/**
 * A /15 physique score → tier. Bands are inclusive-low: a wall at 12 is the
 * ELITE floor. Falsify when touching: move a boundary, watch the test go red.
 */
export function physiqueTier(score15: number): TierBand {
  const s = Number.isFinite(score15) ? score15 : 0;
  if (s >= 14) return { tier: 'MYTHIC', colourKey: 'mythic' };
  if (s >= 12) return { tier: 'ELITE', colourKey: 'epic' };
  if (s >= 9) return { tier: 'SHREDDED', colourKey: 'success' };
  if (s >= 6) return { tier: 'RISING', colourKey: 'accent' };
  return { tier: 'FORGING', colourKey: 'text-dim' };
}

/** The /15 overall shown on a 0–100 face — the same rating, as a percentage
 *  of the ceiling. Rounded, clamped; never invents precision. */
export function scoreOutOf100(score15: number): number {
  const s = Number.isFinite(score15) ? score15 : 0;
  return Math.max(0, Math.min(100, Math.round((s / 15) * 100)));
}

export interface AttributeLine {
  key: 'muscularity' | 'leanness' | 'symmetry';
  label: string;
  value: number;
  /** Token KEY for the bar colour. */
  colourKey: 'epic' | 'success' | 'mythic';
}

/** The three real sub-scores, in display order, from a physique verdict. */
export function attributeLines(v: {
  muscularity_score: number;
  leanness_score: number;
  symmetry_score: number;
}): AttributeLine[] {
  return [
    { key: 'muscularity', label: 'MUSCULARITY', value: v.muscularity_score, colourKey: 'epic' },
    { key: 'leanness', label: 'LEANNESS', value: v.leanness_score, colourKey: 'success' },
    { key: 'symmetry', label: 'SYMMETRY', value: v.symmetry_score, colourKey: 'mythic' },
  ];
}

/** Highest-scoring attribute — the "Top Strength". Ties resolve by order. */
export function topStrength(lines: readonly AttributeLine[]): AttributeLine | null {
  if (lines.length === 0) return null;
  return lines.reduce((best, l) => (l.value > best.value ? l : best), lines[0]);
}

/** Lowest-scoring attribute — the "Main Weakness". Ties resolve by order. */
export function mainWeakness(lines: readonly AttributeLine[]): AttributeLine | null {
  if (lines.length === 0) return null;
  return lines.reduce((worst, l) => (l.value < worst.value ? l : worst), lines[0]);
}

/**
 * A body-fat percentage → one of the four labelled bands, with the marker's
 * position along a fixed 4–35% scale (0–1). Both are derived together so the
 * label and the marker can never disagree.
 */
export type BodyfatBand = 'SHREDDED' | 'ATHLETIC' | 'AVERAGE' | 'HIGH';

export interface BodyfatScale {
  band: BodyfatBand;
  /** 0–1 position along the [SCALE_MIN, SCALE_MAX] axis for the marker. */
  markerPct: number;
}

export const BF_SCALE_MIN = 4;
export const BF_SCALE_MAX = 35;

/** Male-leaning bands (the app's default frame); women read one band leaner
 *  but the axis is shared — the notes carry the nuance. */
export function bodyfatScale(bfMid: number): BodyfatScale {
  const bf = Number.isFinite(bfMid) ? bfMid : 0;
  const band: BodyfatBand = bf < 10 ? 'SHREDDED' : bf < 15 ? 'ATHLETIC' : bf < 22 ? 'AVERAGE' : 'HIGH';
  const markerPct = Math.max(
    0,
    Math.min(1, (bf - BF_SCALE_MIN) / (BF_SCALE_MAX - BF_SCALE_MIN))
  );
  return { band, markerPct };
}

export interface MassSplit {
  fatKg: number;
  leanKg: number;
}

/** Fat vs lean mass from a bodyweight and bf% — only when the weight is
 *  known. Returns null rather than inventing a frame (the house rule: omit,
 *  never fabricate). */
export function massSplit(bodyweightKg: number | null, bfMid: number): MassSplit | null {
  if (bodyweightKg === null || !Number.isFinite(bodyweightKg) || bodyweightKg <= 0) return null;
  if (!Number.isFinite(bfMid) || bfMid <= 0 || bfMid >= 100) return null;
  const fatKg = Math.round(((bodyweightKg * bfMid) / 100) * 10) / 10;
  const leanKg = Math.round((bodyweightKg - fatKg) * 10) / 10;
  return { fatKg, leanKg };
}

/**
 * The honest progress line between the first and latest verdict of a series.
 * Positive delta = improvement for scores; for body fat a DROP is the win,
 * so bfDelta is reported as first−latest (positive = fat lost).
 */
export interface ScanProgress {
  scans: number;
  muscularityDelta: number | null;
  leannessDelta: number | null;
  symmetryDelta: number | null;
  physiqueDelta: number | null;
  bfDelta: number | null;
}

interface PhysiqueRow {
  physique_score?: unknown;
  muscularity_score?: unknown;
  leanness_score?: unknown;
  symmetry_score?: unknown;
}

const n = (v: unknown): number | null => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const delta = (first: number | null, last: number | null): number | null =>
  first === null || last === null ? null : Math.round((last - first) * 10) / 10;

export function scanProgress(
  physiqueRows: readonly PhysiqueRow[],
  bfSeries: readonly number[]
): ScanProgress {
  const scans = physiqueRows.length;
  const first = physiqueRows[0];
  const last = physiqueRows[physiqueRows.length - 1];
  const twoScans = scans >= 2;
  return {
    scans,
    muscularityDelta: twoScans ? delta(n(first?.muscularity_score), n(last?.muscularity_score)) : null,
    leannessDelta: twoScans ? delta(n(first?.leanness_score), n(last?.leanness_score)) : null,
    symmetryDelta: twoScans ? delta(n(first?.symmetry_score), n(last?.symmetry_score)) : null,
    physiqueDelta: twoScans ? delta(n(first?.physique_score), n(last?.physique_score)) : null,
    // Body fat: first − latest, so a positive number is fat LOST.
    bfDelta:
      bfSeries.length >= 2 ? Math.round((bfSeries[0] - bfSeries[bfSeries.length - 1]) * 10) / 10 : null,
  };
}

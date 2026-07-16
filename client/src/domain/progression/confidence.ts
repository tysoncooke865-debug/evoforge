/**
 * PROGRESSION_OVERHAUL — shared confidence arithmetic (spec §13/§18).
 * Confidence decays with evidence AGE before any score ever moves —
 * inactivity makes the rating UNCONFIRMED, not smaller.
 */

/** Days between two ISO dates (calendar, UTC parse of local-day strings). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86_400_000);
}

/**
 * 1.0 while fresh, linear fade to `floor` across the stale window.
 * freshDays=28, staleDays=90 ⇒ full weight for 4 weeks, 40% at ~90 days.
 */
export function recencyWeight(
  ageDays: number,
  { freshDays = 28, staleDays = 90, floor = 0.4 }: { freshDays?: number; staleDays?: number; floor?: number } = {}
): number {
  if (!Number.isFinite(ageDays) || ageDays >= 10_000) return floor;
  if (ageDays <= freshDays) return 1;
  if (ageDays >= staleDays) return floor;
  const t = (ageDays - freshDays) / (staleDays - freshDays);
  return 1 - t * (1 - floor);
}

/** Diminishing-returns evidence confidence: 0 pieces → base, each piece
 *  closes a fraction of the remaining gap to `max`. */
export function evidenceConfidence(
  count: number,
  { base = 20, max = 90, perItem = 0.35 }: { base?: number; max?: number; perItem?: number } = {}
): number {
  const n = Math.max(0, Math.floor(count));
  return Math.round(max - (max - base) * Math.pow(1 - perItem, n));
}

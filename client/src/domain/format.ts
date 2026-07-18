/**
 * Compact display numbers (2026-07-19, the Home coin row). 13000 → "13K",
 * 13120 → "13.1K" — never more than 3 significant digits, so the string
 * stays ≤ 4 chars + suffix and fits beside a sprite.
 *
 * DISPLAY ONLY. The real total is never rounded anywhere but the screen —
 * ranking, spending and the ledger all use the exact number.
 */
const STEPS: { at: number; div: number; suffix: string }[] = [
  { at: 1_000_000_000, div: 1_000_000_000, suffix: 'B' },
  { at: 1_000_000, div: 1_000_000, suffix: 'M' },
  { at: 1_000, div: 1_000, suffix: 'K' },
];

export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 1000) return `${sign}${Math.round(abs)}`;

  for (const { at, div, suffix } of STEPS) {
    if (abs < at) continue;
    const scaled = abs / div;
    // One decimal below 100 of the unit (13.1K), none at or above (131K) —
    // both stay within 3 significant digits.
    let out = scaled >= 99.95 ? Math.round(scaled).toString() : scaled.toFixed(1);
    if (out.endsWith('.0')) out = out.slice(0, -2);
    // Rounding can carry into the next unit (999950 → "1000K"): restart with
    // the carried value so it renders 1M, not 1000K. STEPS iterates largest
    // first, so a plain `continue` would only ever check SMALLER units.
    if (Number.parseFloat(out) >= 1000) {
      return `${sign}${formatCompact(Number.parseFloat(out) * div)}`;
    }
    return `${sign}${out}${suffix}`;
  }
  return `${sign}${Math.round(abs)}`;
}

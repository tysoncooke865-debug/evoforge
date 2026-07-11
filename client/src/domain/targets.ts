/** Port of the pure part of `domain/targets.py`. */

import { pyFloat } from './py';

/**
 * How far along the road from `baseline` to `target` you are, 0-100.
 *
 * A RATIO cannot express a goal that moves downward: current/target reads 107%
 * for an athlete cutting 85->75 standing at 80. So measure distance travelled
 * over distance to travel: (current - baseline) / (target - baseline). Cutting
 * and bulking midpoints both read 50. Overshoot clamps to 100; moving the
 * wrong way clamps to 0. Null when the numbers cannot support an answer --
 * the caller shows "set a target", never a bar that means nothing.
 */
export function journeyPercent(
  baseline: unknown,
  current: unknown,
  target: unknown
): number | null {
  const b = pyFloat(baseline);
  const c = pyFloat(current);
  const t = pyFloat(target);
  if (b === null || c === null || t === null || [b, c, t].some((v) => Number.isNaN(v))) {
    return null;
  }

  const span = t - b;
  if (span === 0) {
    return c === t ? 100.0 : 0.0;
  }

  const percent = ((c - b) / span) * 100.0;
  return Math.max(0.0, Math.min(100.0, percent));
}

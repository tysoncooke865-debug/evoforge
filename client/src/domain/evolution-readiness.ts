/**
 * How close the athlete is to their next evolution: the clamped mean of
 * per-requirement progress from nextEvolutionInfo's output. No projections,
 * no fabricated math — each requirement's progress is current/target clamped
 * to [0,1] (met = 1), Body Fat inverted because leaner is progress.
 */

import type { EvolutionRequirement } from './next-evolution';

export function requirementProgress(req: EvolutionRequirement): number {
  if (req.met) return 1;
  if (req.label === 'Body Fat') {
    // Progress toward a DOWNWARD target: unmeasured (current 0 from the
    // domain port when no reading exists) is honest zero; otherwise scale
    // from a 2x-target baseline so 24%→12% reads as climbing, capped shy of
    // done until actually met.
    if (req.current <= 0) return 0;
    const span = req.target; // baseline 2*target → target
    const travelled = Math.max(0, 2 * req.target - req.current);
    return Math.max(0, Math.min(0.99, travelled / span));
  }
  if (req.target <= 0) return 0;
  return Math.max(0, Math.min(0.99, req.current / req.target));
}

export interface Readiness {
  /** 0-100, floor'd — 100 only when every requirement is met. */
  percent: number;
  /** The unmet requirement closest to done (quick win), if any. */
  nearest: EvolutionRequirement | null;
  /** The unmet requirement furthest from done (the wall), if any. */
  hardest: EvolutionRequirement | null;
}

export function evolutionReadiness(requirements: EvolutionRequirement[]): Readiness {
  if (requirements.length === 0) {
    return { percent: 0, nearest: null, hardest: null };
  }
  const progresses = requirements.map(requirementProgress);
  const mean = progresses.reduce((a, b) => a + b, 0) / requirements.length;
  const allMet = requirements.every((r) => r.met);
  const percent = allMet ? 100 : Math.min(99, Math.floor(mean * 100));

  const unmet = requirements
    .map((r, i) => ({ r, p: progresses[i] }))
    .filter(({ r }) => !r.met)
    .sort((a, b) => b.p - a.p);

  return {
    percent,
    nearest: unmet[0]?.r ?? null,
    hardest: unmet[unmet.length - 1]?.r ?? null,
  };
}

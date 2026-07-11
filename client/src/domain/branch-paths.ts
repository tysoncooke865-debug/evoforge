/**
 * What it takes to CHANGE BRANCH — derived from the exact gates in
 * determineAvatarBranch (parity-pinned), never restated numbers:
 *
 *   mass:   size >= max(aesthetic, conditioning) && strength >= 55 && size >= 55
 *   hybrid: conditioning >= 55 && strength >= 45   (mass checked first)
 *
 * Each path renders as EvolutionRequirement rows so the Avatar screen reuses
 * RequirementRow. A self-consistency test guards honesty: scores meeting every
 * row of a path MUST make determineAvatarBranch return that branch (mass), or
 * return it when mass's gates are not also met (hybrid precedence).
 */

import type { Branch } from './avatar-stats';
import type { EvolutionRequirement } from './next-evolution';

export interface Scores {
  strength: number;
  size: number;
  conditioning: number;
  aesthetic: number;
}

export interface BranchPath {
  branch: Branch;
  requirements: EvolutionRequirement[];
  /** Precedence caveat, when one applies. */
  note?: string;
}

const req = (label: string, current: number, target: number): EvolutionRequirement => ({
  label,
  current,
  target,
  met: current >= target,
});

export function branchPaths(current: Branch, s: Scores): BranchPath[] {
  const paths: BranchPath[] = [];

  if (current !== 'mass') {
    paths.push({
      branch: 'mass',
      requirements: [
        req('Strength', s.strength, 55),
        req('Size', s.size, 55),
        // size >= max(aesthetic, conditioning), split into readable rows
        req('Size ≥ Aesthetic', s.size, s.aesthetic),
        req('Size ≥ Conditioning', s.size, s.conditioning),
      ],
    });
  }

  if (current !== 'hybrid') {
    paths.push({
      branch: 'hybrid',
      requirements: [req('Conditioning', s.conditioning, 55), req('Strength', s.strength, 45)],
      note: 'Mass takes precedence: if the Mass gates are also met, the character branches Mass.',
    });
  }

  return paths;
}

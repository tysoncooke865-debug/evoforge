/**
 * BRANCH SYSTEM V2 — five classes, layered on the parity-pinned core.
 *
 * The Streamlit app (live until cutover) knows three branches, and
 * determineAvatarBranch is golden-fixtured against it — so v2 does not touch
 * it. Instead the two NEW classes are EXTREME tiers checked first, with gates
 * strictly above the core ones, then everything falls through to the pinned
 * resolver. Consequence, by construction: nobody who is mass/hybrid/aesthetic
 * today changes branch unless they genuinely cross an extreme gate.
 *
 *   TITAN           strength >= 80 && size >= 70 && size >= max(aes, cond)
 *   CARDIO MACHINE  conditioning >= 70 && conditioning >= every other stat
 *   (else) mass / hybrid / aesthetic via the pinned core rule.
 *
 * Self-consistency tests pin that meeting a path's displayed gates really
 * resolves to that branch. PARITY.md records this as a deliberate new-app
 * divergence.
 */

import { determineAvatarBranch, getBranchStage, type Branch } from './avatar-stats';
import type { EvolutionRequirement, NextEvolution } from './next-evolution';
import { nextEvolutionInfo } from './next-evolution';

export type BranchV2 = Branch | 'titan' | 'cardio';

export interface ScoresV2 {
  strength: number;
  size: number;
  leanness: number;
  conditioning: number;
  aesthetic: number;
}

export function resolveBranchV2(s: ScoresV2): BranchV2 {
  if (s.strength >= 80 && s.size >= 70 && s.size >= Math.max(s.aesthetic, s.conditioning)) {
    return 'titan';
  }
  if (
    s.conditioning >= 70 &&
    s.conditioning >= Math.max(s.strength, s.size, s.aesthetic, s.leanness)
  ) {
    return 'cardio';
  }
  return determineAvatarBranch({
    strength_score: s.strength,
    size_score: s.size,
    conditioning_score: s.conditioning,
    aesthetic_score: s.aesthetic,
  });
}

export function branchDisplayNameV2(branch: BranchV2): string {
  switch (branch) {
    case 'titan':
      return '🗿 Titan';
    case 'cardio':
      return '🫀 Cardio Machine';
    case 'mass':
      return '🦍 Mass Monster';
    case 'hybrid':
      return '⚡ Hybrid Athlete';
    default:
      return '💎 Aesthetic';
  }
}

/** Evolution ladders for the new classes (core classes keep theirs). */
const V2_LADDERS: Record<'titan' | 'cardio', [number, string][]> = {
  titan: [
    [1, 'Cyber Recruit'],
    [25, 'Bulwark'],
    [50, 'Juggernaut'],
    [75, 'Colossus'],
    [100, 'World Breaker'],
  ],
  cardio: [
    [1, 'Cyber Recruit'],
    [25, 'Pacer'],
    [50, 'Enduro'],
    [75, 'Apex Engine'],
    [100, 'Perpetual'],
  ],
};

export function evolutionNameV2(branch: BranchV2, level: number): string {
  if (branch === 'titan' || branch === 'cardio') {
    const ladder = V2_LADDERS[branch];
    let name = ladder[0][1];
    for (const [unlock, n] of ladder) {
      if (level >= unlock) name = n;
    }
    return name;
  }
  // Core branches: the pinned ladder via the parity-tested function.
  // (Imported lazily by callers through evolutionName; kept here for one API.)
  return CORE_EVOLUTION(branch, level);
}

// Core evolution names re-declared through the pinned function to keep a
// single v2 entry point without a circular import.
import { evolutionName as CORE_EVOLUTION } from './avatar-stats';

export interface StageRowV2 {
  level: number;
  name: string;
  stage: number;
  unlocked: boolean;
  current: boolean;
}

export function avatarStageRowsV2(branch: BranchV2, level: number): StageRowV2[] {
  if (branch === 'titan' || branch === 'cardio') {
    const ladder = V2_LADDERS[branch];
    const unlockedLevels = ladder.filter(([u]) => level >= u).map(([u]) => u);
    const highest = unlockedLevels.length ? Math.max(...unlockedLevels) : null;
    // Stage art mapping mirrors the 3-stage non-aesthetic scheme.
    const stageFor = (unlock: number) => (unlock >= 75 ? 3 : unlock >= 50 ? 2 : 1);
    return ladder.map(([unlock, name]) => ({
      level: unlock,
      name,
      stage: stageFor(unlock),
      unlocked: level >= unlock,
      current: level >= unlock && unlock === highest,
    }));
  }
  // Core branches use the pinned rows.
  return CORE_ROWS(branch, level);
}

import { avatarStageRows as CORE_ROWS } from './xp-leveling';

/**
 * Next-evolution requirements for v2 branches. Core branches delegate to the
 * pinned nextEvolutionInfo; the new classes get gates in the same spirit
 * (level target + a class-defining performance requirement).
 */
export function nextEvolutionV2(
  branch: BranchV2,
  inputs: {
    level: number;
    benchE1rm: number;
    bfMid: number | null;
    totalSets: number;
    cardioMinutes: number;
  }
): NextEvolution {
  if (branch !== 'titan' && branch !== 'cardio') {
    return nextEvolutionInfo(branch, inputs);
  }

  const level = Math.trunc(inputs.level);
  let targetLevel: number;
  let targetName: string;
  const ladder = V2_LADDERS[branch];
  const next = ladder.find(([u]) => u > level);
  if (next) {
    [targetLevel, targetName] = next;
  } else {
    targetLevel = 100;
    targetName = ladder[ladder.length - 1][1];
  }

  const reqs: EvolutionRequirement[] = [
    { label: 'Level', current: level, target: targetLevel, met: level >= targetLevel },
  ];
  if (branch === 'titan') {
    const targetBench = level >= 75 ? 140 : 120;
    const targetSets = level >= 75 ? 400 : 200;
    reqs.push({ label: 'Bench', current: inputs.benchE1rm, target: targetBench, met: inputs.benchE1rm >= targetBench });
    reqs.push({ label: 'Total Sets', current: inputs.totalSets, target: targetSets, met: inputs.totalSets >= targetSets });
  } else {
    const targetMinutes = level >= 75 ? 1000 : 500;
    reqs.push({
      label: 'Cardio Minutes',
      current: inputs.cardioMinutes,
      target: targetMinutes,
      met: inputs.cardioMinutes >= targetMinutes,
    });
  }
  return { targetName, targetLevel, requirements: reqs };
}

/** Branch-switch paths across ALL five classes (v2 gates + core gates). */
export interface BranchPathV2 {
  branch: BranchV2;
  requirements: EvolutionRequirement[];
  note?: string;
}

const req = (label: string, current: number, target: number): EvolutionRequirement => ({
  label,
  current,
  target,
  met: current >= target,
});

export function branchPathsV2(current: BranchV2, s: ScoresV2): BranchPathV2[] {
  const paths: BranchPathV2[] = [];

  if (current !== 'titan') {
    paths.push({
      branch: 'titan',
      requirements: [
        req('Strength', s.strength, 80),
        req('Size', s.size, 70),
        req('Size ≥ Aesthetic', s.size, s.aesthetic),
        req('Size ≥ Conditioning', s.size, s.conditioning),
      ],
    });
  }
  if (current !== 'cardio') {
    paths.push({
      branch: 'cardio',
      requirements: [
        req('Conditioning', s.conditioning, 70),
        req('Cond ≥ Strength', s.conditioning, s.strength),
        req('Cond ≥ Size', s.conditioning, s.size),
        req('Cond ≥ Aesthetic', s.conditioning, s.aesthetic),
        req('Cond ≥ Leanness', s.conditioning, s.leanness),
      ],
      note: 'Titan takes precedence if its gates are also met.',
    });
  }
  if (current !== 'mass') {
    paths.push({
      branch: 'mass',
      requirements: [
        req('Strength', s.strength, 55),
        req('Size', s.size, 55),
        req('Size ≥ Aesthetic', s.size, s.aesthetic),
        req('Size ≥ Conditioning', s.size, s.conditioning),
      ],
      note: 'Titan takes precedence if its gates are also met.',
    });
  }
  if (current !== 'hybrid') {
    paths.push({
      branch: 'hybrid',
      requirements: [req('Conditioning', s.conditioning, 55), req('Strength', s.strength, 45)],
      note: 'Cardio Machine, Titan and Mass all take precedence if their gates are met.',
    });
  }

  return paths;
}

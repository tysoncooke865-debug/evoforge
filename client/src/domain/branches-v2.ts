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

import { determineAvatarBranch, evolutionName as CORE_EVOLUTION, type Branch } from './avatar-stats';
import type { EvolutionRequirement, NextEvolution } from './next-evolution';
import { nextEvolutionInfo } from './next-evolution';
import { avatarStageRows as CORE_ROWS } from './xp-leveling';

export type BranchV2 = Branch | 'titan' | 'cardio' | 'shredder';

/**
 * THE SHREDDER — the redemption arc. Entry is by STARTING CONDITION, not stat
 * mix: first body-fat reading >= 25% AND currently cutting. The class expires
 * when the phase changes (fall through to the other resolvers). Its stages
 * are driven by BODY FAT FALLING, not level:
 *
 *   stage 1  bf >= 25   Hooded Resolve
 *   stage 2  bf <  25   The Grind
 *   stage 3  bf <  18   Cut Deep
 *   stage 4  bf <= 12   Shredded (jacked & shredded — the final form)
 */
export interface BranchContext {
  nutritionPhase: string | null;
  /** First-ever body-fat reading (the athlete's starting condition). */
  earliestBf: number | null;
}

export const SHREDDER_ENTRY_BF = 25;
export const SHREDDER_STAGE_BF = { stage2: 25, stage3: 18, stage4: 12 } as const;

export function isShredder(ctx: BranchContext | undefined): boolean {
  return (
    ctx !== undefined &&
    ctx.nutritionPhase === 'cutting' &&
    ctx.earliestBf !== null &&
    ctx.earliestBf >= SHREDDER_ENTRY_BF
  );
}

export function shredderStage(bfMid: number | null): number {
  if (bfMid === null) return 1;
  if (bfMid <= SHREDDER_STAGE_BF.stage4) return 4;
  if (bfMid < SHREDDER_STAGE_BF.stage3) return 3;
  if (bfMid < SHREDDER_STAGE_BF.stage2) return 2;
  return 1;
}

const SHREDDER_LADDER: [number | null, string][] = [
  [null, 'Hooded Resolve'], // the start: bf >= 25, hood up, head down
  [SHREDDER_STAGE_BF.stage2, 'The Grind'],
  [SHREDDER_STAGE_BF.stage3, 'Cut Deep'],
  [SHREDDER_STAGE_BF.stage4, 'Shredded'],
];

export function shredderName(bfMid: number | null): string {
  return SHREDDER_LADDER[shredderStage(bfMid) - 1][1];
}

export interface ShredderRow {
  stage: number;
  name: string;
  /** Body-fat threshold to unlock; null = the starting form. */
  bfTarget: number | null;
  unlocked: boolean;
  current: boolean;
}

export function shredderRows(bfMid: number | null): ShredderRow[] {
  const currentStage = shredderStage(bfMid);
  return SHREDDER_LADDER.map(([bfTarget, name], i) => ({
    stage: i + 1,
    name,
    bfTarget,
    unlocked: i + 1 <= currentStage,
    current: i + 1 === currentStage,
  }));
}

/** Next form's demands: get the body fat under the line; keep training. */
export function shredderNextEvolution(bfMid: number | null, totalSets: number): NextEvolution {
  const stage = shredderStage(bfMid);
  if (stage >= 4) {
    return {
      targetName: 'Shredded',
      targetLevel: 4,
      requirements: [
        { label: 'Body Fat', current: bfMid ?? 0, target: SHREDDER_STAGE_BF.stage4, met: true },
      ],
    };
  }
  const targets = [SHREDDER_STAGE_BF.stage2, SHREDDER_STAGE_BF.stage3, SHREDDER_STAGE_BF.stage4];
  const setsTargets = [50, 150, 300];
  const bfTarget = targets[stage - 1];
  const setsTarget = setsTargets[stage - 1];
  return {
    targetName: SHREDDER_LADDER[stage][1],
    targetLevel: stage + 1,
    requirements: [
      {
        label: 'Body Fat',
        current: bfMid ?? 0,
        target: bfTarget,
        met: bfMid !== null && bfMid < bfTarget,
      },
      { label: 'Total Sets', current: totalSets, target: setsTarget, met: totalSets >= setsTarget },
    ],
  };
}

export interface ScoresV2 {
  strength: number;
  size: number;
  leanness: number;
  conditioning: number;
  aesthetic: number;
}

/**
 * The mass line's ART stage (Tyson, 2026-07-16: "mass monster is missing
 * its stage 4, and stages 1 and 2 are the same"). The pinned core ladder
 * predates the redesign pack and spreads five rows over THREE painted
 * stages (1,1,2,3,3); the delivered sprite set has FOUR. This V2 mapping
 * mirrors the aesthetic spread (25/50/75) so every early evolution changes
 * the body and the final form actually renders. Core goldens untouched.
 */
export function massArtStage(level: number): number {
  const lv = Math.trunc(level);
  if (lv >= 75) return 4;
  if (lv >= 50) return 3;
  if (lv >= 25) return 2;
  return 1;
}

/**
 * Which companion-sprite LINE an athlete carries (Tyson, 2026-07-16):
 * mass and titan get the Mass Monster; every other branch keeps the
 * Cyber Athlete. Art policy, kept pure here so tests can pin it —
 * a Mass Monster must never wear another line's body.
 */
export function companionLine(branch: BranchV2): 'aesthetic' | 'mass' {
  return branch === 'mass' || branch === 'titan' ? 'mass' : 'aesthetic';
}

export function resolveBranchV2(s: ScoresV2, ctx?: BranchContext): BranchV2 {
  if (isShredder(ctx)) {
    return 'shredder';
  }
  if (s.strength >= 80 && s.size >= 70 && s.size >= Math.max(s.aesthetic, s.conditioning)) {
    return 'titan';
  }
  if (
    s.conditioning >= 70 &&
    s.conditioning >= Math.max(s.strength, s.size, s.aesthetic, s.leanness)
  ) {
    return 'cardio';
  }
  const core = determineAvatarBranch({
    strength_score: s.strength,
    size_score: s.size,
    conditioning_score: s.conditioning,
    aesthetic_score: s.aesthetic,
  });
  // HYBRID REMOVED FROM THE GAME (Tyson, 2026-07-16). The pinned core
  // resolver still knows it (golden-fixtured, untouchable); the V2 layer
  // folds those athletes into the aesthetic default line. PARITY.md-class
  // divergence, deliberate.
  return core === 'hybrid' ? 'aesthetic' : core;
}

export function branchDisplayNameV2(branch: BranchV2): string {
  switch (branch) {
    case 'shredder':
      return '🔪 The Shredder';
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
  if (branch === 'shredder') {
    // Level does not drive shredder forms; callers should prefer
    // shredderName(bfMid). This fallback names the start.
    return SHREDDER_LADDER[0][1];
  }
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

export interface StageRowV2 {
  level: number;
  name: string;
  stage: number;
  unlocked: boolean;
  current: boolean;
}

/** One row per BODY (Tyson, 2026-07-16: "only 4 stages for each type of
 *  skin"): rows that re-use an earlier stage's art are folded away, so
 *  4-stage lines show 4 rows and painted 3-stage lines show 3. The folded
 *  forms (True Adam, Titan Prime, Perpetual…) remain FORM NAMES via
 *  evolutionNameV2 — and reaching level 100 unlocks the True Adam SKIN
 *  instead of a duplicate stage card. */
function uniqueStages(rows: StageRowV2[]): StageRowV2[] {
  const seen = new Set<number>();
  const out = rows.filter((r) => (seen.has(r.stage) ? false : (seen.add(r.stage), true)));
  const lastUnlocked = [...out].reverse().find((r) => r.unlocked);
  return out.map((r) => ({ ...r, current: r === lastUnlocked }));
}

export function avatarStageRowsV2(branch: BranchV2, level: number): StageRowV2[] {
  if (branch === 'shredder') {
    // Body-fat-driven; use shredderRows(bfMid) instead. Empty here keeps the
    // level-driven API honest rather than inventing level gates.
    return [];
  }
  if (branch === 'titan' || branch === 'cardio') {
    const ladder = V2_LADDERS[branch];
    const unlockedLevels = ladder.filter(([u]) => level >= u).map(([u]) => u);
    const highest = unlockedLevels.length ? Math.max(...unlockedLevels) : null;
    // Both new classes have 4-stage sprite sets now (Titan + Enduro
    // packs) — the standard 25/50/75 body spread.
    const stageFor = massArtStage;
    return uniqueStages(
      ladder.map(([unlock, name]) => ({
        level: unlock,
        name,
        stage: stageFor(unlock),
        unlocked: level >= unlock,
        current: level >= unlock && unlock === highest,
      }))
    );
  }
  // Core branches use the pinned rows — except the mass line's ART stage,
  // remapped to the four delivered sprite stages (names + levels pinned).
  const rows = CORE_ROWS(branch, level);
  if (branch === 'mass') {
    return uniqueStages(rows.map((row) => ({ ...row, stage: massArtStage(row.level) })));
  }
  return uniqueStages(rows);
}

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
  if (branch === 'shredder') {
    return shredderNextEvolution(inputs.bfMid, inputs.totalSets);
  }
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

export function branchPathsV2(current: BranchV2, s: ScoresV2, ctx?: BranchContext): BranchPathV2[] {
  const paths: BranchPathV2[] = [];

  if (current !== 'shredder') {
    paths.push({
      branch: 'shredder',
      requirements: [
        {
          label: 'Starting Body Fat',
          current: ctx?.earliestBf ?? 0,
          target: SHREDDER_ENTRY_BF,
          met: (ctx?.earliestBf ?? 0) >= SHREDDER_ENTRY_BF,
        },
      ],
      note: 'Entry class of the great cut: requires a cutting phase and a first body-fat reading of 25%+. Forms advance as body fat falls.',
    });
  }

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
  // Hybrid is no longer a class (Tyson, 2026-07-16) — no path to it.

  return paths;
}

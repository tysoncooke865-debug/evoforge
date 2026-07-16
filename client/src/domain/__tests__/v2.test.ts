import { describe, expect, it } from 'vitest';

import { determineAvatarBranch } from '../avatar-stats';
import {
  avatarStageRowsV2,
  branchPathsV2,
  evolutionNameV2,
  isShredder,
  nextEvolutionV2,
  companionLine,
  resolveBranchV2,
  shredderName,
  shredderNextEvolution,
  shredderRows,
  shredderStage,
  type ScoresV2,
} from '../branches-v2';
import {
  derivedLeannessDefault,
  derivedPhysiqueDefault,
  startingLevelV2,
} from '../starting-level-v2';
import { calculateStartingLevel } from '../profile';

const scores = (over: Partial<ScoresV2> = {}): ScoresV2 => ({
  strength: 40,
  size: 40,
  leanness: 50,
  conditioning: 35,
  aesthetic: 60,
  ...over,
});

describe('resolveBranchV2 — extremes first, pinned core untouched', () => {
  it('an aesthetic athlete stays aesthetic (no accidental reclassification)', () => {
    expect(resolveBranchV2(scores())).toBe('aesthetic');
  });

  it('every non-extreme mix matches the pinned core, hybrid folding to aesthetic', () => {
    // Sweep the sub-extreme space: v2 must agree with the golden rule —
    // except hybrid, REMOVED FROM THE GAME (Tyson, 2026-07-16): those
    // athletes fold into the aesthetic default line.
    let hybridsSeen = 0;
    for (const st of [0, 44, 45, 54, 55, 79]) {
      for (const si of [0, 54, 55, 69]) {
        for (const co of [0, 54, 55, 69]) {
          for (const ae of [0, 50, 100]) {
            const s = scores({ strength: st, size: si, conditioning: co, aesthetic: ae });
            const core = determineAvatarBranch({
              strength_score: st,
              size_score: si,
              conditioning_score: co,
              aesthetic_score: ae,
            });
            if (core === 'hybrid') hybridsSeen++;
            expect(resolveBranchV2(s), JSON.stringify(s)).toBe(core === 'hybrid' ? 'aesthetic' : core);
          }
        }
      }
    }
    // The fold must actually be exercised — a sweep that never hits a
    // hybrid mix proves nothing (a guard that cannot fail is not a guard).
    expect(hybridsSeen).toBeGreaterThan(0);
  });

  it('titan requires the extreme gates and pre-empts mass', () => {
    const t = scores({ strength: 80, size: 70, conditioning: 30, aesthetic: 60 });
    expect(resolveBranchV2(t)).toBe('titan');
    // One point short on either gate: falls back to core (mass here).
    expect(resolveBranchV2({ ...t, strength: 79 })).toBe('mass');
    expect(resolveBranchV2({ ...t, size: 69 })).toBe('mass');
  });

  it('cardio machine requires dominant conditioning and pre-empts hybrid', () => {
    const c = scores({ conditioning: 70, strength: 50, size: 40, aesthetic: 60, leanness: 65 });
    expect(resolveBranchV2(c)).toBe('cardio');
    expect(resolveBranchV2({ ...c, conditioning: 69 })).toBe('aesthetic'); // hybrid removed: folds to the default
    // Not dominant -> not the machine.
    expect(resolveBranchV2({ ...c, aesthetic: 71 })).toBe('aesthetic');
  });

  it('titan outranks cardio when both somehow qualify', () => {
    const both = scores({ strength: 85, size: 90, conditioning: 90, aesthetic: 20, leanness: 20 });
    expect(resolveBranchV2(both)).toBe('titan');
  });
});

describe('branchPathsV2 — displayed gates really resolve there', () => {
  it('meeting every titan row resolves titan', () => {
    const s = scores({ strength: 80, size: 72, conditioning: 40, aesthetic: 65 });
    const titan = branchPathsV2('aesthetic', s).find((p) => p.branch === 'titan')!;
    expect(titan.requirements.every((r) => r.met)).toBe(true);
    expect(resolveBranchV2(s)).toBe('titan');
  });

  it('meeting every cardio row resolves cardio', () => {
    const s = scores({ conditioning: 75, strength: 50, size: 40, aesthetic: 60, leanness: 70 });
    const cardio = branchPathsV2('aesthetic', s).find((p) => p.branch === 'cardio')!;
    expect(cardio.requirements.every((r) => r.met)).toBe(true);
    expect(resolveBranchV2(s)).toBe('cardio');
  });

  it('offers every other class (five-class era), never the current one', () => {
    expect(branchPathsV2('aesthetic', scores()).map((p) => p.branch).sort()).toEqual(
      ['cardio', 'mass', 'shredder', 'titan'].sort()
    );
    expect(branchPathsV2('titan', scores()).map((p) => p.branch)).not.toContain('titan');
  });
});

describe('v2 ladders and evolutions', () => {
  it('titan ladder names by level', () => {
    expect(evolutionNameV2('titan', 1)).toBe('Cyber Recruit');
    expect(evolutionNameV2('titan', 50)).toBe('Juggernaut');
    expect(evolutionNameV2('titan', 100)).toBe('World Breaker');
  });

  it('core branches delegate to the pinned ladder', () => {
    expect(evolutionNameV2('aesthetic', 100)).toBe('True Adam');
    expect(evolutionNameV2('mass', 80)).toBe('Titan Form');
  });

  it('stage rows: one row per body, current flags exactly one', () => {
    const rows = avatarStageRowsV2('cardio', 60);
    expect(rows.filter((r) => r.current)).toHaveLength(1);
    expect(rows.find((r) => r.current)?.name).toBe('Enduro');
    // ONE ROW PER BODY; cardio spreads FOUR since the Enduro pack.
    expect(rows.map((r) => r.stage)).toEqual([1, 2, 3, 4]);
  });

  it('nextEvolutionV2: titan gates, cardio gates, core delegation', () => {
    const titan = nextEvolutionV2('titan', { level: 60, benchE1rm: 100, bfMid: null, totalSets: 150, cardioMinutes: 0 });
    expect(titan.targetName).toBe('Colossus');
    expect(titan.requirements.map((r) => r.label)).toEqual(['Level', 'Bench', 'Total Sets']);

    const cardio = nextEvolutionV2('cardio', { level: 30, benchE1rm: 0, bfMid: null, totalSets: 0, cardioMinutes: 200 });
    expect(cardio.requirements.map((r) => r.label)).toEqual(['Level', 'Cardio Minutes']);

    const core = nextEvolutionV2('aesthetic', { level: 57, benchE1rm: 82, bfMid: null, totalSets: 10, cardioMinutes: 0 });
    expect(core.targetName).toBe('Advanced Form'); // the pinned function's answer
  });
});

describe('startingLevelV2', () => {
  it('scanned athlete: lifts + years + AI scores, clamped', () => {
    const level = startingLevelV2({
      benchE1rm: 100,
      squatE1rm: 140,
      deadliftE1rm: 180,
      trainingYears: 3,
      aiPhysique: 9,
      aiLeanness: 8,
      phase: 'maintaining',
    });
    expect(level).toBe(1 + 22 + 14 + 14 + 12 + 9 + 8);
  });

  it('matches v1 when deadlift is absent and AI scores equal the old sliders', () => {
    // Backward sanity: zero deadlift + same physique/leanness = v1 + 0.
    const v2 = startingLevelV2({
      benchE1rm: 90,
      squatE1rm: 120,
      deadliftE1rm: 0,
      trainingYears: 3,
      aiPhysique: 8,
      aiLeanness: 9,
      phase: 'flexible',
    });
    expect(v2).toBe(calculateStartingLevel(90, 120, 3, 8, 9));
  });

  it('skipped scan uses documented defaults — phase shapes leanness only', () => {
    expect(derivedPhysiqueDefault(100, 140, 180)).toBe(10);
    expect(derivedPhysiqueDefault(0, 0, 0)).toBe(4);
    expect(derivedLeannessDefault('cutting')).toBe(8);
    expect(derivedLeannessDefault('bulking')).toBe(4);

    const cutter = startingLevelV2({
      benchE1rm: 60, squatE1rm: 0, deadliftE1rm: 0, trainingYears: 0,
      aiPhysique: null, aiLeanness: null, phase: 'cutting',
    });
    const bulker = startingLevelV2({
      benchE1rm: 60, squatE1rm: 0, deadliftE1rm: 0, trainingYears: 0,
      aiPhysique: null, aiLeanness: null, phase: 'bulking',
    });
    expect(cutter - bulker).toBe(4); // leanness default delta, nothing else
  });

  it('clamps to 1..100', () => {
    expect(
      startingLevelV2({
        benchE1rm: 200, squatE1rm: 300, deadliftE1rm: 400, trainingYears: 20,
        aiPhysique: 15, aiLeanness: 15, phase: 'maintaining',
      })
    ).toBe(100);
  });
});

describe('The Shredder — the redemption arc', () => {
  const ctx = (phase: string | null, earliestBf: number | null) => ({
    nutritionPhase: phase,
    earliestBf,
  });

  it('entry: cutting phase + starting bf >= 25, both required', () => {
    expect(isShredder(ctx('cutting', 28))).toBe(true);
    expect(isShredder(ctx('cutting', 25))).toBe(true);
    expect(isShredder(ctx('cutting', 24.9))).toBe(false);
    expect(isShredder(ctx('bulking', 30))).toBe(false);
    expect(isShredder(ctx('cutting', null))).toBe(false);
    expect(isShredder(undefined)).toBe(false);
  });

  it('resolver: shredder pre-empts everything; expires with the phase', () => {
    const scores = { strength: 85, size: 75, leanness: 20, conditioning: 30, aesthetic: 40 };
    expect(resolveBranchV2(scores, ctx('cutting', 30))).toBe('shredder');
    expect(resolveBranchV2(scores, ctx('maintaining', 30))).toBe('titan'); // falls through
    expect(resolveBranchV2(scores)).toBe('titan'); // no ctx = old behaviour
  });

  it('stages are driven by body fat FALLING: 25 / 18 / 12 edges', () => {
    expect(shredderStage(30)).toBe(1);
    expect(shredderStage(25)).toBe(1);
    expect(shredderStage(24.9)).toBe(2);
    expect(shredderStage(18)).toBe(2);
    expect(shredderStage(17.9)).toBe(3);
    expect(shredderStage(12.1)).toBe(3);
    expect(shredderStage(12)).toBe(4);
    expect(shredderStage(8)).toBe(4);
    expect(shredderStage(null)).toBe(1);
  });

  it('ladder names track the cut', () => {
    expect(shredderName(30)).toBe('Hooded Resolve');
    expect(shredderName(20)).toBe('The Grind');
    expect(shredderName(15)).toBe('Cut Deep');
    expect(shredderName(11)).toBe('Shredded');
  });

  it('rows: exactly one current, unlocks follow the stage', () => {
    const rows = shredderRows(20);
    expect(rows.filter((r) => r.current)).toHaveLength(1);
    expect(rows.find((r) => r.current)?.name).toBe('The Grind');
    expect(rows.map((r) => r.unlocked)).toEqual([true, true, false, false]);
  });

  it('next evolution demands the next bf line + training volume', () => {
    const evo = shredderNextEvolution(20, 100);
    expect(evo.targetName).toBe('Cut Deep');
    expect(evo.requirements.map((r) => r.label)).toEqual(['Body Fat', 'Total Sets']);
    expect(evo.requirements[0].target).toBe(18);
    expect(evo.requirements[0].met).toBe(false);
    expect(evo.requirements[1].met).toBe(false); // 100 < 150

    const done = shredderNextEvolution(10, 500);
    expect(done.targetName).toBe('Shredded');
    expect(done.requirements[0].met).toBe(true);
  });

  it('branchPathsV2 offers the shredder entry card with honest gates', () => {
    const s = { strength: 40, size: 40, leanness: 50, conditioning: 35, aesthetic: 60 };
    const withCtx = branchPathsV2('aesthetic', s, ctx('bulking', 27));
    const shred = withCtx.find((p) => p.branch === 'shredder')!;
    expect(shred.requirements[0].met).toBe(true); // starting bf qualifies
    expect(shred.note).toMatch(/cutting/i);
    // Already a shredder: not offered.
    expect(branchPathsV2('shredder', s, ctx('cutting', 30)).map((p) => p.branch)).not.toContain('shredder');
  });
});

describe('companionLine - the Mass Monster never wears another body', () => {
  it('mass and titan carry the mass companion', () => {
    expect(companionLine('mass')).toBe('mass');
    expect(companionLine('titan')).toBe('mass');
  });
  it('every other branch keeps the Cyber Athlete', () => {
    for (const b of ['aesthetic', 'shredder', 'cardio', 'hybrid'] as const) {
      expect(companionLine(b)).toBe('aesthetic');
    }
  });
});

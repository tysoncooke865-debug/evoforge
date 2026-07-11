import { describe, expect, it } from 'vitest';

import { evolutionReadiness, requirementProgress } from '../evolution-readiness';
import { computeStreak } from '../streak';
import type { WorkoutRow } from '../summary';

const row = (date: string, weight = 60, reps = 5): WorkoutRow => ({
  date,
  workout: 'Push 1 - Strength',
  exercise: 'Barbell Bench Press (Strength)',
  set: 1,
  weight,
  reps,
  timestamp: `${date}T10:00:00`,
});

describe('computeStreak', () => {
  const TODAY = '2026-07-11';

  it('no data: everything zero', () => {
    expect(computeStreak([], TODAY)).toEqual({ current: 0, best: 0, trainedToday: false });
  });

  it('trained today only: streak 1', () => {
    expect(computeStreak([row(TODAY)], TODAY)).toMatchObject({ current: 1, trainedToday: true });
  });

  it('three consecutive days ending today', () => {
    const rows = [row('2026-07-09'), row('2026-07-10'), row(TODAY)];
    expect(computeStreak(rows, TODAY)).toMatchObject({ current: 3, best: 3, trainedToday: true });
  });

  it('trained yesterday keeps the streak alive (not yet broken)', () => {
    const rows = [row('2026-07-09'), row('2026-07-10')];
    expect(computeStreak(rows, TODAY)).toMatchObject({ current: 2, trainedToday: false });
  });

  it('a full missed day breaks it, best remembers', () => {
    const rows = [row('2026-07-05'), row('2026-07-06'), row('2026-07-07')];
    expect(computeStreak(rows, TODAY)).toMatchObject({ current: 0, best: 3 });
  });

  it('invalid sets (0 weight/reps) do not count as training', () => {
    expect(computeStreak([row(TODAY, 0, 5)], TODAY)).toMatchObject({ current: 0, trainedToday: false });
  });

  it('duplicate rows on one day count once', () => {
    const rows = [row(TODAY), { ...row(TODAY), set: 2 }];
    expect(computeStreak(rows, TODAY)).toMatchObject({ current: 1 });
  });
});

describe('evolutionReadiness', () => {
  const req = (label: string, current: number, target: number, met = false) => ({
    label,
    current,
    target,
    met,
  });

  it('all met = exactly 100', () => {
    const r = evolutionReadiness([req('Level', 75, 75, true), req('Bench', 120, 100, true)]);
    expect(r.percent).toBe(100);
    expect(r.nearest).toBeNull();
    expect(r.hardest).toBeNull();
  });

  it('never reports 100 while anything is unmet', () => {
    const r = evolutionReadiness([req('Level', 74, 75), req('Bench', 200, 100, true)]);
    expect(r.percent).toBeLessThan(100);
    expect(r.nearest?.label).toBe('Level');
  });

  it('nearest is the closest unmet, hardest the furthest', () => {
    const r = evolutionReadiness([
      req('Level', 70, 75), // 0.93
      req('Bench', 50, 100), // 0.5
      req('Total Sets', 10, 250), // 0.04
    ]);
    expect(r.nearest?.label).toBe('Level');
    expect(r.hardest?.label).toBe('Total Sets');
    expect(r.percent).toBe(Math.floor(((70 / 75 + 0.5 + 10 / 250) / 3) * 100));
  });

  it('body fat progress runs downward and unmeasured reads zero', () => {
    expect(requirementProgress(req('Body Fat', 0, 12))).toBe(0); // no reading
    expect(requirementProgress(req('Body Fat', 24, 12))).toBe(0); // baseline
    const half = requirementProgress(req('Body Fat', 18, 12));
    expect(half).toBeCloseTo(0.5, 5);
    expect(requirementProgress(req('Body Fat', 12, 12, true))).toBe(1);
  });

  it('empty requirements: zero, no picks', () => {
    expect(evolutionReadiness([])).toEqual({ percent: 0, nearest: null, hardest: null });
  });
});

import { branchPaths } from '../branch-paths';
import { determineAvatarBranch } from '../avatar-stats';

describe('branchPaths — self-consistency with determineAvatarBranch', () => {
  it('meeting every Mass row actually branches mass', () => {
    // Take an aesthetic athlete and satisfy exactly the displayed targets.
    const scores = { strength: 55, size: 70, conditioning: 40, aesthetic: 65 };
    const massPath = branchPaths('aesthetic', scores).find((p) => p.branch === 'mass')!;
    expect(massPath.requirements.every((r) => r.met)).toBe(true);
    expect(
      determineAvatarBranch({
        strength_score: scores.strength,
        size_score: scores.size,
        conditioning_score: scores.conditioning,
        aesthetic_score: scores.aesthetic,
      })
    ).toBe('mass');
  });

  it('unmet Mass rows mean not mass', () => {
    const scores = { strength: 54, size: 70, conditioning: 40, aesthetic: 65 };
    const massPath = branchPaths('aesthetic', scores).find((p) => p.branch === 'mass')!;
    expect(massPath.requirements.some((r) => !r.met)).toBe(true);
    expect(
      determineAvatarBranch({
        strength_score: scores.strength,
        size_score: scores.size,
        conditioning_score: scores.conditioning,
        aesthetic_score: scores.aesthetic,
      })
    ).not.toBe('mass');
  });

  it('meeting Hybrid rows branches hybrid — unless Mass gates also hold (the caveat)', () => {
    const scores = { strength: 50, size: 40, conditioning: 60, aesthetic: 65 };
    const hybridPath = branchPaths('aesthetic', scores).find((p) => p.branch === 'hybrid')!;
    expect(hybridPath.requirements.every((r) => r.met)).toBe(true);
    expect(
      determineAvatarBranch({
        strength_score: scores.strength,
        size_score: scores.size,
        conditioning_score: scores.conditioning,
        aesthetic_score: scores.aesthetic,
      })
    ).toBe('hybrid');
    expect(hybridPath.note).toMatch(/precedence/i);
  });

  it('current branch is never offered as a path', () => {
    const scores = { strength: 50, size: 50, conditioning: 50, aesthetic: 50 };
    const paths = branchPaths('mass', scores);
    expect(paths.map((p) => p.branch)).toEqual(['hybrid']);
  });
});

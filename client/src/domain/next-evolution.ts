/**
 * Port of `domain/avatar_stats.py :: next_evolution_info()`: what the athlete
 * must hit for their next form. Pure -- Python reads cardio from the DB for
 * the hybrid branch; here the minutes are injected like everything else.
 */

import type { Branch } from './avatar-stats';
import { safeNum } from './physique-ratings';

export interface EvolutionRequirement {
  label: string;
  current: number;
  target: number;
  met: boolean;
}

export interface NextEvolution {
  targetName: string;
  targetLevel: number;
  requirements: EvolutionRequirement[];
}

export interface NextEvolutionInputs {
  level: number;
  benchE1rm: number;
  /** null when no body-fat log exists — the requirement then reads unmet. */
  bfMid: number | null;
  totalSets: number;
  cardioMinutes: number;
}

export function nextEvolutionInfo(branch: Branch, inputs: NextEvolutionInputs): NextEvolution {
  const level = Math.trunc(inputs.level);
  const bench = safeNum(inputs.benchE1rm, 0);
  const bfVal = inputs.bfMid !== null ? safeNum(inputs.bfMid, 99) : null;
  const totalSets = Math.trunc(inputs.totalSets);

  let targetLevel: number;
  let targetName: string;
  if (level < 25) {
    targetLevel = 25;
    targetName = 'First Evolution';
  } else if (level < 50) {
    targetLevel = 50;
    targetName = 'Elite Form';
  } else if (level < 75) {
    targetLevel = 75;
    targetName = 'Advanced Form';
  } else if (level < 90) {
    targetLevel = 90;
    targetName = 'Legendary Form';
  } else {
    targetLevel = 100;
    targetName = 'True Final Form';
  }

  const reqs: EvolutionRequirement[] = [
    { label: 'Level', current: level, target: targetLevel, met: level >= targetLevel },
  ];

  if (branch === 'mass') {
    const targetBench = level >= 75 ? 120 : 100;
    const targetSets = level >= 75 ? 250 : 100;
    reqs.push({ label: 'Bench', current: bench, target: targetBench, met: bench >= targetBench });
    reqs.push({
      label: 'Total Sets',
      current: totalSets,
      target: targetSets,
      met: totalSets >= targetSets,
    });
  } else if (branch === 'hybrid') {
    const minutes = safeNum(inputs.cardioMinutes, 0);
    const targetBench = level >= 50 ? 100 : 90;
    const targetMinutes = level >= 50 ? 300 : 100;
    reqs.push({ label: 'Bench', current: bench, target: targetBench, met: bench >= targetBench });
    reqs.push({
      label: 'Cardio Minutes',
      current: minutes,
      target: targetMinutes,
      met: minutes >= targetMinutes,
    });
  } else {
    const targetBench = level < 75 ? 100 : 110;
    const targetBf = level < 75 ? 12 : 10;
    reqs.push({ label: 'Bench', current: bench, target: targetBench, met: bench >= targetBench });
    reqs.push({
      label: 'Body Fat',
      current: bfVal ?? 0,
      target: targetBf,
      // Leaner is better, and an unlogged body fat cannot satisfy the check.
      met: bfVal !== null && bfVal <= targetBf,
    });
  }

  return { targetName, targetLevel, requirements: reqs };
}

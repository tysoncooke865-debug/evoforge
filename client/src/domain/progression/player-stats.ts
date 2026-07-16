/**
 * PROGRESSION_OVERHAUL P8 — Player Stats (spec §25), Evo Classes (§28)
 * and competitive rulesets (§27). Pure, versioned, explainable.
 *
 * THE MAPPING: Strength→Power · Size→Vitality · Cardio→Stamina ·
 * Aesthetics→Balance; Technique derives from training history (valid
 * exposures, exercise breadth, repeatability), never from a purchase.
 * Evo Rating is the power budget; stats are the build's distribution;
 * real-world performance decides physical challenges (spec §26).
 */

import { CLASS_RULE_VERSION } from './model-versions';
import { clampScore, type EvoPillars } from './types';

export interface PlayerStats {
  power: number;
  vitality: number;
  stamina: number;
  balance: number;
  technique: number;
}

export interface TechniqueEvidence {
  /** Valid sets ever logged. */
  totalValidSets: number;
  /** Distinct exercises with ≥3 valid exposures. */
  familiarExercises: number;
  /** Distinct training days in the last 90. */
  recentTrainingDays: number;
}

export function calculateTechnique(evidence: TechniqueEvidence): number {
  // Log-scaled experience + breadth + recency — plateaus, never explodes.
  const volume = Math.min(45, Math.log10(Math.max(1, evidence.totalValidSets)) * 15);
  const breadth = Math.min(30, evidence.familiarExercises * 1.5);
  const recency = Math.min(25, evidence.recentTrainingDays * 0.8);
  return clampScore(volume + breadth + recency);
}

export function calculatePlayerStats(pillars: EvoPillars, technique: TechniqueEvidence): PlayerStats {
  return {
    power: Math.round(clampScore(pillars.strength.score)),
    vitality: Math.round(clampScore(pillars.size.score)),
    stamina: Math.round(clampScore(pillars.cardio.score)),
    balance: Math.round(clampScore(pillars.aesthetics.score)),
    technique: Math.round(calculateTechnique(technique)),
  };
}

// ---------------------------------------------------------------------
// Evo Classes — first matching rule wins; versioned; never permanent.
// ---------------------------------------------------------------------

export interface ClassAssignment {
  evoClass: string;
  ruleVersion: string;
  explanation: string;
}

interface ClassRule {
  name: string;
  explanation: string;
  matches: (p: { size: number; aesthetics: number; strength: number; cardio: number; technique: number }) => boolean;
}

/** Ordered: specific archetypes before broad ones. */
const CLASS_RULES: ClassRule[] = [
  {
    name: 'Complete Athlete',
    explanation: 'No major weakness across all four pillars',
    matches: (p) => p.size >= 65 && p.aesthetics >= 65 && p.strength >= 65 && p.cardio >= 60,
  },
  {
    name: 'Juggernaut',
    explanation: 'Exceptional Size and Strength with limited Cardio',
    matches: (p) => p.size >= 80 && p.strength >= 80 && p.cardio < 45,
  },
  {
    name: 'Titan',
    explanation: 'High Size and Strength with lower Cardio',
    matches: (p) => p.size >= 65 && p.strength >= 65 && p.cardio < 55,
  },
  {
    name: 'Classic',
    explanation: 'High Size and Aesthetics with balanced Strength',
    matches: (p) => p.size >= 65 && p.aesthetics >= 65 && p.strength >= 50,
  },
  {
    name: 'Striker',
    explanation: 'High Strength and Technique relative to Size',
    matches: (p) => p.strength >= 65 && p.technique >= 60 && p.size < 60,
  },
  {
    name: 'Ranger',
    explanation: 'High Cardio and Technique with lower Size',
    matches: (p) => p.cardio >= 65 && p.technique >= 55 && p.size < 60,
  },
  {
    name: 'Hybrid',
    explanation: 'Balanced Strength and Cardio with solid Size',
    matches: (p) => p.strength >= 55 && p.cardio >= 55 && p.size >= 50,
  },
  {
    name: 'Sculptor',
    explanation: 'High Aesthetics relative to Strength and Cardio',
    matches: (p) => p.aesthetics >= 60 && p.aesthetics >= p.strength + 10 && p.aesthetics >= p.cardio + 10,
  },
  {
    name: 'Gladiator',
    explanation: 'Strength-led with meaningful conditioning',
    matches: (p) => p.strength >= 60 && p.cardio >= 50,
  },
];

export function determineEvoClass(input: {
  pillars: EvoPillars;
  technique: number;
}): ClassAssignment {
  const p = {
    size: input.pillars.size.score,
    aesthetics: input.pillars.aesthetics.score,
    strength: input.pillars.strength.score,
    cardio: input.pillars.cardio.score,
    technique: input.technique,
  };
  for (const rule of CLASS_RULES) {
    if (rule.matches(p)) {
      return { evoClass: rule.name, ruleVersion: CLASS_RULE_VERSION, explanation: rule.explanation };
    }
  }
  return {
    evoClass: 'Specialist',
    ruleVersion: CLASS_RULE_VERSION,
    explanation: 'A focused build still finding its second pillar',
  };
}

// ---------------------------------------------------------------------
// Competitive rulesets (spec §27) — pure transforms over two stat sets.
// ---------------------------------------------------------------------

/** Equalised Arena: normalise both totals to the same budget, preserving
 *  each build's DISTRIBUTION — tactics and class identity decide. */
export function equaliseStats(a: PlayerStats, b: PlayerStats, budget = 300): [PlayerStats, PlayerStats] {
  const scale = (s: PlayerStats): PlayerStats => {
    const total = s.power + s.vitality + s.stamina + s.balance + s.technique;
    const k = total > 0 ? budget / total : 1;
    return {
      power: Math.round(s.power * k),
      vitality: Math.round(s.vitality * k),
      stamina: Math.round(s.stamina * k),
      balance: Math.round(s.balance * k),
      technique: Math.round(s.technique * k),
    };
  };
  return [scale(a), scale(b)];
}

/** Handicap Rivalry (spec §27): ability-scaled targets — each athlete
 *  chases a load relative to THEIR OWN demonstrated e1RM; winner is
 *  performance relative to expectation. */
export function handicapTargets(input: {
  e1rmA: number;
  e1rmB: number;
  intensity?: number; // fraction of e1RM, default 0.75
}): { targetA: number; targetB: number } {
  const intensity = input.intensity ?? 0.75;
  const round25 = (kg: number) => Math.max(2.5, Math.round((kg * intensity) / 2.5) * 2.5);
  return { targetA: round25(input.e1rmA), targetB: round25(input.e1rmB) };
}

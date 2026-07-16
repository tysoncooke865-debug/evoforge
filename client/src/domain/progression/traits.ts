/**
 * PROGRESSION_OVERHAUL P8 — Traits (spec §29): rule-based, versioned,
 * earned from real evidence only. No medical claims, nothing that
 * rewards unsafe behaviour.
 */

import { TRAIT_RULE_VERSION } from './model-versions';
import type { PlayerStats } from './player-stats';
import type { EvoPillars } from './types';

export interface TraitDefinition {
  key: string;
  name: string;
  tier: 1 | 2 | 3;
  description: string;
  sourcePillar: 'size' | 'aesthetics' | 'strength' | 'cardio' | 'mixed';
  /** Gameplay effect handle — the battle layer interprets it. */
  effect: string;
}

export interface EligibleTrait extends TraitDefinition {
  ruleVersion: string;
}

interface TraitRule extends TraitDefinition {
  matches: (p: EvoPillars, s: PlayerStats, momentumWeeks: number) => boolean;
}

const TRAIT_RULES: TraitRule[] = [
  {
    key: 'heavy_hitter',
    name: 'Heavy Hitter',
    tier: 1,
    description: 'Demonstrated pressing power well above your bracket',
    sourcePillar: 'strength',
    effect: 'strength_event_bonus',
    matches: (p) => p.strength.score >= 70 && p.strength.confidence >= 50,
  },
  {
    key: 'armoured_frame',
    name: 'Armoured Frame',
    tier: 1,
    description: 'Muscle mass that shrugs off volume',
    sourcePillar: 'size',
    effect: 'defence_bonus',
    matches: (p) => p.size.score >= 70 && p.size.confidence >= 50,
  },
  {
    key: 'iron_lungs',
    name: 'Iron Lungs',
    tier: 1,
    description: 'Confirmed aerobic engine',
    sourcePillar: 'cardio',
    effect: 'stamina_regen_bonus',
    matches: (p) => p.cardio.score >= 65 && p.cardio.confidence >= 50,
  },
  {
    key: 'physical_presence',
    name: 'Physical Presence',
    tier: 1,
    description: 'A physique that changes the room',
    sourcePillar: 'aesthetics',
    effect: 'intimidation_bonus',
    matches: (p) => p.aesthetics.score >= 70 && p.aesthetics.confidence >= 50,
  },
  {
    key: 'no_weak_link',
    name: 'No Weak Link',
    tier: 2,
    description: 'Every pillar above the line — nothing to exploit',
    sourcePillar: 'mixed',
    effect: 'weak_link_immunity',
    matches: (p) => p.size.score >= 60 && p.aesthetics.score >= 60 && p.strength.score >= 60 && p.cardio.score >= 55,
  },
  {
    key: 'consistent_performer',
    name: 'Consistent Performer',
    tier: 2,
    description: 'Momentum measured in months, not days',
    sourcePillar: 'mixed',
    effect: 'variance_reduction',
    matches: (_p, _s, momentumWeeks) => momentumWeeks >= 6,
  },
  {
    key: 'movement_specialist',
    name: 'Movement Specialist',
    tier: 2,
    description: 'Deep technical familiarity across your library',
    sourcePillar: 'mixed',
    effect: 'technique_crit_bonus',
    matches: (_p, s) => s.technique >= 70,
  },
];

export function determineTraitEligibility(
  pillars: EvoPillars,
  stats: PlayerStats,
  momentumWeeks: number
): EligibleTrait[] {
  return TRAIT_RULES.filter((r) => r.matches(pillars, stats, momentumWeeks)).map(
    ({ matches: _m, ...def }) => ({ ...def, ruleVersion: TRAIT_RULE_VERSION })
  );
}

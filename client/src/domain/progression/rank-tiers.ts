/**
 * PROGRESSION_OVERHAUL P7 — Rival Rank tiers (spec §22): eight tiers ×
 * three divisions over the Glicko rating, provisional until placements
 * complete, display-confidence from RD.
 */

export const PLACEMENT_MATCHES_REQUIRED = 5;

export const RANK_TIERS = [
  { name: 'Iron', min: -Infinity },
  { name: 'Steel', min: 1200 },
  { name: 'Cobalt', min: 1350 },
  { name: 'Titanium', min: 1500 },
  { name: 'Obsidian', min: 1650 },
  { name: 'Mythic', min: 1800 },
  { name: 'Ascendant', min: 1950 },
  { name: 'Apex', min: 2100 },
] as const;

export const DIVISIONS = ['III', 'II', 'I'] as const;

export interface RankStanding {
  provisional: boolean;
  placementsCompleted: number;
  placementsRequired: number;
  tier: string | null;
  division: string | null;
  /** "COBALT II" or "UNRANKED · 3/5 PLACEMENTS". */
  label: string;
  confidence: 'low' | 'medium' | 'high';
}

export function rankStandingFor(input: {
  rating: number;
  rd: number;
  placementsCompleted: number;
}): RankStanding {
  const placements = Math.max(0, Math.floor(input.placementsCompleted));
  if (placements < PLACEMENT_MATCHES_REQUIRED) {
    return {
      provisional: true,
      placementsCompleted: placements,
      placementsRequired: PLACEMENT_MATCHES_REQUIRED,
      tier: null,
      division: null,
      label: `UNRANKED · ${placements}/${PLACEMENT_MATCHES_REQUIRED} PLACEMENTS`,
      confidence: 'low',
    };
  }

  let tierIndex = 0;
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    if (input.rating >= RANK_TIERS[i].min) {
      tierIndex = i;
      break;
    }
  }
  const tier = RANK_TIERS[tierIndex];
  const next = RANK_TIERS[tierIndex + 1] ?? null;
  const floor = Number.isFinite(tier.min) ? tier.min : 1050;
  const span = (next ? next.min : floor + 150) - floor;
  const into = Math.max(0, Math.min(0.999, (input.rating - floor) / span));
  const division = DIVISIONS[Math.min(2, Math.floor(into * 3))];

  return {
    provisional: false,
    placementsCompleted: placements,
    placementsRequired: PLACEMENT_MATCHES_REQUIRED,
    tier: tier.name,
    division,
    label: `${tier.name.toUpperCase()} ${division}`,
    confidence: input.rd <= 80 ? 'high' : input.rd <= 150 ? 'medium' : 'low',
  };
}

/**
 * Matchmaking constraints (spec §24) — pure verdicts the match-forming
 * surface enforces. Never Evo-only, never rank-only, no rating farming.
 */
export interface MatchmakingCheck {
  allowed: boolean;
  reasons: string[];
}

export const MAX_RECENT_MEETINGS = 2;

export function checkMatchup(input: {
  ratingA: number;
  ratingB: number;
  evoA: number | null;
  evoB: number | null;
  /** Rated meetings between this exact pair in the last 7 days. */
  recentMeetings: number;
}): MatchmakingCheck {
  const reasons: string[] = [];
  if (Math.abs(input.ratingA - input.ratingB) > 300) {
    reasons.push('Rival Ratings are too far apart (max 300)');
  }
  if (input.evoA !== null && input.evoB !== null && Math.abs(input.evoA - input.evoB) > 20) {
    reasons.push('Evo Ratings are too far apart for a rated match (max 20)');
  }
  if (input.recentMeetings >= MAX_RECENT_MEETINGS) {
    reasons.push('You two have already played rated this week — try a casual duel');
  }
  return { allowed: reasons.length === 0, reasons };
}

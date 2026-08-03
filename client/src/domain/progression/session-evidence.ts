/**
 * WHICH EVO PILLARS A SESSION FEEDS (2026-08-03, premium pass).
 *
 * THE BRIEF ASKED FOR "+0.4 EVO" ON EVERY REWARD. That number cannot exist,
 * and it is worth writing down why so it is not re-proposed a third time:
 *
 *   The Evo Rating is not granted, it is RECOMPUTED. `evo-review-io.ts`
 *   rebuilds all four pillars from the whole evidence base at review time —
 *   the strength score from every valid e1RM observation in the log, the size
 *   score from accumulated volume against bodyweight, and so on through a
 *   weighted GEOMETRIC mean with tier gates and soft caps on top. A single
 *   session's contribution is therefore path-dependent (it depends on what
 *   else is in the log, what the athlete weighs that week, and which gate is
 *   binding), and it is not knowable before the sets are actually logged —
 *   the same workout is worth a different delta on different days.
 *
 *   `pending_evo_evidence` has `projected_impact_low/high` columns for exactly
 *   this purpose (migration 024), and NOTHING WRITES THEM. Until a projector
 *   exists and is falsified against real reviews, any number on the mission
 *   card would be invented — and an invented number attached to the app's
 *   headline statistic is the one lie that costs trust in the product itself.
 *   The house rule stands: a system without a backend is hidden, never mocked.
 *
 * WHAT IS TRUE, AND IS WHAT THIS RETURNS: which PILLARS the session becomes
 * evidence for. That is not a guess — it is a direct reading of the review's
 * own inputs. A logged resistance set produces an e1RM observation (Strength)
 * and volume (Size); logged cardio minutes feed the Cardio pillar. The mission
 * card can therefore promise the LINK without inventing the MAGNITUDE, which
 * is what the brief actually wants: every reward reinforcing workout → Evo.
 *
 * Physique is deliberately absent. It moves on confirmed scans (spec §15B/C),
 * never on a workout, so claiming a session feeds it would be the same lie in
 * a smaller font.
 */

import type { PillarKey } from './types';

export interface SessionEvidenceInput {
  /** Working sets the session plans (or has logged). */
  sets: number;
  /** Cardio minutes the session plans (or has logged). */
  cardioMinutes: number;
}

/**
 * The pillars this session becomes evidence for, in the order they read.
 * Empty when there is nothing to log — a rest day earns no claim.
 */
export function evoEvidenceFor(input: SessionEvidenceInput): PillarKey[] {
  const pillars: PillarKey[] = [];
  const sets = Number.isFinite(input.sets) ? Math.trunc(input.sets) : 0;
  const minutes = Number.isFinite(input.cardioMinutes) ? Math.trunc(input.cardioMinutes) : 0;
  if (sets > 0) {
    pillars.push('strength', 'size');
  }
  if (minutes > 0) {
    pillars.push('cardio');
  }
  return pillars;
}

const PILLAR_LABELS: Record<PillarKey, string> = {
  size: 'SIZE',
  aesthetics: 'PHYSIQUE',
  strength: 'STRENGTH',
  cardio: 'CARDIO',
};

/** "STRENGTH & SIZE" — the pill's label, or null when there is no claim. */
export function evoEvidenceLabel(pillars: readonly PillarKey[]): string | null {
  if (pillars.length === 0) return null;
  const names = pillars.map((p) => PILLAR_LABELS[p]);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/**
 * P7 — battle readability: pure helpers behind the clarity pass over the
 * combat-fx-driven arena screen (see arena-screen.tsx, lane-strip.tsx,
 * champion-hud.tsx). Mirrors combat-fx.ts's split: every derivation here is
 * a pure function of plain numbers/arrays — no React, no Date.now() calls,
 * no engine/content imports — so it's trivially testable and the caller
 * (which DOES read the wall clock, same "age it every ~50ms frame" pattern
 * as everything else in this package) stays a thin wiring layer.
 *
 * Covers:
 *  - low-health emphasis on any health bar (unit/champion), independent of
 *    team tint, echoing the Shredder's Killer Instinct execute threshold
 *    (content/champions.ts: 35% of baked max) so players can SEE the range
 *    at which their own hits (or the enemy's) start executing harder —
 *    this constant is a UI convention, not a read of that champion's
 *    specific ability data, so it holds even when no Shredder is in play.
 *  - lane momentum: which team currently has more living presence pushing
 *    down a given lane, from the same alive-unit lists the screen already
 *    filters per lane.
 *  - floater stagger: when two+ floaters land at nearly the same spot at
 *    nearly the same time, offset each one so the numbers don't render
 *    perfectly on top of each other.
 *  - ability/ultimate readiness fractions, for progress bars under the
 *    champion HUD buttons.
 */
import type { TeamId } from '../../../game-engine/types';

/** Health fraction at/below which a health bar switches to the low-health
 *  tint — mirrors the Shredder's Killer Instinct execute threshold (35% of
 *  baked max health) so the color cue lines up with when hits actually
 *  start landing harder. Applies to every health bar, not just targets of
 *  that specific passive. */
export const LOW_HEALTH_FRACTION = 0.35;

/**
 * The color a health bar fill should render at. Below `LOW_HEALTH_FRACTION`
 * (and above 0 — a dead unit isn't rendered at all, so there's no "0%
 * amber" case to special-case here) the bar switches to `lowHealthColor`
 * regardless of team tint, so the emphasis reads the same for both sides.
 * At/above threshold, the team's own tint is used as before.
 */
export function healthBarColor(
  healthFraction: number,
  teamTint: string,
  lowHealthColor: string
): string {
  if (healthFraction > 0 && healthFraction <= LOW_HEALTH_FRACTION) return lowHealthColor;
  return teamTint;
}

/** Per-lane momentum input: just enough of a unit to weigh its side's push. */
export interface LaneMomentumUnit {
  team: TeamId;
  health: number;
}

/**
 * -1..1 signed momentum for one lane, from its currently-alive units only:
 * +1 = player's living presence in this lane is total (all the remaining
 * health belongs to the player, so the push is toward the OPPONENT core);
 * -1 = the opposite (push toward the PLAYER's own core); 0 = empty lane or
 * an exact standoff — no indicator should show. Never NaN: an empty lane
 * (both sums 0) returns exactly 0.
 */
export function computeLaneMomentum(units: readonly LaneMomentumUnit[]): number {
  let playerHealth = 0;
  let opponentHealth = 0;
  for (const u of units) {
    if (u.health <= 0) continue;
    if (u.team === 'player') playerHealth += u.health;
    else opponentHealth += u.health;
  }
  const total = playerHealth + opponentHealth;
  if (total <= 0) return 0;
  return (playerHealth - opponentHealth) / total;
}

/** How far apart (in topPct, i.e. percent of lane length) two floaters must
 *  be to NOT be considered "the same spot" for stagger purposes. */
const STAGGER_CLUSTER_PCT = 5;
/** Vertical stagger step, in px, applied per already-occupied slot. */
export const FLOATER_STAGGER_STEP_PX = 11;
/** Stagger growth caps out — a 6th simultaneous floater in one spot renders
 *  at the same offset as the 5th rather than marching off toward the core. */
const STAGGER_MAX_STEPS = 4;

/**
 * How many px to additionally lift a NEW floater landing at `topPct`, given
 * the topPcts of floaters already active in the same lane. Counts every
 * existing floater within `STAGGER_CLUSTER_PCT` of the new one (age/TTL is
 * the caller's problem — pass only still-alive floaters) and steps by
 * `FLOATER_STAGGER_STEP_PX` per prior occupant, capped so a pile-up doesn't
 * launch a floater off past the core.
 */
export function computeFloaterStagger(
  existingTopPcts: readonly number[],
  topPct: number
): number {
  let count = 0;
  for (const p of existingTopPcts) {
    if (Math.abs(p - topPct) < STAGGER_CLUSTER_PCT) count++;
  }
  return Math.min(count, STAGGER_MAX_STEPS) * FLOATER_STAGGER_STEP_PX;
}

/**
 * Ability readiness as a 0..1 fraction (1 = ready) from ticks remaining vs.
 * the ability's total cooldown. Guards the zero-cooldown edge case (a
 * kind:'ultimate' definition's `cooldownTicks` is always 0 since it gates on
 * charge instead — see content/champions.ts) by treating it as always ready
 * rather than dividing by zero.
 */
export function abilityCooldownFraction(remainingTicks: number, totalTicks: number): number {
  if (totalTicks <= 0) return 1;
  const frac = 1 - remainingTicks / totalTicks;
  return Math.max(0, Math.min(1, frac));
}

/** Lateral px between stacked units (Phase 6 — audit C1). */
export const STACK_OFFSET_PX = 9;
/** Units within this many world x-units of each other count as one pile. */
const STACK_CLUSTER_RADIUS_X = 2.5;

/**
 * Phase 6 (audit C1): units standing on nearly the same x used to overprint
 * into one unreadable pile — this fans a pile out laterally. Clusters are
 * greedy over x-sorted units; within a cluster, offsets go center-out
 * (0, +1, -1, +2, -2 …) in id order so a unit keeps ITS offset from frame
 * to frame (ids are stable; position in the pile is not). Pure — the
 * renderer applies the returned px as a translateX.
 */
export function computeStackOffsets(
  units: readonly { id: number; x: number }[]
): Map<number, number> {
  const sorted = [...units].sort((a, b) => a.x - b.x || a.id - b.id);
  const out = new Map<number, number>();
  let cluster: { id: number; x: number }[] = [];
  // Center-out slots, cycling for big piles so a chain of many units never
  // fans wider than ±2 steps (the lane is only so wide).
  const SLOTS = [0, 1, -1, 2, -2];
  const flush = () => {
    if (cluster.length > 1) {
      cluster.sort((a, b) => a.id - b.id);
      cluster.forEach((u, i) => {
        out.set(u.id, SLOTS[i % SLOTS.length] * STACK_OFFSET_PX);
      });
    }
    cluster = [];
  };
  for (const u of sorted) {
    if (cluster.length > 0 && u.x - cluster[cluster.length - 1].x > STACK_CLUSTER_RADIUS_X) {
      flush();
    }
    cluster.push(u);
  }
  flush();
  return out;
}

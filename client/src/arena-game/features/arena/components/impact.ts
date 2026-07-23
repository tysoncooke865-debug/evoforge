/**
 * Combat-feel systems (polish P4) — pure functions only, following the
 * combat-fx.ts doctrine: everything here derives from sim state / log data
 * plus caller-supplied clocks. No React, no Date.now(), no engine imports
 * beyond types. The wiring layer (arena-screen.tsx) owns timestamps, caps
 * and pruning; lane-strip.tsx renders the results.
 *
 * The escalation ladder is the point: light < medium < heavy < ultimate <
 * core-destruction must FEEL different, so every strength knob lives in one
 * tier table instead of being sprinkled per effect.
 */
import type { UnitState } from '../../../game-engine/simulation/state';
import type { LaneId, TeamId } from '../../../game-engine/types';

/** One escalation step. 'core' is reserved for core hits/destruction. */
export type ImpactTier = 'light' | 'medium' | 'heavy' | 'ultimate' | 'core';

export interface TierFx {
  /** Floating damage number font size (px). */
  floaterFontSize: number;
  /** Floater font weight — heavy numbers should look heavy. */
  floaterWeight: '700' | '800' | '900';
  /** Screen-shake peak amplitude (px); 0 = no screen shake for this tier. */
  shakePx: number;
  /** Screen-shake duration (ms). */
  shakeMs: number;
  /** Sim hit-stop (ms); 0 = none. Applied via the battle store's time dilation. */
  hitStopMs: number;
  /** Defender recoil distance (px, backward toward its own core). */
  recoilPx: number;
}

/** The single strength table. Tuned so light hits stay quiet — if every
 *  attack shook the screen the ladder would flatten back into noise. */
export const TIER_FX: Record<ImpactTier, TierFx> = {
  light: { floaterFontSize: 11, floaterWeight: '700', shakePx: 0, shakeMs: 0, hitStopMs: 0, recoilPx: 2 },
  medium: { floaterFontSize: 13, floaterWeight: '800', shakePx: 0, shakeMs: 0, hitStopMs: 0, recoilPx: 3 },
  heavy: { floaterFontSize: 16, floaterWeight: '900', shakePx: 3, shakeMs: 220, hitStopMs: 50, recoilPx: 5 },
  ultimate: { floaterFontSize: 18, floaterWeight: '900', shakePx: 6, shakeMs: 380, hitStopMs: 70, recoilPx: 6 },
  core: { floaterFontSize: 16, floaterWeight: '900', shakePx: 8, shakeMs: 450, hitStopMs: 90, recoilPx: 0 },
};

/** Damage → tier. Thresholds sit against the live stat table (unit basics
 *  ~8–60, champion basics 45–90, abilities 120–250, ultimates 250–320):
 *  a champion's basic lands medium, only genuinely big hits read heavy. */
export function tierForDamage(amount: number): Extract<ImpactTier, 'light' | 'medium' | 'heavy'> {
  if (amount >= 110) return 'heavy';
  if (amount >= 45) return 'medium';
  return 'light';
}

/**
 * Decaying two-axis wobble for screen shake, from age alone. Two
 * incommensurate frequencies so the motion reads as a jolt, not a metronome;
 * everything derived from ageMs → identical for a given age (frame-driven,
 * no RNG, no Animated).
 */
export function shakeOffset(ageMs: number, tier: ImpactTier): { dx: number; dy: number } {
  const { shakePx, shakeMs } = TIER_FX[tier];
  if (shakePx <= 0 || ageMs < 0 || ageMs >= shakeMs) return { dx: 0, dy: 0 };
  const t = ageMs / shakeMs;
  const decay = (1 - t) * (1 - t);
  return {
    dx: Math.sin(ageMs * 0.19) * shakePx * decay,
    dy: Math.cos(ageMs * 0.23) * shakePx * decay * 0.6,
  };
}

/**
 * Per-unit procedural attack animation (the "character animation" layer for
 * combat): anticipation → strike → recovery, derived from the sim's own
 * attack cooldown. All offsets are in the unit's FACING direction — player
 * units face the opponent core (screen-up, negative y), opponents face down.
 *
 *  - fighting stance: any unit with a combat target leans slightly forward;
 *  - anticipation: the last `windupTicks` before the attack fires pull BACK;
 *  - strike: for `strikeMs` after the attack fires, lunge forward with decay
 *    (the caller records strike times by watching cooldown resets).
 */
export interface AttackPose {
  /** Screen-y offset (px, already signed for the unit's facing). */
  offsetY: number;
  /** Uniform scale — a striking unit swells a touch. */
  scale: number;
}

export const STRIKE_MS = 160;
const WINDUP_TICKS = 3;
const STANCE_LEAN_PX = 1;
const WINDUP_PULL_PX = 2.5;
const STRIKE_LUNGE_PX = 5;

export function attackPose(
  unit: Pick<UnitState, 'team' | 'targetId' | 'attackCooldownTicks'> & {
    base: { attackIntervalTicks: number };
  },
  strikeAgeMs: number | null
): AttackPose {
  // Facing: +1 moves toward the unit's own core (backward), -1 toward the
  // enemy (forward). Player units face up (forward = negative screen y).
  const forwardSign = unit.team === 'player' ? -1 : 1;

  if (strikeAgeMs !== null && strikeAgeMs >= 0 && strikeAgeMs < STRIKE_MS) {
    const t = strikeAgeMs / STRIKE_MS;
    const punch = Math.sin(Math.min(1, t * 1.6) * Math.PI); // fast out, ease back
    return {
      offsetY: forwardSign * STRIKE_LUNGE_PX * punch,
      scale: 1 + 0.08 * punch,
    };
  }

  if (unit.targetId === null) return { offsetY: 0, scale: 1 };

  // In combat: anticipation right before the hit, otherwise a slight lean.
  if (unit.attackCooldownTicks > 0 && unit.attackCooldownTicks <= WINDUP_TICKS) {
    const t = 1 - (unit.attackCooldownTicks - 1) / WINDUP_TICKS; // deeper as the hit nears
    return { offsetY: -forwardSign * WINDUP_PULL_PX * t, scale: 1 };
  }
  return { offsetY: forwardSign * STANCE_LEAN_PX, scale: 1 };
}

/**
 * Spawn drop-in (character animation for arrival): a brief scale-down from
 * oversized with a landing squash, derived from ticks-since-spawn — purely
 * sim-driven, so it needs no timestamps and replays identically.
 */
export function spawnScale(ticksSinceSpawn: number): number {
  if (ticksSinceSpawn < 0 || ticksSinceSpawn >= 8) return 1;
  if (ticksSinceSpawn <= 3) return 1.35 - (ticksSinceSpawn / 3) * 0.35; // drop 1.35 -> 1
  if (ticksSinceSpawn <= 5) return 0.92; // landing squash
  return 1;
}

/**
 * Detects attacks that FIRED since the previous frame by comparing attack
 * cooldowns: a cooldown that grew back above its previous value means the
 * unit attacked (the engine resets it to the full interval on fire). Returns
 * the attackers' ids; the caller uses it to start strike lunges and, for
 * ranged attackers, to launch a projectile toward their current target.
 */
export function detectFiredAttacks(
  units: readonly Pick<UnitState, 'id' | 'alive' | 'attackCooldownTicks'>[],
  prevCooldowns: ReadonlyMap<number, number>
): number[] {
  const fired: number[] = [];
  for (const u of units) {
    if (!u.alive) continue;
    const prev = prevCooldowns.get(u.id);
    if (prev !== undefined && u.attackCooldownTicks > prev) fired.push(u.id);
  }
  return fired;
}

/** A ranged shot in flight — rendered as a streak from muzzle to target.
 *  Travel is deliberately fast (the sim applies damage at fire time; a slow
 *  projectile would visibly lag its own damage number). */
export interface ProjectileSignal {
  lane: LaneId;
  fromX: number;
  toX: number;
  team: TeamId;
}

export const PROJECTILE_TTL_MS = 110;

/**
 * Builds projectile signals for ranged attackers that fired this frame.
 * Pure: attacker/target positions come from the caller's current-frame unit
 * list. Attacks whose target is gone (killed same tick) still streak to the
 * target's last known x when available, else are skipped.
 */
export function deriveProjectiles(
  firedIds: readonly number[],
  units: ReadonlyMap<
    number,
    Pick<UnitState, 'id' | 'lane' | 'x' | 'team' | 'targetId'> & { base: { isRanged: boolean } }
  >
): ProjectileSignal[] {
  const shots: ProjectileSignal[] = [];
  for (const id of firedIds) {
    const attacker = units.get(id);
    if (!attacker || !attacker.base.isRanged || attacker.targetId === null) continue;
    const target = units.get(attacker.targetId);
    if (!target || target.lane !== attacker.lane) continue;
    shots.push({ lane: attacker.lane, fromX: attacker.x, toX: target.x, team: attacker.team });
  }
  return shots;
}

import type { Combatant, StatusKind } from './types';

/**
 * STATUS RESOLUTION — the 5 beta statuses and how they warp effective stats.
 * All effects are transient and expire; nothing here mutates base stats, so
 * a status bug can never permanently corrupt a combatant.
 *
 *   bleed         — end-of-turn damage (handled in the engine)
 *   stagger       — lowers effective speed
 *   guard_break   — lowers effective defence
 *   overclocked   — raises speed + regen, lowers defence
 *   perfect_form  — raises precision + evasion (also Shadow Step's edge)
 */

export const STATUS_META: Record<StatusKind, { label: string; icon: string; good: boolean }> = {
  bleed: { label: 'Bleed', icon: '🩸', good: false },
  stagger: { label: 'Stagger', icon: '💫', good: false },
  guard_break: { label: 'Guard Break', icon: '🛡️', good: false },
  overclocked: { label: 'Overclocked', icon: '⚡', good: true },
  perfect_form: { label: 'Perfect Form', icon: '✦', good: true },
};

function magOf(c: Combatant, kind: StatusKind): number {
  const s = c.statuses.find((x) => x.kind === kind);
  return s ? s.magnitude : 0;
}

export function hasStatus(c: Combatant, kind: StatusKind): boolean {
  return c.statuses.some((x) => x.kind === kind);
}

export function effectiveDefence(c: Combatant): number {
  let d = c.stats.defence;
  d *= 1 - Math.min(0.6, magOf(c, 'guard_break'));
  if (hasStatus(c, 'overclocked')) d *= 1 - 0.15; // overclock trades defence
  // NOTE: the one-turn guard stance (Counter Pose / Iron Guard) is applied
  // as a FINAL damage multiplier in the engine, not here.
  return Math.max(1, d);
}

export function effectiveSpeed(c: Combatant): number {
  let s = c.stats.speed;
  if (hasStatus(c, 'overclocked')) s *= 1 + magOf(c, 'overclocked');
  s *= 1 - Math.min(0.5, magOf(c, 'stagger'));
  return Math.max(1, s);
}

export function effectiveEvasion(c: Combatant): number {
  let e = c.stats.evasion;
  if (hasStatus(c, 'perfect_form')) e += magOf(c, 'perfect_form');
  return Math.max(0, Math.min(0.6, e));
}

export function effectivePrecision(c: Combatant): number {
  let p = c.stats.precision;
  if (hasStatus(c, 'perfect_form')) p *= 1 + magOf(c, 'perfect_form');
  return p;
}

export function effectiveRegen(c: Combatant): number {
  let r = c.stats.staminaRegen;
  if (hasStatus(c, 'overclocked')) r *= 1 + magOf(c, 'overclocked');
  return Math.round(r);
}

/** Add or refresh a status (never stacks past its magnitude — refreshes). */
export function applyStatus(c: Combatant, kind: StatusKind, turns: number, magnitude: number): void {
  const existing = c.statuses.find((x) => x.kind === kind);
  if (existing) {
    existing.turnsLeft = Math.max(existing.turnsLeft, turns);
    existing.magnitude = Math.max(existing.magnitude, magnitude);
  } else {
    c.statuses.push({ kind, turnsLeft: turns, magnitude });
  }
}

/** Tick every status down a turn and drop the expired ones. Returns the
 *  kinds that expired (for narration). Guards against negative durations. */
export function tickStatuses(c: Combatant): StatusKind[] {
  const expired: StatusKind[] = [];
  for (const s of c.statuses) s.turnsLeft -= 1;
  c.statuses = c.statuses.filter((s) => {
    if (s.turnsLeft <= 0) {
      expired.push(s.kind);
      return false;
    }
    return true;
  });
  return expired;
}

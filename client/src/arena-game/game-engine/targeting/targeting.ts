/**
 * Target acquisition. Deterministic: ties broken by lower entity id.
 *
 * Rules:
 *  - 'default' units engage the nearest living enemy in their lane within
 *    aggro range; otherwise they march toward the enemy core.
 *  - 'core-only' units ignore enemy units entirely.
 *  - 'healer' units pick the most-wounded living ally in their lane within
 *    attack range (excluding themselves); otherwise they march.
 *  - Cores are attacked when within attack range (cores are lane-agnostic).
 */
import type { BalanceConfig } from '../../content/balance';
import {
  BattleState,
  CoreState,
  effectiveStats,
  enemyOf,
  UnitState,
} from '../simulation/state';

export type TargetRef =
  | { kind: 'unit'; unit: UnitState }
  | { kind: 'core'; core: CoreState }
  | null;

export function distanceBetween(a: number, b: number): number {
  return Math.abs(a - b);
}

/** Nearest living enemy unit in the same lane within range. */
export function findNearestEnemy(
  state: BattleState,
  unit: UnitState,
  maxRange: number
): UnitState | null {
  let best: UnitState | null = null;
  let bestDist = Infinity;
  for (const other of state.units) {
    if (!other.alive || other.team === unit.team || other.lane !== unit.lane) continue;
    const d = distanceBetween(unit.x, other.x);
    if (d > maxRange) continue;
    if (d < bestDist || (d === bestDist && best !== null && other.id < best.id)) {
      best = other;
      bestDist = d;
    }
  }
  return best;
}

/** Most-wounded living ally (health fraction) in lane within range, excluding self. */
export function findHealTarget(
  state: BattleState,
  healer: UnitState,
  maxRange: number,
  tick: number
): UnitState | null {
  let best: UnitState | null = null;
  let bestFraction = 1;
  for (const other of state.units) {
    if (!other.alive || other.team !== healer.team || other.id === healer.id) continue;
    if (other.lane !== healer.lane) continue;
    if (distanceBetween(healer.x, other.x) > maxRange) continue;
    const fraction = other.health / other.baseMaxHealth;
    if (fraction >= 1) continue;
    if (fraction < bestFraction || (fraction === bestFraction && best !== null && other.id < best.id)) {
      best = other;
      bestFraction = fraction;
    }
  }
  return best;
}

/**
 * Frontmost living ally (deepest into enemy territory) in lane within range,
 * excluding self, whose shield is below `shieldCap`. Id tie-break.
 */
export function findShieldTarget(
  state: BattleState,
  shielder: UnitState,
  maxRange: number,
  shieldCap: number
): UnitState | null {
  let best: UnitState | null = null;
  for (const other of state.units) {
    if (!other.alive || other.team !== shielder.team || other.id === shielder.id) continue;
    if (other.lane !== shielder.lane) continue;
    if (distanceBetween(shielder.x, other.x) > maxRange) continue;
    if (other.shield >= shieldCap) continue;
    const advance = shielder.team === 'player' ? other.x : -other.x;
    const bestAdvance = best === null ? -Infinity : shielder.team === 'player' ? best.x : -best.x;
    if (best === null || advance > bestAdvance || (advance === bestAdvance && other.id < best.id)) {
      best = other;
    }
  }
  return best;
}

export function enemyCore(state: BattleState, unit: UnitState): CoreState {
  return state.cores[enemyOf(unit.team)];
}

/**
 * Chooses the unit's current action target. Re-evaluated every tick before
 * acting, so dead or out-of-lane targets are always dropped.
 */
export function acquireTarget(
  state: BattleState,
  balance: BalanceConfig,
  unit: UnitState,
  attackRange: number
): TargetRef {
  if (unit.behavior === 'healer') {
    const ally = findHealTarget(state, unit, attackRange, state.tick);
    if (ally) return { kind: 'unit', unit: ally };
    return null; // no one to heal — march
  }

  if (unit.behavior === 'shielder') {
    // Aura-folded stats, consistent with the attack path in tick.ts.
    const cap =
      effectiveStats(unit, state.tick, state.auras[unit.team]).attackDamage *
      balance.units.shielderShieldCapMult;
    const ally = findShieldTarget(state, unit, attackRange, cap);
    if (ally) return { kind: 'unit', unit: ally };
    return null; // no one to shield — march
  }

  if (unit.behavior !== 'core-only') {
    // Prefer keeping the existing target if it is still valid and in aggro.
    if (unit.targetId !== null) {
      const current = state.units.find((u) => u.id === unit.targetId);
      if (
        current &&
        current.alive &&
        current.team !== unit.team &&
        current.lane === unit.lane &&
        distanceBetween(unit.x, current.x) <= balance.arena.aggroRange
      ) {
        return { kind: 'unit', unit: current };
      }
      unit.targetId = null;
    }
    const enemy = findNearestEnemy(state, unit, balance.arena.aggroRange);
    if (enemy) {
      unit.targetId = enemy.id;
      return { kind: 'unit', unit: enemy };
    }
  }

  const core = enemyCore(state, unit);
  if (core.health > 0) return { kind: 'core', core };
  return null;
}

/**
 * Arena 2.0 — champion player-control command logic (Redesign P2).
 *
 * The deterministic core behind the `champion-basic-attack` and
 * `champion-lane-switch` commands (dispatched from simulation/events.ts). Pure
 * over sim state — mutates only the passed champion unit. These commands are
 * arena2-only; Arena 1.0 never issues them, so this file never runs in a 1.0
 * battle and 1.0 digests are unaffected (see ChampionState docs / §14).
 *
 * Model:
 *  - Movement stays automatic (unchanged). The player controls *timing*.
 *  - Basic attack is rate-limited and chains a combo: taps within the window
 *    escalate a damage multiplier the champion's next strike consumes, and the
 *    tap readies the champion to strike THIS tick if a target is in range.
 *  - Lane switch flips the champion to the other lane on a cooldown — a general
 *    control verb (Cardio's lane-shift ability stays its own thing).
 */
import type { CommandResult } from '../simulation/events';
import { type BattleState, logEvent, type UnitState } from '../simulation/state';

/** Taps within this window chain the combo (0.6s at 20Hz). */
export const COMBO_WINDOW_TICKS = 12;
/** Minimum ticks between accepted taps — caps the player attack rate (~6.7/s). */
export const COMBO_MIN_GAP_TICKS = 3;
/** Combo caps here; higher taps hold the top multiplier. */
export const COMBO_MAX = 4;
/** Bonus damage per combo level (+18% each). */
export const COMBO_STEP = 0.18;
/** Lane-switch cooldown (1s at 20Hz). */
export const LANE_SWITCH_COOLDOWN_TICKS = 20;

/** Damage multiplier for a combo of `count` accepted taps (count in [0, MAX]). */
export function comboMultForCount(count: number): number {
  return 1 + Math.min(Math.max(count, 0), COMBO_MAX) * COMBO_STEP;
}

/** True while the champion's combo is still live (for UI; pure). */
export function comboActive(champ: { lastBasicAttackTick: number }, tick: number): boolean {
  return tick - champ.lastBasicAttackTick <= COMBO_WINDOW_TICKS;
}

/**
 * Player basic-attack: rate-limited, chains a combo, and readies the champion
 * to strike its in-range target on this tick (actUnit consumes pendingComboMult
 * — see tick.ts's championStrikeDamage). Rejected if tapped faster than the gap.
 */
export function applyChampionBasicAttack(state: BattleState, unit: UnitState): CommandResult {
  const champ = unit.champion;
  if (!champ) return { ok: false, reason: 'not a champion' };
  if (state.tick - champ.lastBasicAttackTick < COMBO_MIN_GAP_TICKS) {
    return { ok: false, reason: 'attacking too fast' };
  }
  champ.comboCount = comboActive(champ, state.tick) ? Math.min(COMBO_MAX, champ.comboCount + 1) : 1;
  champ.lastBasicAttackTick = state.tick;
  champ.pendingComboMult = comboMultForCount(champ.comboCount);
  unit.attackCooldownTicks = 0; // strike this tick if a target is in range
  logEvent(state, 'champion-basic', `${unit.contentId}#${unit.id} combo ${champ.comboCount}`);
  return { ok: true };
}

/** Player lane-switch: flip to the other lane on a cooldown, dropping the target
 *  so it retargets cleanly in the new lane. */
export function applyChampionLaneSwitch(state: BattleState, unit: UnitState): CommandResult {
  const champ = unit.champion;
  if (!champ) return { ok: false, reason: 'not a champion' };
  if (state.tick < champ.laneSwitchReadyTick) {
    return { ok: false, reason: 'lane switch on cooldown' };
  }
  unit.lane = unit.lane === 0 ? 1 : 0;
  unit.targetId = null;
  champ.laneSwitchReadyTick = state.tick + LANE_SWITCH_COOLDOWN_TICKS;
  logEvent(state, 'champion-lane', `${unit.contentId}#${unit.id} switched to lane ${unit.lane}`);
  return { ok: true };
}

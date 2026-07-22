/**
 * Mid-match augment engine support (M6).
 *
 * Flow: at BALANCE.augment.offerTick each team is OFFERED `choiceCount` of
 * the augment pool, drawn deterministically from the battle RNG in fixed team
 * order (player first) — this consumes battle RNG, so digests of battles that
 * cross the offer tick differ from pre-M6 builds (expected). A team chooses
 * via the 'choose-augment' command (validated in events.ts): only after the
 * offer, only from its own offered ids, once per team. A team that never
 * chooses simply gets nothing.
 *
 * Offered/chosen ids + choice tick live in TeamAugmentState and ARE digested
 * (they are state, not derivable). The chosen augment's ongoing bonuses fold
 * into the derived aura layer (synergies module); one-shot and periodic
 * effects live here. This module (not tick.ts) touches augment content, in
 * line with the events.ts precedent — the per-tick stat path stays free of
 * content lookups.
 */
import { AUGMENTS, getAugmentById } from '../../content/augments';
import type { BalanceConfig } from '../../content/balance';
import { healUnit } from '../combat/combat';
import { BattleState, logEvent, TEAMS } from '../simulation/state';
import type { TeamId } from '../types';

/** Step 4 of the tick pipeline: create both teams' offers at the offer tick. */
export function offerAugments(state: BattleState, balance: BalanceConfig): void {
  if (state.tick !== balance.augment.offerTick) return;
  for (const team of TEAMS) {
    const teamState = state.teams[team];
    if (teamState.augment.offeredIds !== null) continue;
    const offered = state.rng
      .shuffle(AUGMENTS.map((a) => a.id))
      .slice(0, balance.augment.choiceCount);
    teamState.augment.offeredIds = offered;
    logEvent(state, 'augment-offer', `${team}: ${offered.join(', ')}`);
  }
}

/**
 * Applies a validated augment choice (events.ts owns validation). Records
 * the choice, then fires one-shot effects; ongoing effects are picked up by
 * the aura recompute at the end of this tick.
 */
export function applyAugmentChoice(state: BattleState, team: TeamId, augmentId: string): void {
  const teamState = state.teams[team];
  teamState.augment.chosenId = augmentId;
  teamState.augment.chosenAtTick = state.tick;
  logEvent(state, 'augment-chosen', `${team} chose ${augmentId}`);

  const definition = getAugmentById(augmentId);
  if (definition?.effect.kind === 'core-repair') {
    const core = state.cores[team];
    const repaired = Math.min(core.maxHealth - core.health, definition.effect.amount);
    if (repaired > 0) {
      core.health += repaired;
      logEvent(state, 'augment-effect', `${team} core repaired ${repaired}`);
    }
  }
}

/**
 * Periodic augment effects (currently heal-pulse): pulses every
 * intervalTicks after the choice tick. Healing received scales with the
 * team's healingMult aura like every other heal.
 */
export function applyAugmentPulses(state: BattleState): void {
  for (const team of TEAMS) {
    const aura = state.auras[team];
    if (!aura.healPulse) continue;
    const chosenAtTick = state.teams[team].augment.chosenAtTick;
    if (chosenAtTick === null) continue;
    const elapsed = state.tick - chosenAtTick;
    if (elapsed <= 0 || elapsed % aura.healPulse.intervalTicks !== 0) continue;
    let total = 0;
    for (const unit of state.units) {
      if (!unit.alive || unit.team !== team) continue;
      const healed = healUnit(unit, aura.healPulse.amount, aura.healingMult);
      if (healed > 0) {
        total += healed;
        logEvent(
          state,
          'fx',
          `heal|${unit.lane}|${Math.round(unit.x)}|${Math.round(healed)}|${team}`
        );
      }
    }
    if (total > 0) {
      logEvent(state, 'augment-pulse', `${team} healed ${Math.round(total)} total`);
    }
  }
}

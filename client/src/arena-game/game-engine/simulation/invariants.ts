/**
 * Battle state assertions. Run after every tick in development and tests;
 * violations indicate engine bugs (the reliability list in the master prompt).
 */
import type { BalanceConfig } from '../../content/balance';
import { getAugmentById } from '../../content/augments';
import { SYNERGIES } from '../../content/synergies';
import { checkCardsInvariant } from '../cards/deck';
import type { BattleState } from './state';

export function checkInvariants(state: BattleState, balance: BalanceConfig): string[] {
  const violations: string[] = [];
  const { laneLength } = balance.arena;

  // Energy always valid; card cycle never loses or duplicates cards.
  for (const team of ['player', 'opponent'] as const) {
    const e = state.teams[team].energy;
    if (!Number.isFinite(e) || e < 0 || e > balance.energy.max + 1e-9) {
      violations.push(`invalid energy for ${team}: ${e}`);
    }
    const cards = state.teams[team].cards;
    if (cards) {
      violations.push(...checkCardsInvariant(cards, balance).map((v) => `${team}: ${v}`));
    }

    // Augment state coherence: an offer only at/after the offer tick, exactly
    // choiceCount distinct known ids; a choice only from the team's own offer,
    // with a plausible choice tick; never a choice tick without a choice.
    const augment = state.teams[team].augment;
    if (augment.offeredIds !== null) {
      if (state.tick < balance.augment.offerTick)
        violations.push(`${team}: augment offer before the offer tick`);
      if (augment.offeredIds.length !== balance.augment.choiceCount)
        violations.push(`${team}: augment offer has ${augment.offeredIds.length} options`);
      if (new Set(augment.offeredIds).size !== augment.offeredIds.length)
        violations.push(`${team}: duplicate offered augments`);
      for (const id of augment.offeredIds) {
        if (!getAugmentById(id)) violations.push(`${team}: unknown offered augment '${id}'`);
      }
    }
    if (augment.chosenId !== null) {
      if (augment.offeredIds === null || !augment.offeredIds.includes(augment.chosenId))
        violations.push(`${team}: chosen augment '${augment.chosenId}' was not offered`);
      if (augment.chosenAtTick === null || augment.chosenAtTick > state.tick)
        violations.push(`${team}: invalid augment choice tick ${augment.chosenAtTick}`);
    } else if (augment.chosenAtTick !== null) {
      violations.push(`${team}: augment choice tick without a choice`);
    }

    // Aura layer shape (values are derived; deep correctness is covered by
    // the synergy test suite — tests may legitimately hold a stale snapshot
    // after direct state surgery, so no recompute-equality check here).
    const aura = state.auras[team];
    if (!Number.isFinite(aura.armorFlat) || aura.armorFlat < 0)
      violations.push(`${team}: invalid armorFlat ${aura.armorFlat}`);
    for (const [key, value] of [
      ['healingMult', aura.healingMult],
      ['moveSpeedMult', aura.moveSpeedMult],
      ['attackDamageMult', aura.attackDamageMult],
      ['energyRegenMult', aura.energyRegenMult],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0)
        violations.push(`${team}: invalid aura ${key} ${value}`);
    }
    if (new Set(aura.activeSynergyIds).size !== aura.activeSynergyIds.length)
      violations.push(`${team}: duplicate active synergies`);
    for (const id of aura.activeSynergyIds) {
      if (!SYNERGIES.some((s) => s.id === id))
        violations.push(`${team}: unknown active synergy '${id}'`);
    }
  }

  // Entity ids unique (cores are 1 and 2).
  const ids = new Set<number>([1, 2]);
  for (const unit of state.units) {
    if (ids.has(unit.id)) violations.push(`duplicate entity id ${unit.id}`);
    ids.add(unit.id);
  }

  const commandableChampionsPerTeam = { player: 0, opponent: 0 };
  const borrowedChampionsPerTeam = { player: 0, opponent: 0 };
  for (const unit of state.units) {
    const tag = `${unit.contentId}#${unit.id}`;
    if (unit.attackCooldownTicks < 0) violations.push(`${tag}: negative cooldown`);
    // Champion state coherence: kind and sub-state always travel together;
    // a dead champion keeps health 0 and a pending respawn strictly in the
    // future (the tick pipeline revives at exactly respawnAtTick); an alive
    // champion never has a pending respawn.
    if ((unit.kind === 'champion') !== (unit.champion !== undefined))
      violations.push(`${tag}: kind/champion state mismatch`);
    if (unit.champion) {
      if (unit.champion.commandable) commandableChampionsPerTeam[unit.team]++;
      else borrowedChampionsPerTeam[unit.team]++;
      const champ = unit.champion;
      if (!Number.isFinite(champ.abilityCooldownTicks) || champ.abilityCooldownTicks < 0)
        violations.push(`${tag}: invalid ability cooldown ${champ.abilityCooldownTicks}`);
      if (
        !Number.isFinite(champ.ultimateCharge) ||
        champ.ultimateCharge < 0 ||
        champ.ultimateCharge > champ.chargeRequired + 1e-9
      )
        violations.push(`${tag}: ultimate charge out of range ${champ.ultimateCharge}`);
      if (unit.alive && champ.respawnAtTick !== null)
        violations.push(`${tag}: alive with pending respawn`);
      if (!unit.alive) {
        if (champ.respawnAtTick === null) violations.push(`${tag}: down without respawn tick`);
        else if (champ.respawnAtTick <= state.tick)
          violations.push(`${tag}: missed respawn tick ${champ.respawnAtTick}`);
      }
    }
    if (!Number.isFinite(unit.x) || unit.x < 0 || unit.x > laneLength)
      violations.push(`${tag}: position ${unit.x} out of bounds`);
    if (!Number.isFinite(unit.health)) violations.push(`${tag}: non-finite health`);
    if (unit.alive && unit.health <= 0) violations.push(`${tag}: alive with health <= 0`);
    if (!unit.alive && unit.health !== 0) violations.push(`${tag}: dead with health != 0`);
    if (unit.shield < 0) violations.push(`${tag}: negative shield`);
    if (unit.health > unit.baseMaxHealth + totalBonusHealth(state, unit))
      violations.push(`${tag}: health above max`);
    // No unit may target a dead entity.
    if (unit.alive && unit.targetId !== null) {
      const target = state.units.find((u) => u.id === unit.targetId);
      if (!target) {
        if (unit.targetId !== 1 && unit.targetId !== 2)
          violations.push(`${tag}: targets unknown entity ${unit.targetId}`);
      } else if (!target.alive) {
        violations.push(`${tag}: targets dead entity ${unit.targetId}`);
      }
    }
  }

  // At most ONE commandable champion (the captain) per team; borrowed
  // (auto-cast) champions are capped by balance (M9).
  for (const team of ['player', 'opponent'] as const) {
    if (commandableChampionsPerTeam[team] > 1)
      violations.push(`${team} has ${commandableChampionsPerTeam[team]} commandable champions`);
    if (borrowedChampionsPerTeam[team] > balance.gym.maxBorrowed)
      violations.push(
        `${team} has ${borrowedChampionsPerTeam[team]} borrowed champions (max ${balance.gym.maxBorrowed})`
      );
  }

  // Core health in range.
  for (const team of ['player', 'opponent'] as const) {
    const core = state.cores[team];
    if (core.health < 0 || core.health > core.maxHealth)
      violations.push(`${team} core health out of range: ${core.health}`);
  }

  // Phase/outcome consistency — a battle never has multiple or missing results.
  if (state.phase === 'finished' && state.outcome === null)
    violations.push('finished without outcome');
  if (state.phase !== 'finished' && state.outcome !== null)
    violations.push('outcome set before finish');
  if (state.outcome) {
    const w = state.outcome.winner;
    if (w !== 'player' && w !== 'opponent' && w !== 'draw')
      violations.push(`invalid winner '${String(w)}'`);
  }

  return violations;
}

function totalBonusHealth(state: BattleState, unit: { modifiers: { expiresAtTick: number; bonusMaxHealth?: number }[] }): number {
  let bonus = 0;
  for (const m of unit.modifiers) {
    if (m.expiresAtTick > state.tick && m.bonusMaxHealth) bonus += m.bonusMaxHealth;
  }
  return bonus;
}

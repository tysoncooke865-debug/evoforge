/**
 * Synergy aura layer (M6) — per the engine review, synergies are a RECOMPUTED
 * aura, not accumulating timed modifiers: every evaluation derives the active
 * set from the LIVING team composition (units + champion), so death
 * deactivates and redeploy reactivates with no stacking or expiry bookkeeping.
 *
 * Evaluation cadence: `recomputeAuras` runs once per (team, tick) at the end
 * of the tick pipeline — O(living units) per tick, not per unit — and the
 * whole next tick (commands, combat, regen) consumes that snapshot uniformly.
 * The chosen augment's permanent team bonuses fold into the same layer.
 *
 * Auras are DERIVED state: fully recomputable from digested state, so they
 * are not digested themselves; activation transitions are logged as
 * 'synergy-on' / 'synergy-off' so battles stay observable.
 *
 * Counting rules:
 *  - A tag synergy counts living combatants carrying the tag (copies count —
 *    two Forge Recruits are two brawlers).
 *  - 'mixed-paths' counts DISTINCT avatar-path tags (aesthetic/titan/mass/
 *    shredder/cardio) present across living combatants.
 *  - The champion's content tags count exactly like unit tags.
 *
 * Champion team-aura PASSIVES (five-champion pass) fold into the same layer:
 * a LIVING champion whose passive declares a teamAura contributes its
 * multipliers here — dies with the champion, returns on respawn, recomputed
 * every tick like everything else in this file (derived state).
 */
import { getAugmentById } from '../../content/augments';
import { getCardById } from '../../content/cards';
import { getChampionById } from '../../content/champions';
import { SYNERGIES } from '../../content/synergies';
import { ALL_AVATAR_PATHS, UnitTag } from '../types';
import {
  BattleState,
  logEvent,
  neutralTeamAuras,
  TeamAuras,
  TEAMS,
} from '../simulation/state';
import type { TeamId } from '../types';

const PATH_TAGS: ReadonlySet<string> = new Set(ALL_AVATAR_PATHS);

/** Tags of a living combatant: card tags for units, champion tags for champions. */
function combatantTags(unit: { kind: 'unit' | 'champion'; contentId: string }): readonly UnitTag[] {
  const definition =
    unit.kind === 'champion' ? getChampionById(unit.contentId) : getCardById(unit.contentId);
  return definition?.tags ?? [];
}

/**
 * Derives one team's full aura block from living composition + chosen
 * augment. Pure with respect to `state` (no mutation, no RNG).
 */
export function computeTeamAuras(state: BattleState, team: TeamId): TeamAuras {
  const auras = neutralTeamAuras();

  const tagCounts = new Map<UnitTag, number>();
  const pathsPresent = new Set<string>();
  for (const unit of state.units) {
    if (!unit.alive || unit.team !== team) continue;
    for (const tag of combatantTags(unit)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      if (PATH_TAGS.has(tag)) pathsPresent.add(tag);
    }
    // Living champions contribute their passive team aura (Flow State,
    // Perpetual Motion). Content-defined, alive-only, derived each recompute.
    if (unit.kind === 'champion') {
      const aura = getChampionById(unit.contentId)?.passive.effects.teamAura;
      if (aura) {
        if (aura.energyRegenMult !== undefined) auras.energyRegenMult *= aura.energyRegenMult;
        if (aura.healingMult !== undefined) auras.healingMult *= aura.healingMult;
      }
    }
  }

  for (const synergy of SYNERGIES) {
    const count =
      synergy.tag === 'mixed-paths' ? pathsPresent.size : (tagCounts.get(synergy.tag) ?? 0);
    if (count < synergy.threshold) continue;
    auras.activeSynergyIds.push(synergy.id);
    const bonus = synergy.bonus;
    if (bonus.armorFlat !== undefined) auras.armorFlat += bonus.armorFlat;
    if (bonus.healingMult !== undefined) auras.healingMult *= bonus.healingMult;
    if (bonus.moveSpeedMult !== undefined) auras.moveSpeedMult *= bonus.moveSpeedMult;
    if (bonus.attackDamageMult !== undefined) auras.attackDamageMult *= bonus.attackDamageMult;
  }

  // The chosen augment is a permanent-for-battle team aura (sourced from the
  // digested TeamAugmentState, so this stays derived state).
  const chosenId = state.teams[team].augment.chosenId;
  if (chosenId !== null) {
    const augment = getAugmentById(chosenId);
    if (augment) {
      const effect = augment.effect;
      switch (effect.kind) {
        case 'team-aura':
          if (effect.attackDamageMult !== undefined)
            auras.attackDamageMult *= effect.attackDamageMult;
          if (effect.moveSpeedMult !== undefined) auras.moveSpeedMult *= effect.moveSpeedMult;
          if (effect.healingMult !== undefined) auras.healingMult *= effect.healingMult;
          if (effect.armorFlat !== undefined) auras.armorFlat += effect.armorFlat;
          break;
        case 'energy-regen':
          auras.energyRegenMult *= effect.regenMult;
          break;
        case 'heal-pulse':
          auras.healPulse = { amount: effect.amount, intervalTicks: effect.intervalTicks };
          break;
        case 'deploy-shield':
          auras.deployShield += effect.amount;
          break;
        case 'core-repair':
          break; // one-shot, applied when the choice command lands
      }
    }
  }

  return auras;
}

/**
 * Recomputes both teams' auras (fixed team order) and logs synergy
 * activation/deactivation transitions. Called once at the end of every tick.
 */
export function recomputeAuras(state: BattleState): void {
  for (const team of TEAMS) {
    const previous = state.auras[team].activeSynergyIds;
    const next = computeTeamAuras(state, team);
    for (const id of next.activeSynergyIds) {
      if (!previous.includes(id)) logEvent(state, 'synergy-on', `${team} ${id}`);
    }
    for (const id of previous) {
      if (!next.activeSynergyIds.includes(id)) logEvent(state, 'synergy-off', `${team} ${id}`);
    }
    state.auras[team] = next;
  }
}

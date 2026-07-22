/**
 * Damage, healing and death resolution. All health changes in the game go
 * through these functions so shields, clamping and death are handled in
 * exactly one place.
 *
 * Champion hooks (M5) also live here so they apply uniformly to every damage
 * source: damage-taken modifiers, ultimate-charge accrual and respawn
 * scheduling all read state copied onto the unit at spawn — this module
 * never imports content.
 */
import { BattleState, ChampionState, CoreState, logEvent, UnitState } from '../simulation/state';

export interface DamageResult {
  dealtToShield: number;
  dealtToHealth: number;
  killed: boolean;
}

/** Product of the target's active damageTakenMult modifiers (1 = neutral). */
function damageTakenMult(target: UnitState, tick: number): number {
  let mult = 1;
  for (const mod of target.modifiers) {
    if (mod.expiresAtTick <= tick) continue;
    if (mod.damageTakenMult !== undefined) mult *= mod.damageTakenMult;
  }
  return mult;
}

/** Adds ultimate charge, capped at the champion's required amount. */
export function gainUltimateCharge(champion: ChampionState, amount: number): void {
  if (amount <= 0) return;
  champion.ultimateCharge = Math.min(champion.chargeRequired, champion.ultimateCharge + amount);
}

/**
 * Every hit against a frontline unit protected by armour still deals at
 * least this much. An engine rule, not a tunable — the armour VALUE is the
 * tunable (content synergies / augments).
 */
const ARMOR_MIN_DAMAGE = 1;

/**
 * Applies damage to a unit: damage-taken modifiers first, then aura armour,
 * then shield, then health. Marks death. Pass `source` (the attacking unit)
 * so champions gain ultimate charge for damage they deal; damage from
 * ultimates themselves passes no source (an ultimate never charges the next
 * one).
 *
 * Aura armour (M6 synergies): the target team's `armorFlat` reduces every
 * hit flat, minimum ARMOR_MIN_DAMAGE dealt, and only for FRONTLINE
 * combatants. Frontline rule: melee combatants (base.isRanged === false) —
 * the simplest defensible line: melee units are the ones physically standing
 * in front absorbing hits, it needs no content lookup mid-combat, and every
 * shipped champion is melee so champions benefit too. Applies uniformly to
 * all damage routed through damageUnit (attacks, cards, abilities) — like
 * damageTakenMult, armour can blunt Final Cut's execute follow-up.
 */
export function damageUnit(
  state: BattleState,
  target: UnitState,
  amount: number,
  sourceLabel: string,
  source?: UnitState
): DamageResult {
  if (!target.alive || amount <= 0) return { dealtToShield: 0, dealtToHealth: 0, killed: false };
  let effective = amount * damageTakenMult(target, state.tick);
  const armor = state.auras[target.team].armorFlat;
  if (armor > 0 && !target.base.isRanged) {
    effective = Math.max(ARMOR_MIN_DAMAGE, effective - armor);
  }
  const toShield = Math.min(target.shield, effective);
  target.shield -= toShield;
  const remaining = effective - toShield;
  const toHealth = Math.min(target.health, remaining);
  target.health -= toHealth;

  // Ultimate charge accrues from damage actually dealt/taken (shields count,
  // overkill does not).
  const dealt = toShield + toHealth;
  if (dealt > 0) {
    // Structured combat-feedback entry for the UI's floating numbers
    // (kind|lane|x|amount|team). Log-only — never digested.
    logEvent(
      state,
      'fx',
      `hit|${target.lane}|${Math.round(target.x)}|${Math.round(dealt)}|${target.team}`
    );
    if (source?.champion && source.alive && source.team !== target.team) {
      gainUltimateCharge(source.champion, dealt * source.champion.chargePerDamageDealt);
    }
    if (target.champion) {
      gainUltimateCharge(target.champion, dealt * target.champion.chargePerDamageTaken);
    }
  }

  let killed = false;
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    target.targetId = null;
    killed = true;
    // No living unit may keep a dead entity as a target, regardless of what
    // killed it (basic attack, card effect or champion ability).
    for (const u of state.units) {
      if (u.targetId === target.id) u.targetId = null;
    }
    // Champions are not gone for good — schedule the respawn (delay copied
    // from balance at spawn). The tick pipeline revives at respawnAtTick.
    if (target.champion) {
      target.champion.respawnAtTick = state.tick + target.champion.respawnDelayTicks;
    }
    logEvent(state, 'death', `${target.team} ${target.contentId}#${target.id} killed by ${sourceLabel}`);
    logEvent(state, 'fx', `death|${target.lane}|${Math.round(target.x)}|0|${target.team}`);
  }
  return { dealtToShield: toShield, dealtToHealth: toHealth, killed };
}

export function damageCore(
  state: BattleState,
  core: CoreState,
  amount: number,
  sourceLabel: string,
  source?: UnitState
): void {
  if (core.health <= 0 || amount <= 0) return;
  const dealt = Math.min(core.health, amount);
  core.health = Math.max(0, core.health - amount);
  if (source?.champion && source.alive) {
    gainUltimateCharge(source.champion, dealt * source.champion.chargePerDamageDealt);
  }
  if (core.health === 0) {
    logEvent(state, 'core-destroyed', `${core.team} core destroyed by ${sourceLabel}`);
  }
}

/**
 * Heals a unit up to its base max health (bonus health is shield-like, not
 * healable). `healingMult` is the receiving team's aura multiplier
 * (`state.auras[target.team].healingMult`) — callers without aura context
 * (tests, pre-M6 paths) omit it for neutral behaviour.
 */
export function healUnit(target: UnitState, amount: number, healingMult = 1): number {
  if (!target.alive || amount <= 0) return 0;
  const boosted = amount * healingMult;
  // Lower clamp: if health exceeds baseMaxHealth (bonus-max-health effects),
  // healing must be a no-op, never silent negative damage.
  const healed = Math.max(0, Math.min(target.baseMaxHealth - target.health, boosted));
  target.health += healed;
  return healed;
}

export function addShield(target: UnitState, amount: number): void {
  if (!target.alive || amount <= 0) return;
  target.shield += amount;
}

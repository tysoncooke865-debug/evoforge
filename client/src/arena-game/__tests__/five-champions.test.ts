/**
 * Five-champion pass — the OFFICIAL roster's new kit + passives:
 *
 *  - Mass Monster kit numerics: Gravity Well (cross-lane slow, no stun, no
 *    damage) and Mass Uprising (deterministic summons), plus tested
 *    DISTINCTNESS from the Titan (different stats + different ability
 *    behaviour class: control burst vs area denial + summoning).
 *  - Every passive's numbers: Iron Hide (self armour), Colossal Frame
 *    (spawn health), Killer Instinct (low-health bonus damage), Perpetual
 *    Motion (team energy regen aura, alive-only), Flow State (team healing
 *    aura, alive-only).
 *  - Passive aura lifecycle: dies with the champion, returns on respawn.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE, getCardById, getChampionById } from '../content';
import { findTeamChampion } from '../game-engine/abilities/champion-abilities';
import { damageUnit, healUnit } from '../game-engine/combat/combat';
import { spawnUnitsForCard } from '../game-engine/entities/spawn';
import { applyCommand } from '../game-engine/simulation/events';
import { checkInvariants } from '../game-engine/simulation/invariants';
import { runBattle } from '../game-engine/simulation/run';
import { BattleState, createBattle, effectiveStats, UnitState } from '../game-engine/simulation/state';
import { advanceTick } from '../game-engine/simulation/tick';

function championBattle(playerChampionId?: string, opponentChampionId?: string): BattleState {
  const state = createBattle(
    {
      seed: 20260723,
      player: { playerId: 'p1', championId: playerChampionId },
      opponent: { playerId: 'p2', championId: opponentChampionId },
    },
    BALANCE
  );
  state.tick = 1;
  state.teams.player.energy = 10;
  state.teams.opponent.energy = 10;
  return state;
}

function champ(state: BattleState, team: 'player' | 'opponent' = 'player'): UnitState {
  const unit = findTeamChampion(state, team);
  if (!unit) throw new Error(`no ${team} champion in fixture`);
  return unit;
}

function spawnEnemy(state: BattleState, cardId: string, lane: 0 | 1, x: number): UnitState {
  return spawnUnitsForCard(state, BALANCE, getCardById(cardId)!, 'opponent', lane, x)[0];
}

describe('Mass Monster — distinct from the Titan by design', () => {
  it('has a different stat line: far more health, less burst', () => {
    const mass = getChampionById('champion-mass')!;
    const titan = getChampionById('champion-titan')!;
    expect(mass.stats.maxHealth).toBeGreaterThan(titan.stats.maxHealth);
    expect(mass.stats.attackDamage).toBeLessThan(titan.stats.attackDamage);
    expect(mass.stats.attackIntervalTicks).not.toBe(titan.stats.attackIntervalTicks);
    expect(mass.stats.moveSpeedPerTick).toBeLessThan(titan.stats.moveSpeedPerTick);
  });

  it('has a different ability behaviour CLASS: slow field vs stun, summons vs burst', () => {
    const mass = getChampionById('champion-mass')!;
    const titan = getChampionById('champion-titan')!;
    // Titan ability stuns; Mass ability slows (no stun, no damage).
    expect(titan.ability.effects.stunTicks).toBeGreaterThan(0);
    expect(mass.ability.effects.stunTicks).toBeUndefined();
    expect(mass.ability.effects.damage).toBeUndefined();
    expect(mass.ability.effects.moveSpeedMult).toBeLessThan(1);
    // Titan ultimate is AoE damage; Mass ultimate summons and deals none.
    expect(titan.ultimate.effects.damage).toBeGreaterThan(0);
    expect(mass.ultimate.effects.damage).toBeUndefined();
    expect(mass.ultimate.effects.summon).toEqual({ cardId: 'titan-guard', count: 2 });
  });

  it('Gravity Well slows enemies within radius in BOTH lanes, no stun, cooldown paid', () => {
    const state = championBattle('champion-mass');
    const mass = champ(state);
    const def = getChampionById('champion-mass')!;
    const nearSameLane = spawnEnemy(state, 'titan-guard', 0, mass.x + 5);
    const nearOtherLane = spawnEnemy(state, 'neon-boxer', 1, mass.x + 8);
    const far = spawnEnemy(state, 'titan-guard', 0, mass.x + 25);

    const result = applyCommand(state, BALANCE, { type: 'champion-ability', team: 'player' });
    expect(result.ok).toBe(true);
    for (const slowed of [nearSameLane, nearOtherLane]) {
      expect(slowed.modifiers).toEqual([
        {
          sourceId: 'mass-gravity-well',
          expiresAtTick: state.tick + def.ability.effects.durationTicks!,
          moveSpeedMult: def.ability.effects.moveSpeedMult!,
        },
      ]);
      expect(effectiveStats(slowed, state.tick).moveSpeedPerTick).toBeCloseTo(
        slowed.base.moveSpeedPerTick * def.ability.effects.moveSpeedMult!
      );
      expect(slowed.stunUntilTick).toBe(0); // area denial, not control
      expect(slowed.health).toBe(slowed.baseMaxHealth); // no damage
    }
    expect(far.modifiers).toEqual([]);
    expect(champ(state).champion!.abilityCooldownTicks).toBe(def.ability.cooldownTicks);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('Gravity Well rejects with no valid targets and keeps the cooldown', () => {
    const state = championBattle('champion-mass'); // no enemies in radius
    expect(applyCommand(state, BALANCE, { type: 'champion-ability', team: 'player' })).toEqual({
      ok: false,
      reason: 'no valid targets',
    });
    expect(champ(state).champion!.abilityCooldownTicks).toBe(0);
  });

  it('Mass Uprising summons two Titan Guards at the champion, one per lane, and spends the charge', () => {
    const state = championBattle('champion-mass');
    const mass = champ(state);
    mass.lane = 1;
    mass.x = 30;
    mass.champion!.ultimateCharge = mass.champion!.chargeRequired;
    const unitsBefore = state.units.length;

    expect(applyCommand(state, BALANCE, { type: 'champion-ultimate', team: 'player' }).ok).toBe(
      true
    );
    const summons = state.units.slice(unitsBefore);
    expect(summons).toHaveLength(2);
    const guardStats = getCardById('titan-guard')!.unit!.stats;
    // First summon holds the champion's lane, the second covers the other.
    expect(summons.map((u) => u.lane).sort()).toEqual([0, 1]);
    expect(summons[0].lane).toBe(1);
    for (const u of summons) {
      expect(u.team).toBe('player');
      expect(u.contentId).toBe('titan-guard');
      expect(u.x).toBe(30);
      expect(u.health).toBe(guardStats.maxHealth);
      expect(u.kind).toBe('unit');
    }
    expect(mass.champion!.ultimateCharge).toBe(0);
    expect(state.log.some((l) => l.type === 'ultimate' && l.detail.includes('summoned'))).toBe(
      true
    );
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('summoning is deterministic: identical digests across reruns of a mass battle', () => {
    const config = {
      seed: 8899,
      player: { playerId: 'p1', championId: 'champion-mass' },
      opponent: { playerId: 'p2', championId: 'champion-titan' },
    };
    const commands = [
      { tick: 400, command: { type: 'champion-ability' as const, team: 'player' as const } },
      { tick: 900, command: { type: 'champion-ultimate' as const, team: 'player' as const } },
    ];
    const a = runBattle(config, commands, BALANCE);
    const b = runBattle(config, commands, BALANCE);
    expect(a.digest).toBe(b.digest);
    expect(a.invariantViolations).toEqual([]);
    expect(a.stalled).toBe(false);
  });
});

describe('champion passives', () => {
  it('Iron Hide: hits on the Titan are reduced by 5 flat, floored at 1', () => {
    const state = championBattle('champion-titan');
    const titan = champ(state);
    const big = damageUnit(state, titan, 50, 'test');
    expect(big.dealtToHealth).toBe(45); // 50 - 5
    const tiny = damageUnit(state, titan, 3, 'test');
    expect(tiny.dealtToHealth).toBe(1); // floored, never 0
    // Team aura armour is untouched (this is the champion's own passive).
    expect(state.auras.player.armorFlat).toBe(0);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('Colossal Frame: the Mass Monster spawns at 110% of its listed max health', () => {
    const state = championBattle('champion-mass');
    const def = getChampionById('champion-mass')!;
    const mass = champ(state);
    expect(mass.baseMaxHealth).toBe(Math.round(def.stats.maxHealth * 1.1));
    expect(mass.health).toBe(mass.baseMaxHealth);
    // Other champions do NOT get the bake (spawn bake is passive-specific).
    const titanState = championBattle('champion-titan');
    expect(champ(titanState).baseMaxHealth).toBe(getChampionById('champion-titan')!.stats.maxHealth);
  });

  it('Killer Instinct: The Shredder hits 25% harder on targets below 35% health — own hits only', () => {
    const state = championBattle('champion-shredder');
    const shredder = champ(state);
    const target = spawnEnemy(state, 'titan-guard', 0, shredder.x + 4);

    // Above the threshold: no bonus.
    target.health = 400; // 61% of 650
    const normal = damageUnit(state, target, 40, 'test', shredder);
    expect(normal.dealtToHealth).toBe(40);

    // Below the threshold (35% of 650 = 227.5): the shredder's hits scale.
    target.health = 200;
    const boosted = damageUnit(state, target, 40, 'test', shredder);
    expect(boosted.dealtToHealth).toBe(50); // 40 × 1.25

    // A non-champion source gets no bonus on the same low target.
    const ally = spawnUnitsForCard(state, BALANCE, getCardById('neon-boxer')!, 'player', 0, 10)[0];
    target.health = 200;
    const plain = damageUnit(state, target, 40, 'test', ally);
    expect(plain.dealtToHealth).toBe(40);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('Perpetual Motion: the Cardio Machine grants 5% team energy regen while alive', () => {
    const state = championBattle('champion-cardio');
    // Live from creation (initial aura snapshot includes the passive).
    expect(state.auras.player.energyRegenMult).toBeCloseTo(1.05);
    expect(state.auras.opponent.energyRegenMult).toBe(1);

    // Regen genuinely runs 5% faster than the opponent's.
    state.teams.player.energy = 0;
    state.teams.opponent.energy = 0;
    advanceTick(state, BALANCE);
    expect(state.teams.player.energy).toBeCloseTo(
      state.teams.opponent.energy * 1.05
    );

    // Dies with the champion…
    const cardio = champ(state);
    damageUnit(state, cardio, 999999, 'test');
    advanceTick(state, BALANCE);
    expect(state.auras.player.energyRegenMult).toBe(1);

    // …and returns on respawn.
    while (!cardio.alive) advanceTick(state, BALANCE);
    expect(state.auras.player.energyRegenMult).toBeCloseTo(1.05);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('Flow State: Aesthetics grants 10% team healing while alive', () => {
    const state = championBattle('champion-aesthetic');
    expect(state.auras.player.healingMult).toBeCloseTo(1.1);
    expect(state.auras.opponent.healingMult).toBe(1);

    // A card heal on an ally scales by the aura.
    const ally = spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'player', 0, 20)[0];
    ally.health -= 400;
    const before = ally.health;
    const result = applyCommand(state, BALANCE, {
      type: 'play-card',
      team: 'player',
      cardId: 'recovery-pulse',
      target: { kind: 'unit', unitId: ally.id },
    });
    expect(result.ok).toBe(true);
    expect(ally.health).toBe(before + 180 * 1.1);

    // healUnit itself stays neutral without the aura parameter (the passive
    // lives in the aura layer, not inside the combat function).
    ally.health -= 100;
    expect(healUnit(ally, 100)).toBe(100);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('Cardio Overclock refunds 1 energy on cast (tempo identity)', () => {
    const state = championBattle('champion-cardio');
    const cardio = champ(state);
    cardio.champion!.ultimateCharge = cardio.champion!.chargeRequired;
    state.teams.player.energy = 4;
    expect(applyCommand(state, BALANCE, { type: 'champion-ultimate', team: 'player' }).ok).toBe(
      true
    );
    expect(state.teams.player.energy).toBeCloseTo(5); // +1 refund, capped at max
    // The overclock modifiers still land as before.
    expect(cardio.modifiers.some((m) => m.sourceId === 'cardio-overclock')).toBe(true);
  });
});

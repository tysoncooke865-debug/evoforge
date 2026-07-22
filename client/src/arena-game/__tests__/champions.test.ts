/**
 * Milestone 5 tests — Champions. Pure TS only (engine + controller).
 *
 * Covers: champion spawning, every ability and ultimate's numeric outcomes,
 * ultimate charge accrual (dealt/taken/cap), cooldown and charge gating,
 * no-valid-target rejections, death → untargetable → respawn, the full 4x4
 * champion matchup matrix, live replay fidelity including ability/ultimate
 * commands, and determinism.
 */
import { describe, expect, it } from 'vitest';
import {
  createLiveBattle,
  liveDigest,
  queueChampionAbility,
  queueChampionUltimate,
  stepLiveBattle,
} from '../features/arena/battle-controller';
import { BALANCE, getCardById, getChampionById, CHAMPIONS } from '../content';
import { findTeamChampion } from '../game-engine/abilities/champion-abilities';
import { damageUnit } from '../game-engine/combat/combat';
import { spawnUnitsForCard } from '../game-engine/entities/spawn';
import { applyCommand, ScheduledCommand } from '../game-engine/simulation/events';
import { checkInvariants } from '../game-engine/simulation/invariants';
import { computeDigest, runBattle } from '../game-engine/simulation/run';
import {
  BattleState,
  createBattle,
  effectiveStats,
  isStunned,
  UnitState,
} from '../game-engine/simulation/state';
import { advanceTick } from '../game-engine/simulation/tick';
import { DEFAULT_DECK_CARD_IDS } from '../services/persistence/save';
import type { BattleConfig } from '../game-engine/simulation/state';

const OFFSET = BALANCE.champion.spawnOffsetFromCore;
const L = BALANCE.arena.laneLength;

function championConfig(playerChampionId?: string, opponentChampionId?: string): BattleConfig {
  return {
    seed: 4321,
    player: { playerId: 'p1', championId: playerChampionId },
    opponent: { playerId: 'p2', championId: opponentChampionId },
  };
}

/** Battle at tick 1 with full energy, ready for direct applyCommand calls. */
function championBattle(playerChampionId?: string, opponentChampionId?: string): BattleState {
  const state = createBattle(championConfig(playerChampionId, opponentChampionId), BALANCE);
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

function useAbility(state: BattleState, team: 'player' | 'opponent' = 'player') {
  return applyCommand(state, BALANCE, { type: 'champion-ability', team });
}

function useUltimate(state: BattleState, team: 'player' | 'opponent' = 'player') {
  return applyCommand(state, BALANCE, { type: 'champion-ultimate', team });
}

function spawnEnemy(state: BattleState, cardId: string, lane: 0 | 1, x: number): UnitState {
  return spawnUnitsForCard(state, BALANCE, getCardById(cardId)!, 'opponent', lane, x)[0];
}

function spawnAlly(state: BattleState, cardId: string, lane: 0 | 1, x: number): UnitState {
  return spawnUnitsForCard(state, BALANCE, getCardById(cardId)!, 'player', lane, x)[0];
}

describe('champion spawning', () => {
  it('spawns configured champions in front of their own cores with content stats', () => {
    const state = createBattle(championConfig('champion-titan', 'champion-shredder'), BALANCE);
    const player = champ(state, 'player');
    const opponent = champ(state, 'opponent');
    const titan = getChampionById('champion-titan')!;
    const shredder = getChampionById('champion-shredder')!;

    expect(player.kind).toBe('champion');
    expect(player.contentId).toBe('champion-titan');
    expect(player.x).toBe(OFFSET);
    expect(player.lane).toBe(0); // default lane
    expect(player.health).toBe(titan.stats.maxHealth);
    expect(player.base).toEqual(titan.stats);
    expect(player.behavior).toBe('default');
    expect(player.champion).toMatchObject({
      definitionId: 'champion-titan',
      abilityCooldownTicks: 0,
      ultimateCharge: 0,
      respawnAtTick: null,
      chargePerDamageDealt: titan.ultimateChargePerDamageDealt,
      chargePerDamageTaken: titan.ultimateChargePerDamageTaken,
      chargeRequired: titan.ultimateChargeRequired,
      respawnDelayTicks: BALANCE.champion.respawnTicks,
    });

    expect(opponent.contentId).toBe('champion-shredder');
    expect(opponent.x).toBe(L - OFFSET);
    expect(opponent.health).toBe(shredder.stats.maxHealth);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('honours championLane and throws on unknown champion ids', () => {
    const state = createBattle(
      {
        seed: 1,
        player: { playerId: 'p1', championId: 'champion-speedster', championLane: 1 },
        opponent: { playerId: 'p2' },
      },
      BALANCE
    );
    expect(champ(state, 'player').lane).toBe(1);
    expect(findTeamChampion(state, 'opponent')).toBeNull();

    expect(() =>
      createBattle(
        { seed: 1, player: { playerId: 'p1', championId: 'nope' }, opponent: { playerId: 'p2' } },
        BALANCE
      )
    ).toThrow(/unknown champion/);
  });

  it('champions fight automatically and the digest covers champion state', () => {
    const a = createBattle(championConfig('champion-titan', 'champion-hybrid'), BALANCE);
    const b = createBattle(championConfig('champion-titan', 'champion-hybrid'), BALANCE);
    expect(computeDigest(a)).toBe(computeDigest(b));

    // Every champion runtime field must be digest-visible.
    const mutations: ((u: UnitState) => void)[] = [
      (u) => (u.champion!.ultimateCharge = 5),
      (u) => (u.champion!.abilityCooldownTicks = 7),
      (u) => (u.champion!.respawnAtTick = 99),
      (u) => (u.champion!.stanceShifts = 1),
      (u) => (u.lane = 1),
    ];
    for (const mutate of mutations) {
      const fresh = createBattle(championConfig('champion-titan', 'champion-hybrid'), BALANCE);
      mutate(champ(fresh, 'player'));
      expect(computeDigest(fresh)).not.toBe(computeDigest(a));
    }
  });
});

describe('Titan — Quake Stomp and Seismic Smash', () => {
  it('Quake Stomp stuns all enemies within radius in BOTH lanes, both unit kinds', () => {
    const state = championBattle('champion-titan', 'champion-speedster');
    const titan = champ(state, 'player');
    const enemyChampion = champ(state, 'opponent');
    enemyChampion.x = titan.x + 4; // drag the enemy champion into range
    const nearSameLane = spawnEnemy(state, 'titan-guard', 0, titan.x + 5);
    const nearOtherLane = spawnEnemy(state, 'neon-boxer', 1, titan.x + 8);
    const farSameLane = spawnEnemy(state, 'titan-guard', 0, titan.x + 25);
    const def = getChampionById('champion-titan')!;

    const result = useAbility(state);
    expect(result.ok).toBe(true);

    const stunEnd = state.tick + def.ability.effects.stunTicks!;
    expect(nearSameLane.stunUntilTick).toBe(stunEnd);
    expect(nearOtherLane.stunUntilTick).toBe(stunEnd); // cross-lane ground effect
    expect(enemyChampion.stunUntilTick).toBe(stunEnd); // champions are stunnable
    expect(farSameLane.stunUntilTick).toBe(0);
    expect(isStunned(nearSameLane, state.tick)).toBe(true);
    expect(titan.champion!.abilityCooldownTicks).toBe(def.ability.cooldownTicks);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('rejects with no valid targets and does NOT consume the cooldown', () => {
    const state = championBattle('champion-titan'); // no enemies at all
    const result = useAbility(state);
    expect(result).toEqual({ ok: false, reason: 'no valid targets' });
    expect(champ(state).champion!.abilityCooldownTicks).toBe(0);

    // Same for an enemy that exists but is out of radius.
    spawnEnemy(state, 'titan-guard', 0, champ(state).x + 30);
    expect(useAbility(state)).toEqual({ ok: false, reason: 'no valid targets' });
    expect(champ(state).champion!.abilityCooldownTicks).toBe(0);
  });

  it('cooldown ticks down each tick and gates reuse exactly', () => {
    const state = championBattle('champion-titan');
    const titan = champ(state);
    const enemy = spawnEnemy(state, 'titan-guard', 0, titan.x + 5);
    // Freeze the fight so positions stay stable: stuns do not block abilities.
    titan.stunUntilTick = 100000;
    enemy.stunUntilTick = 100000;
    const cooldown = getChampionById('champion-titan')!.ability.cooldownTicks;

    expect(useAbility(state).ok).toBe(true);
    expect(titan.champion!.abilityCooldownTicks).toBe(cooldown);

    for (let i = 0; i < 100; i++) advanceTick(state, BALANCE);
    expect(titan.champion!.abilityCooldownTicks).toBe(cooldown - 100);
    const early = useAbility(state);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.reason).toContain('cooldown');

    for (let i = 0; i < cooldown - 100 - 1; i++) advanceTick(state, BALANCE);
    expect(titan.champion!.abilityCooldownTicks).toBe(1);
    expect(useAbility(state).ok).toBe(false);
    advanceTick(state, BALANCE);
    expect(titan.champion!.abilityCooldownTicks).toBe(0);
    expect(useAbility(state).ok).toBe(true);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('Seismic Smash deals AoE damage + stun around the champion and resets charge', () => {
    const state = championBattle('champion-titan');
    const titan = champ(state);
    const def = getChampionById('champion-titan')!;
    const near = spawnEnemy(state, 'titan-guard', 0, titan.x + 5);
    const crossLane = spawnEnemy(state, 'titan-guard', 1, titan.x + 9);
    const far = spawnEnemy(state, 'titan-guard', 0, titan.x + 40);
    titan.champion!.ultimateCharge = titan.champion!.chargeRequired;

    const result = useUltimate(state);
    expect(result.ok).toBe(true);
    expect(near.health).toBe(650 - def.ultimate.effects.damage!);
    expect(crossLane.health).toBe(650 - def.ultimate.effects.damage!);
    expect(far.health).toBe(650);
    expect(near.stunUntilTick).toBe(state.tick + def.ultimate.effects.stunTicks!);
    expect(titan.champion!.ultimateCharge).toBe(0);

    // Immediately re-firing is rejected: charge is spent.
    const again = useUltimate(state);
    expect(again).toEqual({ ok: false, reason: 'ultimate not charged' });
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('ultimate with full charge but no targets is rejected and keeps the charge', () => {
    const state = championBattle('champion-titan');
    champ(state).champion!.ultimateCharge = 100;
    expect(useUltimate(state)).toEqual({ ok: false, reason: 'no valid targets' });
    expect(champ(state).champion!.ultimateCharge).toBe(100);
  });
});

describe('ultimate charge accrual', () => {
  it('charges from damage dealt and taken at the content rates, in real combat', () => {
    const state = championBattle('champion-titan');
    const titan = champ(state);
    const def = getChampionById('champion-titan')!;
    titan.x = 20;
    const guard = spawnEnemy(state, 'titan-guard', 0, 21); // in melee contact

    // Only the titan swings: charge from damage dealt.
    guard.stunUntilTick = 100000;
    advanceTick(state, BALANCE);
    const titanDamage = def.stats.attackDamage;
    expect(titan.champion!.ultimateCharge).toBeCloseTo(
      titanDamage * def.ultimateChargePerDamageDealt
    );

    // Only the guard swings: charge from damage taken.
    titan.stunUntilTick = 100000;
    guard.stunUntilTick = 0;
    advanceTick(state, BALANCE);
    const guardDamage = getCardById('titan-guard')!.unit!.stats.attackDamage;
    expect(titan.champion!.ultimateCharge).toBeCloseTo(
      titanDamage * def.ultimateChargePerDamageDealt +
        guardDamage * def.ultimateChargePerDamageTaken
    );
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('shield damage charges; overkill does not; charge caps at required', () => {
    const state = championBattle('champion-titan');
    const titan = champ(state);
    const guard = spawnEnemy(state, 'titan-guard', 0, 30);

    // Shielded target: absorbed damage still counts as dealt.
    guard.shield = 50;
    damageUnit(state, guard, 40, 'test', titan);
    expect(titan.champion!.ultimateCharge).toBeCloseTo(40 * 0.06);

    // Overkill: only the health actually removed counts.
    guard.shield = 0;
    guard.health = 10;
    damageUnit(state, guard, 5000, 'test', titan);
    expect(titan.champion!.ultimateCharge).toBeCloseTo(40 * 0.06 + 10 * 0.06);

    // Cap.
    const fresh = spawnEnemy(state, 'heavy-tank', 0, 40);
    titan.champion!.ultimateCharge = 99;
    damageUnit(state, fresh, 500, 'test', titan);
    expect(titan.champion!.ultimateCharge).toBe(titan.champion!.chargeRequired);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('champions charge from damaging the enemy core', () => {
    const state = championBattle('champion-titan');
    const titan = champ(state);
    titan.x = L - 1; // adjacent to the opponent core
    advanceTick(state, BALANCE);
    const def = getChampionById('champion-titan')!;
    expect(state.cores.opponent.health).toBe(BALANCE.core.maxHealth - def.stats.attackDamage);
    expect(titan.champion!.ultimateCharge).toBeCloseTo(
      def.stats.attackDamage * def.ultimateChargePerDamageDealt
    );
  });
});

describe('Speedster — Lane Shift and Overclock', () => {
  it('Lane Shift moves to the same x in the other lane and retargets cleanly', () => {
    const state = championBattle('champion-speedster');
    const speedster = champ(state);
    const lane0Enemy = spawnEnemy(state, 'titan-guard', 0, speedster.x + 2);
    const lane1Enemy = spawnEnemy(state, 'titan-guard', 1, speedster.x + 4);
    lane0Enemy.stunUntilTick = 100000;
    lane1Enemy.stunUntilTick = 100000;

    advanceTick(state, BALANCE); // both sides acquire targets in lane 0
    expect(speedster.targetId).toBe(lane0Enemy.id);
    const xBefore = speedster.x;

    const result = useAbility(state);
    expect(result.ok).toBe(true);
    expect(speedster.lane).toBe(1);
    expect(speedster.x).toBe(xBefore); // same position along the lane axis
    expect(speedster.targetId).toBeNull();
    expect(speedster.champion!.abilityCooldownTicks).toBe(
      getChampionById('champion-speedster')!.ability.cooldownTicks
    );

    advanceTick(state, BALANCE);
    // The champion re-acquired in its new lane; nothing targets across lanes.
    expect(speedster.targetId).toBe(lane1Enemy.id);
    expect(lane0Enemy.targetId).not.toBe(speedster.id);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('Overclock applies the self modifiers for the listed duration', () => {
    const state = championBattle('champion-speedster');
    const speedster = champ(state);
    const def = getChampionById('champion-speedster')!;
    speedster.champion!.ultimateCharge = 100;

    expect(useUltimate(state).ok).toBe(true);
    expect(speedster.champion!.ultimateCharge).toBe(0);
    expect(speedster.modifiers).toEqual([
      {
        sourceId: 'speedster-overclock',
        expiresAtTick: state.tick + def.ultimate.effects.durationTicks!,
        attackIntervalMult: 0.5,
        moveSpeedMult: 1.6,
      },
    ]);
    const stats = effectiveStats(speedster, state.tick);
    expect(stats.attackIntervalTicks).toBe(Math.round(def.stats.attackIntervalTicks * 0.5));
    expect(stats.moveSpeedPerTick).toBeCloseTo(def.stats.moveSpeedPerTick * 1.6);

    // Expires and is pruned by the tick pipeline.
    for (let i = 0; i < def.ultimate.effects.durationTicks! + 5; i++) {
      advanceTick(state, BALANCE);
      expect(checkInvariants(state, BALANCE)).toEqual([]);
    }
    expect(speedster.modifiers).toEqual([]);
  });
});

describe('Shredder — Phase Dash and Final Cut', () => {
  it('Phase Dash teleports to the FURTHEST in-lane enemy in aggro range and hits it', () => {
    const state = championBattle('champion-shredder');
    const shredder = champ(state);
    const def = getChampionById('champion-shredder')!;
    const near = spawnEnemy(state, 'titan-guard', 0, shredder.x + 6);
    const far = spawnEnemy(state, 'neon-boxer', 0, shredder.x + 24); // within aggro 30
    const otherLane = spawnEnemy(state, 'titan-guard', 1, shredder.x + 2);
    const outOfRange = spawnEnemy(state, 'heavy-tank', 0, shredder.x + 39);

    const result = useAbility(state);
    expect(result.ok).toBe(true);
    expect(shredder.x).toBe(far.x); // teleported onto the furthest target
    expect(shredder.targetId).toBe(far.id);
    expect(far.health).toBe(300 - def.ability.effects.damage!);
    expect(near.health).toBe(650);
    expect(otherLane.health).toBe(650);
    expect(outOfRange.health).toBe(1100);
    // Active-ability damage charges the ultimate.
    expect(shredder.champion!.ultimateCharge).toBeCloseTo(
      def.ability.effects.damage! * def.ultimateChargePerDamageDealt
    );
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('Phase Dash with no in-lane enemy in aggro range is rejected', () => {
    const state = championBattle('champion-shredder');
    spawnEnemy(state, 'titan-guard', 1, champ(state).x + 2); // wrong lane
    spawnEnemy(state, 'titan-guard', 0, champ(state).x + 35); // out of aggro
    expect(useAbility(state)).toEqual({ ok: false, reason: 'no valid targets' });
    expect(champ(state).champion!.abilityCooldownTicks).toBe(0);
  });

  it('Final Cut hits the LOWEST-health enemy; above the post-hit threshold it survives', () => {
    const state = championBattle('champion-shredder');
    const shredder = champ(state);
    const higher = spawnEnemy(state, 'titan-guard', 0, shredder.x + 4);
    const lower = spawnEnemy(state, 'titan-guard', 0, shredder.x + 8);
    higher.health = 600;
    // 455 - 250 = 205, above the 30% threshold (195): survives.
    lower.health = 455;
    shredder.champion!.ultimateCharge = 100;

    expect(useUltimate(state).ok).toBe(true);
    expect(lower.alive).toBe(true);
    expect(lower.health).toBe(205);
    expect(higher.health).toBe(600); // untouched
    expect(shredder.champion!.ultimateCharge).toBe(0);
    expect(state.log.some((l) => l.type === 'execute')).toBe(false);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('Final Cut executes a survivor left below the threshold — through shields', () => {
    const state = championBattle('champion-shredder');
    const shredder = champ(state);
    const target = spawnEnemy(state, 'titan-guard', 0, shredder.x + 4);
    // 435 - 250 = 185, below 30% of 650 (195): executed.
    target.health = 435;
    shredder.champion!.ultimateCharge = 100;
    expect(useUltimate(state).ok).toBe(true);
    expect(target.alive).toBe(false);
    expect(target.health).toBe(0);
    expect(state.log.some((l) => l.type === 'execute')).toBe(true);

    // Shields cannot save an execute target: 250 is fully absorbed, but the
    // target was already below threshold, so the execute kills through it.
    const state2 = championBattle('champion-shredder');
    const shielded = spawnEnemy(state2, 'titan-guard', 0, champ(state2).x + 4);
    shielded.health = 100;
    shielded.shield = 1000;
    champ(state2).champion!.ultimateCharge = 100;
    expect(useUltimate(state2).ok).toBe(true);
    expect(shielded.alive).toBe(false);
    expect(shielded.health).toBe(0);
    expect(checkInvariants(state2, BALANCE)).toEqual([]);
  });
});

describe('Hybrid — Stance Shift and Forge Rally', () => {
  it('stances alternate Bulwark → Assault → Bulwark, each replacing the last', () => {
    const state = championBattle('champion-hybrid');
    const hybrid = champ(state);
    const def = getChampionById('champion-hybrid')!;

    // Use 1: Bulwark — damage taken reduced by the content multiplier.
    expect(useAbility(state).ok).toBe(true);
    expect(hybrid.champion!.stanceShifts).toBe(1);
    expect(hybrid.modifiers).toHaveLength(1);
    expect(hybrid.modifiers[0].damageTakenMult).toBe(def.ability.effects.damageTakenMult);
    expect(hybrid.modifiers[0].attackDamageMult).toBeUndefined();
    const before = hybrid.health;
    damageUnit(state, hybrid, 100, 'test');
    expect(before - hybrid.health).toBeCloseTo(100 * def.ability.effects.damageTakenMult!);

    // Use 2: Assault — the Bulwark modifier is replaced, damage buffed.
    hybrid.champion!.abilityCooldownTicks = 0;
    expect(useAbility(state).ok).toBe(true);
    expect(hybrid.champion!.stanceShifts).toBe(2);
    expect(hybrid.modifiers).toHaveLength(1);
    expect(hybrid.modifiers[0].attackDamageMult).toBe(def.ability.effects.attackDamageMult);
    expect(hybrid.modifiers[0].damageTakenMult).toBeUndefined();
    expect(effectiveStats(hybrid, state.tick).attackDamage).toBeCloseTo(
      def.stats.attackDamage * def.ability.effects.attackDamageMult!
    );

    // Use 3: back to Bulwark.
    hybrid.champion!.abilityCooldownTicks = 0;
    expect(useAbility(state).ok).toBe(true);
    expect(hybrid.champion!.stanceShifts).toBe(3);
    expect(hybrid.modifiers).toHaveLength(1);
    expect(hybrid.modifiers[0].damageTakenMult).toBe(def.ability.effects.damageTakenMult);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('Forge Rally buffs and heals ALL living allies in both lanes, not enemies', () => {
    const state = championBattle('champion-hybrid');
    const hybrid = champ(state);
    const def = getChampionById('champion-hybrid')!;
    const woundedAlly = spawnAlly(state, 'titan-guard', 0, 20);
    const fullAlly = spawnAlly(state, 'neon-boxer', 1, 30);
    const enemy = spawnEnemy(state, 'titan-guard', 0, 40);
    woundedAlly.health = 300;
    hybrid.champion!.ultimateCharge = 100;

    expect(useUltimate(state).ok).toBe(true);
    expect(woundedAlly.health).toBe(300 + def.ultimate.effects.heal!);
    expect(fullAlly.health).toBe(300); // heal clamps at max
    for (const ally of [hybrid, woundedAlly, fullAlly]) {
      expect(ally.modifiers.some((m) => m.sourceId === 'hybrid-rally' && m.attackDamageMult === 1.25)).toBe(true);
    }
    expect(enemy.modifiers).toEqual([]);
    expect(enemy.health).toBe(650);
    expect(hybrid.champion!.ultimateCharge).toBe(0);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });
});

describe('champion death and respawn', () => {
  it('death schedules a respawn, keeps the champion untargetable, then revives clean', () => {
    const state = championBattle('champion-titan');
    const titan = champ(state);
    titan.champion!.ultimateCharge = 10;
    titan.champion!.abilityCooldownTicks = 33;
    titan.shield = 50;
    titan.modifiers.push({ sourceId: 'x', expiresAtTick: 100000, attackDamageMult: 1.5 });

    // The killing blow still charges from damage taken: 1450 (health+shield).
    const chargeAtDeath = 10 + 1450 * titan.champion!.chargePerDamageTaken;
    damageUnit(state, titan, 999999, 'test');
    expect(titan.champion!.ultimateCharge).toBeCloseTo(chargeAtDeath);
    expect(titan.alive).toBe(false);
    expect(titan.health).toBe(0);
    const deathTick = state.tick;
    expect(titan.champion!.respawnAtTick).toBe(deathTick + BALANCE.champion.respawnTicks);
    expect(checkInvariants(state, BALANCE)).toEqual([]);

    // Down champions can use nothing.
    expect(useAbility(state)).toEqual({ ok: false, reason: 'champion is down' });
    expect(useUltimate(state)).toEqual({ ok: false, reason: 'champion is down' });

    // Cards cannot target a downed champion.
    const secondWind = applyCommand(state, BALANCE, {
      type: 'play-card',
      team: 'player',
      cardId: 'second-wind',
      target: { kind: 'unit', unitId: titan.id },
    });
    expect(secondWind).toEqual({ ok: false, reason: 'target is gone' });

    // A nearby enemy never targets the corpse.
    const enemy = spawnEnemy(state, 'titan-guard', 0, titan.x + 1);
    advanceTick(state, BALANCE);
    expect(enemy.targetId).not.toBe(titan.id);
    // Clear the field so the revival tick below is fully deterministic.
    damageUnit(state, enemy, 999999, 'test');

    // Dead until exactly the respawn tick, invariants clean throughout.
    while (state.tick < deathTick + BALANCE.champion.respawnTicks - 1) {
      advanceTick(state, BALANCE);
      expect(checkInvariants(state, BALANCE)).toEqual([]);
      expect(titan.alive).toBe(false);
      expect(titan.health).toBe(0);
    }

    advanceTick(state, BALANCE); // the respawn tick
    expect(state.tick).toBe(deathTick + BALANCE.champion.respawnTicks);
    expect(titan.alive).toBe(true);
    expect(titan.health).toBe(BALANCE.champion.respawnHealthFraction * titan.baseMaxHealth);
    // Revived beside its own core, then it already acted this tick: with no
    // enemies left it marched one step from the spawn offset.
    expect(titan.x).toBeCloseTo(OFFSET + titan.base.moveSpeedPerTick, 8);
    expect(titan.shield).toBe(0);
    expect(titan.modifiers).toEqual([]);
    expect(titan.stunUntilTick).toBe(0);
    expect(titan.targetId).toBeNull();
    expect(titan.champion!.respawnAtTick).toBeNull();
    // Charge persists through death; the frozen ability cooldown resumes
    // ticking (one tick has already elapsed on the revival tick itself).
    expect(titan.champion!.ultimateCharge).toBeCloseTo(chargeAtDeath);
    expect(titan.champion!.abilityCooldownTicks).toBe(32);
    expect(state.log.some((l) => l.type === 'champion-respawn')).toBe(true);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('killing blows on a champion clear other units targeting it', () => {
    const state = championBattle('champion-titan');
    const titan = champ(state);
    const enemy = spawnEnemy(state, 'titan-guard', 0, titan.x + 1);
    advanceTick(state, BALANCE);
    expect(enemy.targetId).toBe(titan.id);
    damageUnit(state, titan, 999999, 'test');
    expect(enemy.targetId).toBeNull();
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });
});

describe('second-wind targets a live champion (M4 gap closed)', () => {
  it('heals the champion and refunds energy', () => {
    const state = championBattle('champion-hybrid');
    const hybrid = champ(state);
    hybrid.health -= 300;
    const before = hybrid.health;
    const result = applyCommand(state, BALANCE, {
      type: 'play-card',
      team: 'player',
      cardId: 'second-wind',
      target: { kind: 'unit', unitId: hybrid.id },
    });
    expect(result.ok).toBe(true);
    expect(hybrid.health).toBe(before + 220);
    expect(state.teams.player.energy).toBeCloseTo(10 - 2 + 1);
  });
});

describe('4x4 champion matchup matrix', () => {
  it('all 16 matchups run headless to completion with zero invariant violations', () => {
    let seed = 7000;
    for (const a of CHAMPIONS) {
      for (const b of CHAMPIONS) {
        const result = runBattle(
          {
            seed: seed++,
            player: { playerId: 'p1', championId: a.id },
            opponent: { playerId: 'p2', championId: b.id },
          },
          [],
          BALANCE
        );
        const label = `${a.id} vs ${b.id}`;
        expect(result.invariantViolations, label).toEqual([]);
        expect(result.stalled, label).toBe(false);
        expect(result.outcome, label).not.toBeNull();
        expect(['player', 'opponent', 'draw'], label).toContain(result.outcome.winner);
      }
    }
  });
});

describe('champion battle determinism and replay fidelity', () => {
  it('scheduled ability + ultimate commands replay to identical digests', () => {
    const config: BattleConfig = {
      seed: 555,
      player: { playerId: 'p1', championId: 'champion-titan' },
      opponent: { playerId: 'p2', championId: 'champion-titan' },
    };
    const commands: ScheduledCommand[] = [
      { tick: 300, command: { type: 'champion-ability', team: 'player' } },
      { tick: 700, command: { type: 'champion-ultimate', team: 'player' } },
    ];
    const a = runBattle(config, commands, BALANCE);
    const b = runBattle(config, commands, BALANCE);
    expect(a.digest).toBe(b.digest);
    expect(a.outcome).toEqual(b.outcome);
    expect(a.invariantViolations).toEqual([]);
    // Both champion commands actually landed (the fixture stays honest).
    expect(a.rejected).toEqual([]);
    expect(a.state.log.some((l) => l.type === 'ability')).toBe(true);
    expect(a.state.log.some((l) => l.type === 'ultimate')).toBe(true);
    // And they mattered: dropping them changes the battle.
    const without = runBattle(config, [], BALANCE);
    expect(without.digest).not.toBe(a.digest);
  });

  it('a live champion battle with ability/ultimate use replays digest-identically', () => {
    const live = createLiveBattle(20260722, 'p1', {
      playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
      opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
      playerChampionId: 'champion-titan',
    });
    // The opponent champion is picked deterministically from the roster.
    const opponentChampion = findTeamChampion(live.state, 'opponent');
    expect(opponentChampion).not.toBeNull();
    expect(live.config.opponent.championId).toBe(opponentChampion!.contentId);

    let abilityUses = 0;
    let ultimateUses = 0;
    while (live.state.phase !== 'finished') {
      stepLiveBattle(live, 25);
      // On a finished battle these reject ('battle is over') without queueing.
      if (queueChampionAbility(live).ok) abilityUses++;
      if (queueChampionUltimate(live).ok) ultimateUses++;
    }
    expect(abilityUses).toBeGreaterThan(0);
    expect(ultimateUses).toBeGreaterThan(0);

    const rerun = runBattle(live.config, live.commandLog, BALANCE);
    expect(rerun.digest).toBe(liveDigest(live));
    expect(rerun.outcome).toEqual(live.state.outcome);
    expect(rerun.invariantViolations).toEqual([]);
  });

  it('the same live seed twice produces identical digests (incl. opponent champion pick)', () => {
    function playThrough(): number {
      const live = createLiveBattle(777, 'p1', { playerChampionId: 'champion-speedster' });
      while (live.state.phase !== 'finished') {
        stepLiveBattle(live, 40);
        queueChampionAbility(live);
        queueChampionUltimate(live);
      }
      return liveDigest(live);
    }
    expect(playThrough()).toBe(playThrough());
  });
});

describe('live controller champion command pre-validation', () => {
  it('rejects with clear reasons: no champion, on cooldown, not charged', () => {
    const noChampion = createLiveBattle(1, 'p1');
    expect(queueChampionAbility(noChampion)).toEqual({
      ok: false,
      reason: 'no champion in this battle',
    });

    const live = createLiveBattle(2, 'p1', { playerChampionId: 'champion-titan' });
    // No enemies anywhere near at tick 0 → the stomp has no valid targets.
    expect(queueChampionAbility(live)).toEqual({ ok: false, reason: 'no valid targets' });
    expect(queueChampionUltimate(live)).toEqual({ ok: false, reason: 'Ultimate not charged' });
  });
});

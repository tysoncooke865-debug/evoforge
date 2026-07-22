/**
 * Milestone 9 tests — Gym Champions: multi-champion squads (captain +
 * borrowed), captain-only command routing, borrowed auto-cast, borrowed
 * respawn, squad determinism + digest-identical replays, a full gym-war
 * headless run, borrowing purity, squad builder correctness, contribution
 * stats and backward compatibility of pre-M9 config shapes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BALANCE, getChampionById, getChampionByPath } from '../content';
import {
  autoCastBorrowedAbility,
  findTeamCaptain,
  findTeamChampion,
} from '../game-engine/abilities/champion-abilities';
import { computeFitnessScaling } from '../game-engine/balance/fitness-scaling';
import { damageUnit } from '../game-engine/combat/combat';
import { spawnChampion, spawnUnitsForCard } from '../game-engine/entities/spawn';
import { applyCommand } from '../game-engine/simulation/events';
import { checkInvariants } from '../game-engine/simulation/invariants';
import { computeDigest, runBattle } from '../game-engine/simulation/run';
import {
  BattleConfig,
  BattleState,
  createBattle,
  normalizeTeamSquad,
  TeamSquadConfig,
  UnitState,
} from '../game-engine/simulation/state';
import { advanceTick } from '../game-engine/simulation/tick';
import { getCardById } from '../content';
import {
  createLiveBattle,
  liveDigest,
  stepLiveBattle,
} from '../features/arena/battle-controller';
import { createBattleStore } from '../features/arena/battle-store';
import { verifyBattleRecord } from '../game-engine/simulation/replay';
import { loadBattleRecords } from '../services/persistence/battle-records';
import { buildEnemyGymSquad } from '../features/gyms/gym-war';
import {
  borrowedLane,
  buildPlayerSquad,
  computeMemberRoles,
  memberChampionId,
} from '../features/gyms/squad';
import { LocalMockPlayerProvider } from '../integration/evoforge/local-mock-provider';
import type { BattleResult, GymMemberInfo } from '../integration/evoforge/types';
import { applyGymWarResult, gymMostUsedMemberId, gymMvpMemberId } from '../services/gyms/contribution';
import { DEFAULT_DECK_CARD_IDS } from '../services/persistence/save';
import { MemoryStorage } from '../services/persistence/storage';
import { createPlayerStore } from '../services/player-data/player-store';

const OFFSET = BALANCE.champion.spawnOffsetFromCore;
const SPACING = BALANCE.arena.unitSpacing;
const L = BALANCE.arena.laneLength;

function squadOf(captainId: string, borrowedIds: string[]): TeamSquadConfig {
  return {
    captain: { championId: captainId },
    borrowed: borrowedIds.map((championId, i) => ({
      championId,
      lane: (i % 2) as 0 | 1,
      displayName: `Borrowed ${i}`,
      sourcePlayerId: `member-${i}`,
    })),
  };
}

function squadConfig(playerSquad: TeamSquadConfig, opponentSquad?: TeamSquadConfig): BattleConfig {
  return {
    seed: 991,
    player: { playerId: 'p1', squad: playerSquad },
    opponent: opponentSquad
      ? { playerId: 'p2', squad: opponentSquad }
      : { playerId: 'p2' },
  };
}

function spawnEnemy(state: BattleState, cardId: string, lane: 0 | 1, x: number): UnitState {
  return spawnUnitsForCard(state, BALANCE, getCardById(cardId)!, 'opponent', lane, x)[0];
}

async function makeProvider() {
  const ref = { current: null as never };
  const store = createPlayerStore(ref);
  await store.getState().initialize(new MemoryStorage());
  return { store, provider: new LocalMockPlayerProvider(store) };
}

describe('multi-champion squads — spawning and invariants', () => {
  it('spawns the captain commandable and borrowed champions staggered behind it', () => {
    const state = createBattle(
      squadConfig(squadOf('champion-titan', ['champion-cardio', 'champion-shredder', 'champion-aesthetic'])),
      BALANCE
    );
    const champions = state.units.filter((u) => u.kind === 'champion' && u.team === 'player');
    expect(champions).toHaveLength(4);
    const [captain, b0, b1, b2] = champions;
    expect(captain.champion!.commandable).toBe(true);
    expect(captain.x).toBe(OFFSET);
    // Borrowed: staggered one unitSpacing per slot BEHIND the captain.
    expect(b0.champion!.commandable).toBe(false);
    expect(b0.x).toBe(OFFSET - SPACING);
    expect(b1.x).toBe(OFFSET - 2 * SPACING);
    expect(b2.x).toBe(OFFSET - 3 * SPACING);
    // Configured lanes honoured.
    expect(b0.lane).toBe(0);
    expect(b1.lane).toBe(1);
    expect(b2.lane).toBe(0);
    // No two champions share a spawn point.
    const positions = new Set(champions.map((u) => `${u.lane}:${u.x}`));
    expect(positions.size).toBe(4);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('opponent borrowed champions mirror the stagger toward their own core', () => {
    const state = createBattle(
      squadConfig(squadOf('champion-titan', []), squadOf('champion-titan', ['champion-aesthetic'])),
      BALANCE
    );
    const borrowed = state.units.find(
      (u) => u.team === 'opponent' && u.champion && !u.champion.commandable
    )!;
    expect(borrowed.x).toBe(L - OFFSET + SPACING);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('rejects more than maxBorrowed borrowed champions at creation', () => {
    expect(() =>
      createBattle(
        squadConfig(
          squadOf('champion-titan', [
            'champion-titan',
            'champion-titan',
            'champion-titan',
            'champion-titan',
          ])
        ),
        BALANCE
      )
    ).toThrow(/too many borrowed/);
  });

  it('rejects unknown borrowed champion ids and invalid lanes', () => {
    expect(() =>
      createBattle(squadConfig(squadOf('champion-titan', ['nope'])), BALANCE)
    ).toThrow(/unknown champion/);
    const bad = squadOf('champion-titan', ['champion-aesthetic']);
    bad.borrowed[0].lane = 7 as unknown as 0;
    expect(() => createBattle(squadConfig(bad), BALANCE)).toThrow(/invalid borrowed champion lane/);
  });

  it('invariants flag a second commandable champion and over-limit borrowed', () => {
    const state = createBattle(
      squadConfig(squadOf('champion-titan', ['champion-cardio'])),
      BALANCE
    );
    expect(checkInvariants(state, BALANCE)).toEqual([]);

    // State surgery: promote the borrowed champion → 2 commandable.
    const borrowed = state.units.find((u) => u.champion && !u.champion.commandable)!;
    borrowed.champion!.commandable = true;
    expect(checkInvariants(state, BALANCE).join()).toContain('2 commandable champions');
    borrowed.champion!.commandable = false;

    // State surgery: spawn 3 extra borrowed → 4 borrowed on one team.
    for (let i = 0; i < 3; i++) {
      spawnChampion(state, BALANCE, getChampionById('champion-aesthetic')!, 'player', 0, undefined, {
        commandable: false,
      });
    }
    expect(checkInvariants(state, BALANCE).join()).toContain('4 borrowed champions');
  });

  it('digest covers the commandable flag', () => {
    const a = createBattle(squadConfig(squadOf('champion-titan', ['champion-aesthetic'])), BALANCE);
    const b = createBattle(squadConfig(squadOf('champion-titan', ['champion-aesthetic'])), BALANCE);
    expect(computeDigest(a)).toBe(computeDigest(b));
    b.units.find((u) => u.champion && !u.champion.commandable)!.champion!.commandable = true;
    expect(computeDigest(b)).not.toBe(computeDigest(a));
  });

  it('pre-M9 configs normalize to a captain-only squad and behave identically', () => {
    const legacy: BattleConfig = {
      seed: 777,
      player: { playerId: 'p1', championId: 'champion-titan', championLane: 1 },
      opponent: { playerId: 'p2', championId: 'champion-shredder' },
    };
    const squad: BattleConfig = {
      seed: 777,
      player: {
        playerId: 'p1',
        championLane: 1,
        squad: { captain: { championId: 'champion-titan' }, borrowed: [] },
      },
      opponent: {
        playerId: 'p2',
        squad: { captain: { championId: 'champion-shredder' }, borrowed: [] },
      },
    };
    const normalized = normalizeTeamSquad(legacy.player);
    expect(normalized).toEqual({
      captain: { championId: 'champion-titan', scaling: undefined },
      captainLane: 1,
      borrowed: [],
    });
    const a = runBattle(legacy, [], BALANCE);
    const b = runBattle(squad, [], BALANCE);
    expect(a.digest).toBe(b.digest);
    expect(a.invariantViolations).toEqual([]);
    expect(b.invariantViolations).toEqual([]);
  });
});

describe('captain-only command routing', () => {
  function routedBattle(): BattleState {
    const state = createBattle(
      squadConfig(squadOf('champion-titan', ['champion-titan'])),
      BALANCE
    );
    state.tick = 1;
    state.teams.player.energy = 10;
    state.teams.opponent.energy = 10;
    return state;
  }

  it('champion-ability pays the CAPTAIN cooldown, never a borrowed one', () => {
    const state = routedBattle();
    const captain = findTeamCaptain(state, 'player')!;
    const borrowed = state.units.find((u) => u.champion && !u.champion.commandable)!;
    // Enemy within stomp radius of the captain only.
    const enemy = spawnEnemy(state, 'titan-guard', 0, captain.x + 5);
    enemy.stunUntilTick = 100000;

    const result = applyCommand(state, BALANCE, { type: 'champion-ability', team: 'player' });
    expect(result.ok).toBe(true);
    expect(captain.champion!.abilityCooldownTicks).toBe(
      captain.champion!.abilityCooldownTotalTicks
    );
    expect(borrowed.champion!.abilityCooldownTicks).toBe(0);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('a downed captain rejects commands even while borrowed champions live', () => {
    const state = routedBattle();
    const captain = findTeamCaptain(state, 'player')!;
    damageUnit(state, captain, 999999, 'test');
    expect(captain.alive).toBe(false);
    const result = applyCommand(state, BALANCE, { type: 'champion-ability', team: 'player' });
    expect(result).toEqual({ ok: false, reason: 'champion is down' });
    // findTeamCaptain still resolves the (dead) captain, never a borrowed one.
    expect(findTeamCaptain(state, 'player')).toBe(captain);
    expect(findTeamChampion(state, 'player')).toBe(captain);
  });
});

describe('borrowed auto-cast', () => {
  function autoCastBattle(): {
    state: BattleState;
    captain: UnitState;
    borrowed: UnitState;
  } {
    const state = createBattle(
      squadConfig(squadOf('champion-titan', ['champion-titan'])),
      BALANCE
    );
    const captain = findTeamCaptain(state, 'player')!;
    const borrowed = state.units.find((u) => u.champion && !u.champion.commandable)!;
    return { state, captain, borrowed };
  }

  it('casts the signature ability when valid, paying the full cooldown', () => {
    const { state, borrowed } = autoCastBattle();
    const def = getChampionById('champion-titan')!;
    // The enemy acts AFTER the borrowed champion (higher entity id), so the
    // auto-cast stomp stuns it before it can move this tick.
    const enemy = spawnEnemy(state, 'titan-guard', 0, borrowed.x + 5);

    advanceTick(state, BALANCE);
    expect(borrowed.champion!.abilityCooldownTicks).toBe(
      borrowed.champion!.abilityCooldownTotalTicks
    );
    expect(enemy.stunUntilTick).toBe(state.tick + def.ability.effects.stunTicks!);
    expect(state.log.some((l) => l.type === 'auto-ability')).toBe(true);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('respects the cooldown — no re-cast until it reaches zero again', () => {
    const { state, borrowed } = autoCastBattle();
    const enemy = spawnEnemy(state, 'titan-guard', 0, borrowed.x + 5);
    enemy.stunUntilTick = 100000;
    enemy.health = 100000; // survives long enough (bounded by baseMaxHealth check? no: state surgery)
    enemy.baseMaxHealth = 100000;

    advanceTick(state, BALANCE);
    const total = borrowed.champion!.abilityCooldownTotalTicks;
    expect(borrowed.champion!.abilityCooldownTicks).toBe(total);
    const casts = () => state.log.filter((l) => l.type === 'auto-ability').length;
    expect(casts()).toBe(1);

    // While the cooldown recovers, no further auto-cast happens.
    for (let i = 0; i < total - 1; i++) advanceTick(state, BALANCE);
    expect(borrowed.champion!.abilityCooldownTicks).toBe(1);
    expect(casts()).toBe(1);
    // The tick the cooldown hits zero, it casts again (target still valid).
    advanceTick(state, BALANCE);
    expect(casts()).toBe(2);
    expect(borrowed.champion!.abilityCooldownTicks).toBe(total);
  });

  it('never wastes the cooldown without valid targets', () => {
    const { state, borrowed } = autoCastBattle(); // no enemies at all
    for (let i = 0; i < 10; i++) advanceTick(state, BALANCE);
    expect(borrowed.champion!.abilityCooldownTicks).toBe(0);
    expect(state.log.some((l) => l.type === 'auto-ability')).toBe(false);
  });

  it('never uses the ultimate — charge accrues but is never spent', () => {
    const { state, borrowed } = autoCastBattle();
    borrowed.champion!.ultimateCharge = borrowed.champion!.chargeRequired;
    const enemy = spawnEnemy(state, 'titan-guard', 0, borrowed.x + 2); // melee contact
    enemy.stunUntilTick = 100000;
    enemy.health = 100000;
    enemy.baseMaxHealth = 100000;
    for (let i = 0; i < 50; i++) advanceTick(state, BALANCE);
    // Full charge the whole time (capped), yet no ultimate was ever fired.
    expect(borrowed.champion!.ultimateCharge).toBe(borrowed.champion!.chargeRequired);
    expect(state.log.some((l) => l.type === 'ultimate')).toBe(false);
    expect(state.log.some((l) => l.type === 'auto-ability')).toBe(true);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('the commandable captain never auto-casts', () => {
    const { state, captain } = autoCastBattle();
    const enemy = spawnEnemy(state, 'titan-guard', 0, captain.x + 3);
    enemy.stunUntilTick = 100000;
    enemy.health = 100000;
    enemy.baseMaxHealth = 100000;
    // Direct call is a no-op on commandable champions…
    autoCastBorrowedAbility(state, BALANCE, captain);
    expect(captain.champion!.abilityCooldownTicks).toBe(0);
    // …and the pipeline never casts for it (only the borrowed champion casts).
    advanceTick(state, BALANCE);
    expect(captain.champion!.abilityCooldownTicks).toBe(0);
  });

  it('a stunned borrowed champion does not auto-cast', () => {
    const { state, borrowed } = autoCastBattle();
    const enemy = spawnEnemy(state, 'titan-guard', 0, borrowed.x + 5);
    enemy.stunUntilTick = 100000;
    borrowed.stunUntilTick = 100000;
    advanceTick(state, BALANCE);
    expect(borrowed.champion!.abilityCooldownTicks).toBe(0);
    expect(state.log.some((l) => l.type === 'auto-ability')).toBe(false);
  });
});

describe('borrowed respawn', () => {
  it('a borrowed champion respawns at its staggered spawn slot, state clean', () => {
    const state = createBattle(
      squadConfig(squadOf('champion-titan', ['champion-cardio'])),
      BALANCE
    );
    state.tick = 1;
    const borrowed = state.units.find((u) => u.champion && !u.champion.commandable)!;
    const spawnX = borrowed.champion!.spawnX;
    expect(spawnX).toBe(OFFSET - SPACING);

    damageUnit(state, borrowed, 999999, 'test');
    expect(borrowed.alive).toBe(false);
    const deathTick = state.tick;
    expect(borrowed.champion!.respawnAtTick).toBe(deathTick + BALANCE.champion.respawnTicks);

    while (state.tick < deathTick + BALANCE.champion.respawnTicks - 1) {
      advanceTick(state, BALANCE);
      expect(checkInvariants(state, BALANCE)).toEqual([]);
      expect(borrowed.alive).toBe(false);
    }
    advanceTick(state, BALANCE);
    expect(borrowed.alive).toBe(true);
    expect(borrowed.health).toBe(
      BALANCE.champion.respawnHealthFraction * borrowed.baseMaxHealth
    );
    // Revived at ITS spawn slot (then it already marched once this tick).
    expect(borrowed.x).toBeCloseTo(spawnX + borrowed.base.moveSpeedPerTick, 8);
    expect(borrowed.champion!.respawnAtTick).toBeNull();
    expect(borrowed.champion!.commandable).toBe(false); // survives death
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });
});

describe('squad battles — determinism and replay', () => {
  it('full-squad battles run headless deterministically with clean invariants', () => {
    const config = squadConfig(
      squadOf('champion-titan', ['champion-cardio', 'champion-shredder', 'champion-aesthetic']),
      squadOf('champion-aesthetic', ['champion-titan', 'champion-cardio'])
    );
    const a = runBattle(config, [], BALANCE);
    const b = runBattle(config, [], BALANCE);
    expect(a.digest).toBe(b.digest);
    expect(a.outcome).toEqual(b.outcome);
    expect(a.stalled).toBe(false);
    expect(a.invariantViolations).toEqual([]);
    // Auto-casts actually happened engine-side (borrowed champions fight).
    expect(a.state.log.some((l) => l.type === 'auto-ability')).toBe(true);
    // JSON round-trip (as a battle record would store the config) replays too.
    const c = runBattle(JSON.parse(JSON.stringify(config)), [], BALANCE);
    expect(c.digest).toBe(a.digest);
  });
});

describe('squad builder (features/gyms/squad)', () => {
  it('builds borrowed configs from member fitness: path champion + capped scaling', async () => {
    const { provider } = await makeProvider();
    const members = (await provider.getGymMembers('forge-district')).filter(
      (m) => m.playerId !== 'local-player'
    );
    const picked = members.slice(0, 3);
    const squad = buildPlayerSquad('champion-titan', computeFitnessScaling(
      { strength: 50, cardio: 50, muscularity: 50, leanness: 50, aesthetics: 50 },
      BALANCE
    ), picked, BALANCE);

    expect(squad.captain.championId).toBe('champion-titan');
    expect(squad.borrowed).toHaveLength(3);
    squad.borrowed.forEach((borrowed, i) => {
      const member = picked[i];
      expect(borrowed.championId).toBe(getChampionByPath(member.fitness.avatarPath)!.id);
      expect(borrowed.scaling).toEqual(
        computeFitnessScaling(
          {
            strength: member.fitness.strengthRating,
            cardio: member.fitness.cardioRating,
            muscularity: member.fitness.muscularityRating,
            leanness: member.fitness.leannessRating,
            aesthetics: member.fitness.aestheticsRating,
          },
          BALANCE
        )
      );
      expect(borrowed.displayName).toBe(member.displayName);
      expect(borrowed.sourcePlayerId).toBe(member.playerId);
      expect(borrowed.lane).toBe(borrowedLane(i, 0));
    });
    // Lanes spread across both lanes deterministically.
    expect(squad.borrowed.map((b) => b.lane)).toEqual([1, 0, 1]);
    // The squad constructs a valid battle.
    const state = createBattle(
      { seed: 5, player: { playerId: 'p1', squad }, opponent: { playerId: 'p2' } },
      BALANCE
    );
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('rejects over-limit selections', async () => {
    const { provider } = await makeProvider();
    const members = await provider.getGymMembers('neon-iron-club');
    expect(() =>
      buildPlayerSquad('champion-titan', computeFitnessScaling(
        { strength: 50, cardio: 50, muscularity: 50, leanness: 50, aesthetics: 50 },
        BALANCE
      ), members.slice(0, 4), BALANCE)
    ).toThrow(/too many borrowed members/);
  });

  it('borrowing NEVER mutates the owner (pure reads)', async () => {
    const { provider } = await makeProvider();
    const members = await provider.getGymMembers('apex-performance');
    const snapshot = JSON.parse(JSON.stringify(members));
    buildPlayerSquad('champion-titan', computeFitnessScaling(
      { strength: 99, cardio: 1, muscularity: 50, leanness: 50, aesthetics: 50 },
      BALANCE
    ), members.slice(0, 3), BALANCE);
    buildEnemyGymSquad(members, BALANCE);
    computeMemberRoles(members);
    expect(members).toEqual(snapshot);
  });

  it('enemy gym squads field the Overall/Strength/Cardio champions, deduped', async () => {
    const { provider } = await makeProvider();
    for (const gymId of ['neon-iron-club', 'apex-performance']) {
      const members = await provider.getGymMembers(gymId);
      const roles = computeMemberRoles(members);
      const holderOf = (role: string) =>
        members.find((m) => (roles[m.playerId] ?? []).includes(role as never))!;
      const squad = buildEnemyGymSquad(members, BALANCE);
      const overall = holderOf('overall');
      expect(squad.captain.championId).toBe(memberChampionId(overall));
      const expectedBorrowed = ['strength', 'cardio']
        .map((r) => holderOf(r))
        .filter((m, i, arr) => m.playerId !== overall.playerId && arr.findIndex((x) => x.playerId === m.playerId) === i);
      expect(squad.borrowed.map((b) => b.sourcePlayerId)).toEqual(
        expectedBorrowed.map((m) => m.playerId)
      );
      expect(squad.borrowed.length).toBeLessThanOrEqual(BALANCE.gym.maxBorrowed);
    }
  });

  it('dedupes a member holding several fielded titles (synthetic roster)', () => {
    const ace: GymMemberInfo = {
      playerId: 'ace',
      displayName: 'Ace',
      fitness: {
        playerId: 'ace',
        evoRating: 99,
        strengthRating: 99,
        cardioRating: 99,
        muscularityRating: 99,
        leannessRating: 99,
        aestheticsRating: 99,
        forgeLevel: 10,
        avatarPath: 'titan',
        avatarStage: 3,
      },
    };
    const rest: GymMemberInfo = {
      playerId: 'rest',
      displayName: 'Rest',
      fitness: { ...ace.fitness, playerId: 'rest', evoRating: 10, strengthRating: 10, cardioRating: 10 },
    };
    const squad = buildEnemyGymSquad([ace, rest], BALANCE);
    expect(squad.captain.championId).toBe('champion-titan');
    expect(squad.borrowed).toEqual([]); // ace holds all three titles — fields once
  });
});

describe('full gym-war run (live AI battle + digest-identical replay)', () => {
  it('plays to completion with clean invariants and replays identically', async () => {
    const { provider } = await makeProvider();
    const own = (await provider.getGymMembers('forge-district')).filter(
      (m) => m.playerId !== 'local-player'
    );
    const enemy = await provider.getGymMembers('neon-iron-club');
    const playerSquad = buildPlayerSquad(
      'champion-titan',
      computeFitnessScaling(
        { strength: 60, cardio: 55, muscularity: 50, leanness: 45, aesthetics: 50 },
        BALANCE
      ),
      own.slice(0, 3),
      BALANCE
    );
    const opponentSquad = buildEnemyGymSquad(enemy, BALANCE);

    const live = createLiveBattle(20260722, 'local-player', {
      playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
      opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
      playerSquad,
      opponentSquad,
      opponentPlayerId: 'gym-neon-iron-club',
      opponentDisplayName: 'Neon Iron Club',
      aiDifficulty: 'standard',
    });
    expect(live.config.player.squad).toBe(playerSquad);
    expect(live.config.opponent.playerId).toBe('gym-neon-iron-club');

    let guard = 0;
    while (live.state.phase !== 'finished' && guard < 6000) {
      stepLiveBattle(live, 1);
      guard++;
      const violations = checkInvariants(live.state, BALANCE);
      expect(violations, `tick ${live.state.tick}`).toEqual([]);
    }
    expect(live.state.phase).toBe('finished');
    expect(live.state.outcome).not.toBeNull();

    // The recorded command log replays digest-identically WITHOUT the AI.
    const rerun = runBattle(live.config, live.commandLog, BALANCE);
    expect(rerun.digest).toBe(liveDigest(live));
    expect(rerun.outcome).toEqual(live.state.outcome);
    expect(rerun.invariantViolations).toEqual([]);
  });
});

describe('gym-war contribution stats', () => {
  const resultBase: Omit<BattleResult, 'outcome' | 'mode'> = {
    battleId: 'war-1',
    balanceVersion: BALANCE.balanceVersion,
    seed: 1,
    playerId: 'local-player',
    opponentId: 'gym-neon-iron-club',
    playerCoreHealth: 100,
    opponentCoreHealth: 0,
    durationTicks: 1000,
    rankPointsDelta: 30,
    completedAt: new Date().toISOString(),
  };

  it('pure helper: appearances/wins/contribution/wars update per the documented rule', () => {
    const start = { selectedSquad: [], championStats: {}, warsPlayed: 0, warsWon: 0 };
    const afterWin = applyGymWarResult(start, ['m1', 'm2'], true, BALANCE);
    // +1 per war participated, +2 extra on a win.
    expect(afterWin.championStats.m1).toEqual({ appearances: 1, wins: 1, warContribution: 3 });
    expect(afterWin.championStats.m2).toEqual({ appearances: 1, wins: 1, warContribution: 3 });
    expect(afterWin.warsPlayed).toBe(1);
    expect(afterWin.warsWon).toBe(1);
    const afterLoss = applyGymWarResult(afterWin, ['m1'], false, BALANCE);
    expect(afterLoss.championStats.m1).toEqual({ appearances: 2, wins: 1, warContribution: 4 });
    expect(afterLoss.championStats.m2).toEqual({ appearances: 1, wins: 1, warContribution: 3 });
    expect(afterLoss.warsPlayed).toBe(2);
    expect(afterLoss.warsWon).toBe(1);
    // Never mutates the input.
    expect(start.championStats).toEqual({});
    expect(afterWin.championStats.m1.appearances).toBe(1);
    // MVP = highest contribution; most-used = highest appearances.
    expect(gymMvpMemberId(afterLoss)).toBe('m1');
    expect(gymMostUsedMemberId(afterLoss)).toBe('m1');
  });

  it('the provider credits gym-war results into the save; other modes leave gym untouched', async () => {
    const { store, provider } = await makeProvider();
    await provider.recordBattleResult({
      ...resultBase,
      outcome: 'win',
      mode: 'gym-war',
      gymWar: { enemyGymId: 'neon-iron-club', fieldedMemberIds: ['a', 'b', 'c'] },
    });
    let gym = store.getState().save.gym;
    expect(gym.warsPlayed).toBe(1);
    expect(gym.warsWon).toBe(1);
    expect(gym.championStats.a).toEqual({ appearances: 1, wins: 1, warContribution: 3 });

    await provider.recordBattleResult({
      ...resultBase,
      outcome: 'loss',
      mode: 'gym-war',
      gymWar: { enemyGymId: 'neon-iron-club', fieldedMemberIds: ['a'] },
    });
    gym = store.getState().save.gym;
    expect(gym.warsPlayed).toBe(2);
    expect(gym.warsWon).toBe(1);
    expect(gym.championStats.a).toEqual({ appearances: 2, wins: 1, warContribution: 4 });
    expect(gym.championStats.b).toEqual({ appearances: 1, wins: 1, warContribution: 3 });

    // A standard battle never touches gym stats (but still counts globally).
    await provider.recordBattleResult({ ...resultBase, outcome: 'win', mode: 'standard' });
    const after = store.getState().save;
    expect(after.gym).toEqual(gym);
    expect(after.stats.battlesPlayed).toBe(3);
  });
});

describe('gym-war through the battle store (mode + recording)', () => {
  const WORST_CASE_TICKS = BALANCE.battle.durationTicks + BALANCE.battle.suddenDeathTicks + 20;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports mode gym-war with fielded-member attribution and persists a verifiable record', async () => {
    const results: BattleResult[] = [];
    const fakeProvider = {
      async getCurrentPlayer() {
        return {
          playerId: 'local-player',
          displayName: 'Warrior',
          championId: 'champion-titan',
          rankPoints: 10,
        };
      },
      async getFitnessProfile(): Promise<never> {
        throw new Error('not used');
      },
      async getGymProfile() {
        return null;
      },
      async getGymMembers() {
        return [];
      },
      async listRivalGyms() {
        return [];
      },
      async recordBattleResult(result: BattleResult) {
        results.push(result);
      },
    };
    const storage = new MemoryStorage();
    const store = createBattleStore({ current: fakeProvider }, { current: storage });

    const playerSquad: TeamSquadConfig = {
      captain: { championId: 'champion-titan' },
      borrowed: [
        { championId: 'champion-cardio', lane: 1, displayName: 'Kai', sourcePlayerId: 'm-1' },
        { championId: 'champion-aesthetic', lane: 0, displayName: 'Lena', sourcePlayerId: 'm-2' },
      ],
    };
    const opponentSquad: TeamSquadConfig = {
      captain: { championId: 'champion-shredder' },
      borrowed: [{ championId: 'champion-titan', lane: 1 }],
    };

    store.getState().start(
      424242,
      'local-player',
      {
        playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
        opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
        playerSquad,
        opponentSquad,
        opponentPlayerId: 'gym-neon-iron-club',
        opponentDisplayName: 'Neon Iron Club',
        aiDifficulty: 'standard',
      },
      'gym-war'
    );
    await vi.advanceTimersByTimeAsync((WORST_CASE_TICKS + 100) * 50);
    expect(store.getState().status).toBe('finished');
    await vi.advanceTimersByTimeAsync(10); // flush the async persist chain

    // Provider result: mode gym-war + attribution of the fielded members.
    expect(results).toHaveLength(1);
    expect(results[0].mode).toBe('gym-war');
    expect(results[0].opponentId).toBe('gym-neon-iron-club');
    expect(results[0].gymWar).toEqual({
      enemyGymId: 'neon-iron-club',
      fieldedMemberIds: ['m-1', 'm-2'],
    });

    // Battle record: debug mode gym-war, gym display name, verifies.
    const records = await loadBattleRecords(storage);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.debug?.mode).toBe('gym-war');
    expect(record.opponentSnapshot.displayName).toBe('Neon Iron Club');
    expect(record.opponentSnapshot.championId).toBe('champion-shredder');
    expect(record.config.player.squad).toEqual(playerSquad);
    const verified = verifyBattleRecord(record, BALANCE);
    expect(verified.ok, JSON.stringify(verified)).toBe(true);

    store.getState().stop();
  });
});

describe('provider gym boundary (M9)', () => {
  it('the local player belongs to forge-district and appears in the roster', async () => {
    const { provider } = await makeProvider();
    const profile = await provider.getGymProfile('local-player');
    expect(profile).not.toBeNull();
    expect(profile!.gymId).toBe('forge-district');
    expect(profile!.memberIds).toContain('local-player');
    expect(profile!.memberIds.length).toBe(11); // 10 seeded + the player

    const members = await provider.getGymMembers('forge-district');
    expect(members.map((m) => m.playerId)).toEqual(profile!.memberIds);
    // Unknown players are gym-less; unknown gyms reject.
    expect(await provider.getGymProfile('someone-else')).toBeNull();
    await expect(provider.getGymMembers('no-such-gym')).rejects.toThrow(/unknown gym/);
  });

  it('rival gyms exclude the player gym', async () => {
    const { provider } = await makeProvider();
    const rivals = await provider.listRivalGyms();
    expect(rivals.map((g) => g.gymId).sort()).toEqual(['apex-performance', 'neon-iron-club']);
    for (const rival of rivals) {
      expect(rival.memberIds).toHaveLength(10);
      expect(rival.name.length).toBeGreaterThan(0);
    }
  });
});

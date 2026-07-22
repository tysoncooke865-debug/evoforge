/**
 * P12 tests — Gym Champions slice: official-path squad roles (data-linked to
 * champion content), the squad-synergy preview (pure function pinned against
 * the engine's spawn auras), borrowed-passive probes (every passive functions
 * in the borrowed auto-cast context, team auras included), stale-selection
 * pruning and squad persistence.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE, CHAMPIONS, getCardById, getChampionByPath, SYNERGIES } from '../content';
import { damageUnit } from '../game-engine/combat/combat';
import { spawnUnitsForCard } from '../game-engine/entities/spawn';
import { checkInvariants } from '../game-engine/simulation/invariants';
import {
  BattleConfig,
  BattleState,
  createBattle,
  TeamSquadConfig,
  UnitState,
} from '../game-engine/simulation/state';
import { advanceTick } from '../game-engine/simulation/tick';
import { ALL_AVATAR_PATHS } from '../game-engine/types';
import { pathSquadRole } from '../features/gyms/path-roles';
import { pruneSquadSelection } from '../features/gyms/squad';
import {
  hasSpawnSynergy,
  previewSquadSynergies,
  relevantSynergyEntries,
} from '../features/gyms/synergy-preview';
import type { GymMemberInfo } from '../integration/evoforge/types';
import { createDefaultSave, loadSave, persistSave } from '../services/persistence/save';
import { MemoryStorage } from '../services/persistence/storage';

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

function squadConfig(playerSquad: TeamSquadConfig): BattleConfig {
  return {
    seed: 991,
    player: { playerId: 'p1', squad: playerSquad },
    opponent: { playerId: 'p2' },
  };
}

function borrowedByContentId(state: BattleState, contentId: string): UnitState {
  const unit = state.units.find(
    (u) => u.team === 'player' && u.champion && !u.champion.commandable && u.contentId === contentId
  );
  if (!unit) throw new Error(`no borrowed ${contentId}`);
  return unit;
}

function member(playerId: string, path: (typeof ALL_AVATAR_PATHS)[number]): GymMemberInfo {
  return {
    playerId,
    displayName: playerId,
    fitness: {
      playerId,
      evoRating: 50,
      strengthRating: 50,
      cardioRating: 50,
      muscularityRating: 50,
      leannessRating: 50,
      aestheticsRating: 50,
      forgeLevel: 10,
      avatarPath: path,
      avatarStage: 2,
    },
  };
}

describe('official-path squad roles (P12)', () => {
  it('covers all five official paths with unique, non-empty labels', () => {
    const roles = ALL_AVATAR_PATHS.map((p) => pathSquadRole(p)!);
    expect(roles).toHaveLength(5);
    for (const role of roles) {
      expect(role.label.length).toBeGreaterThan(0);
      expect(role.summary.length).toBeGreaterThan(0);
    }
    expect(new Set(roles.map((r) => r.label)).size).toBe(5);
    // The pinned role names.
    expect(Object.fromEntries(roles.map((r) => [r.path, r.label]))).toEqual({
      titan: 'Anchor',
      mass: 'Bulwark',
      shredder: 'Finisher',
      cardio: 'Pacer',
      aesthetic: 'Coach',
    });
  });

  it('every summary NAMES the path champion\'s actual passive (data link)', () => {
    for (const path of ALL_AVATAR_PATHS) {
      const role = pathSquadRole(path)!;
      const passive = getChampionByPath(path)!.passive;
      expect(role.summary, `${path} summary must name ${passive.name}`).toContain(passive.name);
    }
  });

  it('teamAura is DERIVED from content: true exactly for aura passives', () => {
    for (const path of ALL_AVATAR_PATHS) {
      const expected = getChampionByPath(path)!.passive.effects.teamAura !== undefined;
      expect(pathSquadRole(path)!.teamAura, path).toBe(expected);
    }
    // The current roster split, pinned: only the two support paths are auras.
    expect(pathSquadRole('cardio')!.teamAura).toBe(true);
    expect(pathSquadRole('aesthetic')!.teamAura).toBe(true);
    expect(pathSquadRole('titan')!.teamAura).toBe(false);
    expect(pathSquadRole('mass')!.teamAura).toBe(false);
    expect(pathSquadRole('shredder')!.teamAura).toBe(false);
  });

  it('unknown paths return undefined (fail-soft for garbage data)', () => {
    expect(pathSquadRole('hybrid')).toBeUndefined();
    expect(pathSquadRole('')).toBeUndefined();
    expect(pathSquadRole('speedster')).toBeUndefined();
  });
});

describe('squad synergy preview (P12) — pure function pinned to the engine', () => {
  it('activeFromSpawn EXACTLY matches the engine\'s spawn aura synergies', () => {
    const cases: { captain: string; borrowed: string[] }[] = [
      // 4 distinct paths → balanced-forge only.
      { captain: 'champion-titan', borrowed: ['champion-cardio', 'champion-shredder', 'champion-aesthetic'] },
      // 2 aesthetics → poise + support-network.
      { captain: 'champion-aesthetic', borrowed: ['champion-aesthetic'] },
      // Nothing meets a threshold.
      { captain: 'champion-titan', borrowed: ['champion-shredder'] },
      // Full mass/titan wall: 2 mass → mass-presence; titan 1+1(heavy? none) …
      { captain: 'champion-mass', borrowed: ['champion-mass', 'champion-titan'] },
    ];
    for (const c of cases) {
      const state = createBattle(squadConfig(squadOf(c.captain, c.borrowed)), BALANCE);
      const preview = previewSquadSynergies([c.captain, ...c.borrowed], []);
      expect(
        preview.filter((e) => e.activeFromSpawn).map((e) => e.synergyId),
        `${c.captain} + [${c.borrowed.join()}]`
      ).toEqual(state.auras.player.activeSynergyIds);
      expect(checkInvariants(state, BALANCE)).toEqual([]);
    }
  });

  it('counts squad tags and mixed-paths distinctness like the engine', () => {
    const preview = previewSquadSynergies(
      ['champion-titan', 'champion-cardio', 'champion-shredder', 'champion-aesthetic'],
      []
    );
    const byId = Object.fromEntries(preview.map((e) => [e.synergyId, e]));
    expect(byId['balanced-forge'].squadCount).toBe(4); // 4 distinct paths
    expect(byId['balanced-forge'].activeFromSpawn).toBe(true);
    expect(byId['titan-bulwark'].squadCount).toBe(1);
    expect(byId['aesthetic-poise'].squadCount).toBe(1);
    expect(byId['support-network'].squadCount).toBe(1); // aesthetic carries 'support'
    expect(byId['support-network'].activeFromSpawn).toBe(false);
    // Every content synergy appears exactly once.
    expect(preview.map((e) => e.synergyId).sort()).toEqual(SYNERGIES.map((s) => s.id).sort());
  });

  it('deck potential counts DISTINCT FIGHTER cards only (techniques/equipment/unknown ignored)', () => {
    const preview = previewSquadSynergies(
      ['champion-cardio'],
      ['titan-guard', 'heavy-tank', 'recovery-pulse', 'power-belt', 'reinforced-armour', 'no-such-card']
    );
    const byId = Object.fromEntries(preview.map((e) => [e.synergyId, e]));
    // titan-guard + heavy-tank are titan fighters; reinforced-armour (equipment) is not.
    expect(byId['titan-bulwark'].deckFighterCount).toBe(2);
    // heavy-tank is the only mass FIGHTER; power-belt (equipment) never spawns.
    expect(byId['mass-presence'].deckFighterCount).toBe(1);
    expect(byId['cardio-momentum'].deckFighterCount).toBe(0);
    // Guard against silently counting non-fighters.
    expect(getCardById('power-belt')!.category).toBe('equipment');
    expect(getCardById('recovery-pulse')!.category).toBe('technique');
  });

  it('mixed-paths deck potential counts only paths the squad does not already field', () => {
    const preview = previewSquadSynergies(
      ['champion-titan'],
      ['titan-guard', 'neon-boxer', 'shadow-striker'] // titan, cardio, shredder fighters
    );
    const mixed = preview.find((e) => e.synergyId === 'balanced-forge')!;
    expect(mixed.squadCount).toBe(1); // titan
    expect(mixed.deckFighterCount).toBe(2); // cardio + shredder (titan already fielded)
  });

  it('no-synergy squads are flagged for the hint; relevant entries need squad progress', () => {
    const none = previewSquadSynergies(['champion-titan', 'champion-shredder'], []);
    expect(hasSpawnSynergy(none)).toBe(false);
    const some = previewSquadSynergies(['champion-aesthetic', 'champion-aesthetic'], []);
    expect(hasSpawnSynergy(some)).toBe(true);
    // relevantSynergyEntries drops rows with zero squad progress.
    for (const entry of relevantSynergyEntries(none)) {
      expect(entry.squadCount).toBeGreaterThan(0);
    }
  });

  it('is pure: identical results, inputs never mutated', () => {
    const champs = ['champion-titan', 'champion-cardio'];
    const deck = ['titan-guard', 'recovery-pulse'];
    const champsSnapshot = [...champs];
    const deckSnapshot = [...deck];
    const a = previewSquadSynergies(champs, deck);
    const b = previewSquadSynergies(champs, deck);
    expect(a).toEqual(b);
    expect(champs).toEqual(champsSnapshot);
    expect(deck).toEqual(deckSnapshot);
  });
});

describe('borrowed passives function in the auto-cast context (P12 probes)', () => {
  it('borrowed Cardio Machine: Perpetual Motion team aura applies, dies and returns with it', () => {
    const state = createBattle(squadConfig(squadOf('champion-titan', ['champion-cardio'])), BALANCE);
    // Live from creation — the aura does not require a commandable champion.
    expect(state.auras.player.energyRegenMult).toBeCloseTo(1.05);
    expect(state.auras.opponent.energyRegenMult).toBe(1);

    const cardio = borrowedByContentId(state, 'champion-cardio');
    damageUnit(state, cardio, 999999, 'test');
    advanceTick(state, BALANCE);
    expect(state.auras.player.energyRegenMult).toBe(1); // dead borrowed = no aura

    while (!cardio.alive) advanceTick(state, BALANCE);
    expect(state.auras.player.energyRegenMult).toBeCloseTo(1.05); // respawn restores it
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('borrowed Aesthetics: Flow State team healing aura applies while alive', () => {
    const state = createBattle(
      squadConfig(squadOf('champion-titan', ['champion-aesthetic'])),
      BALANCE
    );
    expect(state.auras.player.healingMult).toBeCloseTo(1.1);
    expect(state.auras.opponent.healingMult).toBe(1);

    const aesthetic = borrowedByContentId(state, 'champion-aesthetic');
    damageUnit(state, aesthetic, 999999, 'test');
    advanceTick(state, BALANCE);
    expect(state.auras.player.healingMult).toBe(1);
  });

  it('two borrowed aura champions stack their team auras', () => {
    const state = createBattle(
      squadConfig(squadOf('champion-titan', ['champion-cardio', 'champion-aesthetic'])),
      BALANCE
    );
    expect(state.auras.player.energyRegenMult).toBeCloseTo(1.05);
    expect(state.auras.player.healingMult).toBeCloseTo(1.1);
  });

  it('borrowed Titan: Iron Hide flat armour applies to the borrowed unit itself', () => {
    const state = createBattle(squadConfig(squadOf('champion-cardio', ['champion-titan'])), BALANCE);
    const titan = borrowedByContentId(state, 'champion-titan');
    expect(damageUnit(state, titan, 50, 'test').dealtToHealth).toBe(45); // 50 - 5
    expect(damageUnit(state, titan, 3, 'test').dealtToHealth).toBe(1); // min-1 floor
  });

  it('borrowed Mass Monster: Colossal Frame max-health bake applies at spawn', () => {
    const state = createBattle(squadConfig(squadOf('champion-titan', ['champion-mass'])), BALANCE);
    const mass = borrowedByContentId(state, 'champion-mass');
    const listed = CHAMPIONS.find((c) => c.id === 'champion-mass')!.stats.maxHealth;
    expect(mass.baseMaxHealth).toBe(Math.round(listed * 1.1));
    expect(mass.health).toBe(mass.baseMaxHealth);
  });

  it('borrowed Shredder: Killer Instinct low-health bonus applies to its own hits', () => {
    const state = createBattle(
      squadConfig(squadOf('champion-titan', ['champion-shredder'])),
      BALANCE
    );
    const shredder = borrowedByContentId(state, 'champion-shredder');
    const target = spawnUnitsForCard(
      state,
      BALANCE,
      getCardById('titan-guard')!,
      'opponent',
      shredder.lane,
      shredder.x + 4
    )[0];
    target.health = 400; // above 35% of 650 — no bonus
    expect(damageUnit(state, target, 40, 'test', shredder).dealtToHealth).toBe(40);
    target.health = 200; // below the threshold — the borrowed champion's own hit scales
    expect(damageUnit(state, target, 40, 'test', shredder).dealtToHealth).toBe(50);
  });
});

describe('squad selection pruning + persistence (P12)', () => {
  it('pruneSquadSelection drops stale ids, preserves order, never mutates', () => {
    const members = [member('a', 'titan'), member('b', 'cardio'), member('c', 'shredder')];
    const selected = ['c', 'gone', 'a'];
    const pruned = pruneSquadSelection(selected, members);
    expect(pruned).toEqual(['c', 'a']); // order preserved, stale id dropped
    expect(selected).toEqual(['c', 'gone', 'a']); // input untouched
    expect(pruneSquadSelection(['a', 'b'], members)).toEqual(['a', 'b']); // no-op keeps all
    expect(pruneSquadSelection(['a', 'b'], [])).toEqual([]); // empty roster clears
  });

  it('selectedSquad persists across save round-trips (existing v3 field — no schema change)', async () => {
    const storage = new MemoryStorage();
    const save = createDefaultSave();
    save.gym.selectedSquad = ['m-1', 'm-2', 'm-3'];
    await persistSave(storage, save);
    const loaded = await loadSave(storage);
    expect(loaded.recovered).toBe(false);
    expect(loaded.fresh).toBe(false);
    expect(loaded.save.gym.selectedSquad).toEqual(['m-1', 'm-2', 'm-3']);
  });
});

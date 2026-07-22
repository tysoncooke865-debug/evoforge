import { describe, expect, it } from 'vitest';
import { LocalMockPlayerProvider } from '../integration/evoforge/local-mock-provider';
import {
  createDefaultSave,
  loadSave,
  migrateAvatarPath,
  migrateChampionId,
  persistSave,
  resetSave,
  SAVE_KEY,
  SAVE_VERSION,
} from '../services/persistence/save';
import { MemoryStorage } from '../services/persistence/storage';
import { createPlayerStore } from '../services/player-data/player-store';

describe('save system', () => {
  it('fresh install returns a valid default save and persists it via the store', async () => {
    const storage = new MemoryStorage();
    const result = await loadSave(storage);
    expect(result.fresh).toBe(true);
    expect(result.recovered).toBe(false);
    expect(result.save.saveVersion).toBe(SAVE_VERSION);
    expect(result.save.decks.all[0].cardIds.length).toBe(8);
  });

  it('round-trips persisted data', async () => {
    const storage = new MemoryStorage();
    const save = createDefaultSave();
    save.player.displayName = 'Tyson';
    save.player.rankPoints = 123;
    await persistSave(storage, save);
    const loaded = await loadSave(storage);
    expect(loaded.fresh).toBe(false);
    expect(loaded.recovered).toBe(false);
    expect(loaded.save.player.displayName).toBe('Tyson');
    expect(loaded.save.player.rankPoints).toBe(123);
  });

  it('recovers from corrupt JSON', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(SAVE_KEY, '{not json!!');
    const result = await loadSave(storage);
    expect(result.recovered).toBe(true);
    expect(result.save.saveVersion).toBe(SAVE_VERSION);
  });

  it('recovers from structurally invalid data', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: SAVE_VERSION, junk: true }));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(true);
  });

  it('refuses to load a save from a newer version', async () => {
    const storage = new MemoryStorage();
    const future = { ...createDefaultSave(), saveVersion: SAVE_VERSION + 5 };
    await storage.setItem(SAVE_KEY, JSON.stringify(future));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(true);
    expect(result.save.saveVersion).toBe(SAVE_VERSION);
  });

  it('recovers when a save version has no migration path', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 0, old: true }));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(true);
  });

  it('reset produces a fresh save', async () => {
    const storage = new MemoryStorage();
    const save = createDefaultSave();
    save.player.rankPoints = 500;
    await persistSave(storage, save);
    const fresh = await resetSave(storage);
    expect(fresh.player.rankPoints).toBe(0);
    const loaded = await loadSave(storage);
    expect(loaded.save.player.rankPoints).toBe(0);
  });
});

describe('save migration v1 → v2 (M6: settings.aiDifficulty)', () => {
  /** A faithful v1 save: current shape minus aiDifficulty, version 1. */
  function v1Save(): Record<string, unknown> {
    const base = createDefaultSave() as unknown as Record<string, unknown>;
    return {
      ...base,
      saveVersion: 1,
      player: { ...(base.player as object), displayName: 'Migrator', rankPoints: 250 },
      settings: { showDebugPanel: true }, // no aiDifficulty in v1
    };
  }

  it('migrates a v1 save forward without recovery, preserving fields', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(SAVE_KEY, JSON.stringify(v1Save()));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(false);
    expect(result.fresh).toBe(false);
    expect(result.save.saveVersion).toBe(SAVE_VERSION);
    // v1→v2 added 'standard'; the v5→v6 step re-defaults a never-battled
    // save (this fixture has 0 battles) to 'training'.
    expect(result.save.settings.aiDifficulty).toBe('training');
    // Existing data survives the migration untouched.
    expect(result.save.settings.showDebugPanel).toBe(true);
    expect(result.save.player.displayName).toBe('Migrator');
    expect(result.save.player.rankPoints).toBe(250);
    expect(result.save.decks.all[0].cardIds.length).toBe(8);
  });

  it('migrates even when the v1 settings object is malformed', async () => {
    const storage = new MemoryStorage();
    const broken = { ...v1Save(), settings: 'garbage' };
    await storage.setItem(SAVE_KEY, JSON.stringify(broken));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(false);
    expect(result.save.settings).toEqual({ showDebugPanel: false, aiDifficulty: 'training' });
  });

  it('a current-version save with an invalid aiDifficulty is recovered, not trusted', async () => {
    const storage = new MemoryStorage();
    const bad = createDefaultSave() as unknown as Record<string, unknown>;
    (bad.settings as Record<string, unknown>).aiDifficulty = 'nightmare';
    await storage.setItem(SAVE_KEY, JSON.stringify(bad));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(true);
    expect(result.save.settings.aiDifficulty).toBe('training');
  });

  it('the default save is already the current version with the training difficulty (v6)', () => {
    const save = createDefaultSave();
    expect(save.saveVersion).toBe(SAVE_VERSION);
    expect(save.settings.aiDifficulty).toBe('training');
  });
});

describe('save migration v2 → v3 (M9: gym squad + war stats)', () => {
  /** A faithful v2 save: current shape minus the gym block, version 2. */
  function v2Save(): Record<string, unknown> {
    const base = createDefaultSave() as unknown as Record<string, unknown>;
    const v2 = {
      ...base,
      saveVersion: 2,
      player: { ...(base.player as object), displayName: 'GymMigrator', rankPoints: 77 },
    };
    delete (v2 as Record<string, unknown>).gym;
    return v2;
  }

  it('migrates a v2 save forward without recovery, adding empty gym state', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(SAVE_KEY, JSON.stringify(v2Save()));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(false);
    expect(result.fresh).toBe(false);
    expect(result.save.saveVersion).toBe(SAVE_VERSION);
    expect(result.save.gym).toEqual({
      selectedSquad: [],
      championStats: {},
      warsPlayed: 0,
      warsWon: 0,
    });
    // Existing data survives the migration untouched.
    expect(result.save.player.displayName).toBe('GymMigrator');
    expect(result.save.player.rankPoints).toBe(77);
    // 0 battles in this fixture → v5→v6 re-defaults to 'training'.
    expect(result.save.settings.aiDifficulty).toBe('training');
    expect(result.save.decks.all[0].cardIds.length).toBe(8);
  });

  it('migrates a v1 save all the way through the chain to v3', async () => {
    const storage = new MemoryStorage();
    const v1 = { ...v2Save(), saveVersion: 1, settings: { showDebugPanel: true } };
    await storage.setItem(SAVE_KEY, JSON.stringify(v1));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(false);
    expect(result.save.saveVersion).toBe(SAVE_VERSION);
    expect(result.save.settings).toEqual({ showDebugPanel: true, aiDifficulty: 'training' });
    expect(result.save.gym.selectedSquad).toEqual([]);
  });

  it('replaces a malformed pre-existing gym field during migration', async () => {
    const storage = new MemoryStorage();
    const broken = { ...v2Save(), gym: 'garbage' };
    await storage.setItem(SAVE_KEY, JSON.stringify(broken));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(false);
    expect(result.save.gym).toEqual({
      selectedSquad: [],
      championStats: {},
      warsPlayed: 0,
      warsWon: 0,
    });
  });

  it('a v3 save with a malformed gym block is recovered, not trusted', async () => {
    const storage = new MemoryStorage();
    for (const gym of [
      null,
      'nope',
      { selectedSquad: 'not-an-array', championStats: {}, warsPlayed: 0, warsWon: 0 },
      { selectedSquad: [1, 2], championStats: {}, warsPlayed: 0, warsWon: 0 },
      { selectedSquad: [], championStats: { a: { appearances: 'x' } }, warsPlayed: 0, warsWon: 0 },
      { selectedSquad: [], championStats: {}, warsPlayed: NaN, warsWon: 0 },
    ]) {
      const bad = createDefaultSave() as unknown as Record<string, unknown>;
      bad.gym = gym;
      await storage.setItem(SAVE_KEY, JSON.stringify(bad));
      const result = await loadSave(storage);
      expect(result.recovered, JSON.stringify(gym)).toBe(true);
      expect(result.save.gym.selectedSquad).toEqual([]);
    }
  });
});

describe('save migration v4 → v5 (five-champion pass: official roster ids)', () => {
  /** A faithful v4 save carrying the retired champion/path names. */
  function v4Save(championId: string, avatarPath: string): Record<string, unknown> {
    const base = createDefaultSave('2026-07-20T00:00:00.000Z') as unknown as Record<string, unknown>;
    return {
      ...base,
      saveVersion: 4,
      player: {
        ...(base.player as object),
        displayName: 'Roster Migrator',
        championId,
        rankPoints: 420,
        onboardingComplete: true,
      },
      fitness: { ...(base.fitness as object), avatarPath, avatarStage: 5, strengthRating: 77 },
    };
  }

  it('maps speedster → champion-cardio and hybrid → champion-aesthetic, preserving everything else', async () => {
    const cases: [string, string][] = [
      ['champion-speedster', 'champion-cardio'],
      ['champion-hybrid', 'champion-aesthetic'],
      ['champion-titan', 'champion-titan'],
      ['champion-shredder', 'champion-shredder'],
      ['champion-mass', 'champion-mass'],
    ];
    for (const [oldId, newId] of cases) {
      const storage = new MemoryStorage();
      await storage.setItem(SAVE_KEY, JSON.stringify(v4Save(oldId, 'speedster')));
      const result = await loadSave(storage);
      expect(result.recovered, oldId).toBe(false);
      expect(result.save.saveVersion).toBe(SAVE_VERSION);
      expect(result.save.player.championId, oldId).toBe(newId);
      // Everything else survives untouched.
      expect(result.save.player.rankPoints).toBe(420);
      expect(result.save.player.displayName).toBe('Roster Migrator');
      expect(result.save.player.onboardingComplete).toBe(true);
      expect(result.save.fitness.strengthRating).toBe(77);
      // The mock fitness path migrates by the same table; stage clamps to 4.
      expect(result.save.fitness.avatarPath).toBe('cardio');
      expect(result.save.fitness.avatarStage).toBe(4);
    }
  });

  it('normalizes unknown or malformed champion ids to the titan default', async () => {
    for (const bad of ['champion-nope', 42, null, undefined, '']) {
      const storage = new MemoryStorage();
      const save = v4Save('champion-titan', 'hybrid');
      (save.player as Record<string, unknown>).championId = bad as never;
      await storage.setItem(SAVE_KEY, JSON.stringify(save));
      const result = await loadSave(storage);
      // championId must be a string for the migrated save to validate; the
      // remap normalizes every malformed value rather than recovering.
      expect(result.save.player.championId, String(bad)).toBe('champion-titan');
      expect(result.save.fitness.avatarPath).toBe('aesthetic'); // hybrid folds
    }
  });

  it('the pure remap tables are total', () => {
    expect(migrateChampionId('champion-speedster')).toBe('champion-cardio');
    expect(migrateChampionId('champion-hybrid')).toBe('champion-aesthetic');
    expect(migrateChampionId('champion-cardio')).toBe('champion-cardio');
    expect(migrateChampionId({})).toBe('champion-titan');
    expect(migrateAvatarPath('speedster')).toBe('cardio');
    expect(migrateAvatarPath('hybrid')).toBe('aesthetic');
    expect(migrateAvatarPath('mass')).toBe('mass');
    expect(migrateAvatarPath(null)).toBe('titan');
  });

  it('migrates a v1 save through the whole chain to v5', async () => {
    const storage = new MemoryStorage();
    const base = createDefaultSave('2026-01-01T00:00:00.000Z') as unknown as Record<string, unknown>;
    const v1player: Record<string, unknown> = {
      ...(base.player as object),
      championId: 'champion-speedster',
      rankPoints: 99,
    };
    // A faithful v1 save predates the onboarding flag entirely.
    delete v1player.onboardingComplete;
    const v1 = {
      ...base,
      saveVersion: 1,
      player: v1player,
      fitness: { ...(base.fitness as object), avatarPath: 'hybrid' },
      settings: { showDebugPanel: true },
    };
    delete (v1 as Record<string, unknown>).gym;
    await storage.setItem(SAVE_KEY, JSON.stringify(v1));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(false);
    expect(result.save.saveVersion).toBe(SAVE_VERSION);
    expect(result.save.player.championId).toBe('champion-cardio');
    expect(result.save.fitness.avatarPath).toBe('aesthetic');
    expect(result.save.player.rankPoints).toBe(99);
    // 0 battles in this fixture → the final v5→v6 step lands 'training'.
    expect(result.save.settings).toEqual({ showDebugPanel: true, aiDifficulty: 'training' });
    expect(result.save.gym.selectedSquad).toEqual([]);
    expect(result.save.player.onboardingComplete).toBe(true);
  });

  it('the default save is already v5 with an official champion id', () => {
    const save = createDefaultSave();
    expect(save.saveVersion).toBe(SAVE_VERSION);
    expect(save.player.championId).toBe('champion-titan');
    expect(save.fitness.avatarPath).toBe('titan');
  });
});

describe('player store + mock provider', () => {
  function makeStore() {
    const ref = { current: null as never };
    return { store: createPlayerStore(ref), storage: new MemoryStorage() };
  }

  it('initializes and persists player data across store instances (restart simulation)', async () => {
    const { store, storage } = makeStore();
    await store.getState().initialize(storage);
    expect(store.getState().status).toBe('ready');

    await store.getState().update((s) => ({
      ...s,
      player: { ...s.player, displayName: 'Restarter', rankPoints: 42 },
    }));

    // Simulate app restart: new store, same storage.
    const ref2 = { current: null as never };
    const store2 = createPlayerStore(ref2);
    await store2.getState().initialize(storage);
    expect(store2.getState().save.player.displayName).toBe('Restarter');
    expect(store2.getState().save.player.rankPoints).toBe(42);
  });

  it('provider reads player and fitness through the boundary', async () => {
    const { store, storage } = makeStore();
    await store.getState().initialize(storage);
    const provider = new LocalMockPlayerProvider(store);

    const player = await provider.getCurrentPlayer();
    expect(player.playerId).toBe('local-player');

    const fitness = await provider.getFitnessProfile(player.playerId);
    expect(fitness.evoRating).toBe(50);
    expect(fitness.avatarPath).toBe('titan');

    await expect(provider.getFitnessProfile('someone-else')).rejects.toThrow();
  });

  it('recordBattleResult updates rank points and stats', async () => {
    const { store, storage } = makeStore();
    await store.getState().initialize(storage);
    const provider = new LocalMockPlayerProvider(store);

    await provider.recordBattleResult({
      battleId: 'b1',
      balanceVersion: '0.1.0',
      seed: 1,
      playerId: 'local-player',
      opponentId: 'ai-1',
      outcome: 'win',
      playerCoreHealth: 1000,
      opponentCoreHealth: 0,
      durationTicks: 1200,
      rankPointsDelta: 30,
      mode: 'standard',
      completedAt: new Date().toISOString(),
    });

    const state = store.getState();
    expect(state.save.player.rankPoints).toBe(30);
    expect(state.save.stats.battlesPlayed).toBe(1);
    expect(state.save.stats.wins).toBe(1);

    // Rank points never go negative.
    await provider.recordBattleResult({
      battleId: 'b2',
      balanceVersion: '0.1.0',
      seed: 2,
      playerId: 'local-player',
      opponentId: 'ai-1',
      outcome: 'loss',
      playerCoreHealth: 0,
      opponentCoreHealth: 500,
      durationTicks: 900,
      rankPointsDelta: -100,
      mode: 'standard',
      completedAt: new Date().toISOString(),
    });
    expect(store.getState().save.player.rankPoints).toBe(0);
    expect(store.getState().save.stats.losses).toBe(1);
  });
});

describe('save migration v5 → v6 (P11: first-battle difficulty default)', () => {
  /** A faithful v5 save at the given battle count / difficulty. */
  function v5Save(battlesPlayed: number, aiDifficulty: string): Record<string, unknown> {
    const base = createDefaultSave() as unknown as Record<string, unknown>;
    return {
      ...base,
      saveVersion: 5,
      player: { ...(base.player as object), displayName: 'Gater', rankPoints: 55 },
      stats: {
        battlesPlayed,
        wins: Math.min(battlesPlayed, 3),
        losses: Math.max(0, battlesPlayed - 3),
        draws: 0,
      },
      settings: { showDebugPanel: true, aiDifficulty },
    };
  }

  it('a never-battled v5 save re-defaults its difficulty to training', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(SAVE_KEY, JSON.stringify(v5Save(0, 'standard')));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(false);
    expect(result.save.saveVersion).toBe(SAVE_VERSION);
    expect(result.save.settings.aiDifficulty).toBe('training');
    // Everything else survives untouched.
    expect(result.save.settings.showDebugPanel).toBe(true);
    expect(result.save.player.displayName).toBe('Gater');
    expect(result.save.player.rankPoints).toBe(55);
  });

  it('a v5 save with battles keeps its chosen difficulty', async () => {
    for (const difficulty of ['training', 'standard', 'advanced']) {
      const storage = new MemoryStorage();
      await storage.setItem(SAVE_KEY, JSON.stringify(v5Save(7, difficulty)));
      const result = await loadSave(storage);
      expect(result.recovered, difficulty).toBe(false);
      expect(result.save.settings.aiDifficulty, difficulty).toBe(difficulty);
    }
  });

  it('normalizes a malformed difficulty or stats block to training', async () => {
    for (const broken of [
      { ...v5Save(0, 'standard'), settings: 'garbage' },
      v5Save(0, 'nightmare'),
      // battlesPlayed missing → treated as never-battled.
      { ...v5Save(4, 'advanced'), stats: {} },
    ]) {
      const storage = new MemoryStorage();
      await storage.setItem(SAVE_KEY, JSON.stringify(broken));
      const result = await loadSave(storage);
      expect(result.recovered).toBe(false);
      expect(result.save.settings.aiDifficulty).toBe('training');
    }
  });
});

describe('save migration v3 → v4 (M10: player.onboardingComplete)', () => {
  it('a v3 save without the field migrates forward as already-onboarded', async () => {
    const storage = new MemoryStorage();
    const v3 = createDefaultSave() as unknown as Record<string, unknown>;
    v3.saveVersion = 3;
    const player = { ...(v3.player as Record<string, unknown>) };
    delete player.onboardingComplete;
    v3.player = player;
    await storage.setItem(SAVE_KEY, JSON.stringify(v3));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(false);
    expect(result.save.saveVersion).toBe(SAVE_VERSION);
    // Pre-M10 players are not funneled through onboarding.
    expect(result.save.player.onboardingComplete).toBe(true);
  });

  it('normalizes a malformed onboardingComplete during migration', async () => {
    const storage = new MemoryStorage();
    const v3 = createDefaultSave() as unknown as Record<string, unknown>;
    v3.saveVersion = 3;
    (v3.player as Record<string, unknown>).onboardingComplete = 'yes';
    await storage.setItem(SAVE_KEY, JSON.stringify(v3));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(false);
    expect(result.save.player.onboardingComplete).toBe(true);
  });

  it('a current-version save with a non-boolean field is recovered, not trusted', async () => {
    const storage = new MemoryStorage();
    const bad = createDefaultSave() as unknown as Record<string, unknown>;
    (bad.player as Record<string, unknown>).onboardingComplete = 'maybe';
    await storage.setItem(SAVE_KEY, JSON.stringify(bad));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(true);
  });
});

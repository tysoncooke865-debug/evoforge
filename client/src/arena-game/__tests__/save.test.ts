import { describe, expect, it } from 'vitest';
import { LocalMockPlayerProvider } from '../integration/evoforge/local-mock-provider';
import {
  createDefaultSave,
  loadSave,
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
    expect(result.save.settings.aiDifficulty).toBe('standard');
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
    expect(result.save.settings).toEqual({ showDebugPanel: false, aiDifficulty: 'standard' });
  });

  it('a v2 save with an invalid aiDifficulty is recovered, not trusted', async () => {
    const storage = new MemoryStorage();
    const bad = createDefaultSave() as unknown as Record<string, unknown>;
    (bad.settings as Record<string, unknown>).aiDifficulty = 'nightmare';
    await storage.setItem(SAVE_KEY, JSON.stringify(bad));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(true);
    expect(result.save.settings.aiDifficulty).toBe('standard');
  });

  it('the default save is already the current version with a standard difficulty', () => {
    const save = createDefaultSave();
    expect(save.saveVersion).toBe(SAVE_VERSION);
    expect(save.settings.aiDifficulty).toBe('standard');
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
    expect(result.save.settings.aiDifficulty).toBe('standard');
    expect(result.save.decks.all[0].cardIds.length).toBe(8);
  });

  it('migrates a v1 save all the way through the chain to v3', async () => {
    const storage = new MemoryStorage();
    const v1 = { ...v2Save(), saveVersion: 1, settings: { showDebugPanel: true } };
    await storage.setItem(SAVE_KEY, JSON.stringify(v1));
    const result = await loadSave(storage);
    expect(result.recovered).toBe(false);
    expect(result.save.saveVersion).toBe(SAVE_VERSION);
    expect(result.save.settings).toEqual({ showDebugPanel: true, aiDifficulty: 'standard' });
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

/**
 * App-level service wiring for the Arena INSIDE EvoForge.
 *
 * Exports are STABLE delegating objects (never rebound): anything that
 * caches `appStorage` or `playerProvider` (the battle store's lazy refs)
 * always sees the current user's backend. `initArenaForUser` namespaces all
 * Arena persistence under the signed-in user id (shared-device isolation —
 * the "four caches" doctrine) and swaps in the Supabase-backed provider.
 */
import { LocalMockPlayerProvider } from '../integration/evoforge/local-mock-provider';
import { SupabaseEvoForgePlayerProvider } from '../integration/evoforge/supabase-provider';
import type {
  BattleResult,
  EvoForgePlayerProvider,
  FitnessProfile,
  GymMemberInfo,
  GymProfile,
  PlayerProfile,
} from '../integration/evoforge/types';
import { AsyncStorageBackend } from './persistence/async-storage';
import type { KeyValueStorage } from './persistence/storage';
import { createPlayerStore, PlayerStore } from './player-data/player-store';

/** Namespaces every key under a per-user prefix. */
class NamespacedStorage implements KeyValueStorage {
  constructor(
    private readonly inner: KeyValueStorage,
    private readonly prefix: string
  ) {}

  getItem(key: string): Promise<string | null> {
    return this.inner.getItem(this.prefix + key);
  }

  setItem(key: string, value: string): Promise<void> {
    return this.inner.setItem(this.prefix + key, value);
  }

  removeItem(key: string): Promise<void> {
    return this.inner.removeItem(this.prefix + key);
  }

  async getAllKeys(): Promise<string[]> {
    const keys = await this.inner.getAllKeys();
    return keys.filter((k) => k.startsWith(this.prefix)).map((k) => k.slice(this.prefix.length));
  }
}

const storageRef: { current: KeyValueStorage | null } = { current: null };

/** The active backend the delegator below points at. */
let activeStorage: KeyValueStorage = new AsyncStorageBackend();

/** Stable storage object — delegates to the current user's namespace. */
export const appStorage: KeyValueStorage = {
  getItem: (key) => activeStorage.getItem(key),
  setItem: (key, value) => activeStorage.setItem(key, value),
  removeItem: (key) => activeStorage.removeItem(key),
  getAllKeys: () => activeStorage.getAllKeys(),
};

export const playerStore: PlayerStore = createPlayerStore(storageRef);

let activeProvider: EvoForgePlayerProvider = new LocalMockPlayerProvider(playerStore);

/**
 * The game's only gateway to player/fitness/gym data — a stable delegator
 * over the active provider (LocalMock until initArenaForUser swaps in the
 * Supabase-backed one).
 */
export const playerProvider: EvoForgePlayerProvider = {
  getCurrentPlayer: (): Promise<PlayerProfile> => activeProvider.getCurrentPlayer(),
  getFitnessProfile: (playerId: string): Promise<FitnessProfile> =>
    activeProvider.getFitnessProfile(playerId),
  getGymProfile: (playerId: string): Promise<GymProfile | null> =>
    activeProvider.getGymProfile(playerId),
  getGymMembers: (gymId: string): Promise<GymMemberInfo[]> => activeProvider.getGymMembers(gymId),
  listRivalGyms: (): Promise<GymProfile[]> => activeProvider.listRivalGyms(),
  recordBattleResult: (result: BattleResult): Promise<void> =>
    activeProvider.recordBattleResult(result),
};

/**
 * Initialize the Arena for the signed-in EvoForge user: per-user namespaced
 * persistence + the Supabase provider. Safe to call again on user change.
 */
export async function initArenaForUser(userId: string): Promise<void> {
  activeStorage = new NamespacedStorage(new AsyncStorageBackend(), `u/${userId}/`);
  activeProvider = new SupabaseEvoForgePlayerProvider(playerStore, userId);
  await playerStore.getState().initialize(appStorage);
}

/**
 * Sign-out teardown, called from EvoForge's auth-context (which clears
 * EVERY cache layer on sign-out): drop back to defaults so no in-memory
 * state can leak to the next athlete on a shared device. Persistence is
 * already per-user namespaced, so on-disk data needs no wipe.
 */
export async function resetArenaSession(): Promise<void> {
  activeStorage = new AsyncStorageBackend();
  activeProvider = new LocalMockPlayerProvider(playerStore);
  // Reset the battle loop first so no timer keeps mutating a battle.
  const { battleStore } = await import('../features/arena/battle-store');
  battleStore.getState().reset();
  playerStore.setState({ status: 'idle' });
}

/** Standalone-compatible bootstrap (kept for tests/dev tools). */
export async function bootstrapServices(): Promise<void> {
  await playerStore.getState().initialize(appStorage);
}

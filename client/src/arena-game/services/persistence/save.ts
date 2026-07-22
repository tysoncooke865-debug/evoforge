/**
 * Versioned save data with migration and corrupt-data recovery.
 *
 * Rules:
 *  - Every schema change bumps SAVE_VERSION and adds a migration step.
 *  - Loading NEVER throws: corrupt or invalid data falls back to a fresh
 *    default save and reports `recovered: true` so the UI can inform the user.
 */
import type { AiDifficulty } from '../../content/balance';
import { ALL_AI_DIFFICULTIES } from '../../content/balance';
import type { FitnessProfile } from '../../integration/evoforge/types';
import type { KeyValueStorage } from './storage';

export const SAVE_KEY = 'evoforge-arena/save';
/** v2 (M6): settings gained aiDifficulty. v3 (M9): gym squad + war stats.
 *  v4 (M10): onboardingComplete. v5 (five-champion pass): champion ids and
 *  avatar paths remapped onto the official EvoForge roster. */
export const SAVE_VERSION = 5;

export interface DeckRecord {
  id: string;
  name: string;
  cardIds: string[];
}

/** Per-member Gym War contribution counters (M9). */
export interface GymMemberStats {
  /** Wars this member's borrowed champion was fielded in. */
  appearances: number;
  /** Fielded appearances that ended in victory. */
  wins: number;
  /**
   * Contribution score — a simple deterministic damage PROXY, not real damage
   * attribution: +contributionPerWar per war fielded, +contributionWinBonus
   * extra on a win (values in BALANCE.gym). Real per-unit damage attribution
   * needs per-unit tracking in the engine — deferred (see KNOWN_ISSUES).
   */
  warContribution: number;
}

/** Gym membership state (M9, save v3). */
export interface GymSaveState {
  /** Borrowed squad member playerIds (max BALANCE.gym.maxBorrowed). */
  selectedSquad: string[];
  /** Contribution stats per gym member fielded in at least one war. */
  championStats: Record<string, GymMemberStats>;
  warsPlayed: number;
  warsWon: number;
}

export function createDefaultGymState(): GymSaveState {
  return { selectedSquad: [], championStats: {}, warsPlayed: 0, warsWon: 0 };
}

export interface SaveData {
  saveVersion: number;
  createdAt: string;
  updatedAt: string;
  player: {
    playerId: string;
    displayName: string;
    championId: string;
    rankPoints: number;
    onboardingComplete: boolean;
  };
  fitness: FitnessProfile;
  decks: {
    activeDeckId: string;
    all: DeckRecord[];
  };
  stats: {
    battlesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
  };
  settings: {
    showDebugPanel: boolean;
    /** Opponent AI tier for lobby battles (v2). */
    aiDifficulty: AiDifficulty;
  };
  /** Gym squad + war stats (v3, M9). */
  gym: GymSaveState;
}

export const DEFAULT_DECK_CARD_IDS = [
  'forge-recruit',
  'titan-guard',
  'neon-boxer',
  'drone-archer',
  'cardio-runner',
  'recovery-pulse',
  'overload',
  'emergency-shield',
];

export function createDefaultSave(now: string = new Date().toISOString()): SaveData {
  return {
    saveVersion: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    player: {
      playerId: 'local-player',
      displayName: 'Challenger',
      championId: 'champion-titan',
      rankPoints: 0,
      onboardingComplete: false,
    },
    fitness: {
      playerId: 'local-player',
      evoRating: 50,
      strengthRating: 50,
      cardioRating: 50,
      muscularityRating: 50,
      leannessRating: 50,
      aestheticsRating: 50,
      forgeLevel: 1,
      avatarPath: 'titan',
      avatarStage: 1,
    },
    decks: {
      activeDeckId: 'starter',
      all: [{ id: 'starter', name: 'Starter Deck', cardIds: [...DEFAULT_DECK_CARD_IDS] }],
    },
    stats: { battlesPlayed: 0, wins: 0, losses: 0, draws: 0 },
    settings: { showDebugPanel: false, aiDifficulty: 'standard' },
    gym: createDefaultGymState(),
  };
}

/** Structural validation of a parsed save. Not exhaustive, but rejects the
 *  shapes that would crash screens (missing player/decks/fitness). */
export function isValidSave(data: unknown): data is SaveData {
  if (typeof data !== 'object' || data === null) return false;
  const s = data as Partial<SaveData>;
  if (typeof s.saveVersion !== 'number') return false;
  if (typeof s.player !== 'object' || s.player === null) return false;
  if (typeof s.player.playerId !== 'string' || s.player.playerId.length === 0) return false;
  if (typeof s.player.displayName !== 'string') return false;
  if (typeof s.player.championId !== 'string') return false;
  if (typeof s.player.rankPoints !== 'number' || !Number.isFinite(s.player.rankPoints))
    return false;
  // v4: schema and validator stay in lockstep with the type (M10 audit).
  if (typeof s.player.onboardingComplete !== 'boolean') return false;
  if (typeof s.fitness !== 'object' || s.fitness === null) return false;
  if (typeof s.fitness.evoRating !== 'number') return false;
  if (typeof s.decks !== 'object' || s.decks === null) return false;
  if (!Array.isArray(s.decks.all)) return false;
  if (typeof s.stats !== 'object' || s.stats === null) return false;
  if (typeof s.settings !== 'object' || s.settings === null) return false;
  if (!ALL_AI_DIFFICULTIES.includes(s.settings.aiDifficulty as AiDifficulty)) return false;
  // v3 gym block: shape that screens/stat updates rely on.
  if (typeof s.gym !== 'object' || s.gym === null) return false;
  if (!Array.isArray(s.gym.selectedSquad)) return false;
  if (s.gym.selectedSquad.some((id) => typeof id !== 'string')) return false;
  if (typeof s.gym.championStats !== 'object' || s.gym.championStats === null) return false;
  for (const stats of Object.values(s.gym.championStats)) {
    if (typeof stats !== 'object' || stats === null) return false;
    const m = stats as Partial<GymMemberStats>;
    if (
      !Number.isFinite(m.appearances) ||
      !Number.isFinite(m.wins) ||
      !Number.isFinite(m.warContribution)
    )
      return false;
  }
  if (!Number.isFinite(s.gym.warsPlayed) || !Number.isFinite(s.gym.warsWon)) return false;
  return true;
}

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migration steps keyed by the version they migrate FROM.
 * Every step must advance saveVersion (the loader enforces this).
 */
const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2 (M6): settings gains aiDifficulty, defaulting to 'standard'.
  // Existing settings fields are preserved; a malformed settings object is
  // rebuilt so the migrated save always validates.
  1: (data) => {
    const oldSettings =
      typeof data.settings === 'object' && data.settings !== null
        ? (data.settings as Record<string, unknown>)
        : {};
    return {
      ...data,
      saveVersion: 2,
      settings: {
        ...oldSettings,
        showDebugPanel:
          typeof oldSettings.showDebugPanel === 'boolean' ? oldSettings.showDebugPanel : false,
        aiDifficulty: 'standard' satisfies AiDifficulty,
      },
    };
  },
  // v2 → v3 (M9): the gym block (squad selection + war contribution stats)
  // is added with empty defaults. Any pre-existing 'gym' field of the wrong
  // shape is replaced so the migrated save always validates.
  2: (data) => ({
    ...data,
    saveVersion: 3,
    gym: createDefaultGymState(),
  }),
  // v3 → v4 (M10): player.onboardingComplete becomes a required boolean.
  // Pre-M10 saves lack it (they onboarded before the flow existed — treat as
  // complete so returning players are not funneled through onboarding);
  // malformed values are normalized.
  3: (data) => {
    const oldPlayer =
      typeof data.player === 'object' && data.player !== null
        ? (data.player as Record<string, unknown>)
        : {};
    return {
      ...data,
      saveVersion: 4,
      player: {
        ...oldPlayer,
        onboardingComplete:
          typeof oldPlayer.onboardingComplete === 'boolean'
            ? oldPlayer.onboardingComplete
            : true,
      },
    };
  },
  // v4 → v5 (five-champion pass): champion ids and avatar paths map onto the
  // OFFICIAL EvoForge roster — no destructive resets. speedster → Cardio
  // Machine's champion, hybrid → Aesthetics'; already-official ids pass
  // through; anything unknown/malformed normalizes to the titan default (the
  // same default a fresh save uses). The mock fitness avatarPath migrates by
  // the same table and its stage clamps onto the real 1–4 art-stage ladder.
  4: (data) => {
    const oldPlayer =
      typeof data.player === 'object' && data.player !== null
        ? (data.player as Record<string, unknown>)
        : {};
    const oldFitness =
      typeof data.fitness === 'object' && data.fitness !== null
        ? (data.fitness as Record<string, unknown>)
        : {};
    const stage =
      typeof oldFitness.avatarStage === 'number' && Number.isFinite(oldFitness.avatarStage)
        ? Math.min(4, Math.max(1, Math.trunc(oldFitness.avatarStage)))
        : 1;
    return {
      ...data,
      saveVersion: 5,
      player: {
        ...oldPlayer,
        championId: migrateChampionId(oldPlayer.championId),
      },
      fitness: {
        ...oldFitness,
        avatarPath: migrateAvatarPath(oldFitness.avatarPath),
        avatarStage: stage,
      },
    };
  },
};

/** The five official champion ids (v5). */
const OFFICIAL_CHAMPION_IDS = new Set([
  'champion-aesthetic',
  'champion-titan',
  'champion-mass',
  'champion-shredder',
  'champion-cardio',
]);

/** v4 → v5 champion id remap (exported for tests). */
export function migrateChampionId(id: unknown): string {
  if (id === 'champion-speedster') return 'champion-cardio';
  if (id === 'champion-hybrid') return 'champion-aesthetic';
  if (typeof id === 'string' && OFFICIAL_CHAMPION_IDS.has(id)) return id;
  return 'champion-titan';
}

/** v4 → v5 avatar path remap (exported for tests). */
export function migrateAvatarPath(path: unknown): string {
  if (path === 'speedster') return 'cardio';
  if (path === 'hybrid') return 'aesthetic';
  if (
    path === 'aesthetic' ||
    path === 'titan' ||
    path === 'mass' ||
    path === 'shredder' ||
    path === 'cardio'
  )
    return path;
  return 'titan';
}

export interface LoadResult {
  save: SaveData;
  /** True when the stored data was missing (fresh install). */
  fresh: boolean;
  /** True when stored data existed but was corrupt/invalid and was replaced. */
  recovered: boolean;
}

export async function loadSave(storage: KeyValueStorage): Promise<LoadResult> {
  let raw: string | null = null;
  try {
    raw = await storage.getItem(SAVE_KEY);
  } catch {
    return { save: createDefaultSave(), fresh: false, recovered: true };
  }
  if (raw === null) {
    const save = createDefaultSave();
    return { save, fresh: true, recovered: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { save: createDefaultSave(), fresh: false, recovered: true };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { save: createDefaultSave(), fresh: false, recovered: true };
  }

  let data = parsed as Record<string, unknown>;
  let version = typeof data.saveVersion === 'number' ? data.saveVersion : -1;

  if (version > SAVE_VERSION) {
    // Save from a newer app build — do not attempt to run it backwards.
    return { save: createDefaultSave(), fresh: false, recovered: true };
  }

  while (version >= 0 && version < SAVE_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      return { save: createDefaultSave(), fresh: false, recovered: true };
    }
    data = migrate(data);
    const next = typeof data.saveVersion === 'number' ? data.saveVersion : -1;
    if (next <= version) {
      // A migration must advance the version, otherwise we would loop forever.
      return { save: createDefaultSave(), fresh: false, recovered: true };
    }
    version = next;
  }

  if (!isValidSave(data)) {
    return { save: createDefaultSave(), fresh: false, recovered: true };
  }
  return { save: data, fresh: false, recovered: false };
}

export async function persistSave(storage: KeyValueStorage, save: SaveData): Promise<void> {
  const toWrite: SaveData = { ...save, updatedAt: new Date().toISOString() };
  await storage.setItem(SAVE_KEY, JSON.stringify(toWrite));
}

export async function resetSave(storage: KeyValueStorage): Promise<SaveData> {
  const fresh = createDefaultSave();
  await storage.setItem(SAVE_KEY, JSON.stringify(fresh));
  return fresh;
}

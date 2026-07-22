/**
 * Real progression mapping (audit CRITICAL #1 + HIGH #2):
 *
 *  - branchToAvatarPath is a 5→5 passthrough of the live BranchV2 slugs
 *    (retired 'hybrid' → 'aesthetic', missing/garbage → 'titan').
 *  - The avatar STAGE is EvoForge's real, branch-specific derivation
 *    (currentStageFor): The Shredder's stage is BODY-FAT-driven; the level
 *    branches use their real ladders off the legacy display level
 *    (base_level + XP ledger through the pinned curve).
 *  - Fallbacks only ever UNDER-state progress (locked stages stay locked).
 *  - The Supabase provider assembles exactly these functions from queried
 *    data — exercised end-to-end with a mocked supabase client.
 */
import { describe, expect, it, vi } from 'vitest';
import { ALL_AVATAR_PATHS } from '../game-engine/types';
import {
  branchToAvatarPath,
  deriveLegacyLevel,
  deriveRealStage,
  estimateMemberStage,
  latestValidBfMid,
  pathFromUserId,
} from '../integration/evoforge/progression-mapping';
// vi.mock hoists above these imports, so the provider receives the mocked
// '@/data/supabase' module (the factory is defined further down).
import { SupabaseEvoForgePlayerProvider } from '../integration/evoforge/supabase-provider';
import { MemoryStorage } from '../services/persistence/storage';
import { createPlayerStore } from '../services/player-data/player-store';

describe('branchToAvatarPath — 5→5 passthrough', () => {
  it('passes every live branch slug through unchanged', () => {
    for (const slug of ['aesthetic', 'titan', 'mass', 'shredder', 'cardio'] as const) {
      expect(branchToAvatarPath(slug)).toBe(slug);
    }
  });

  it("folds the retired 'hybrid' origin into 'aesthetic'", () => {
    expect(branchToAvatarPath('hybrid')).toBe('aesthetic');
  });

  it('defaults missing/unknown origins to titan', () => {
    expect(branchToAvatarPath(null)).toBe('titan');
    expect(branchToAvatarPath(undefined)).toBe('titan');
    expect(branchToAvatarPath('')).toBe('titan');
    expect(branchToAvatarPath('speedster')).toBe('titan'); // never a real origin slug
  });
});

describe('deriveLegacyLevel — the ledger path of the pinned curve', () => {
  it('derives the level from base level + ledger XP (500 + (L-1)*25 curve)', () => {
    expect(deriveLegacyLevel(1, 0)).toBe(1);
    expect(deriveLegacyLevel(1, 499)).toBe(1);
    expect(deriveLegacyLevel(1, 500)).toBe(2);
    expect(deriveLegacyLevel(1, 500 + 525)).toBe(3);
    expect(deriveLegacyLevel(5, 0)).toBe(5);
  });

  it('a null ledger falls back to the base level alone — never higher', () => {
    expect(deriveLegacyLevel(7, null)).toBe(7);
    expect(deriveLegacyLevel(1, null)).toBe(1);
  });
});

describe('deriveRealStage — the branch-specific real stage', () => {
  it("The Shredder's stage is BODY-FAT-driven, level ignored", () => {
    // Level 100 changes nothing: only body fat moves the ladder.
    expect(deriveRealStage('shredder', 100, 30)).toBe(1); // >= 25: Hooded Resolve
    expect(deriveRealStage('shredder', 1, 24.9)).toBe(2); // < 25: The Grind
    expect(deriveRealStage('shredder', 1, 17.9)).toBe(3); // < 18: Cut Deep
    expect(deriveRealStage('shredder', 1, 12)).toBe(4); // <= 12: Shredded
    // No valid reading = the starting form — locked stages stay locked.
    expect(deriveRealStage('shredder', 100, null)).toBe(1);
  });

  it('titan / mass / cardio use the 25/50/75 body spread on the legacy level', () => {
    for (const branch of ['titan', 'mass', 'cardio'] as const) {
      expect(deriveRealStage(branch, 1, null), branch).toBe(1);
      expect(deriveRealStage(branch, 24, null), branch).toBe(1);
      expect(deriveRealStage(branch, 25, null), branch).toBe(2);
      expect(deriveRealStage(branch, 50, null), branch).toBe(3);
      expect(deriveRealStage(branch, 75, null), branch).toBe(4);
      expect(deriveRealStage(branch, 100, null), branch).toBe(4);
    }
  });

  it('aesthetic uses the pinned core ladder', () => {
    expect(deriveRealStage('aesthetic', 1, null)).toBe(1);
    expect(deriveRealStage('aesthetic', 100, null)).toBeGreaterThanOrEqual(3);
    // Monotone in level — a stage can never exceed a higher level's stage.
    let last = 0;
    for (const level of [1, 10, 25, 40, 50, 60, 75, 90, 100]) {
      const stage = deriveRealStage('aesthetic', level, null);
      expect(stage).toBeGreaterThanOrEqual(last);
      last = stage;
    }
  });
});

describe('latestValidBfMid — the useLatestBodyfatMid rule', () => {
  it('takes the newest reading > 0, skipping invalid ones', () => {
    expect(latestValidBfMid([17.2, 0, 28])).toBe(17.2);
    expect(latestValidBfMid([0, null, 'x', 21.5, 30])).toBe(21.5);
    expect(latestValidBfMid([])).toBeNull();
    expect(latestValidBfMid([0, -3, NaN, undefined])).toBeNull();
  });
});

describe('gym member estimation (documented approximation)', () => {
  it('pathFromUserId hashes deterministically over the FIVE official paths', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const path = pathFromUserId(`member-${i}`);
      expect(ALL_AVATAR_PATHS).toContain(path);
      seen.add(path);
    }
    expect(seen.size).toBe(5); // all five paths reachable
    expect(pathFromUserId('member-1')).toBe(pathFromUserId('member-1')); // stable
  });

  it('estimateMemberStage spreads forge level over the 4 art stages', () => {
    expect(estimateMemberStage(1)).toBe(1);
    expect(estimateMemberStage(24)).toBe(1);
    expect(estimateMemberStage(25)).toBe(2);
    expect(estimateMemberStage(50)).toBe(3);
    expect(estimateMemberStage(75)).toBe(4);
    expect(estimateMemberStage(NaN)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Provider end-to-end with a mocked supabase client
// ---------------------------------------------------------------------------

/** Rows the mocked client serves, keyed by table / rpc name. */
const mockData: {
  tables: Record<string, unknown[]>;
  rpcs: Record<string, unknown>;
  failTables: Set<string>;
} = {
  tables: {},
  rpcs: {},
  failTables: new Set(),
};

vi.mock('@/data/supabase', () => {
  const resultFor = (table: string) =>
    mockData.failTables.has(table)
      ? { data: null, error: { message: 'mock failure' } }
      : { data: mockData.tables[table] ?? [], error: null };
  const builder = (table: string) => ({
    select: () => ({
      limit: async () => resultFor(table),
      order: () => ({ limit: async () => resultFor(table) }),
    }),
  });
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: async (name: string) =>
        name in mockData.rpcs
          ? { data: mockData.rpcs[name], error: null }
          : { data: null, error: { message: `no rpc '${name}'` } },
    },
  };
});

async function makeProvider(userId = 'athlete-1') {
  const ref = { current: null as never };
  const store = createPlayerStore(ref);
  await store.getState().initialize(new MemoryStorage());
  return new SupabaseEvoForgePlayerProvider(store, userId);
}

describe('SupabaseEvoForgePlayerProvider — real stage derivation (mocked queries)', () => {
  it('derives a Shredder profile: origin passthrough + body-fat stage', async () => {
    mockData.tables = {
      evo_rating_current: [
        {
          displayed_rating: 61,
          strength_score: 70,
          cardio_score: 55,
          size_score: 48,
          aesthetics_score: 66,
        },
      ],
      profiles: [{ origin_path: 'shredder', base_level: 1, leanness_score: 62 }],
      user_progression: [{ lifetime_xp: 10000 }],
      // Newest first; the 0 reading is skipped, 17.2 wins → stage 3 (< 18).
      bodyfat_log: [{ bf_mid: 0 }, { bf_mid: 17.2 }, { bf_mid: 28 }],
    };
    mockData.rpcs = { xp_total: 3000 };
    mockData.failTables = new Set();

    const provider = await makeProvider();
    const fitness = await provider.getFitnessProfile('athlete-1');
    expect(fitness.avatarPath).toBe('shredder');
    expect(fitness.avatarStage).toBe(3); // bf 17.2 → Cut Deep, NOT a level ladder
    expect(fitness.forgeLevel).toBe(10); // pinned forge curve at 10,000 XP
    expect(fitness.strengthRating).toBe(70);
    expect(fitness.muscularityRating).toBe(48); // size_score → the Size pillar
    expect(fitness.leannessRating).toBe(62);
  });

  it('derives a Mass Monster stage from the legacy level (ledger XP)', async () => {
    mockData.tables = {
      evo_rating_current: [{ displayed_rating: 50 }],
      profiles: [{ origin_path: 'mass', base_level: 1, leanness_score: 50 }],
      user_progression: [{ lifetime_xp: 0 }],
      bodyfat_log: [],
    };
    // Enough ledger XP for legacy level >= 25 (25 level-ups ≈ 500+525+…):
    // cumulative cost of levels 1..24 = Σ(500 + i*25) = 12,000 + 6,900.
    mockData.rpcs = { xp_total: 20000 };

    const provider = await makeProvider();
    const fitness = await provider.getFitnessProfile('athlete-1');
    expect(fitness.avatarPath).toBe('mass');
    // deriveLegacyLevel(1, 20000) lands in the 25–49 band → stage 2.
    expect(deriveLegacyLevel(1, 20000)).toBeGreaterThanOrEqual(25);
    expect(deriveLegacyLevel(1, 20000)).toBeLessThan(50);
    expect(fitness.avatarStage).toBe(2);
  });

  it('a null ledger under-states the stage (base level only) — never inflates', async () => {
    mockData.tables = {
      evo_rating_current: [{ displayed_rating: 50 }],
      profiles: [{ origin_path: 'cardio', base_level: 30, leanness_score: 50 }],
      user_progression: [{ lifetime_xp: 0 }],
      bodyfat_log: [],
    };
    mockData.rpcs = {}; // xp_total fails → null ledger

    const provider = await makeProvider();
    const fitness = await provider.getFitnessProfile('athlete-1');
    expect(fitness.avatarPath).toBe('cardio');
    expect(fitness.avatarStage).toBe(2); // base level 30 → 25–49 band, no more
  });

  it("the retired 'hybrid' origin resolves to the Aesthetics champion", async () => {
    mockData.tables = {
      evo_rating_current: [{ displayed_rating: 50 }],
      profiles: [{ origin_path: 'hybrid', base_level: 1, leanness_score: 50 }],
      user_progression: [{ lifetime_xp: 0 }],
      bodyfat_log: [],
    };
    mockData.rpcs = { xp_total: 0 };
    const provider = await makeProvider();
    const fitness = await provider.getFitnessProfile('athlete-1');
    expect(fitness.avatarPath).toBe('aesthetic');
    const player = await provider.getCurrentPlayer();
    expect(player.championId).toBe('champion-aesthetic');
  });

  it('fails soft to the baseline profile when every query breaks', async () => {
    mockData.tables = {};
    mockData.rpcs = {};
    mockData.failTables = new Set(['evo_rating_current', 'profiles', 'user_progression', 'bodyfat_log']);
    const provider = await makeProvider();
    const fitness = await provider.getFitnessProfile('athlete-1');
    expect(fitness.avatarPath).toBe('titan');
    expect(fitness.avatarStage).toBe(1);
    expect(fitness.evoRating).toBe(50);
    mockData.failTables = new Set();
  });

  it('gym members synthesize path + estimated stage over the official five', async () => {
    mockData.tables = {};
    mockData.rpcs = {
      gym_detail: {
        ok: true,
        members: [
          { user_id: 'm-1', display_name: 'Aria Steele', forge_level: 60, evo_rating: 70 },
          { user_id: 'm-2', display_name: 'Kai Volt', forge_level: 3, evo_rating: 40 },
        ],
      },
    };
    const provider = await makeProvider();
    const members = await provider.getGymMembers('gym-1');
    expect(members).toHaveLength(2);
    for (const member of members) {
      expect(ALL_AVATAR_PATHS).toContain(member.fitness.avatarPath);
      expect(member.fitness.avatarPath).toBe(pathFromUserId(member.playerId));
    }
    expect(members[0].fitness.avatarStage).toBe(3); // forge 60 → 50–74 band
    expect(members[1].fitness.avatarStage).toBe(1);
  });
});

/**
 * Premium P5 — arena avatar profile: the mapping from the app's resolved
 * display identity, the store push semantics, the own-path guard, and the
 * battle-asset fidelity chain (pure core with an injected lookup — the real
 * registry requires PNGs the node env cannot load).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  resolveChampionAsset,
  type SpriteLookup,
} from '../features/arena/components/battle-assets-core';
import {
  ARENA_VISUAL_VERSION,
  arenaAvatarStore,
  arenaProfileKey,
  clearArenaAvatarProfile,
  mapDisplayToArenaProfile,
  profileForChampionPath,
  setArenaAvatarProfile,
  type ArenaAvatarProfile,
} from '../integration/evoforge/avatar-profile';

function baseInput() {
  return {
    branch: 'titan',
    stage: 3,
    formName: 'Iron Colossus',
    skinId: 'standard',
    character: null as { id: string } | null,
    sex: 'male',
  };
}

describe('mapDisplayToArenaProfile', () => {
  it('passes the five live branches through and folds hybrid into aesthetic', () => {
    for (const branch of ['aesthetic', 'mass', 'titan', 'cardio', 'shredder'] as const) {
      expect(mapDisplayToArenaProfile({ ...baseInput(), branch }).championPath).toBe(branch);
    }
    expect(mapDisplayToArenaProfile({ ...baseInput(), branch: 'hybrid' }).championPath).toBe(
      'aesthetic'
    );
  });

  it('clamps the visual stage into 1..4 (truncating, NaN-safe)', () => {
    expect(mapDisplayToArenaProfile({ ...baseInput(), stage: 0 }).evolutionStage).toBe(1);
    expect(mapDisplayToArenaProfile({ ...baseInput(), stage: 7 }).evolutionStage).toBe(4);
    expect(mapDisplayToArenaProfile({ ...baseInput(), stage: 2.9 }).evolutionStage).toBe(2);
    expect(mapDisplayToArenaProfile({ ...baseInput(), stage: NaN }).evolutionStage).toBe(1);
  });

  it('defaults skin to standard, maps sex safely, carries premium character', () => {
    expect(mapDisplayToArenaProfile({ ...baseInput(), skinId: '' }).skinId).toBe('standard');
    expect(mapDisplayToArenaProfile({ ...baseInput(), sex: 'female' }).sex).toBe('female');
    expect(mapDisplayToArenaProfile({ ...baseInput(), sex: 'unknown' }).sex).toBe('male');
    expect(
      mapDisplayToArenaProfile({ ...baseInput(), character: { id: 'gymerica' } }).premiumCharacter
    ).toBe('gymerica');
    expect(mapDisplayToArenaProfile(baseInput()).premiumCharacter).toBeNull();
    expect(mapDisplayToArenaProfile(baseInput()).visualVersion).toBe(ARENA_VISUAL_VERSION);
  });
});

describe('arenaProfileKey', () => {
  it('is stable for identical profiles and distinct per art-selecting field', () => {
    const a = mapDisplayToArenaProfile(baseInput());
    const b = mapDisplayToArenaProfile(baseInput());
    expect(arenaProfileKey(a)).toBe(arenaProfileKey(b));
    expect(arenaProfileKey(mapDisplayToArenaProfile({ ...baseInput(), stage: 2 }))).not.toBe(
      arenaProfileKey(a)
    );
    expect(arenaProfileKey(mapDisplayToArenaProfile({ ...baseInput(), skinId: 'inferno' }))).not.toBe(
      arenaProfileKey(a)
    );
    // formName is label-only — it must NOT change the art key.
    expect(
      arenaProfileKey(mapDisplayToArenaProfile({ ...baseInput(), formName: 'Other Name' }))
    ).toBe(arenaProfileKey(a));
  });
});

describe('arena avatar store', () => {
  beforeEach(() => clearArenaAvatarProfile());

  it('pushes, no-ops on identical pushes, and clears', () => {
    const profile = mapDisplayToArenaProfile(baseInput());
    setArenaAvatarProfile(profile, null);
    const first = arenaAvatarStore.getState();
    expect(first.profile?.championPath).toBe('titan');

    setArenaAvatarProfile({ ...profile }, null);
    expect(arenaAvatarStore.getState()).toBe(first); // no churn on same key

    setArenaAvatarProfile({ ...profile, evolutionStage: 4 }, null);
    expect(arenaAvatarStore.getState().profile?.evolutionStage).toBe(4);

    clearArenaAvatarProfile();
    expect(arenaAvatarStore.getState().profile).toBeNull();
  });
});

describe('profileForChampionPath (the own-path guard)', () => {
  it('returns the profile only for the matching path', () => {
    const profile = mapDisplayToArenaProfile(baseInput());
    expect(profileForChampionPath(profile, 'titan')).toBe(profile);
    expect(profileForChampionPath(profile, 'mass')).toBeNull();
    expect(profileForChampionPath(null, 'titan')).toBeNull();
  });
});

describe('resolveChampionAsset (fidelity chain)', () => {
  const VARIANT = { uri: 'variant' };
  const VARIANT_FRAMES = [{ uri: 'vw0' }, { uri: 'vw1' }, { uri: 'vw2' }, { uri: 'vw3' }];
  const CANONICAL = { uri: 'canonical' };
  const CANONICAL_FRAMES = [{ uri: 'w0' }, { uri: 'w1' }, { uri: 'w2' }, { uri: 'w3' }];

  function lookup(overrides: Partial<SpriteLookup> = {}): SpriteLookup {
    return {
      variantStill: () => null,
      variantWalk: () => null,
      canonicalStill: () => CANONICAL,
      canonicalWalk: () => CANONICAL_FRAMES,
      ...overrides,
    };
  }
  const profile: ArenaAvatarProfile = mapDisplayToArenaProfile(baseInput());

  it('prefers the exact profile variant when it exists', () => {
    const resolved = resolveChampionAsset(
      lookup({ variantStill: () => VARIANT, variantWalk: () => VARIANT_FRAMES }),
      'champion-titan',
      'player',
      profile
    );
    expect(resolved.fidelity).toBe('variant');
    expect(resolved.still).toBe(VARIANT);
    expect(resolved.walkFrames).toBe(VARIANT_FRAMES);
  });

  it('layer-drift rule: a variant still WITHOUT its own frames renders static', () => {
    const resolved = resolveChampionAsset(
      lookup({ variantStill: () => VARIANT }),
      'champion-titan',
      'player',
      profile
    );
    expect(resolved.fidelity).toBe('variant');
    expect(resolved.walkFrames).toBeNull(); // never canonical frames under a variant still
  });

  it('falls back to the canonical path asset when no variant exists (today, always)', () => {
    const resolved = resolveChampionAsset(lookup(), 'champion-titan', 'player', profile);
    expect(resolved.fidelity).toBe('canonical');
    expect(resolved.still).toBe(CANONICAL);
    expect(resolved.walkFrames).toBe(CANONICAL_FRAMES);
  });

  it('resolves canonically with no profile, and to the glyph fallback when even canonical art is missing', () => {
    expect(resolveChampionAsset(lookup(), 'champion-titan', 'opponent', null).fidelity).toBe(
      'canonical'
    );
    const missing = resolveChampionAsset(
      lookup({ canonicalStill: () => null }),
      'champion-unknown',
      'player',
      profile
    );
    expect(missing.fidelity).toBe('fallback');
    expect(missing.still).toBeNull();
    expect(missing.walkFrames).toBeNull();
  });
});

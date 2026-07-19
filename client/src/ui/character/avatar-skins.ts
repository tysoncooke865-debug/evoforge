import { useSyncExternalStore } from 'react';
import type { ImageSourcePropType } from 'react-native';

import type { BranchV2 } from '@/domain/branches-v2';
import type { SkinId } from '@/domain/customise';

import type { Sex } from './avatar-art';

/**
 * SKINS (Tyson, 2026-07-16): palette-swap recolours of every delivered art
 * set. 'standard' and any branch without a recoloured set resolve to
 * undefined and the caller falls back to the base art — the skin system can
 * never substitute a missing body.
 *
 * B4 (2026-07-19): the 308 require() entries used to load EAGERLY in the
 * first-paint bundle — every colour, every stage, every line, for athletes
 * who each wear at most one. The tables now live in per-line modules
 * (./skins/*, GENERATED — regenerate, never hand-edit) loaded on FIRST USE
 * via dynamic import: the resolvers stay synchronous (cache-read),
 * returning undefined for the frames a chunk is still in flight — which
 * every caller already treats as "use the base art", the exact fallback
 * seam the skin system was built on. Surfaces that render skins subscribe
 * via useSkinsReady() so the recolour pops in the moment its chunk lands.
 */

type SkinTables = { gifs: Record<string, ImageSourcePropType>; stills: Record<string, ImageSourcePropType> };
type SkinLine = 'aesthetic' | 'mass' | 'titan' | 'cardio' | 'shredder';

const tableCache = new Map<string, SkinTables>();
let femaleCache: Record<string, ImageSourcePropType> | null = null;
const inFlight = new Set<string>();
let version = 0;
const subscribers = new Set<() => void>();
const bump = () => {
  version += 1;
  for (const cb of subscribers) cb();
};

/** Re-render tick for skin-rendering surfaces: bumps when a lazy skin
 *  chunk lands, so the recolour replaces the base-art fallback. */
export function useSkinsReady(): number {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    () => version,
    () => version
  );
}

const LINE_LOADERS: Record<SkinLine, () => Promise<SkinTables>> = {
  aesthetic: async () => {
    const m = await import('./skins/aesthetic');
    return { gifs: m.AESTHETIC_SKIN_GIFS, stills: m.AESTHETIC_SKIN_STILLS };
  },
  mass: async () => {
    const m = await import('./skins/mass');
    return { gifs: m.MASS_SKIN_GIFS, stills: m.MASS_SKIN_STILLS };
  },
  titan: async () => {
    const m = await import('./skins/titan');
    return { gifs: m.TITAN_SKIN_GIFS, stills: m.TITAN_SKIN_STILLS };
  },
  cardio: async () => {
    const m = await import('./skins/cardio');
    return { gifs: m.CARDIO_SKIN_GIFS, stills: m.CARDIO_SKIN_STILLS };
  },
  shredder: async () => {
    const m = await import('./skins/shredder');
    return { gifs: m.SHREDDER_SKIN_GIFS, stills: m.SHREDDER_SKIN_STILLS };
  },
};

/** Which recolour tables a branch draws from — EXPLICIT per line (Titan has
 *  its own body; companionLine's titan→mass borrow is the MOVE SET only,
 *  skins must not follow it). A miss triggers the lazy load. */
function skinTables(branch: BranchV2): SkinTables | null {
  const line = (['aesthetic', 'mass', 'titan', 'cardio', 'shredder'] as const).find((l) => l === branch);
  if (!line) return null;
  const hit = tableCache.get(line);
  if (hit) return hit;
  if (!inFlight.has(line)) {
    inFlight.add(line);
    void LINE_LOADERS[line]()
      .then((tables) => {
        tableCache.set(line, tables);
        bump();
      })
      .catch(() => inFlight.delete(line)); // retry on the next resolve
  }
  return null;
}

function femaleTable(): Record<string, ImageSourcePropType> | null {
  if (femaleCache) return femaleCache;
  if (!inFlight.has('female')) {
    inFlight.add('female');
    void import('./skins/female-aesthetic')
      .then((m) => {
        femaleCache = m.FEMALE_AESTHETIC_SKINS;
        bump();
      })
      .catch(() => inFlight.delete('female'));
  }
  return null;
}

function key(skin: SkinId, stage: number): string {
  return `${skin}-${Math.max(1, Math.min(4, Math.trunc(stage)))}`;
}

/** The recoloured rotation GIF, or undefined → caller uses the base art. */
export function skinnedAnimated(
  branch: BranchV2,
  stage: number,
  sex: Sex,
  skin: SkinId
): ImageSourcePropType | undefined {
  if (skin === 'standard' || sex !== 'male') return undefined;
  return skinTables(branch)?.gifs[key(skin, stage)];
}

/** The recoloured frozen pose (same canvas as the gif). */
export function skinnedStill(
  branch: BranchV2,
  stage: number,
  sex: Sex,
  skin: SkinId
): ImageSourcePropType | undefined {
  if (skin === 'standard' || sex !== 'male') return undefined;
  return skinTables(branch)?.stills[key(skin, stage)];
}

/** The recoloured female painted art (aesthetic line only — the only
 *  delivered female set). */
export function skinnedFemalePainted(
  branch: BranchV2,
  stage: number,
  sex: Sex,
  skin: SkinId
): ImageSourcePropType | undefined {
  if (skin === 'standard' || sex !== 'female' || branch !== 'aesthetic') return undefined;
  return femaleTable()?.[key(skin, stage)];
}

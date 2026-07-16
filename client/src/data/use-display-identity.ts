import type { ImageSourcePropType } from 'react-native';

import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { useAvatarData } from '@/data/use-avatar-data';
import type { DerivedIdentity, ResolvedDisplay } from '@/domain/customise';
import { resolveDisplay } from '@/domain/customise';
import { useLoadoutStore } from '@/state/loadout-store';
import { animatedAvatar, avatarArtV2, stillAvatar, type Sex } from '@/ui/character/avatar-art';
import { skinnedAnimated, skinnedFemalePainted, skinnedStill } from '@/ui/character/avatar-skins';

/**
 * CUSTOMISE (Tyson, 2026-07-16): the athlete's DISPLAY identity — the
 * derived identity with the equipped loadout applied and re-validated
 * against live progression (resolveDisplay). Home's hero and the header
 * companion read this instead of the raw derivation, so an equipped
 * character/stage/skin shows up everywhere at once — and anything whose
 * gates have closed silently falls back to the derived truth.
 */
export interface DisplayIdentity {
  ready: boolean;
  sex: Sex;
  derived: DerivedIdentity;
  display: ResolvedDisplay;
  /** The skin-aware art for the displayed form (base art when standard). */
  animatedSource?: ImageSourcePropType;
  stillSource?: ImageSourcePropType;
  paintedSource: ImageSourcePropType;
  hasArt: boolean;
}

export function useDisplayIdentity(): DisplayIdentity {
  const { ready, branchV2, sex, summary, stats, bfMid, earliestBf, nutritionPhase } = useAvatarData();
  const forge = useForgeProgression();
  const loadout = useLoadoutStore((s) => s.loadout);

  const derived: DerivedIdentity = {
    branch: branchV2,
    level: summary.level,
    bfMid,
    scores: {
      strength: stats.strengthScore,
      size: stats.sizeScore,
      leanness: stats.leannessScore,
      conditioning: stats.conditioningScore,
      aesthetic: stats.aestheticScore,
    },
    ctx: { nutritionPhase, earliestBf },
    forgeLevel: forgeProgressFromRow(forge.data ?? null).level,
  };
  const display = resolveDisplay(derived, loadout);

  const painted =
    skinnedFemalePainted(display.branch, display.stage, sex, display.skinId) ??
    avatarArtV2(display.branch, display.stage, sex).source;

  return {
    ready,
    sex,
    derived,
    display,
    animatedSource:
      skinnedAnimated(display.branch, display.stage, sex, display.skinId) ??
      animatedAvatar(display.branch, display.stage, sex),
    stillSource:
      skinnedStill(display.branch, display.stage, sex, display.skinId) ??
      stillAvatar(display.branch, display.stage, sex),
    paintedSource: painted,
    hasArt: avatarArtV2(display.branch, display.stage, sex).hasArt,
  };
}

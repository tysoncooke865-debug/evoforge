import type { ImageSourcePropType } from 'react-native';

import { useCharacterUnlocks } from '@/data/characters';
import { ORIGIN_FLAGS, useOriginStatus } from '@/data/origin';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { useSkinUnlocks } from '@/data/skins';
import { useAvatarData } from '@/data/use-avatar-data';
import type { DerivedIdentity, ResolvedDisplay } from '@/domain/customise';
import { resolveDisplay, skinKey } from '@/domain/customise';
import { useLoadoutStore } from '@/state/loadout-store';
import { animatedAvatar, avatarArtV2, stillAvatar, type Sex } from '@/ui/character/avatar-art';
import { skinnedAnimated, skinnedFemalePainted, skinnedStill, useSkinsReady } from '@/ui/character/avatar-skins';
import { gymericaAnimated, gymericaStill } from '@/ui/character/gymerica-art';

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
  // B4: repaint when a lazy skin chunk lands (base art shows meanwhile).
  useSkinsReady();
  const { ready, branchV2, sex, summary, stats, bfMid, earliestBf, nutritionPhase } = useAvatarData();
  const forge = useForgeProgression();
  const loadout = useLoadoutStore((s) => s.loadout);
  const unlocks = useSkinUnlocks();
  const ownedSkins = new Set((unlocks.data ?? []).map((u) => skinKey(u.line, u.skin)));
  const charUnlocks = useCharacterUnlocks();
  const ownedCharacters = new Set((charUnlocks.data ?? []).map((u) => u.character));
  const origin = useOriginStatus();

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
    // THE ORIGIN LOCK (Tyson, 2026-07-17): with an Origin assigned,
    // resolveDisplay pins the champion to it — everywhere this hook feeds.
    originPath: ORIGIN_FLAGS.newSchemaReadEnabled ? (origin.data?.origin_path ?? null) : null,
  };
  let display = resolveDisplay(derived, loadout, ownedSkins, ownedCharacters);

  // ORIGIN PATH Release 6 — the DUAL-READ cutover (ORIGIN_PATH_PLAN.md): an
  // account WITH an assigned Origin reads its champion stage from the new
  // schema when it shows the same path — the server record is monotonic
  // (record_path_progress never lowers), so an EARNED stage can never regress
  // even if the legacy level/bf derivation would drop it. Accounts without an
  // origin are untouched: legacy remains their entire read path. Cross-path
  // overrides stay off until Release 5's roster gains an equip action — the
  // dual-write mirror keeps active_path aligned with the derivation anyway.
  if (
    ORIGIN_FLAGS.newSchemaReadEnabled &&
    origin.data?.origin_path != null &&
    origin.data.active_path === display.branch &&
    !display.character &&
    origin.data.active_stage > display.stage
  ) {
    display = { ...display, stage: Math.min(4, origin.data.active_stage) };
  }
  // CROSS-PATH (Tyson 2026-07-18: the ORIGIN champion appears on Home): when
  // the equipped server path DIFFERS from the derivation and no custom skin or
  // premium character is worn, the server champion wins the podium.
  if (
    ORIGIN_FLAGS.newSchemaReadEnabled &&
    origin.data?.origin_path != null &&
    origin.data.active_path != null &&
    origin.data.active_path !== display.branch &&
    !display.character &&
    display.skinId === 'standard'
  ) {
    display = {
      ...display,
      branch: origin.data.active_path as typeof display.branch,
      stage: Math.min(4, Math.max(1, origin.data.active_stage)),
    };
  }

  // PREMIUM OVERLAY: an equipped, owned premium character takes over the
  // rendered art everywhere Home/Forge read this hook — branch/stats below
  // are untouched.
  if (display.character) {
    const { stage, look } = display.character;
    return {
      ready,
      sex,
      derived,
      // Render at the STAGE-4 scale (Tyson, 2026-07-16: "make Gymerica the
      // same size as a stage 4 character") — the growth math keys off
      // display.stage, so a premium hero always shows at full size, never
      // his 1/2 gameplay stage. His ART still comes from the real stage.
      display: { ...display, stage: 4 },
      animatedSource: gymericaAnimated(stage, look),
      stillSource: gymericaStill(stage, look),
      paintedSource: gymericaStill(stage, look),
      hasArt: true,
    };
  }

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

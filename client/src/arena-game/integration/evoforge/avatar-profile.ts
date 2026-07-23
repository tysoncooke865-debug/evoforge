/**
 * Arena Avatar Profile — premium program Phase 5: ONE authoritative visual
 * identity for the athlete's champion inside the Arena, sourced from the
 * SAME resolution the rest of EvoForge renders (use-display-identity's
 * ResolvedDisplay), never re-derived here.
 *
 * Flow: the app-side arena layout (src/app/(main)/forge-arena/_layout.tsx)
 * calls the canonical `useDisplayIdentity()` hook, maps its output through
 * `mapDisplayToArenaProfile`, and PUSHES the result into this store. The
 * arena package therefore needs no import of app hooks/queries — the
 * integration boundary stays one-way, and the Arena keeps ZERO cosmetic
 * ownership state of its own (prompt rule + P13 zero-write contract).
 *
 * The profile is DISPLAY-ONLY: it never enters the battle engine, the
 * digest, or the command log. Battle scaling continues to come from the
 * provider's FitnessProfile (avatarPath/avatarStage), unchanged.
 */
import type { ImageSourcePropType } from 'react-native';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { AvatarPath } from '../../game-engine/types';
import { branchToAvatarPath } from './progression-mapping';

/** Bump when the profile shape changes in a way cached art keys must see. */
export const ARENA_VISUAL_VERSION = 1;

export interface ArenaAvatarProfile {
  /** BranchV2 resolved to the five official Avatar Paths (hybrid folds into
   *  aesthetic; unknown falls back to titan — branchToAvatarPath is the one
   *  mapping authority). This is the DISPLAY branch: origin lock and
   *  cross-path equips are already applied by resolveDisplay upstream. */
  championPath: AvatarPath;
  /** Visual evolution stage 1-4 as displayed app-wide (a premium character
   *  renders at stage-4 scale by design — that is the display truth). */
  evolutionStage: 1 | 2 | 3 | 4;
  /** The stage's player-facing form name (e.g. "Cut Deep"). Display only. */
  formName: string;
  sex: 'male' | 'female';
  /** Equipped skin id ('standard' when none). */
  skinId: string;
  /** Equipped premium character id (e.g. 'gymerica'), or null. */
  premiumCharacter: string | null;
  visualVersion: number;
}

/** The subset of use-display-identity's output the mapping consumes —
 *  structural on purpose so the app side passes its ResolvedDisplay fields
 *  without this package importing app domain types. */
export interface DisplayIdentityInput {
  branch: string;
  stage: number;
  formName: string;
  skinId: string;
  character: { id: string } | null;
  sex: string;
}

function clampStage(stage: number): 1 | 2 | 3 | 4 {
  if (!Number.isFinite(stage)) return 1;
  const s = Math.trunc(stage);
  return (s < 1 ? 1 : s > 4 ? 4 : s) as 1 | 2 | 3 | 4;
}

export function mapDisplayToArenaProfile(input: DisplayIdentityInput): ArenaAvatarProfile {
  return {
    championPath: branchToAvatarPath(input.branch),
    evolutionStage: clampStage(input.stage),
    formName: typeof input.formName === 'string' ? input.formName : '',
    sex: input.sex === 'female' ? 'female' : 'male',
    skinId: input.skinId && typeof input.skinId === 'string' ? input.skinId : 'standard',
    premiumCharacter: input.character?.id ?? null,
    visualVersion: ARENA_VISUAL_VERSION,
  };
}

/** Stable cache/identity key over every field that selects ART (formName is
 *  label-only and deliberately excluded). */
export function arenaProfileKey(p: ArenaAvatarProfile): string {
  return `${p.championPath}|s${p.evolutionStage}|${p.sex}|${p.skinId}|${p.premiumCharacter ?? '-'}|v${p.visualVersion}`;
}

export interface ArenaAvatarState {
  profile: ArenaAvatarProfile | null;
  /** The app's skin/stage-aware still portrait (the SAME art Home shows) —
   *  menus use it so the athlete sees one champion everywhere. Opaque
   *  source; never fed to the battlefield renderer. */
  portraitStill: ImageSourcePropType | null;
}

export const arenaAvatarStore = createStore<ArenaAvatarState>(() => ({
  profile: null,
  portraitStill: null,
}));

/** Idempotent push from the app layout — no-ops when nothing changed so the
 *  store never churns subscribers on unrelated re-renders. */
export function setArenaAvatarProfile(
  profile: ArenaAvatarProfile,
  portraitStill: ImageSourcePropType | null
): void {
  const prev = arenaAvatarStore.getState();
  if (
    prev.profile !== null &&
    arenaProfileKey(prev.profile) === arenaProfileKey(profile) &&
    prev.profile.formName === profile.formName &&
    prev.portraitStill === portraitStill
  ) {
    return;
  }
  arenaAvatarStore.setState({ profile, portraitStill });
}

/** Sign-out teardown (P13: nothing may leak to the next athlete). */
export function clearArenaAvatarProfile(): void {
  arenaAvatarStore.setState({ profile: null, portraitStill: null });
}

export function useArenaAvatar(): ArenaAvatarState {
  return useStore(arenaAvatarStore);
}

/**
 * The profile drives art ONLY for a champion of the athlete's own display
 * path. The arena deliberately lets a player field ANY champion after
 * onboarding (applyProviderIdentity doctrine: their pick is never
 * overridden) — a mismatched profile must not stage/skin someone else's
 * champion (e.g. probing mass stage-3 art because the ATHLETE is an
 * aesthetic stage 3). Callers pass the fielded champion's path.
 */
export function profileForChampionPath(
  profile: ArenaAvatarProfile | null,
  championPath: string
): ArenaAvatarProfile | null {
  return profile !== null && profile.championPath === championPath ? profile : null;
}

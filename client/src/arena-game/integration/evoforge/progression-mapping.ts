/**
 * PURE progression mapping — EvoForge identity/progression data → the
 * Arena's FitnessProfile fields. No supabase, no React: the Supabase
 * provider feeds these functions plain queried values, and tests exercise
 * them directly (plus the provider itself with a mocked client).
 *
 * Stage doctrine (audit HIGH #2): the Arena displays EvoForge's REAL
 * evolution stage — the same derivation `use-avatar-data`/`customise`
 * render — never a parallel forge-level ladder. Locked stages stay locked:
 * every fallback here can only UNDER-state progress, never inflate it.
 *
 * Relative imports into src/domain on purpose: this module must stay
 * loadable by vitest without path-alias configuration.
 */
import { currentStageFor, originAsBranch } from '../../../domain/customise';
import { levelFromLedger } from '../../../domain/xp';
import { seedFromString } from '../../game-engine/random/rng';
import { ALL_AVATAR_PATHS, AvatarPath } from '../../game-engine/types';

/**
 * EvoForge Origin (BranchV2 slug) → Arena Avatar Path. 5 → 5 passthrough:
 * the five live branches ARE the five champions. The retired 'hybrid'
 * origin folds into 'aesthetic' (exactly what resolveBranchV2 does for
 * hybrid-scored athletes); a missing/unknown origin defaults to 'titan'
 * (the Arena's fresh-save default champion).
 */
export function branchToAvatarPath(originPath: string | null | undefined): AvatarPath {
  if (originPath === 'hybrid') return 'aesthetic';
  const branch = originAsBranch(originPath);
  // originAsBranch only admits the five roster slugs (ROSTER_ORDER — which
  // excludes the retired 'hybrid'), so this narrowing is total at runtime;
  // the explicit filter keeps the type honest without a cast.
  if (
    branch === 'aesthetic' ||
    branch === 'titan' ||
    branch === 'mass' ||
    branch === 'shredder' ||
    branch === 'cardio'
  ) {
    return branch;
  }
  return 'titan';
}

/**
 * The LEGACY display level — the level that drives every EvoForge stage
 * ladder (avatarStageRowsV2 / massArtStage / getBranchStage). Derived from
 * the athlete's base level + the xp_events ledger sum (public.xp_total()),
 * via the same pinned curve the app displays (levelFromLedger).
 *
 * Fallback semantics: a null ledger (read failed / not reconciled) yields
 * the base level alone — the stage can only read LOWER than the real one,
 * never higher. (EvoForge's screens additionally floor the ledger at the
 * log-derived XP total; those logs are not available to a pure profile
 * query, so the rare ledger-behind-derived athlete may see an earlier
 * stage in the Arena until the ledger reconciles — documented in
 * ARENA_BETA_AUDIT.md.)
 */
export function deriveLegacyLevel(baseLevel: unknown, ledgerXp: number | null): number {
  return levelFromLedger(baseLevel, ledgerXp ?? 0).level;
}

/**
 * THE real evolution stage for an Avatar Path (1–4 art stages):
 *  - shredder: BODY-FAT-driven (shredderStage via currentStageFor) — bfMid
 *    null (no valid reading) is stage 1, the starting form.
 *  - titan / mass / cardio: the 25/50/75 body spread (massArtStage).
 *  - aesthetic: the pinned core ladder (getBranchStage via the shape donor).
 * Exactly `currentStageFor` from domain/customise — the function the
 * customiser itself renders with. AvatarPath ⊂ BranchV2, so it passes
 * through unchanged.
 */
export function deriveRealStage(
  path: AvatarPath,
  legacyLevel: number,
  bfMid: number | null
): number {
  return currentStageFor(path, legacyLevel, bfMid);
}

/**
 * Latest valid body-fat midpoint from a NEWEST-FIRST series of raw bf_mid
 * values — mirrors useLatestBodyfatMid: only readings > 0 count, the most
 * recent valid one wins, null when none exist.
 */
export function latestValidBfMid(newestFirst: readonly unknown[]): number | null {
  for (const raw of newestFirst) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Deterministic path for gym members whose Origin is not visible to us
 * (gym_detail exposes display_name/forge_level/evo_rating only — RLS).
 * Hashes over the FIVE official paths. An "estimated build", per the audit.
 */
export function pathFromUserId(userId: string): AvatarPath {
  return ALL_AVATAR_PATHS[seedFromString(userId) % ALL_AVATAR_PATHS.length];
}

/**
 * Estimated stage for a gym member from the only progression number the
 * RPC exposes (forge_level). Uses the standard 25/50/75 body spread as an
 * approximation — Forge Level is NOT the legacy level, so this is marked
 * "estimated" wherever it renders (same status as the synthesized path).
 */
export function estimateMemberStage(forgeLevel: number): number {
  const lv = Number.isFinite(forgeLevel) ? Math.trunc(forgeLevel) : 1;
  if (lv >= 75) return 4;
  if (lv >= 50) return 3;
  if (lv >= 25) return 2;
  return 1;
}

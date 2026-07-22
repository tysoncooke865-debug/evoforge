/**
 * SupabaseEvoForgePlayerProvider — the real EvoForge implementation of the
 * Arena's provider boundary (the swap EVOFORGE_INTEGRATION.md was written
 * for). Identity, fitness and gyms come from EvoForge's live data; battle
 * results stay COSMETIC (local rank/stats via the delegate) per the
 * gym-battle precedent — no client-minted XP, no server writes. A reward
 * migration (server-priced xp_ledger kind) is a deliberate later decision.
 *
 * Mapping notes (EvoForge → Arena FitnessProfile; pure functions live in
 * progression-mapping.ts, tested directly):
 *  - Pillars: strength←strength_score, cardio←cardio_score,
 *    muscularity←size_score (EvoForge's SIZE pillar — the field name is
 *    save-compat, all UI copy says Size), aesthetics←aesthetics_score
 *    (evo_rating_current, 1–100); leanness←profiles.leanness_score.
 *  - forgeLevel: derived from user_progression.lifetime_xp via the pinned
 *    forgeProgressFor curve (SQL twin in migration 023).
 *  - avatarPath: profiles.origin_path (BranchV2) passes through 5→5 — the
 *    five live branches ARE the five champions; retired 'hybrid' →
 *    'aesthetic'; missing → 'titan'.
 *  - avatarStage: the REAL evolution stage (audit HIGH #2) — the same
 *    branch-specific derivation the customiser renders: The Shredder's
 *    stage is BODY-FAT-driven (latest bodyfat_log bf_mid > 0); the other
 *    branches use their legacy-level ladders, with the legacy level derived
 *    from profiles.base_level + public.xp_total() (the ledger path). Every
 *    fallback under-states progress, never inflates it.
 *  - Gym members expose forge_level + evo_rating only, so member pillar
 *    ratings are approximated as their evo_rating, their path derives
 *    deterministically from their user id (over the FIVE official paths)
 *    and their stage is estimated from forge_level — a "simplified
 *    fitness-derived build" exactly as the Arena's borrowed-champion spec
 *    allows (rendered as estimated).
 *
 * Every read fails soft to sensible baselines: a broken profile must never
 * block battling (the Arena then plays with neutral scaling).
 */
import { supabase } from '@/data/supabase';
import { forgeProgressFor } from '@/domain/progression/forge-level';
import { AvatarPath } from '../../game-engine/types';
import type { PlayerStore } from '../../services/player-data/player-store';
import { LocalMockPlayerProvider } from './local-mock-provider';
import {
  branchToAvatarPath,
  deriveLegacyLevel,
  deriveRealStage,
  estimateMemberStage,
  latestValidBfMid,
  pathFromUserId,
} from './progression-mapping';
import type {
  BattleResult,
  EvoForgePlayerProvider,
  FitnessProfile,
  GymMemberInfo,
  GymProfile,
  PlayerProfile,
} from './types';

export { branchToAvatarPath } from './progression-mapping';

const BASELINE_RATING = 50;

function clampRating(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : BASELINE_RATING;
  return Math.min(100, Math.max(1, Math.round(n)));
}

function baselineFitness(playerId: string): FitnessProfile {
  return {
    playerId,
    evoRating: BASELINE_RATING,
    strengthRating: BASELINE_RATING,
    cardioRating: BASELINE_RATING,
    muscularityRating: BASELINE_RATING,
    leannessRating: BASELINE_RATING,
    aestheticsRating: BASELINE_RATING,
    forgeLevel: 1,
    avatarPath: 'titan',
    avatarStage: 1,
  };
}

export class SupabaseEvoForgePlayerProvider implements EvoForgePlayerProvider {
  /** Local delegate: rank points + battle stats stay device-local (cosmetic). */
  private readonly local: LocalMockPlayerProvider;
  /** Member fitness cache so getFitnessProfile works for roster ids. */
  private readonly memberFitness = new Map<string, FitnessProfile>();

  constructor(
    private readonly store: PlayerStore,
    private readonly userId: string
  ) {
    this.local = new LocalMockPlayerProvider(store);
  }

  async getCurrentPlayer(): Promise<PlayerProfile> {
    // Rank points and battle stats live in the Arena's local (per-user
    // namespaced) save; identity comes from EvoForge.
    const localProfile = await this.local.getCurrentPlayer();
    let displayName = localProfile.displayName;
    let championId = localProfile.championId;
    try {
      const [{ data: identity }, { data: profile }] = await Promise.all([
        supabase.from('public_profile').select('display_name').limit(10),
        supabase.from('profiles').select('origin_path').limit(1),
      ]);
      const identityRow = identity && identity.length > 0 ? identity[identity.length - 1] : null;
      if (identityRow?.display_name && String(identityRow.display_name).trim()) {
        displayName = String(identityRow.display_name).trim();
      }
      const originPath = profile && profile.length > 0 ? profile[0].origin_path : null;
      if (originPath) {
        // The Origin lock decides the champion — same rule as EvoForge's
        // own battle champion select. 5 → 5: the Origin IS the champion.
        championId = `champion-${branchToAvatarPath(originPath)}`;
      }
    } catch {
      // Fail soft: local identity is always usable.
    }
    return { ...localProfile, playerId: this.userId, displayName, championId };
  }

  async getFitnessProfile(playerId: string): Promise<FitnessProfile> {
    if (playerId !== this.userId) {
      const cached = this.memberFitness.get(playerId);
      if (cached) return { ...cached };
      return baselineFitness(playerId);
    }
    try {
      const [{ data: evo }, { data: profile }, { data: progression }, ledgerXp, bfMid] =
        await Promise.all([
          supabase.from('evo_rating_current').select('*').limit(1),
          supabase.from('profiles').select('leanness_score,origin_path,base_level').limit(1),
          supabase.from('user_progression').select('lifetime_xp').limit(1),
          this.fetchLedgerXp(),
          this.fetchLatestBfMid(),
        ]);
      const evoRow = (evo?.[0] ?? {}) as Record<string, unknown>;
      const profileRow = (profile?.[0] ?? {}) as Record<string, unknown>;
      const lifetimeXp =
        typeof progression?.[0]?.lifetime_xp === 'number' ? progression[0].lifetime_xp : 0;
      const forgeLevel = forgeProgressFor(lifetimeXp).level;
      const avatarPath: AvatarPath = branchToAvatarPath(profileRow.origin_path as string | null);
      // The REAL stage: legacy display level (base_level + XP ledger, pinned
      // curve) drives the level ladders; The Shredder's stage is body-fat-
      // driven. See progression-mapping.ts for the fallback doctrine.
      const legacyLevel = deriveLegacyLevel(profileRow.base_level, ledgerXp);
      return {
        playerId,
        evoRating: clampRating(evoRow.displayed_rating),
        strengthRating: clampRating(evoRow.strength_score),
        cardioRating: clampRating(evoRow.cardio_score),
        // EvoForge's SIZE pillar — field name kept for save compatibility.
        muscularityRating: clampRating(evoRow.size_score),
        aestheticsRating: clampRating(evoRow.aesthetics_score),
        leannessRating: clampRating(profileRow.leanness_score),
        forgeLevel,
        avatarPath,
        avatarStage: deriveRealStage(avatarPath, legacyLevel, bfMid),
      };
    } catch {
      return baselineFitness(playerId);
    }
  }

  /** xp_events summed server-side (public.xp_total()) — null on ANY failure,
   *  never 0 (the useLedgerXp rule). */
  private async fetchLedgerXp(): Promise<number | null> {
    try {
      const { data, error } = await supabase.rpc('xp_total');
      if (error || data === null || data === undefined) return null;
      const n = Number(data);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    } catch {
      return null;
    }
  }

  /** Latest valid bf_mid (> 0) from the newest readings — mirrors
   *  useLatestBodyfatMid. Null (stage 1 / level ladder) on any failure. */
  private async fetchLatestBfMid(): Promise<number | null> {
    try {
      const { data, error } = await supabase
        .from('bodyfat_log')
        .select('bf_mid,timestamp')
        .order('timestamp', { ascending: false })
        .limit(90);
      if (error || !Array.isArray(data)) return null;
      return latestValidBfMid(data.map((r) => (r as Record<string, unknown>).bf_mid));
    } catch {
      return null;
    }
  }

  async getGymProfile(_playerId: string): Promise<GymProfile | null> {
    try {
      const { data, error } = await supabase.rpc('my_gyms');
      if (error || !Array.isArray(data) || data.length === 0) return null;
      const gym = data[0] as { gym_id: string; name: string };
      const members = await this.getGymMembers(gym.gym_id);
      return { gymId: gym.gym_id, name: gym.name, memberIds: members.map((m) => m.playerId) };
    } catch {
      return null;
    }
  }

  async getGymMembers(gymId: string): Promise<GymMemberInfo[]> {
    const { data, error } = await supabase.rpc('gym_detail', { p_gym: gymId });
    const detail = data as
      | { ok?: boolean; members?: { user_id: string; display_name: string; forge_level: number | null; evo_rating: number | null }[] }
      | null;
    if (error || !detail?.members) {
      throw new Error(`unknown gym '${gymId}'`);
    }
    return detail.members.map((member) => {
      const rating = clampRating(member.evo_rating ?? BASELINE_RATING);
      const level = Math.max(1, member.forge_level ?? 1);
      const fitness: FitnessProfile = {
        playerId: member.user_id,
        evoRating: rating,
        strengthRating: rating,
        cardioRating: rating,
        muscularityRating: rating,
        leannessRating: rating,
        aestheticsRating: rating,
        forgeLevel: level,
        // Estimated build: gym_detail exposes no origin/stage inputs (RLS),
        // so path synthesizes over the FIVE official paths and stage
        // estimates from forge_level — see progression-mapping.ts.
        avatarPath:
          member.user_id === this.userId ? branchToAvatarPath(null) : pathFromUserId(member.user_id),
        avatarStage: estimateMemberStage(level),
      };
      this.memberFitness.set(member.user_id, fitness);
      return {
        playerId: member.user_id,
        displayName: member.display_name || 'Athlete',
        fitness,
      };
    });
  }

  async listRivalGyms(): Promise<GymProfile[]> {
    try {
      const [{ data: mine }, { data: discovered, error }] = await Promise.all([
        supabase.rpc('my_gyms'),
        supabase.rpc('discover_gyms', { p_query: '', p_limit: 30 }),
      ]);
      if (error || !Array.isArray(discovered)) return [];
      const myIds = new Set(
        (Array.isArray(mine) ? mine : []).map((g: { gym_id: string }) => g.gym_id)
      );
      return (discovered as { gym_id: string; name: string }[])
        .filter((g) => !myIds.has(g.gym_id))
        .slice(0, 10)
        .map((g) => ({ gymId: g.gym_id, name: g.name, memberIds: [] }));
    } catch {
      return [];
    }
  }

  async recordBattleResult(result: BattleResult): Promise<void> {
    // Cosmetic-only for now (gym-battle precedent): local rank/stats update,
    // no server writes, no XP minting. See the module docstring.
    await this.local.recordBattleResult(result);
  }
}

/**
 * TanStack Query over Supabase: the replacement for all four hand-rolled
 * cache layers in the Streamlit app.
 *
 * Rules carried over:
 *   * Query keys carry the user id. RLS is the real isolation (and the cache
 *     is cleared on sign-out), but per-user keys mean a stale entry can never
 *     even be looked up for the wrong athlete.
 *   * Reads are projected: the same wire columns as Python's load_log --
 *     muscle/volume/estimated_1rm/notes stay off the wire, id stays on it
 *     (update-in-place needs it).
 *   * `useLedgerXp` returns null ON ANY FAILURE, NEVER 0. resolveXp reads null
 *     as "fall back to derived" and 0 as "ledger readable and empty"; reading
 *     a failure as 0 drops the athlete to base level (root CLAUDE.md #13).
 *   * The 2500-row cap matches sb_ops; a heavy user needs the server-side
 *     totals RPC before they need a bigger cap.
 */

import { useQuery } from '@tanstack/react-query';

import type { PhysiqueValues } from '@/domain/avatar-stats-calc';
import type { CardioRow, WorkoutRow } from '@/domain/summary';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

const ROW_CAP = 2500;

export interface ProfileRow {
  id: string;
  height_cm: number | null;
  bodyweight_kg: number | null;
  bench_e1rm: number | null;
  squat_e1rm: number | null;
  training_years: number | null;
  physique_score: number | null;
  leanness_score: number | null;
  base_level: number | null;
  created_at: string | null;
  sex: 'male' | 'female' | null;
  deadlift_e1rm: number | null;
  nutrition_phase: string | null;
  /** 047 program: NULL = legacy user (the origin gate never traps them). */
  origin_path: string | null;
  onboarding_flow_version: number | null;
}

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

/**
 * The athlete's profile row, or null when none exists yet.
 * A SAVED PROFILE ROW IS THE ONBOARDED FLAG — no extra table or column.
 * Latest row wins, matching Python's iloc[-1] on the created_at ordering.
 */
export function useProfile() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['profile', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<ProfileRow | null> => {
      const { data, error } = await supabase
        .from('profile')
        .select('id,height_cm,bodyweight_kg,bench_e1rm,squat_e1rm,training_years,physique_score,leanness_score,base_level,created_at,sex,deadlift_e1rm,nutrition_phase,origin_path,onboarding_flow_version')
        .order('created_at', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      return data.length > 0 ? (data[data.length - 1] as ProfileRow) : null;
    },
  });
}

/** The one workout_log read, shared by the query and by useSaveSet's
 *  cache-miss fallback (an empty cache must mean "no sets", never "not
 *  loaded yet" — a cold-cache save that guesses sees an existing set as
 *  new and double-grants XP). */
export async function fetchWorkoutLog(): Promise<WorkoutRow[]> {
  const { data, error } = await supabase
    .from('workout_log')
    .select('id,date,workout,exercise,set,weight,reps,timestamp')
    .order('timestamp', { ascending: true })
    .limit(ROW_CAP);
  if (error) throw error;
  return data as WorkoutRow[];
}

export function useWorkoutLog() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['workout_log', userId],
    enabled: userId !== null,
    queryFn: fetchWorkoutLog,
  });
}

export function useCardioLog() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['cardio_log', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<CardioRow[]> => {
      const { data, error } = await supabase
        .from('cardio_log')
        .select('id,date,type,minutes,distance_km,timestamp')
        .order('timestamp', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      return data as CardioRow[];
    },
  });
}

/** The latest positive reading per tape field — a sparse table where every
 *  row fills only what was measured, so "latest" is per COLUMN, not per row. */
export function useLatestMeasurements() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['measurements_latest', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from('measurements')
        .select('neck_cm,shoulders_cm,chest_cm,bicep_cm,waist_cm,hips_cm,thigh_cm,calf_cm,bodyweight,timestamp')
        .order('timestamp', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      const latest: Record<string, number> = {};
      for (const row of (data ?? []) as Record<string, unknown>[]) {
        for (const [key, value] of Object.entries(row)) {
          if (key === 'timestamp') continue;
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) latest[key] = n;
        }
      }
      return latest;
    },
  });
}

/** The athlete's ACTIVE AI plan: newest plan_name's rows, regrouped. */
export function useCustomPlan() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['custom_workout_plan', userId],
    enabled: userId !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('custom_workout_plan')
        .select('id,plan_name,workout,exercise,sets,reps,reason,day_goal,timestamp')
        .order('timestamp', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      const { groupPlanRows } = await import('@/domain/custom-plan');
      return groupPlanRows((data ?? []) as never[]);
    },
  });
}

/** XP granted by the SERVER (battle, adjustment…) — the legitimate part of
 *  ledger-over-derived. Null on failure, same rule as useLedgerXp. */
export function useServerGrantedXp() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['xp_server_granted', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<number | null> => {
      try {
        const { data, error } = await supabase
          .from('xp_events')
          .select('kind,amount')
          .not('kind', 'in', '("set","cardio")')
          .limit(ROW_CAP);
        if (error) return null;
        return (data ?? []).reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
      } catch {
        return null;
      }
    },
  });
}

export function useBodyweightLog() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['bodyweight_log', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<{ date: string; bodyweight: number; timestamp: string }[]> => {
      const { data, error } = await supabase
        .from('bodyweight_log')
        .select('id,date,bodyweight,timestamp')
        .order('timestamp', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      return data as { date: string; bodyweight: number; timestamp: string }[];
    },
  });
}

/** The validated bf_mid series (bf_mid > 0 only, oldest → newest). ONE
 *  fetch and cache entry — latest/earliest derive via select, so screens
 *  that need both (every avatar screen) cost one round-trip, not two
 *  byte-identical ones. Sharing the key also means the write invalidation
 *  in ai.tsx refreshes BOTH derivations: under split keys the first-ever
 *  reading left the earliest (Shredder entry) stale until a refocus. */
function useBodyfatSeries<T>(select: (valid: number[]) => T) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['bodyfat_series', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<number[]> => {
      const { data, error } = await supabase
        .from('bodyfat_log')
        .select('id,bf_mid,timestamp')
        .order('timestamp', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      return data.map((r) => Number(r.bf_mid)).filter((v) => Number.isFinite(v) && v > 0);
    },
    select,
  });
}

/** Latest body-fat midpoint, or null. Mirrors latest_bodyfat_mid(): only rows
 *  with bf_mid > 0 count, last one wins. */
export function useLatestBodyfatMid() {
  return useBodyfatSeries((valid) => (valid.length > 0 ? valid[valid.length - 1] : null));
}

/** First-ever body-fat midpoint — the athlete's STARTING condition (drives
 *  Shredder entry). Same validity rule as the latest: bf_mid > 0 only. */
export function useEarliestBodyfat() {
  return useBodyfatSeries((valid) => (valid.length > 0 ? valid[0] : null));
}

/** Latest AI physique rating values, each null when absent or non-numeric.
 *  Mirrors latest_physique_rating_values(). */
export function usePhysiqueRatings() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['physique_ratings', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<PhysiqueValues> => {
      const { data, error } = await supabase
        .from('physique_ratings')
        .select('id,physique_score,leanness_score,symmetry_score,muscularity_score,timestamp')
        .order('timestamp', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      const num = (v: unknown) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const row = (data.length > 0 ? data[data.length - 1] : {}) as Record<string, unknown>;
      return {
        physique_score: num(row.physique_score),
        leanness_score: num(row.leanness_score),
        symmetry_score: num(row.symmetry_score),
        muscularity_score: num(row.muscularity_score),
      };
    },
  });
}

/**
 * xp_events summed server-side by public.xp_total() (migrations/003).
 * null on ANY failure — never 0. See the header block.
 */
export function useLedgerXp() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['xp_total', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<number | null> => {
      try {
        const { data, error } = await supabase.rpc('xp_total');
        if (error || data === null || data === undefined) {
          return null;
        }
        const n = Number(data);
        return Number.isFinite(n) ? Math.trunc(n) : null;
      } catch {
        return null;
      }
    },
  });
}

/** All achievement rows this athlete holds (for the Awards screen + sweeps). */
export function useAchievements() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['achievements', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<{ achievement_id: string; date_unlocked: string | null }[]> => {
      const { data, error } = await supabase
        .from('achievements')
        .select('id,achievement_id,date_unlocked')
        .limit(ROW_CAP);
      if (error) throw error;
      return data as { achievement_id: string; date_unlocked: string | null }[];
    },
  });
}

/** This user's opt-in public identity: (display_name, is_public). */
export function usePublicIdentity() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['public_profile', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<{ displayName: string | null; isPublic: boolean }> => {
      const { data, error } = await supabase
        .from('public_profile')
        .select('display_name,is_public,updated_at')
        .limit(ROW_CAP);
      if (error) return { displayName: null, isPublic: false }; // pre-004 shape
      if (!data || data.length === 0) return { displayName: null, isPublic: false };
      const row = data[data.length - 1];
      const name = row.display_name && String(row.display_name).trim() ? String(row.display_name) : null;
      return { displayName: name, isPublic: Boolean(row.is_public) };
    },
  });
}

/** The ONE cross-user read surface: leaderboard_top() RPC, [] on any failure. */
export function useLeaderboardTop(n = 50) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['leaderboard_top', userId, n],
    enabled: userId !== null,
    queryFn: async (): Promise<import('@/domain/leaderboard').LeaderboardRow[]> => {
      try {
        const { data, error } = await supabase.rpc('leaderboard_top', { n });
        if (error || !Array.isArray(data)) return [];
        return data;
      } catch {
        return [];
      }
    },
  });
}

export interface TargetRow {
  id: string;
  target_type: string;
  name: string;
  target_value: number;
  unit: string | null;
  created_at: string | null;
  notes: string | null;
}

export function useTargets() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['targets', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<TargetRow[]> => {
      const { data, error } = await supabase
        .from('targets')
        .select('id,target_type,name,target_value,unit,created_at,notes')
        .order('created_at', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      return data as TargetRow[];
    },
  });
}

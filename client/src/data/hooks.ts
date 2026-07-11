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
        .select('id,height_cm,bodyweight_kg,bench_e1rm,squat_e1rm,training_years,physique_score,leanness_score,base_level,created_at')
        .order('created_at', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      return data.length > 0 ? (data[data.length - 1] as ProfileRow) : null;
    },
  });
}

export function useWorkoutLog() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['workout_log', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<WorkoutRow[]> => {
      const { data, error } = await supabase
        .from('workout_log')
        .select('id,date,workout,exercise,set,weight,reps,timestamp')
        .order('timestamp', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      return data as WorkoutRow[];
    },
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

/** Latest body-fat midpoint, or null. Mirrors latest_bodyfat_mid(): only rows
 *  with bf_mid > 0 count, last one wins. */
export function useLatestBodyfatMid() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['bodyfat_mid', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from('bodyfat_log')
        .select('id,bf_mid,timestamp')
        .order('timestamp', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      const valid = data.map((r) => Number(r.bf_mid)).filter((v) => Number.isFinite(v) && v > 0);
      return valid.length > 0 ? valid[valid.length - 1] : null;
    },
  });
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

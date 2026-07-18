import { useQuery } from '@tanstack/react-query';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * ORACLE_REDESIGN — the STORED history seams. Photos are never persisted, so
 * the Oracle's timeline and its before/current comparison read the saved
 * VERDICTS (physique_ratings, bodyfat_log) — never images. Dated rows, oldest
 * first, so scanProgress can diff first↔latest and the timeline can reverse
 * for newest-first display.
 */

const ROW_CAP = 2500;

export interface PhysiqueHistoryRow {
  id: string;
  physique_score: number | null;
  leanness_score: number | null;
  symmetry_score: number | null;
  muscularity_score: number | null;
  timestamp: string;
}

export interface BodyfatHistoryRow {
  id: string;
  bf_mid: number | null;
  timestamp: string;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function useUserId(): string | null {
  const { session } = useAuth();
  return session?.user?.id ?? null;
}

/** Every physique verdict, oldest → newest. */
export function usePhysiqueHistory() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['physique_history', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<PhysiqueHistoryRow[]> => {
      const { data, error } = await supabase
        .from('physique_ratings')
        .select('id,physique_score,leanness_score,symmetry_score,muscularity_score,timestamp')
        .order('timestamp', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: String((r as { id: unknown }).id),
        physique_score: num((r as Record<string, unknown>).physique_score),
        leanness_score: num((r as Record<string, unknown>).leanness_score),
        symmetry_score: num((r as Record<string, unknown>).symmetry_score),
        muscularity_score: num((r as Record<string, unknown>).muscularity_score),
        timestamp: String((r as { timestamp: unknown }).timestamp),
      }));
    },
  });
}

/** Every body-fat estimate, oldest → newest (bf_mid > 0 only). */
export function useBodyfatHistory() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['bodyfat_history', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<BodyfatHistoryRow[]> => {
      const { data, error } = await supabase
        .from('bodyfat_log')
        .select('id,bf_mid,timestamp')
        .order('timestamp', { ascending: true })
        .limit(ROW_CAP);
      if (error) throw error;
      return (data ?? [])
        .map((r) => ({
          id: String((r as { id: unknown }).id),
          bf_mid: num((r as Record<string, unknown>).bf_mid),
          timestamp: String((r as { timestamp: unknown }).timestamp),
        }))
        .filter((r) => r.bf_mid !== null && r.bf_mid > 0);
    },
  });
}

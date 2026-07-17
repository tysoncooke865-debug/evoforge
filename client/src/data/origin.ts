import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * ORIGIN PATH client layer (Releases 4+5, ORIGIN_PATH_PLAN.md). One flow for
 * everyone: origin unset + classification possible → the reveal (with a choice
 * when scores are close); classification not yet possible → the discover
 * banner. Feature flags per the spec's Phase 12 — flip to false to pull the
 * UI without a deploy of the data layer.
 */
export const ORIGIN_FLAGS = {
  originRevealEnabled: true,
  pathRosterEnabled: true,
  /** Release 6 dual-read: accounts WITH an origin read their champion from
   *  the new schema (profile.active_path/active_stage, monotonic server
   *  record); accounts without one stay entirely on legacy. */
  newSchemaReadEnabled: true,
};

export const PATH_NAMES: Record<string, string> = {
  aesthetic: 'Elite Aesthetic',
  mass: 'Mass Monster',
  titan: 'Titan',
  cardio: 'Apex Engine',
  shredder: 'Shredder',
};

export interface OriginStatus {
  origin_path: string | null;
  active_path: string | null;
  active_stage: number;
  migration_status: string;
}

export function useOriginStatus() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['origin_status', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<OriginStatus | null> => {
      const { data, error } = await supabase
        .from('profile')
        .select('origin_path,active_path,active_stage,migration_status')
        .limit(1);
      if (error) throw error;
      return (data?.[0] as OriginStatus) ?? null;
    },
  });
}

export interface Classification {
  ok: boolean;
  reason?: string;
  recommended_path?: string;
  scores?: Record<string, number>;
  /** v3: score − per-pillar baseline. The RANKING rides these, not the raw
   *  scores — pillars are scored on different effective scales. */
  affinities?: Record<string, number>;
  /** v3: evidenced pillars in affinity order — the display order. */
  ranking?: string[];
  requires_choice?: boolean;
  choices?: string[];
  shredder_eligible?: boolean;
  /** v3: cutting phase + high body fat → The Shredder outright. */
  shredder_auto?: boolean;
  confidence?: number;
}

/** Only fetched while the origin is unset. */
export function useClassification(enabled: boolean) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['origin_classification', userId],
    enabled: enabled && userId !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Classification> => {
      const { data, error } = await supabase.rpc('classify_evo_path');
      if (error) throw error;
      return data as Classification;
    },
  });
}

export function useAssignOrigin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (path: string): Promise<{ ok: boolean; reason?: string }> => {
      const { data, error } = await supabase.rpc('assign_origin_path', { p_path: path });
      if (error) throw new Error('Could not claim your Origin. Try again.');
      return data as { ok: boolean; reason?: string };
    },
    onSuccess: (r, path) => {
      if (!r.ok) {
        useToastStore.getState().push({ kind: 'error', title: 'NOT CLAIMED', subtitle: r.reason ?? 'Try again.' });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['origin_status'] });
      void queryClient.invalidateQueries({ queryKey: ['user_paths'] });
      useToastStore.getState().push({
        kind: 'achievement',
        title: 'ORIGIN PATH DISCOVERED',
        subtitle: `${PATH_NAMES[path] ?? path} — Stage 1 unlocked`,
      });
    },
    onError: (e: Error) => useToastStore.getState().push({ kind: 'error', title: 'NOT CLAIMED', subtitle: e.message }),
  });
}

export interface UserPathRow {
  path: string;
  current_stage: number;
  is_origin: boolean;
  is_unlocked: boolean;
}

export function useUserPaths() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['user_paths', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<UserPathRow[]> => {
      const { data, error } = await supabase
        .from('user_paths')
        .select('path,current_stage,is_origin,is_unlocked')
        .order('is_origin', { ascending: false });
      if (error) throw error;
      return (data ?? []) as UserPathRow[];
    },
  });
}

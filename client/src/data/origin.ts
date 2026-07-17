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
  /** Origin-in-onboarding (047 program): new-flow users (profile
   *  onboarding_flow_version >= 2) cannot reach Home origin-less — the
   *  (main) gate returns them to /onboarding's Act II. Legacy users (no
   *  flow version) are untouched. */
  originOnboardingEnabled: true,
  /** The Forge reveal renders the v5 three-candidate experience instead of
   *  the v4 choice chips (existing users' introduction flow). */
  candidateRevealEnabled: true,
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

/* ------------------------------------------------------------------ */
/* Candidate model v5 (migration 047) — see docs/ORIGIN_*.md           */
/* ------------------------------------------------------------------ */

export interface OriginCandidatePayload {
  originId: string;
  recommendationType: 'resonant' | 'destined' | 'anomaly';
  score: number;
  reasonCodes: string[];
  currentStrengthMatch: number;
  goalAlignment: number;
  playstyleAlignment: number;
}

export interface OriginCandidatesResult {
  ok: boolean;
  reason?: string;
  candidates?: OriginCandidatePayload[];
  recommended_origin?: string;
  candidate_model_version?: number;
  evo_rating?: number | null;
  input_snapshot_kind?: 'evidence' | 'self_report' | 'mixed';
  resonantSource?: string;
}

/** The server's authoritative candidate generation. Only fetched while the
 *  origin is unset; the bind RPC re-generates server-side at claim time, so
 *  a stale render can never widen the set. */
export function useOriginCandidates(enabled: boolean) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['origin_candidates', userId],
    enabled: enabled && userId !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<OriginCandidatesResult> => {
      const { data, error } = await supabase.rpc('origin_candidates');
      if (error) throw error;
      return data as OriginCandidatesResult;
    },
  });
}

export interface BindResult {
  ok: boolean;
  reason?: string;
  origin_path?: string;
  stage?: number;
  champion?: string;
  firstbound?: string;
  followed_recommendation?: boolean;
  /** already_assigned is success-shaped: a retry after a landed bind. */
  already?: boolean;
}

/** v5 binding. Idempotency contract: `already_assigned` (double-tap, retry
 *  after network loss, second device) is treated as SUCCESS — the server
 *  advisory lock + write-once origin means exactly one bind ever lands. */
export function useBindOrigin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (path: string): Promise<BindResult> => {
      const { data, error } = await supabase.rpc('assign_origin_path', { p_path: path });
      if (error) throw new Error('network');
      const r = data as BindResult;
      if (!r.ok && r.reason !== 'already_assigned') return r;
      return { ...r, ok: true, already: r.reason === 'already_assigned' };
    },
    onSuccess: (r) => {
      if (!r.ok) return;
      void queryClient.invalidateQueries({ queryKey: ['origin_status'] });
      void queryClient.invalidateQueries({ queryKey: ['user_paths'] });
      void queryClient.invalidateQueries({ queryKey: ['origin_candidates'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export interface ReforgeStatus {
  ok: boolean;
  reason?: string;
  granted?: boolean;
  already_granted?: boolean;
  used?: boolean;
  days?: number;
  days_remaining?: number;
}

/** One free Reforge after 3 valid post-binding workout days (server-proved). */
export function useClaimReforge() {
  return useMutation({
    mutationFn: async (): Promise<ReforgeStatus> => {
      const { data, error } = await supabase.rpc('claim_free_reforge');
      if (error) throw new Error('network');
      return data as ReforgeStatus;
    },
  });
}

export function useReforgeOrigin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (path: string): Promise<BindResult & { previous_origin?: string }> => {
      const { data, error } = await supabase.rpc('reforge_origin', { p_path: path });
      if (error) throw new Error('network');
      return data as BindResult & { previous_origin?: string };
    },
    onSuccess: (r) => {
      if (!r.ok) return;
      void queryClient.invalidateQueries({ queryKey: ['origin_status'] });
      void queryClient.invalidateQueries({ queryKey: ['user_paths'] });
      void queryClient.invalidateQueries({ queryKey: ['origin_candidates'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

/**
 * FIRST MISSION (docs/ORIGIN_ONBOARDING_SPEC.md §6) — client-side rider,
 * never blocking. If the athlete skipped the split step in Act I (no
 * workout_schedule row exists), binding seeds the origin's recommended
 * split ROTATED so today is training day 1. An athlete who chose a split
 * keeps theirs — this does nothing.
 */
export async function seedFirstMissionIfNeeded(originId: string): Promise<void> {
  try {
    const { data: existing, error } = await supabase
      .from('workout_schedule')
      .select('effective_from')
      .limit(1);
    if (error || (existing ?? []).length > 0) return;
    const { originSplitFor, rotateScheduleToToday } = await import('@/domain/origin/first-mission');
    const { seedPlanForSplit } = await import('@/domain/exercise-library');
    const { saveUserPlanDirect } = await import('./user-plans');
    const { todayIso } = await import('@/domain/today');
    const splitKey = originSplitFor(originId as never);
    const seed = seedPlanForSplit(splitKey);
    if (seed) {
      await saveUserPlanDirect('custom', { plan_name: seed.plan_name, days: seed.days });
    }
    const week = rotateScheduleToToday(splitKey, new Date().getUTCDay());
    if (week) {
      await supabase
        .from('workout_schedule')
        .upsert({ effective_from: todayIso(), plan: week }, { onConflict: 'user_id,effective_from' });
    }
  } catch {
    /* a system without a backend is hidden, never mocked — mission derives
       from real rows; a failed seed just means the built-in routine shows */
  }
}

/**
 * ORIGIN EVOLUTION PATH — the client data layer.
 *
 * Every write goes through a `security definer` RPC; there is no direct
 * table write anywhere in the app, because the progression rules live in
 * migration 131 and must be unbypassable. This file is transport and cache
 * invalidation only — it contains no progression logic, deliberately.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { progressionFeatures } from '@/data/progression/features';
import type {
  ApplyWorkoutResult,
  ChapterId,
  OriginId,
  OriginLevel,
  OriginPathState,
} from '@/domain/origin-path/types';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

export const ORIGIN_PATH_QUERY_KEY = 'origin_path_state';

/* ------------------------------------------------------------------ */
/* Feature flag                                                        */
/* ------------------------------------------------------------------ */

/**
 * `evolution_path_beta`, resolved for THIS athlete.
 *
 * TWO GATES, and both must pass:
 *   1. `progressionFeatures.evolutionPathEnabled` — a build constant, the
 *      instant kill switch. Flipping it false pulls the UI in the next
 *      deploy without touching the database, and recorded progress is
 *      untouched (the tables and the trigger keep working).
 *   2. `app_flag_enabled('evolution_path_beta')` — the remote per-athlete
 *      gate on the existing command_flags framework (migration 132).
 *
 * A FAILED FLAG READ IS `false`. An unreachable network must not roll a
 * beta out to everyone.
 */
export function useEvolutionPathBeta() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['app_flag', 'evolution_path_beta', userId],
    enabled: userId !== null && progressionFeatures.evolutionPathEnabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc('app_flag_enabled', { p_key: 'evolution_path_beta' });
      if (error) return false;
      return data === true;
    },
  });
}

/** The one boolean the UI branches on. Pending reads as OFF — the old
 *  experience is the safe thing to show while we do not know. */
export function useEvolutionPathEnabled(): boolean {
  const flag = useEvolutionPathBeta();
  return progressionFeatures.evolutionPathEnabled && flag.data === true;
}

/* ------------------------------------------------------------------ */
/* Read model                                                          */
/* ------------------------------------------------------------------ */

interface RawState {
  ok?: boolean;
  has_path?: boolean;
  origin_path_id?: string | null;
  status?: string;
  current_level?: number;
  active_chapter?: number;
  active_week?: number;
  qualified_weeks?: number;
  selected_training_days?: number[] | null;
  started_at?: string | null;
  first_workout_completed_at?: string | null;
  this_week?: {
    week_start: string;
    planned_sessions: number;
    required_sessions: number;
    completed_sessions: number;
    qualified_at: string | null;
  } | null;
  next_reward?: {
    reward_id: string;
    kind: string;
    label: string;
    description: string | null;
    week_index: number;
  } | null;
  unlocked_rewards?: {
    reward_id: string;
    kind: string;
    label: string;
    week_index: number;
    unlocked_at: string;
    claimed_at: string | null;
  }[];
}

function toState(raw: RawState | null): OriginPathState | null {
  if (!raw || raw.ok === false) return null;
  if (!raw.has_path) {
    return {
      ok: true,
      hasPath: false,
      originPathId: null,
      status: 'active',
      currentLevel: 0,
      activeChapter: 1,
      activeWeek: 1,
      qualifiedWeeks: 0,
      selectedTrainingDays: [],
      startedAt: null,
      firstWorkoutCompletedAt: null,
      thisWeek: null,
      nextReward: null,
      unlockedRewards: [],
    };
  }
  return {
    ok: true,
    hasPath: true,
    originPathId: (raw.origin_path_id ?? null) as OriginId | null,
    status: (raw.status ?? 'active') as OriginPathState['status'],
    currentLevel: (raw.current_level ?? 0) as OriginLevel,
    activeChapter: (raw.active_chapter ?? 1) as ChapterId,
    activeWeek: raw.active_week ?? 1,
    qualifiedWeeks: raw.qualified_weeks ?? 0,
    selectedTrainingDays: raw.selected_training_days ?? [],
    startedAt: raw.started_at ?? null,
    firstWorkoutCompletedAt: raw.first_workout_completed_at ?? null,
    thisWeek: raw.this_week
      ? {
          weekStart: raw.this_week.week_start,
          plannedSessions: raw.this_week.planned_sessions,
          requiredSessions: raw.this_week.required_sessions,
          completedSessions: raw.this_week.completed_sessions,
          qualifiedAt: raw.this_week.qualified_at,
        }
      : null,
    nextReward: raw.next_reward
      ? {
          rewardId: raw.next_reward.reward_id,
          kind: raw.next_reward.kind as OriginPathState['unlockedRewards'][number]['kind'],
          label: raw.next_reward.label,
          description: raw.next_reward.description,
          weekIndex: raw.next_reward.week_index,
        }
      : null,
    unlockedRewards: (raw.unlocked_rewards ?? []).map((r) => ({
      rewardId: r.reward_id,
      kind: r.kind as OriginPathState['unlockedRewards'][number]['kind'],
      label: r.label,
      weekIndex: r.week_index,
      unlockedAt: r.unlocked_at,
      claimedAt: r.claimed_at,
    })),
  };
}

/**
 * The whole Path state in one round trip. Every surface (Home summary, the
 * Path page, the post-workout screen) reads this one query, so they can
 * never disagree about the week or the level.
 */
export function useOriginPathState() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const enabled = useEvolutionPathEnabled();
  return useQuery({
    queryKey: [ORIGIN_PATH_QUERY_KEY, userId],
    enabled: userId !== null && enabled,
    queryFn: async (): Promise<OriginPathState | null> => {
      const { data, error } = await supabase.rpc('origin_path_state');
      // A MISSING TABLE OR FUNCTION IS NOT A CRASH. The client can ship
      // before the migration is applied (they are separate, hand-applied
      // steps here) — that must degrade to "no path yet", not a red screen.
      if (error) {
        if (/does not exist|schema cache|PGRST202|PGRST205/i.test(error.message)) return null;
        throw error;
      }
      return toState(data as RawState);
    },
  });
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/** Create (or re-point, while still Dormant) the athlete's path. Idempotent
 *  server-side, so onboarding may call it as often as it likes. */
export function useStartOriginPath() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (input: { path: OriginId; trainingDays?: number[] }) => {
      const { data, error } = await supabase.rpc('origin_path_start', {
        p_path: input.path,
        p_training_days: input.trainingDays ?? [],
      });
      if (error) throw new Error(error.message || 'network');
      return data as { ok: boolean; reason?: string; created?: boolean };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ORIGIN_PATH_QUERY_KEY, userId] });
    },
  });
}

function toResult(raw: Record<string, unknown> | null): ApplyWorkoutResult | null {
  if (!raw) return null;
  return {
    ok: raw.ok === true,
    applied: raw.applied === true,
    reason: (raw.reason as string) ?? undefined,
    originPathId: (raw.origin_path_id ?? null) as OriginId | null,
    currentLevel: (Number(raw.current_level ?? 0) || 0) as OriginLevel,
    levelUnlocked: raw.level_unlocked == null ? null : ((Number(raw.level_unlocked) || 0) as OriginLevel),
    awakened: raw.awakened === true,
    qualifiedWeeks: Number(raw.qualified_weeks ?? 0) || 0,
    activeWeek: Number(raw.active_week ?? 1) || 1,
    activeChapter: (Number(raw.active_chapter ?? 1) || 1) as ChapterId,
    weekCompletedSessions: Number(raw.week_completed_sessions ?? 0) || 0,
    weekRequiredSessions: Number(raw.week_required_sessions ?? 0) || 0,
    weekQualified: raw.week_qualified === true,
    rewardsUnlocked: Array.isArray(raw.rewards_unlocked)
      ? (raw.rewards_unlocked as Record<string, string>[]).map((r) => ({
          rewardId: r.reward_id,
          kind: r.kind as ApplyWorkoutResult['rewardsUnlocked'][number]['kind'],
          label: r.label,
        }))
      : [],
  };
}

/**
 * Apply a finished workout and READ THE RESULT.
 *
 * The database trigger has almost certainly already applied it (that is the
 * exactly-once guarantee, and it covers the offline queue too). This call
 * exists so the post-workout screen has a structured answer to render, and
 * it is safe precisely because a second application is impossible: the
 * server returns `applied: false, reason: 'already_applied'` with the
 * current state, which renders identically.
 */
export function useApplyWorkoutToPath() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (sessionId: string): Promise<ApplyWorkoutResult | null> => {
      const { data, error } = await supabase.rpc('origin_path_apply_workout', { p_session_id: sessionId });
      if (error) {
        if (/does not exist|schema cache|PGRST202/i.test(error.message)) return null;
        throw new Error(error.message || 'network');
      }
      return toResult(data as Record<string, unknown>);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ORIGIN_PATH_QUERY_KEY, userId] });
    },
  });
}

/** Pause / resume. Illness, shift work and injury cost nothing. */
export function useSetPathStatus() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: async (status: 'active' | 'paused') => {
      const { data, error } = await supabase.rpc('origin_path_set_status', { p_status: status });
      if (error) throw new Error(error.message || 'network');
      return data as { ok: boolean; status?: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ORIGIN_PATH_QUERY_KEY, userId] });
    },
  });
}

/**
 * Resolve the workout_sessions id for a finished (date, workout).
 *
 * The finish mutation is optimistic: its cache row may carry a `pending:` id
 * that exists only on the device. The post-workout screen needs the REAL id
 * to ask the server for a progression result, so it reads it back. Returns
 * null while the insert is still in flight or the athlete is offline — the
 * caller shows the workout summary without a path panel, which is the
 * correct degraded state.
 */
export async function resolveSessionId(date: string, workout: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('date', date)
    .eq('workout', workout)
    .limit(1);
  if (error) return null;
  return (data?.[0]?.id as string) ?? null;
}

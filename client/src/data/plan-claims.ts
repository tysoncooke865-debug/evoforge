import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * TRAIN EARLY — the claims layer (migration 194, 2026-08-10).
 *
 * A CLAIM says: "the session the plan scheduled for Wednesday, I trained on
 * Monday." It carries both dates, because both are true and the app needs
 * each — `planned_date` to stop offering that day, `completed_date` to say
 * where it went.
 *
 * WHAT A CLAIM IS NOT: it is not the workout. The sets, the finish marker, the
 * XP and the streak all live on the day the athlete actually trained, written
 * by the paths that have always written them. This table only answers the
 * schedule's question — "is this day still owed?" — which is why turning the
 * feature on could not disturb a single existing number.
 *
 * DEGRADES TO [] WHILE THE TABLE DOES NOT EXIST, like routines and
 * user_exercises: the client ships before the migration is applied by hand,
 * and "no claims" is exactly what an athlete who has never trained early
 * sees. That is safe here in a way it is NOT for the XP ledger — an absent
 * ledger means "unknown", and rendering unknown as zero wipes a character;
 * an absent claim list means "nothing has been moved", which is the truth for
 * almost everyone almost always.
 */

export interface PlanSessionClaim {
  id: string;
  planned_date: string;
  workout: string;
  completed_date: string;
}

const KEY = (userId: string | null) => ['plan_session_claims', userId];

export function usePlanSessionClaims() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: KEY(userId),
    enabled: userId !== null,
    queryFn: async (): Promise<PlanSessionClaim[]> => {
      const { data, error } = await supabase
        .from('plan_session_claims')
        .select('id,planned_date,workout,completed_date');
      if (error) {
        // ONLY "the table isn't there yet" degrades to empty. Everything else
        // throws, so a transient blip keeps the last good data instead of
        // silently re-offering a session the athlete already trained.
        if (/does not exist|schema cache|PGRST205/i.test(error.message)) return [];
        throw error;
      }
      return (data ?? []) as PlanSessionClaim[];
    },
  });
}

/**
 * Claim a planned session for a day the athlete is training it instead.
 *
 * OPTIMISTIC, because the future card must change under the thumb that tapped
 * it — the athlete is already walking to the rack. A failure rolls the card
 * back and says so rather than leaving a lie on screen.
 */
export function useClaimPlanSession() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (input: { plannedDate: string; workout: string; completedDate: string }) => {
      const { error } = await supabase.from('plan_session_claims').insert({
        planned_date: input.plannedDate,
        workout: input.workout,
        completed_date: input.completedDate,
      });
      // Claiming twice IS claimed. The unique index is the authority, and a
      // double tap on a slow network must not raise an error about a thing
      // that is true.
      if (error && !/duplicate|unique|already exists/i.test(error.message)) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: KEY(userId) });
      const prev = queryClient.getQueryData<PlanSessionClaim[]>(KEY(userId)) ?? [];
      if (!prev.some((c) => c.planned_date === input.plannedDate && c.workout === input.workout)) {
        queryClient.setQueryData<PlanSessionClaim[]>(KEY(userId), [
          ...prev,
          {
            id: `pending:${input.plannedDate}|${input.workout}`,
            planned_date: input.plannedDate,
            workout: input.workout,
            completed_date: input.completedDate,
          },
        ]);
      }
      return { prev };
    },
    onError: (e: Error, _input, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(KEY(userId), ctx.prev);
      useToastStore.getState().push({
        kind: 'error',
        title: 'NOT MOVED',
        subtitle: e.message,
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: KEY(userId) });
    },
  });
}

/** PUT IT BACK — the undo. Deleting by (planned_date, workout) rather than by
 *  id, because an optimistic row's id is a `pending:` placeholder the server
 *  has never heard of, and (planned_date, workout) is the claim's real
 *  identity anyway — it is what 194's unique index keys on. */
export function useReleasePlanSession() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (input: { plannedDate: string; workout: string }) => {
      const { error } = await supabase
        .from('plan_session_claims')
        .delete()
        .eq('planned_date', input.plannedDate)
        .eq('workout', input.workout);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: KEY(userId) });
      const prev = queryClient.getQueryData<PlanSessionClaim[]>(KEY(userId)) ?? [];
      queryClient.setQueryData<PlanSessionClaim[]>(
        KEY(userId),
        prev.filter((c) => !(c.planned_date === input.plannedDate && c.workout === input.workout))
      );
      return { prev };
    },
    onSuccess: () => {
      useToastStore.getState().push({
        kind: 'info',
        title: 'BACK ON THE PLAN',
        subtitle: 'That session is scheduled again.',
      });
    },
    onError: (e: Error, _input, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(KEY(userId), ctx.prev);
      useToastStore.getState().push({ kind: 'error', title: 'NOT RESTORED', subtitle: e.message });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: KEY(userId) });
    },
  });
}

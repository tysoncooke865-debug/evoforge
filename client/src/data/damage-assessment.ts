import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * DAMAGE ASSESSMENT client layer (Tyson, 2026-07-17) — migration 038 + the
 * damage-assessment edge function. Pre-pump photo → train → post photo; when
 * all four are in the AI judges whose physique changed most, the winner takes
 * the XP, and every photo is deleted server-side the moment the verdict lands.
 * Photos go STRAIGHT from the camera capture to the edge function — never into
 * app state stores (the D2 posture).
 */

export interface DamageVerdictSide {
  delta: number;
  blurb: string;
}

export interface DamageAssessment {
  id: string;
  status: 'open' | 'judged' | 'expired';
  created_at: string;
  challenger_id: string;
  opponent_id: string;
  opponent_name: string;
  i_am_challenger: boolean;
  winner_id: string | null;
  verdict: { judgeable: boolean; challenger: DamageVerdictSide; opponent: DamageVerdictSide } | null;
  my_pre: boolean;
  my_post: boolean;
  their_pre: boolean;
  their_post: boolean;
}

export function useDamageAssessments() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['damage_assessments', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<DamageAssessment[]> => {
      const { data, error } = await supabase.rpc('my_damage_assessments');
      if (error) throw error;
      return (data ?? []) as DamageAssessment[];
    },
  });
}

const CREATE_REASON: Record<string, string> = {
  self: "You can't assess yourself.",
  not_friends: 'You can only challenge a friend.',
  already_open: 'An assessment with this rival is already running.',
};

export function useCreateAssessment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (opponentId: string): Promise<{ ok: boolean; id?: string; reason?: string }> => {
      const { data, error } = await supabase.rpc('create_damage_assessment', { p_opponent: opponentId });
      if (error) throw new Error('Could not start the assessment. Try again.');
      return data as { ok: boolean; id?: string; reason?: string };
    },
    onSuccess: (r) => {
      const push = useToastStore.getState().push;
      if (!r.ok) {
        push({ kind: 'error', title: 'NOT STARTED', subtitle: CREATE_REASON[r.reason ?? ''] ?? 'Try again.' });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['damage_assessments'] });
      push({ kind: 'info', title: 'DAMAGE ASSESSMENT OPEN', subtitle: 'Capture your PRE photo before you train.' });
    },
    onError: (e: Error) => useToastStore.getState().push({ kind: 'error', title: 'NOT STARTED', subtitle: e.message }),
  });
}

export function useCancelAssessment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.rpc('cancel_damage_assessment', { p_id: id });
      if (error) throw new Error('Could not cancel.');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['damage_assessments'] }),
    onError: (e: Error) => useToastStore.getState().push({ kind: 'error', title: 'FAILED', subtitle: e.message }),
  });
}

export interface SubmitPhotoResult {
  judged: boolean;
  winner?: string | null;
  awaiting?: number;
}

/** Send a fresh camera capture straight to the edge function. */
export function useSubmitDaPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; kind: 'pre' | 'post'; image: string }): Promise<SubmitPhotoResult> => {
      const { data, error } = await supabase.functions.invoke('damage-assessment', {
        body: { assessment_id: args.id, kind: args.kind, image: args.image },
      });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          const payload = await ctx.json().catch(() => null);
          throw new Error(payload?.error ?? error.message);
        }
        throw new Error(error.message);
      }
      if (data?.error) throw new Error(String(data.error));
      return data as SubmitPhotoResult;
    },
    onSuccess: (r, { kind }) => {
      void queryClient.invalidateQueries({ queryKey: ['damage_assessments'] });
      if (r.judged) {
        // AUDIT A5: a verdict awards XP server-side — refresh its readers
        // or the winner's level/XP display sits stale until a refocus.
        void queryClient.invalidateQueries({ queryKey: ['xp_ledger'] });
        void queryClient.invalidateQueries({ queryKey: ['user_progression'] });
        void queryClient.invalidateQueries({ queryKey: ['xp_total'] });
      }
      const push = useToastStore.getState().push;
      if (r.judged) {
        push({ kind: 'achievement', title: 'VERDICT IS IN', subtitle: 'The damage has been assessed.' });
      } else {
        push({
          kind: 'info',
          title: kind === 'pre' ? 'PRE PHOTO LOCKED' : 'POST PHOTO LOCKED',
          subtitle: kind === 'pre' ? 'Now go do the damage.' : 'Waiting on the other side…',
        });
      }
    },
    onError: (e: Error) => useToastStore.getState().push({ kind: 'error', title: 'PHOTO REJECTED', subtitle: e.message }),
  });
}

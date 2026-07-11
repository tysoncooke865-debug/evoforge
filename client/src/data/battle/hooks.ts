/**
 * Battle reads. Same shape as data/hooks.ts: per-user query keys, RLS does
 * the scoping (a participant sees exactly their matches and nothing else —
 * pinned by migration 009's falsification checklist).
 *
 * useBattleChannel is the realtime seam: one channel per match, postgres
 * changes only (the DB is the event log), and every callback just
 * invalidates the bundle — reconnect-safe because NOTHING lives only in the
 * socket; a refetch rebuilds the whole battle from the tables.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuth } from '../auth-context';
import { supabase } from '../supabase';

export interface BattleMatch {
  id: string;
  mode: string;
  format: string;
  status: 'inviting' | 'matched' | 'active' | 'judging' | 'settled' | 'abandoned';
  invite_code: string | null;
  current_round: number;
  winner_user_id: string | null;
  settled_at: string | null;
  created_at: string;
}

export interface BattleParticipant {
  match_id: string;
  user_id: string;
  seat: number;
  snapshot: {
    name?: string;
    level?: number;
    power?: number;
    strengthScore?: number;
    branch?: string;
    stage?: number;
    sex?: string;
    characterClass?: string;
  };
  ready_at: string | null;
  total_score: number | null;
  xp_awarded: number | null;
}

export interface BattleRound {
  match_id: string;
  round_no: number;
  kind: string;
  spec: {
    objectKey?: string;
    targetEffectiveKg?: number;
    displayKg?: number;
    challengeKey?: string;
    targetUnits?: number;
    poseKey?: string;
  };
  starts_at: string | null;
  ends_at: string | null;
  status: string;
}

export interface BattleEventRow {
  id: string;
  user_id: string;
  round_no: number;
  kind: string;
  payload: { exercise?: string; weight?: number; reps?: number };
  server_ts: string;
}

export interface BattleScoreRow {
  round_no: number;
  user_id: string;
  components: Record<string, number | boolean>;
  points: number;
}

export interface BattleMediaRow {
  id: string;
  user_id: string;
  round_no: number;
  confidence: string | null;
  compliant: boolean | null;
  verdict: Record<string, unknown> | null;
  created_at: string;
}

export function useMyBattles() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['battle_matches', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<BattleMatch[]> => {
      const { data, error } = await supabase
        .from('battle_matches')
        .select('id,mode,format,status,invite_code,current_round,winner_user_id,settled_at,created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as BattleMatch[];
    },
  });
}

export interface BattleBundle {
  match: BattleMatch | null;
  participants: BattleParticipant[];
  /** All opened rounds; the live one is rounds[match.current_round - 1]. */
  rounds: BattleRound[];
  events: BattleEventRow[];
  scores: BattleScoreRow[];
  media: BattleMediaRow[];
}

export function useBattleBundle(matchId: string | null) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['battle_bundle', userId, matchId],
    enabled: userId !== null && matchId !== null,
    refetchInterval: (q) => {
      // Realtime is the push path; a slow 15s poll is the belt-and-braces
      // fallback while a battle is live (and stops once it settles).
      const status = q.state.data?.match?.status;
      return status && status !== 'settled' && status !== 'abandoned' ? 15_000 : false;
    },
    queryFn: async (): Promise<BattleBundle> => {
      const [m, p, r, e, s, md] = await Promise.all([
        supabase.from('battle_matches').select('*').eq('id', matchId!).limit(1),
        supabase.from('battle_participants').select('*').eq('match_id', matchId!).order('seat'),
        supabase.from('battle_rounds').select('*').eq('match_id', matchId!).order('round_no'),
        supabase
          .from('battle_events')
          .select('id,user_id,round_no,kind,payload,server_ts')
          .eq('match_id', matchId!)
          .in('kind', ['volume', 'cardio', 'photo_hash'])
          .order('server_ts'),
        supabase.from('battle_round_scores').select('round_no,user_id,components,points').eq('match_id', matchId!),
        supabase
          .from('battle_media')
          .select('id,user_id,round_no,confidence,compliant,verdict,created_at')
          .eq('match_id', matchId!)
          .order('created_at'),
      ]);
      const firstError = m.error ?? p.error ?? r.error ?? e.error ?? s.error ?? md.error;
      if (firstError) throw firstError;
      return {
        match: ((m.data ?? [])[0] ?? null) as BattleMatch | null,
        participants: (p.data ?? []) as BattleParticipant[],
        rounds: (r.data ?? []) as BattleRound[],
        events: (e.data ?? []) as BattleEventRow[],
        scores: (s.data ?? []) as BattleScoreRow[],
        media: (md.data ?? []) as BattleMediaRow[],
      };
    },
  });
}

/** Subscribe to the match channel; any row change refetches the bundle. */
export function useBattleChannel(matchId: string | null) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!matchId || !userId) return;
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['battle_bundle', userId, matchId] });
      void queryClient.invalidateQueries({ queryKey: ['battle_matches', userId] });
    };
    const channel = supabase
      .channel(`battle:${matchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_events', filter: `match_id=eq.${matchId}` }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_rounds', filter: `match_id=eq.${matchId}` }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_round_scores', filter: `match_id=eq.${matchId}` }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_matches', filter: `id=eq.${matchId}` }, invalidate)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [matchId, userId, queryClient]);
}

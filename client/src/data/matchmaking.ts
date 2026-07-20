import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { ChampionId } from '@/domain/battle-rpg/types';
import type { PlayerCombatInput } from '@/domain/battle-rpg/stat-scaler';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * LIVE PvP MATCHMAKING client (migration 074). Enqueue → get paired with a real
 * opponent → play a turn-by-turn champion match over Supabase Realtime. Replaces
 * the old join-by-code. All mutation goes through the definer RPCs; the tables
 * are participant-RLS. The realtime pattern mirrors data/battle/hooks.ts: the DB
 * is the event log, callbacks refetch — reconnect-safe.
 */

export interface PvpMatch {
  id: string;
  seat1: string;
  seat2: string;
  seed: string;
  champion1: ChampionId;
  champion2: ChampionId;
  input1: PlayerCombatInput;
  input2: PlayerCombatInput;
  status: 'active' | 'finished' | 'abandoned';
  winner_seat: number | null;
}

export interface PvpMoveRow {
  match_id: string;
  turn: number;
  seat: number;
  move_id: string;
}

export type MatchmakingState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'matched'; matchId: string; seat: 1 | 2 };

/**
 * The searching loop: enqueue, then wait for a pairing. A pairing arrives either
 * immediately (an opponent was already waiting → pvp_enqueue returns the match),
 * or later via a Realtime INSERT on pvp_matches (RLS delivers only ours) with a
 * 3s pvp_poll() belt-and-braces fallback.
 */
export function useMatchmaking() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [state, setState] = useState<MatchmakingState>({ status: 'idle' });

  const start = useCallback(
    async (champion: ChampionId, input: PlayerCombatInput) => {
      setState({ status: 'searching' });
      try {
        const { data, error } = await supabase.rpc('pvp_enqueue', { p_champion: champion, p_input: input });
        if (error) throw error;
        const r = data as { matched: boolean; match_id?: string; seat?: number };
        if (r.matched && r.match_id) setState({ status: 'matched', matchId: r.match_id, seat: (r.seat ?? 2) as 1 | 2 });
      } catch {
        setState({ status: 'idle' });
        useToastStore.getState().push({ kind: 'error', title: 'MATCHMAKING FAILED', subtitle: 'Could not join the queue. Try again.' });
      }
    },
    []
  );

  const cancel = useCallback(async () => {
    try { await supabase.rpc('pvp_cancel_queue'); } catch { /* ignore */ }
    setState({ status: 'idle' });
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  useEffect(() => {
    if (state.status !== 'searching' || !userId) return;
    let live = true;
    const onPaired = (id: string, seat1: string) => {
      if (!live) return;
      setState({ status: 'matched', matchId: id, seat: seat1 === userId ? 1 : 2 });
    };
    const channel = supabase
      .channel(`pvp_pair:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pvp_matches' }, (payload) => {
        const m = payload.new as { id: string; seat1: string; seat2: string };
        if (m.seat1 === userId || m.seat2 === userId) onPaired(m.id, m.seat1);
      })
      .subscribe();
    const poll = setInterval(async () => {
      try {
        const { data } = await supabase.rpc('pvp_poll');
        const r = data as { matched: boolean; match_id?: string; seat?: number };
        if (live && r?.matched && r.match_id) setState({ status: 'matched', matchId: r.match_id, seat: (r.seat ?? 1) as 1 | 2 });
      } catch {
        /* keep waiting */
      }
    }, 3000);
    return () => {
      live = false;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [state.status, userId]);

  return { state, start, cancel, reset };
}

/** The match row (seed, seats, champions, inputs). Both clients read the same. */
export function usePvpMatch(matchId: string | null) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['pvp_match', userId, matchId],
    enabled: userId !== null && matchId !== null,
    queryFn: async (): Promise<PvpMatch | null> => {
      const { data, error } = await supabase.from('pvp_matches').select('*').eq('id', matchId!).limit(1);
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as PvpMatch | null;
    },
  });
}

/** Fetch all moves for a match (reconnect / late-join rebuild). */
export async function fetchPvpMoves(matchId: string): Promise<PvpMoveRow[]> {
  const { data, error } = await supabase
    .from('pvp_moves')
    .select('match_id,turn,seat,move_id')
    .eq('match_id', matchId)
    .order('turn');
  if (error) return [];
  return (data ?? []) as PvpMoveRow[];
}

export async function pvpSubmitMove(matchId: string, turn: number, moveId: string): Promise<void> {
  try { await supabase.rpc('pvp_submit_move', { p_match: matchId, p_turn: turn, p_move: moveId }); } catch { /* ignore */ }
}

export async function pvpFinish(matchId: string, iWon: boolean): Promise<void> {
  try { await supabase.rpc('pvp_finish', { p_match: matchId, p_i_won: iWon }); } catch { /* ignore */ }
}

export async function pvpForfeit(matchId: string): Promise<void> {
  try { await supabase.rpc('pvp_forfeit', { p_match: matchId }); } catch { /* ignore */ }
}

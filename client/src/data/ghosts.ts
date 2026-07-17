import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ChampionId } from '@/domain/battle-rpg/types';
import type { PlayerCombatInput } from '@/domain/battle-rpg/stat-scaler';
import { useToastStore } from '@/state/toast-store';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * GHOST BATTLES client layer (Tyson, 2026-07-17) — migration 037. Publish a
 * finished session as a ghost (combat stats + headline numbers, NO photos);
 * friends load it and fight an AI driven by the snapshot. All access via the
 * SECURITY DEFINER RPCs; results feed the rivalry server-side.
 */

/** The server champion vocabulary (036/037 checks) vs the client ChampionId:
 *  'shredded' is stored where the client says 'shredder'-class art — the
 *  battle engine's ChampionId 'shredded' matches, so it's 1:1 already. */
export interface FriendGhost {
  id: string;
  owner_id: string;
  owner_name: string;
  workout: string;
  date: string;
  champion: ChampionId;
  headline: { sets?: number; volume?: number };
  plays: number;
  defeats: number;
  created_at: string;
}

export interface GhostSnapshot extends FriendGhost {
  player_input: PlayerCombatInput;
  is_own: boolean;
}

export function useFriendGhosts() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['friend_ghosts', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<FriendGhost[]> => {
      const { data, error } = await supabase.rpc('list_friend_ghosts');
      if (error) throw error;
      return (data ?? []) as FriendGhost[];
    },
  });
}

/** Load one ghost to fight (owner-or-friend gated server-side). */
export async function fetchGhost(id: string): Promise<GhostSnapshot | null> {
  const { data, error } = await supabase.rpc('get_ghost', { p_id: id });
  if (error) return null;
  const d = data as GhostSnapshot & { found: boolean };
  return d.found ? d : null;
}

export function usePublishGhost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      workout: string;
      date: string;
      champion: ChampionId;
      ownerName: string;
      input: PlayerCombatInput;
      headline: { sets?: number; volume?: number };
    }): Promise<void> => {
      const { error } = await supabase.rpc('publish_ghost', {
        p_workout: args.workout,
        p_date: args.date,
        p_champion: args.champion,
        p_owner_name: args.ownerName,
        p_input: args.input,
        p_headline: args.headline,
      });
      if (error) throw new Error('Could not publish the ghost. Try again.');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['friend_ghosts'] });
      useToastStore.getState().push({
        kind: 'achievement',
        title: 'GHOST PUBLISHED',
        subtitle: 'Friends can now battle this session in the Arena.',
      });
    },
    onError: (e: Error) => useToastStore.getState().push({ kind: 'error', title: 'NOT PUBLISHED', subtitle: e.message }),
  });
}

/** Fire-and-forget: post a ghost battle outcome (plays/defeats + rivalry). */
export async function recordGhostResult(id: string, won: boolean): Promise<void> {
  try {
    await supabase.rpc('record_ghost_result', { p_id: id, p_won: won });
  } catch {
    /* casual mode — a failed post is not worth an error surface */
  }
}

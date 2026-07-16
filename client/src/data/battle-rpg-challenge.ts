import { useMutation } from '@tanstack/react-query';

import type { ChampionId } from '@/domain/battle-rpg/types';
import type { PlayerCombatInput } from '@/domain/battle-rpg/stat-scaler';
import { useToastStore } from '@/state/toast-store';
import { supabase } from '@/data/supabase';

/**
 * RPG BATTLE CHALLENGES (Tyson: "VS join by code", 2026-07-16) — async friend
 * battles via a shareable code (migration 034). Create captures your champion
 * + real stats; join fetches a code's snapshot and you battle that champion
 * (AI-driven from their build); the result posts back. Cross-device, no
 * real-time — live move-by-move PvP is the documented next step.
 */

export interface ChallengeSnapshot {
  code: string;
  ownerName: string;
  champion: ChampionId;
  playerInput: PlayerCombatInput;
  plays: number;
  defeats: number;
  isOwn: boolean;
}

export function useCreateChallenge() {
  return useMutation({
    mutationFn: async (args: { champion: ChampionId; ownerName: string; input: PlayerCombatInput }): Promise<string> => {
      const { data, error } = await supabase.rpc('create_rpg_challenge', {
        p_champion: args.champion,
        p_owner_name: args.ownerName,
        p_player_input: args.input,
      });
      if (error) throw new Error('Could not create a challenge. Try again.');
      return (data as { code: string }).code;
    },
    onError: (e: Error) => useToastStore.getState().push({ kind: 'error', title: 'NO CODE', subtitle: e.message }),
  });
}

export function useJoinChallenge() {
  return useMutation({
    mutationFn: async (code: string): Promise<ChallengeSnapshot | null> => {
      const clean = code.trim().toUpperCase();
      if (clean.length !== 6) throw new Error('A code is 6 characters.');
      const { data, error } = await supabase.rpc('get_rpg_challenge', { p_code: clean });
      if (error) throw new Error('Could not find that challenge.');
      const d = data as { found: boolean; code: string; owner_name: string; champion: ChampionId; player_input: PlayerCombatInput; plays: number; defeats: number; is_own: boolean };
      if (!d.found) return null;
      return {
        code: d.code,
        ownerName: d.owner_name,
        champion: d.champion,
        playerInput: d.player_input,
        plays: d.plays,
        defeats: d.defeats,
        isOwn: d.is_own,
      };
    },
    onError: (e: Error) => useToastStore.getState().push({ kind: 'error', title: 'NOT FOUND', subtitle: e.message }),
  });
}

/** Fire-and-forget: post a challenge result (join outcome) back to the owner. */
export async function recordChallengeResult(code: string, joinerWon: boolean): Promise<void> {
  try {
    await supabase.rpc('record_rpg_challenge_result', { p_code: code, p_joiner_won: joinerWon });
  } catch {
    /* casual mode — a failed post is not worth an error surface */
  }
}

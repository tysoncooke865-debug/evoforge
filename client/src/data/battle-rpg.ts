import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { BattleMode } from '@/domain/battle-rpg/types';
import { supabase } from '@/data/supabase';

/**
 * BATTLE RPG server rewards (Tyson, 2026-07-16). The RPC grant_battle_reward
 * (migration 033) is the AUTHORITY on battle coins/Forge XP — server-decided,
 * idempotent per result key, daily-capped (anti-farm). The client just asks
 * and refreshes the wallet + Forge Level. Battle history stays local for the
 * beta (state/battle-rpg-store) with migration 032 as the documented seam.
 */
export function useGrantBattleReward() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ resultKey, mode, won }: { resultKey: string; mode: BattleMode; won: boolean }) => {
      const { data, error } = await supabase.rpc('grant_battle_reward', {
        p_result_key: resultKey,
        p_mode: mode,
        p_won: won,
      });
      if (error) throw error;
      return data as { granted: boolean; xp?: number; coins?: number; reason?: string };
    },
    onSuccess: () => {
      // Real coins + Forge XP landed — refresh both.
      void queryClient.invalidateQueries({ queryKey: ['coin_total'] });
      void queryClient.invalidateQueries({ queryKey: ['coin_events'] });
      void queryClient.invalidateQueries({ queryKey: ['xp_ledger'] });
      void queryClient.invalidateQueries({ queryKey: ['user_progression'] });
    },
    // A failed grant is non-fatal: the local result is already recorded and
    // the modal shows the (locally-computed) reward; the wallet just won't
    // update until a successful grant. No user-facing error for the beta.
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { BranchV2 } from '@/domain/branches-v2';
import type { SkinId } from '@/domain/customise';
import { useToastStore } from '@/state/toast-store';
import { playPurchase } from '@/ui/core/sound';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * THE SKIN SHOP client layer (Tyson, 2026-07-16) — colours are bought per
 * LINE with forge coins (migration 030). Server is the authority: prices
 * live in skin_price(), purchases go through purchase_skin() atomically
 * (advisory-locked, balance-checked, spend + unlock in one transaction).
 * The client never charges — it asks, and reflects what the server did.
 *
 * The shop lines are the five with their OWN art. A skin bought for a line
 * is owned only for that line (aesthetic red ≠ mass red), mirroring how
 * each line carries its own recoloured sprite set.
 */

/** The lines that have purchasable colour skins (their own art). */
export type SkinLine = 'aesthetic' | 'mass' | 'titan' | 'cardio' | 'shredder';

export function skinLineFor(branch: BranchV2): SkinLine {
  // hybrid was removed; anything without its own set maps to aesthetic.
  if (branch === 'mass' || branch === 'titan' || branch === 'cardio' || branch === 'shredder') {
    return branch;
  }
  return 'aesthetic';
}

export interface SkinUnlockRow {
  line: SkinLine;
  skin: SkinId;
}

/** Owned colour unlocks (server truth). null while loading / on failure —
 *  a failed read must not read as "owns nothing" and offer to re-charge;
 *  the UI treats null as "still loading" and disables buying. */
export function useSkinUnlocks() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['user_skin_unlocks', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<SkinUnlockRow[]> => {
      const { data, error } = await supabase.from('user_skin_unlocks').select('line,skin');
      if (error) throw error;
      return (data ?? []) as SkinUnlockRow[];
    },
  });
}

export interface PurchaseResult {
  price: number;
  balance: number;
}

/** Buy a colour for a line. Resolves on success; throws a friendly message
 *  on any server rejection (already owned, not enough coins, unknown skin).
 *  Invalidates the wallet + unlocks so the UI reflects the new state. */
export function usePurchaseSkin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ line, skin }: { line: SkinLine; skin: SkinId }): Promise<PurchaseResult> => {
      const { data, error } = await supabase.rpc('purchase_skin', { p_line: line, p_skin: skin });
      if (error) {
        const m = error.message.toLowerCase();
        if (m.includes('already owned')) throw new Error('You already own this colour.');
        if (m.includes('not enough')) throw new Error('Not enough forge coins yet.');
        if (m.includes('unknown skin')) throw new Error('That colour is not for sale.');
        throw new Error('Purchase failed. Try again.');
      }
      return data as PurchaseResult;
    },
    onSuccess: (_result, { skin }) => {
      void queryClient.invalidateQueries({ queryKey: ['user_skin_unlocks'] });
      void queryClient.invalidateQueries({ queryKey: ['coin_total'] });
      void queryClient.invalidateQueries({ queryKey: ['coin_events'] });
      playPurchase(); // retro coin-cascade (web; settings-gated)
      useToastStore.getState().push({
        kind: 'achievement',
        title: 'COLOUR UNLOCKED',
        subtitle: `${skin.toUpperCase()} is yours — equip it any time`,
      });
    },
    onError: (err: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT PURCHASED', subtitle: err.message });
    },
  });
}

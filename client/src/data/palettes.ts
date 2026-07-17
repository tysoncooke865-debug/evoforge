import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useToastStore } from '@/state/toast-store';
import type { ThemePaletteId } from '@/theme/palettes';
import { playPurchase } from '@/ui/core/sound';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * THE PALETTE SHOP client layer (2026-07-17) — whole-app colour reskins
 * bought with forge coins (migration 044). Server is the authority: prices
 * live in palette_price(), purchases go through purchase_palette()
 * atomically (advisory-locked, balance-checked, spend + unlock in one
 * transaction). The client never charges — it asks, and reflects what the
 * server did. Ownership is for life; equipping is free and lives in the
 * loadout.
 */

/** What the shop sells: every palette except the free 'standard'. */
export type PurchasablePaletteId = Exclude<ThemePaletteId, 'standard'>;

export interface PaletteUnlockRow {
  palette: PurchasablePaletteId;
}

/** Owned palettes (server truth). undefined while loading / on failure —
 *  a failed read must not read as "owns nothing" and offer to re-charge;
 *  the UI treats it as "still loading" and disables buying. */
export function usePaletteUnlocks() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['user_palette_unlocks', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<PaletteUnlockRow[]> => {
      const { data, error } = await supabase.from('user_palette_unlocks').select('palette');
      if (error) throw error;
      return (data ?? []) as PaletteUnlockRow[];
    },
  });
}

export interface PurchaseResult {
  price: number;
  balance: number;
}

/** Buy a palette. Resolves on success; throws a friendly message on any
 *  server rejection (already owned, not enough coins, unknown palette).
 *  Invalidates the wallet + unlocks so every page reflects the new state. */
export function usePurchasePalette() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ palette }: { palette: PurchasablePaletteId }): Promise<PurchaseResult> => {
      const { data, error } = await supabase.rpc('purchase_palette', { p_palette: palette });
      if (error) {
        const m = error.message.toLowerCase();
        if (m.includes('already owned')) throw new Error('You already own this theme.');
        if (m.includes('not enough')) throw new Error('Not enough forge coins yet.');
        if (m.includes('unknown palette')) throw new Error('That theme is not for sale.');
        throw new Error('Purchase failed. Try again.');
      }
      return data as PurchaseResult;
    },
    onSuccess: (_result, { palette }) => {
      void queryClient.invalidateQueries({ queryKey: ['user_palette_unlocks'] });
      void queryClient.invalidateQueries({ queryKey: ['coin_total'] });
      void queryClient.invalidateQueries({ queryKey: ['coin_events'] });
      playPurchase(); // retro coin-cascade (web; settings-gated)
      useToastStore.getState().push({
        kind: 'achievement',
        title: 'THEME UNLOCKED',
        subtitle: `${palette.toUpperCase()} is yours for life — equip it any time`,
      });
    },
    onError: (err: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT PURCHASED', subtitle: err.message });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SpecialCharacterId } from '@/domain/customise';
import { useToastStore } from '@/state/toast-store';
import { playPowerUp } from '@/ui/core/sound';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * PREMIUM CHARACTERS client layer (Tyson, 2026-07-16) — Captain Gymerica
 * and future premium heroes are bought once with forge coins (migration
 * 031). Server is the authority: character_price() holds the price,
 * purchase_character() charges atomically (advisory-locked, balance-
 * checked, spend + unlock in one transaction). The client reflects
 * ownership; it never charges.
 */

export interface CharacterUnlockRow {
  character: SpecialCharacterId;
}

/** Owned premium characters (server truth). */
export function useCharacterUnlocks() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['user_character_unlocks', userId],
    enabled: userId !== null,
    queryFn: async (): Promise<CharacterUnlockRow[]> => {
      const { data, error } = await supabase.from('user_character_unlocks').select('character');
      if (error) throw error;
      return (data ?? []) as CharacterUnlockRow[];
    },
  });
}

export interface CharacterPurchaseResult {
  price: number;
  balance: number;
}

export function usePurchaseCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ character }: { character: SpecialCharacterId }): Promise<CharacterPurchaseResult> => {
      const { data, error } = await supabase.rpc('purchase_character', { p_character: character });
      if (error) {
        const m = error.message.toLowerCase();
        if (m.includes('already owned')) throw new Error('You already own this character.');
        if (m.includes('not enough')) throw new Error('Not enough forge coins yet.');
        if (m.includes('unknown')) throw new Error('That character is not for sale.');
        throw new Error('Purchase failed. Try again.');
      }
      return data as CharacterPurchaseResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user_character_unlocks'] });
      void queryClient.invalidateQueries({ queryKey: ['coin_total'] });
      void queryClient.invalidateQueries({ queryKey: ['coin_events'] });
      playPowerUp(); // retro unlock chime (web; settings-gated)
      useToastStore.getState().push({
        kind: 'achievement',
        title: 'CHARACTER UNLOCKED',
        subtitle: 'Captain Gymerica reports for duty — equip him any time',
      });
    },
    onError: (err: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT PURCHASED', subtitle: err.message });
    },
  });
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';

import { columnsFor, type DropTier } from '@/domain/forge-drop';
import {
  sessionBalance,
  sessionSummary,
  stakeFor,
  type LaneChoice,
  type SessionDrop,
  laneFor,
} from '@/domain/forge-drop-session';
import { useToastStore } from '@/state/toast-store';

import { track } from './analytics';
import { useAuth } from './auth-context';
import { useCoinTotal } from './coins';
import { refreshDrop } from './forge-drop';
import { supabase } from './supabase';

/**
 * THE SESSION — several chips in the air, one wallet, one server.
 *
 * `domain/forge-drop-session.ts` decides what the numbers mean. This owns when
 * they change, and it exists because concurrency turns three ordinary problems
 * into sharp ones:
 *
 *   THE BALANCE IS THE SERVER'S. Always `coin_total()`, adjusted only to HIDE
 *   what the athlete has not been shown — never to predict, and never carried
 *   forward from a previous reading. Taking the balance each drop response
 *   returns would be simpler and wrong: responses arrive in whatever order the
 *   network feels like, so a total from a drop that committed first can land
 *   last and roll the display backwards over two later settlements.
 *
 *   THE KEYS ON DISK. Up to five idempotency keys can be in flight when a tab
 *   closes. They are written BEFORE their requests go out and cleared only once
 *   their results have been seen, so a refresh mid-flight can ask what
 *   happened instead of guessing. `forge_drop_fetch_many` answers for all of
 *   them in one round trip.
 *
 *   REVEAL IS NOT SETTLEMENT. A falling chip has already settled on the
 *   server. Nothing here re-settles it; the animation only decides when the
 *   athlete is TOLD. That is why a lost connection mid-fall costs an animation
 *   and never a payout.
 */

const PENDING_KEY = 'evoforge-forge-drop-pending-v2';

/** Keys of drops that are out there somewhere, oldest first. */
async function readKeys(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

async function writeKeys(keys: string[]): Promise<void> {
  try {
    if (keys.length === 0) await AsyncStorage.removeItem(PENDING_KEY);
    else await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(keys));
  } catch {
    // A wager that cannot be remembered is still a wager the server settled;
    // losing the note costs a recovery prompt, never coins.
  }
}

function humanise(message: string): string {
  const m = message.replace(/^[a-z_]+:\s*/i, '').trim();
  if (/row-level security/i.test(message)) return 'That is not yours to play.';
  return m.charAt(0).toUpperCase() + m.slice(1);
}

export interface DropSession {
  drops: SessionDrop[];
  balance: ReturnType<typeof sessionBalance>;
  summary: ReturnType<typeof sessionSummary>;
  /** True until the wallet has been read once — the rack stays shut rather
   *  than guessing what is affordable. */
  loading: boolean;
  /** Throw a chip. Returns false when it was refused before anything was
   *  sent, so the caller knows nothing is in flight. */
  play: (chip: number, choice: LaneChoice) => Promise<boolean>;
  /** The athlete has now seen this drop's result. */
  reveal: (key: string) => void;
  /** Forget the revealed drops — used when leaving, never mid-flight. */
  clearSettled: () => void;
  recovered: SessionDrop[];
}

export function useDropSession(tier: DropTier | null): DropSession {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const queryClient = useQueryClient();
  const coinTotal = useCoinTotal();

  const [drops, setDrops] = useState<SessionDrop[]>([]);
  const [recovered, setRecovered] = useState<SessionDrop[]>([]);
  const server = coinTotal.data ?? null;

  // Derived straight from the server's own total every render. There is no
  // anchor to keep in step and therefore nothing to fall out of step: the only
  // adjustments are for drops the athlete has not been shown yet, and those
  // come off the list as soon as they are.
  const balance = sessionBalance(server ?? 0, drops);
  const summary = sessionSummary(drops);

  // ── recovery ──────────────────────────────────────────────────────────────
  //
  // On mount, ask about every key left on disk. A key that never played comes
  // back absent, which is the signal that no coins were taken and it can be
  // dropped. A key that DID play comes back with its real result, shown as
  // already-landed rather than replayed as an animation — the athlete was not
  // watching, and pretending otherwise would be theatre.
  const recoverRan = useRef(false);
  useEffect(() => {
    if (recoverRan.current || userId === null) return;
    recoverRan.current = true;
    void (async () => {
      const keys = await readKeys();
      if (keys.length === 0) return;
      try {
        const { data, error } = await supabase.rpc('forge_drop_fetch_many', { p_keys: keys });
        if (error) return; // still offline: the keys stay on disk for next time
        const rows = (data ?? []) as Record<string, unknown>[];
        await writeKeys([]);
        if (rows.length === 0) return;
        const restored: SessionDrop[] = rows.map((r) => ({
          key: String(r.idempotency_key),
          stake: Number(r.stake),
          lane: Number(r.lane),
          phase: 'revealed',
          dropId: String(r.drop_id),
          slot: Number(r.slot),
          multiplier: Number(r.multiplier),
          payout: Number(r.payout),
          net: Number(r.net),
          tier: Number(r.tier),
          path: ((r.path ?? []) as number[]).map(Number),
        }));
        setRecovered(restored);
        refreshDrop(queryClient, userId);
        track('forge_drop_recovered', { count: restored.length });
      } catch {
        // Leave the keys on disk. Discarding them is how a settled wager
        // becomes unaccountable.
      }
    })();
  }, [userId, queryClient]);

  // ── playing ───────────────────────────────────────────────────────────────
  const play = useCallback(
    async (chip: number, choice: LaneChoice): Promise<boolean> => {
      if (!tier || server === null) return false;

      const stake = stakeFor(chip, tier, balance);
      if (stake === null) return false;

      const lane = laneFor(choice, tier);
      const key = Crypto.randomUUID();

      // The key goes to disk BEFORE the request. A wager whose key was never
      // written is a wager nobody can ask about afterwards.
      await writeKeys([...(await readKeys()), key]);

      setDrops((prev) => [...prev, { key, stake, lane, phase: 'pending' }]);
      track('forge_drop_staked', {
        stake, lane, tier: tier.tier, concurrent: balance.activeCount + 1,
      });

      try {
        const { data, error } = await supabase.rpc('forge_drop_play', {
          p_key: key,
          p_stake: stake,
          p_lane: lane,
        });
        if (error) throw new Error(humanise(error.message));
        const r = data as Record<string, unknown>;
        const path = ((r.path ?? []) as number[]).map(Number);
        const slot = Number(r.slot);

        // THE LEDGER WINS. If the server's path and the slot it actually PAID
        // disagree there is no honest animation of the journey, so the drop
        // skips the fall and is revealed at once rather than illustrated with
        // a route that did not end where the money did.
        const animatable = columnsFor({ lane, path, slot }, Number(r.rows ?? tier.rows)) !== null;

        setDrops((prev) =>
          prev.map((d) =>
            d.key === key
              ? {
                  ...d,
                  phase: animatable ? 'falling' : 'revealed',
                  dropId: String(r.drop_id),
                  slot,
                  multiplier: Number(r.multiplier),
                  payout: Number(r.payout),
                  net: Number(r.net),
                  tier: Number(r.tier),
                  path,
                }
              : d
          )
        );
        track('forge_drop_settled', {
          tier: Number(r.tier), lane, stake, slot, net: Number(r.net),
          replayed: Boolean(r.replayed),
        });
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'The drop did not go through.';
        // A refused drop took nothing. It is marked failed rather than removed,
        // so the rail can say what happened instead of a chip simply vanishing.
        setDrops((prev) => prev.map((d) => (d.key === key ? { ...d, phase: 'failed', error: message } : d)));
        await writeKeys((await readKeys()).filter((x) => x !== key));
        track('forge_drop_failed', { stake, lane, reason: message.slice(0, 80) });
        useToastStore.getState().push({ kind: 'error', title: 'DROP NOT PLAYED', subtitle: message });
        return false;
      }
    },
    [tier, server, balance]
  );

  const reveal = useCallback(
    (key: string) => {
      setDrops((prev) => prev.map((d) => (d.key === key ? { ...d, phase: 'revealed' } : d)));
      void (async () => {
        await writeKeys((await readKeys()).filter((x) => x !== key));
      })();
      // Tell every other surface the wallet moved. Refetching cannot spoil a
      // chip still falling: an unrevealed payout is subtracted back out of
      // whatever total comes back.
      if (userId !== null) refreshDrop(queryClient, userId);
    },
    [queryClient, userId]
  );

  const clearSettled = useCallback(() => {
    setDrops((prev) => prev.filter((d) => d.phase !== 'revealed' && d.phase !== 'failed'));
  }, []);

  return {
    drops,
    balance,
    summary,
    loading: server === null || coinTotal.isPending,
    play,
    reveal,
    clearSettled,
    recovered,
  };
}

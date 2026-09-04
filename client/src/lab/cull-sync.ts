import { useEffect } from 'react';

import { useAuth } from '@/data/auth-context';
import { supabase } from '@/data/supabase';

import { batchCullKey, mergeCulled, parseCulled, serializeCulled } from './cull-model';
import { cullBatch, replaceAllCulled, uncullBatch, useCulled } from './cull-store';

/**
 * CULL SYNC — the durable cross-device layer over cull-store (migration 200,
 * `lab_culls`: owner-only rows of `<page>/batch-<n>` keys).
 *
 * THE ONE RULE, stated once and load-bearing: **localStorage stays the
 * synchronous source of truth for render.** `useCulled()` and the store's
 * getSnapshot never touch the network; this module only moves keys between
 * the database and the local store inside effects and fire-and-forget
 * promises, and every local change goes through cull-store's single write()
 * path — so the identity-stable snapshot cache and the listeners keep
 * working exactly as before, and a network failure can never blank or wedge
 * the gallery (the local list simply stands).
 *
 * The REAL client on purpose: the gallery sits OUTSIDE LabDataProvider, so
 * `useAuth()` here is the real session and `supabase` the real singleton —
 * the same direction of dependency the MockWriteWarning already uses. Signed
 * out, everything degrades to the per-device behavior the lab has always
 * had, and the gallery shows a quiet hint instead of failing.
 *
 * Known asymmetry, accepted for a single-developer tool: a device that still
 * holds a key locally will re-push it on its next gallery mount after
 * another device unculled it (RESTORE is one tap). The alternative —
 * DB-authoritative overwrite — would silently LOSE every cull made signed
 * out at the next sign-in, which is worse.
 */

/** Pull-and-merge on gallery mount. Returns whether culls are durable here
 *  (a real session exists). */
export function useCullSync(): { durable: boolean } {
  const { session } = useAuth();
  const local = useCulled();
  const signedIn = Boolean(session);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.from('lab_culls').select('cull_key');
        if (error || cancelled) return;
        // Re-validate through the same total parser the store uses: the
        // CHECK constraint should make this a no-op, but the client never
        // trusts a wire shape it can validate for free.
        const remote = parseCulled(
          serializeCulled((data ?? []).map((r) => String(r.cull_key)))
        );
        const { merged, toPush } = mergeCulled(local, remote);
        if (toPush.length > 0) {
          void supabase
            .from('lab_culls')
            .upsert(
              toPush.map((cull_key) => ({ cull_key })),
              { ignoreDuplicates: true }
            )
            .then(undefined, () => undefined);
        }
        if (merged.length !== local.length) replaceAllCulled(merged);
      } catch (e) {
        // Offline, blocked, or a half-configured environment: the lab must
        // never break on network. Local state stands.
        console.warn('lab cull-sync pull failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately NOT keyed on `local`: this is a mount+sign-in pull, not a
    // subscription — hand culls push themselves in cullBatchEverywhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  return { durable: signedIn };
}

/** Local hide (instant, synchronous) + fire-and-forget durable insert. */
export function cullBatchEverywhere(page: string, batchNumber: number): void {
  cullBatch(page, batchNumber);
  void supabase
    .from('lab_culls')
    .upsert([{ cull_key: batchCullKey(page, batchNumber) }], { ignoreDuplicates: true })
    .then(
      ({ error }) => {
        if (error) console.warn('lab cull-sync push failed', error.message);
      },
      () => undefined
    );
}

/** Local restore + fire-and-forget durable delete (RLS scopes it to the
 *  owner's row; signed out the delete simply matches nothing). */
export function uncullBatchEverywhere(page: string, batchNumber: number): void {
  uncullBatch(page, batchNumber);
  void supabase
    .from('lab_culls')
    .delete()
    .eq('cull_key', batchCullKey(page, batchNumber))
    .then(
      ({ error }) => {
        if (error) console.warn('lab cull-sync delete failed', error.message);
      },
      () => undefined
    );
}

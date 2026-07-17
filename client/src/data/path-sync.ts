import { useEffect } from 'react';

import type { BranchV2 } from '@/domain/branches-v2';
import { currentStageFor } from '@/domain/customise';

import { useAuth } from './auth-context';
import { supabase } from './supabase';

/**
 * ORIGIN PATH Release 2 — the dual-write mirror (migration 040, plan at
 * ORIGIN_PATH_PLAN.md). Whenever the Forge screen shows a derived identity,
 * mirror the path + derived stage into user_paths (monotonic server-side) and
 * the active champion onto the profile. LEGACY REMAINS THE READ PATH — nothing
 * user-visible reads these fields until Release 5; this only accumulates truth
 * for the Release 3 backfill to reconcile. Fire-and-forget, once per
 * user+path+stage per app run.
 */

const PATH_FOR_BRANCH: Partial<Record<BranchV2, string>> = {
  aesthetic: 'aesthetic',
  mass: 'mass',
  titan: 'titan',
  cardio: 'cardio',
  shredder: 'shredder',
  // 'hybrid' has no path (removed from the game) — never mirrored.
};

const synced = new Set<string>();

export function usePathDualWrite(ready: boolean, branch: BranchV2, level: number, bfMid: number | null): void {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!ready || !userId) return;
    const path = PATH_FOR_BRANCH[branch];
    if (!path) return;
    const stage = currentStageFor(branch, level, bfMid);
    const key = `${userId}:${path}:${stage}`;
    if (synced.has(key)) return;
    synced.add(key);
    void (async () => {
      try {
        await supabase.rpc('record_path_progress', { p_path: path, p_stage: stage });
        await supabase.rpc('set_active_champion', { p_path: path, p_stage: stage });
      } catch {
        synced.delete(key); // retry on the next qualifying render
      }
    })();
  }, [ready, userId, branch, level, bfMid]);
}

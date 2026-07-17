import { useEffect } from 'react';

import type { BranchV2 } from '@/domain/branches-v2';
import { currentStageFor, originAsBranch } from '@/domain/customise';

import { useAuth } from './auth-context';
import { useOriginStatus } from './origin';
import { supabase } from './supabase';

/**
 * ORIGIN PATH Release 2 — the dual-write mirror (migration 040, plan at
 * ORIGIN_PATH_PLAN.md). Whenever the Forge screen shows a derived identity,
 * mirror the path + derived stage into user_paths (monotonic server-side) and
 * the active champion onto the profile. Fire-and-forget, once per
 * user+path+stage per app run.
 *
 * THE ORIGIN LOCK (Tyson, 2026-07-17): with an Origin assigned, the active
 * champion NEVER leaves the origin path — set_active_champion mirrors the
 * ORIGIN line's derived stage (so the origin champion keeps growing with
 * training), and the server refuses any other path anyway (migration 046).
 * ORIGIN EXCLUSIVITY (048, Tyson, same evening): with an Origin assigned,
 * ONLY the origin line is mirrored — the derived (non-origin) branch is
 * NEVER recorded into user_paths. ("Nobody should have any data on any
 * character other than their origin"; the pre-048 behaviour recorded the
 * derived line "as roster truth" and resurrected wiped rows.)
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
  const originStatus = useOriginStatus();
  // undefined = still loading (do nothing yet — a premature legacy mirror
  // could flip active_path before the lock is known); null = no origin.
  const originPath = originStatus.data === undefined ? undefined : originAsBranch(originStatus.data?.origin_path);
  useEffect(() => {
    if (!ready || !userId || originPath === undefined) return;
    const path = PATH_FOR_BRANCH[branch];
    if (!path) return;
    const stage = currentStageFor(branch, level, bfMid);
    const originStage = originPath !== null ? currentStageFor(originPath, level, bfMid) : null;
    const key = `${userId}:${path}:${stage}:${originPath ?? 'none'}:${originStage ?? ''}`;
    if (synced.has(key)) return;
    synced.add(key);
    void (async () => {
      try {
        if (originPath !== null) {
          // 048 exclusivity: mirror ONLY the origin line.
          await supabase.rpc('record_path_progress', { p_path: originPath, p_stage: originStage });
          await supabase.rpc('set_active_champion', { p_path: originPath, p_stage: originStage });
        } else {
          // No origin yet: the derived line IS the roster truth (unchanged).
          await supabase.rpc('record_path_progress', { p_path: path, p_stage: stage });
          await supabase.rpc('set_active_champion', { p_path: path, p_stage: stage });
        }
      } catch {
        synced.delete(key); // retry on the next qualifying render
      }
    })();
  }, [ready, userId, branch, level, bfMid, originPath]);
}

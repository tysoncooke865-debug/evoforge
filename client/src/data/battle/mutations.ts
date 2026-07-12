/**
 * Battle writes. Everything authoritative goes through the edge functions
 * (the client has no write path to matches/scores — RLS enforces it); the
 * one direct insert is battle_events, whose 009 trigger rebuilds the payload
 * from the referenced owned log row, so nothing here is trusted anyway.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useToastStore } from '@/state/toast-store';

import { useAuth } from '../auth-context';
import { supabase } from '../supabase';
import { useAvatarData } from '../use-avatar-data';

/** The display snapshot sent to invite/join; server clamps + names it. */
export function useBattleSnapshot(): Record<string, unknown> {
  const { summary, stats, branchV2, sex } = useAvatarData();
  const power = Math.trunc(
    summary.level * 2 +
      (stats.strengthScore + stats.sizeScore + stats.leannessScore + stats.conditioningScore + stats.aestheticScore) / 5
  );
  return {
    level: summary.level,
    power,
    strengthScore: stats.strengthScore,
    conditioningScore: stats.conditioningScore,
    branch: branchV2,
    stage: 1,
    sex,
    characterClass: stats.characterClass,
  };
}

async function invokeBattle(fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    // The gateway wraps non-2xx; surface the function's own message if present.
    let message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = await ctx.json();
        if (payload?.error) message = String(payload.error);
      } catch {
        // keep the gateway message
      }
    }
    throw new Error(message);
  }
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String(data.error));
  }
  return (data ?? {}) as Record<string, unknown>;
}

export function useCreateInvite() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: ({ snapshot, format = 'blitz' }: { snapshot: Record<string, unknown>; format?: string }) =>
      invokeBattle('battle-invite', { snapshot, format }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['battle_matches', userId] });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NO BATTLE CREATED', subtitle: e.message });
    },
  });
}

export function useJoinBattle() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: ({ code, snapshot }: { code: string; snapshot: Record<string, unknown> }) =>
      invokeBattle('battle-join', { code, snapshot }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['battle_matches', userId] });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'COULD NOT JOIN', subtitle: e.message });
    },
  });
}

export function useReadyUp(matchId: string) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: () => invokeBattle('battle-ready', { match_id: matchId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['battle_bundle', userId, matchId] });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'READY FAILED', subtitle: e.message });
    },
  });
}

/** IMPROVEMENT_PLAN #5: end a live battle for both players. Server CAS
 *  decides any race with settle; XP-inert by construction. */
export function useCancelBattle(matchId: string) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: () => invokeBattle('battle-cancel', { match_id: matchId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['battle_bundle', userId, matchId] });
      void queryClient.invalidateQueries({ queryKey: ['battle_matches', userId] });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'CANCEL FAILED', subtitle: e.message });
    },
  });
}

/** Heads or Tails: apply a coin-flip pick (or claim a stalled one via auto). */
export function useBattlePick(matchId: string) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: ({ pick, auto = false }: { pick?: string; auto?: boolean }) =>
      invokeBattle('battle-pick', { match_id: matchId, pick, auto }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['battle_bundle', userId, matchId] });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'PICK NOT APPLIED', subtitle: e.message });
    },
  });
}

export function useSettleBattle(matchId: string) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: () => invokeBattle('battle-settle', { match_id: matchId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['battle_bundle', userId, matchId] });
      void queryClient.invalidateQueries({ queryKey: ['battle_matches', userId] });
      void queryClient.invalidateQueries({ queryKey: ['battle_my_results', userId] });
      // Battle XP landed in the ledger — the avatar must hear about it.
      void queryClient.invalidateQueries({ queryKey: ['xp_total', userId] });
    },
    onError: (e: Error) => {
      // "Round N is still open" is the server truthfully out-voting a fast
      // client clock — an info nudge, not a failure. Everything else is real.
      if (/still open/i.test(e.message)) {
        useToastStore.getState().push({
          kind: 'info',
          title: 'ROUND STILL OPEN',
          subtitle: 'The server clock has not reached time yet — settle again in a few seconds.',
        });
        return;
      }
      useToastStore.getState().push({ kind: 'error', title: 'SETTLE FAILED', subtitle: e.message });
    },
  });
}

/**
 * Tie a just-saved log row into the battle. Fire-and-forget in spirit (a
 * failure never blocks the save that already happened) but never silent —
 * the athlete must know their work didn't count for the battle.
 */
async function postBattleEvent(
  matchId: string,
  roundNo: number,
  kind: 'volume' | 'cardio',
  sourceId: string,
  failTitle: string
): Promise<boolean> {
  const { error } = await supabase.from('battle_events').insert({
    match_id: matchId,
    round_no: roundNo,
    kind,
    source_id: sourceId,
  });
  if (error && !/duplicate|unique/i.test(error.message)) {
    useToastStore.getState().push({
      kind: 'error',
      title: failTitle,
      subtitle: error.message.includes('window') ? 'Logged outside the round window.' : error.message,
    });
    return false;
  }
  return true;
}

export const postBattleVolume = (matchId: string, roundNo: number, workoutLogId: string) =>
  postBattleEvent(matchId, roundNo, 'volume', workoutLogId, 'SET NOT COUNTED');

export const postBattleCardio = (matchId: string, roundNo: number, cardioLogId: string) =>
  postBattleEvent(matchId, roundNo, 'cardio', cardioLogId, 'SESSION NOT COUNTED');

export interface BattlePhysiqueResponse {
  verdict?: Record<string, unknown>;
  compliant?: boolean;
  confidence?: string;
  attempt?: number;
  retry_requested?: boolean;
}

/** Round 3: send the fresh camera capture to the judge. */
export function useBattlePhysique(matchId: string) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  return useMutation({
    mutationFn: (image: string): Promise<BattlePhysiqueResponse> =>
      invokeBattle('battle-physique', { match_id: matchId, image }) as Promise<BattlePhysiqueResponse>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['battle_bundle', userId, matchId] });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'JUDGING FAILED', subtitle: e.message });
    },
  });
}

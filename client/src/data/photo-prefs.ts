/**
 * THE ATHLETE'S PHOTO PREFERENCES — one place, so the promises hold
 * (docs/ONBOARDING_V3_SPEC.md §6).
 *
 * Three separate states, and they are separate on purpose:
 *
 *   consent            — they read the disclosure and agreed to processing.
 *                        Withdrawable. Versioned: consent to one description
 *                        of the pipeline is not consent to a different one.
 *   baseline exists    — a private starting point was created. The DATE
 *                        only; the photos themselves are still never
 *                        persisted anywhere (client/CLAUDE.md).
 *   prompts disabled   — "don't ask me again". The strongest of the three,
 *                        and the one every prompt surface must consult
 *                        before it renders anything at all.
 *
 * A surface that wants to ask for a photo reads `photoPrompts.mayAsk`. If a
 * new prompt is ever added and forgets, that is the bug this module exists
 * to make obvious.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { track } from '@/data/analytics';
import { useAuth } from '@/data/auth-context';
import { useProfile } from '@/data/hooks';
import { supabase } from '@/data/supabase';
import { useToastStore } from '@/state/toast-store';

/** Bump when the processing description changes — it re-asks. */
export const PHOTO_CONSENT_VERSION = 1;

export interface PhotoPrefs {
  /** May a surface offer a photo prompt at all? */
  mayAsk: boolean;
  /** Has the athlete permanently opted out of being asked? */
  promptsDisabled: boolean;
  /** Current, versioned consent to process physique photos. */
  hasConsent: boolean;
  /** A private baseline exists (the date it was made, never the photos). */
  hasBaseline: boolean;
  baselineAt: string | null;
  ready: boolean;
}

export function usePhotoPrefs(): PhotoPrefs {
  const profile = useProfile();
  const p = profile.data;
  const promptsDisabled = p?.photo_prompts_disabled === true;
  const hasConsent =
    p != null &&
    (p as { photo_consent_at?: string | null }).photo_consent_at != null &&
    Number((p as { photo_consent_version?: number | null }).photo_consent_version ?? 0) >=
      PHOTO_CONSENT_VERSION;
  return {
    mayAsk: !promptsDisabled,
    promptsDisabled,
    hasConsent,
    hasBaseline: p?.physique_baseline_at != null,
    baselineAt: p?.physique_baseline_at ?? null,
    ready: !profile.isPending,
  };
}

type PhotoPrefPatch = {
  /** true = never ask again. */
  promptsDisabled?: boolean;
  /** true = record consent now, false = withdraw it. */
  consent?: boolean;
  /** true = a baseline exists as of now. */
  baseline?: boolean;
  /** Clear the baseline date. Only valid alongside a consent withdrawal —
   *  the 134 guard refuses a silent clear from an ordinary save. */
  clearBaseline?: boolean;
};

export function useSavePhotoPrefs() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async (patch: PhotoPrefPatch) => {
      const row: Record<string, unknown> = {};
      if (patch.promptsDisabled !== undefined) row.photo_prompts_disabled = patch.promptsDisabled;
      if (patch.consent !== undefined) {
        row.photo_consent_at = patch.consent ? new Date().toISOString() : null;
        row.photo_consent_version = patch.consent ? PHOTO_CONSENT_VERSION : null;
      }
      if (patch.baseline) row.physique_baseline_at = new Date().toISOString();
      if (patch.clearBaseline) row.physique_baseline_at = null;
      if (Object.keys(row).length === 0) return;

      const { error, count } = await supabase
        .from('profile')
        .update(row, { count: 'exact' })
        .eq('user_id', userId!);
      if (error) throw error;
      if ((count ?? 0) === 0) throw new Error('No profile row to update.');
    },
    onSuccess: (_r, patch) => {
      void queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      if (patch.promptsDisabled === true) {
        track('photo_prompts_disabled', {});
        useToastStore.getState().push({
          kind: 'info',
          title: 'WE WON’T ASK AGAIN',
          subtitle: 'Every training feature stays exactly as it is.',
        });
      }
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT SAVED', subtitle: e.message });
    },
  });
}

/**
 * Delete the physique data derived from photos, and stop the asking.
 *
 * The photos were never stored, so there is nothing to delete there — what
 * this removes is everything DERIVED from them: the assessments, the ratings
 * and the baseline date. Saying "photos deleted" would be theatre; saying
 * what is actually removed is the honest version.
 */
export function useDeletePhysiqueData() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  return useMutation({
    mutationFn: async () => {
      // Owner-only RLS scopes each delete to this athlete.
      const assessments = await supabase.from('physique_assessments').delete().eq('user_id', userId!);
      if (assessments.error) throw assessments.error;
      const ratings = await supabase.from('physique_ratings').delete().eq('user_id', userId!);
      if (ratings.error) throw ratings.error;
      const { error } = await supabase
        .from('profile')
        .update({
          physique_baseline_at: null,
          photo_consent_at: null,
          photo_consent_version: null,
          photo_prompts_disabled: true,
        })
        .eq('user_id', userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      void queryClient.invalidateQueries({ queryKey: ['physique_assessments'] });
      void queryClient.invalidateQueries({ queryKey: ['physique_ratings'] });
      track('photo_data_deleted', {});
      useToastStore.getState().push({
        kind: 'info',
        title: 'PHYSIQUE DATA DELETED',
        subtitle: 'Your ratings from photos are gone and we will not ask again.',
      });
    },
    onError: (e: Error) => {
      useToastStore.getState().push({ kind: 'error', title: 'NOT DELETED', subtitle: e.message });
    },
  });
}

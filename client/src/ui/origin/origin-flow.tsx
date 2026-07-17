/**
 * ORIGIN ONBOARDING — Act II, the origin ceremony step machine
 * (docs/ORIGIN_ONBOARDING_SPEC.md §3). Rendered INSIDE /onboarding after the
 * profile insert, and again on any later launch while the athlete is
 * flow-v2 and origin-less (the (main) gate returns them here).
 *
 *   rating → candidates → confirm → awakening → onComplete()
 *
 * RESUME BY CONSTRUCTION: nothing persists between selection and binding —
 * the profile row + origin_path derive every resume state, the review is
 * idempotent (not_due is a no-op), candidates regenerate deterministically
 * from the same stored inputs, and binding is the only mutation. Killing
 * the app anywhere lands back at `rating` with identical cards.
 *
 * Never a dead end: rating failure → retry card; candidates failure → retry
 * card; binding failure → toast + stay on confirm (already_assigned is
 * success — the server advisory lock makes exactly one bind land).
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { ratingBand, track } from '@/data/analytics';
import { useEvoRatingCurrent } from '@/data/progression/use-evo-rating';
import { runDueEvoReview } from '@/data/progression/evo-review-io';
import {
  PATH_NAMES,
  seedFirstMissionIfNeeded,
  useBindOrigin,
  useOriginCandidates,
} from '@/data/origin';
import { supabase } from '@/data/supabase';
import type { OriginId } from '@/domain/origin/types';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useToastStore } from '@/state/toast-store';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';

import { AwakeningCeremony } from './awakening';
import { OriginCandidateCard } from './candidate-card';
import { RatingReveal } from './rating-reveal';

type Step = 'rating' | 'candidates' | 'confirm' | 'awakening';

const FLOW_PROPS = { calibration_version: 5, flow_version: 2 } as const;

export function OriginFlow({
  sex,
  userType,
  onComplete,
}: {
  sex: 'male' | 'female';
  userType: 'new' | 'migrated';
  onComplete: () => void;
}) {
  const colors = useThemeColors();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('rating');
  const stepRef = useRef<Step>('rating');
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  const boundRef = useRef<OriginId | null>(null);
  const [boundOrigin, setBoundOrigin] = useState<OriginId | null>(null);
  const startedAt = useRef(0);
  useEffect(() => {
    if (!startedAt.current) startedAt.current = Date.now();
  }, []);

  /* Abandon signal (best-effort): unmounting Act II without a bind. */
  useEffect(() => {
    return () => {
      if (!boundRef.current) {
        track('origin_selection_abandoned', { ...FLOW_PROPS, user_type: userType, last_step: stepRef.current });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- step 1: the first Evo Review + rating reveal ------- */
  const rating = useEvoRatingCurrent();
  const [reviewState, setReviewState] = useState<'running' | 'error' | 'done'>('running');
  const reviewRan = useRef(false);

  const runReview = async () => {
    setReviewState('running');
    try {
      // Non-forced: the first review is due by definition; a resume finds
      // the row and not_due is a no-op. Idempotent per its own due-check.
      await runDueEvoReview(supabase);
      await queryClient.invalidateQueries({ queryKey: ['evo_rating_current'] });
      setReviewState('done');
    } catch {
      setReviewState('error');
    }
  };
  useEffect(() => {
    if (reviewRan.current) return;
    reviewRan.current = true;
    void runReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ratingRow = rating.data as Record<string, unknown> | null | undefined;
  const revealedRef = useRef(false);
  useEffect(() => {
    if (step === 'rating' && reviewState === 'done' && ratingRow && !revealedRef.current) {
      revealedRef.current = true;
      track('evo_rating_revealed', {
        ...FLOW_PROPS,
        user_type: userType,
        rating_band: ratingBand(Number(ratingRow.displayed_rating ?? NaN)),
        confidence_label: String(ratingRow.confidence_label ?? 'provisional'),
      });
    }
  }, [step, reviewState, ratingRow, userType]);

  /* ---------------- step 2: candidates -------------------------------- */
  const wantsCandidates = step === 'candidates' || step === 'confirm';
  const candidates = useOriginCandidates(wantsCandidates);
  const calibrationTracked = useRef(false);
  const generatedTracked = useRef(false);
  const revealedCardsTracked = useRef(false);

  useEffect(() => {
    if (wantsCandidates && !calibrationTracked.current) {
      calibrationTracked.current = true;
      track('origin_calibration_started', { ...FLOW_PROPS, user_type: userType });
    }
  }, [wantsCandidates, userType]);

  const result = candidates.data;
  const candidateList = result?.ok && result.candidates ? result.candidates : null;

  useEffect(() => {
    if (candidateList && result && !generatedTracked.current) {
      generatedTracked.current = true;
      track('origin_candidates_generated', {
        ...FLOW_PROPS,
        user_type: userType,
        candidate_ids: candidateList.map((c) => c.originId),
        types: candidateList.map((c) => c.recommendationType),
        recommended: result.recommended_origin ?? null,
        model_version: result.candidate_model_version ?? 5,
      });
    }
  }, [candidateList, result, userType]);

  const [selected, setSelected] = useState<OriginId | null>(null);
  useEffect(() => {
    if (step === 'candidates' && candidateList && !revealedCardsTracked.current) {
      revealedCardsTracked.current = true;
      track('origin_candidates_revealed', {
        ...FLOW_PROPS,
        user_type: userType,
        candidate_ids: candidateList.map((c) => c.originId),
        recommended: result?.recommended_origin ?? null,
      });
    }
  }, [step, candidateList, result, userType]);

  /* ---------------- step 3: binding ------------------------------------ */
  const bind = useBindOrigin();

  const doBind = async () => {
    if (!selected || bind.isPending) return;
    track('origin_binding_started', { ...FLOW_PROPS, user_type: userType, origin_id: selected });
    try {
      const r = await bind.mutateAsync(selected);
      if (!r.ok) {
        track('origin_binding_failed', { ...FLOW_PROPS, user_type: userType, reason: r.reason ?? 'unknown' });
        useToastStore.getState().push({ kind: 'error', title: 'NOT BOUND', subtitle: 'Try again.' });
        return;
      }
      boundRef.current = selected;
      setBoundOrigin(selected);
      track('origin_binding_completed', {
        ...FLOW_PROPS,
        user_type: userType,
        origin_id: selected,
        followed_recommendation: r.followed_recommendation ?? null,
      });
      // First-mission rider: real data, never blocking (spec §6).
      void seedFirstMissionIfNeeded(selected);
      setStep('awakening');
    } catch {
      track('origin_binding_failed', { ...FLOW_PROPS, user_type: userType, reason: 'network' });
      useToastStore.getState().push({ kind: 'error', title: 'NOT BOUND', subtitle: 'Connection problem — try again.' });
    }
  };

  /* ---------------- step 4: awakening ---------------------------------- */
  const awakenedTracked = useRef(false);
  useEffect(() => {
    if (step === 'awakening' && boundOrigin && !awakenedTracked.current) {
      awakenedTracked.current = true;
      track('stage_one_awakened', { ...FLOW_PROPS, user_type: userType, origin_id: boundOrigin });
    }
  }, [step, boundOrigin, userType]);

  const finish = () => {
    if (userType === 'new') {
      track('onboarding_completed', { ...FLOW_PROPS, duration_ms: Date.now() - startedAt.current });
    }
    onComplete();
  };

  /* ---------------- render ---------------------------------------------- */
  return (
    <View className="flex-1" style={{ backgroundColor: colors['bg-deep'] }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: -220, left: -200, width: 440, height: 440, borderRadius: 220, backgroundColor: 'rgba(34, 211, 238, 0.05)' }} />
      <ScrollView className="flex-1" contentContainerClassName="items-center p-s6">
        <View className="w-full max-w-[480px]">
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
          >
            THE ORIGIN CEREMONY
          </Text>
          <Text
            className="mb-s5 text-accent"
            allowFontScaling={false}
            style={{
              fontSize: 26,
              lineHeight: 32,
              letterSpacing: 0,
              textShadowColor: 'rgba(34,211,238,0.55)',
              textShadowRadius: 18,
              ...pixelFont(),
            }}
          >
            {step === 'rating' && 'WHERE YOU STAND'}
            {step === 'candidates' && 'CHOOSE YOUR ORIGIN'}
            {step === 'confirm' && 'BIND YOUR ORIGIN'}
            {step === 'awakening' && 'THE AWAKENING'}
          </Text>

          {step === 'rating' ? (
            <>
              {reviewState === 'error' ? (
                <GlowCard glow={colors.danger} padding={16}>
                  <Text className="text-sm text-text">The review could not run.</Text>
                  <Text className="mt-s1 text-xs text-text-dim">
                    Check your connection — your character is saved and nothing is lost.
                  </Text>
                  <View className="mt-s3">
                    <NeonButton title="RETRY" onPress={() => void runReview()} testID="origin-review-retry" />
                  </View>
                </GlowCard>
              ) : reviewState === 'done' && ratingRow ? (
                <>
                  <RatingReveal row={ratingRow} testID="origin-rating-reveal" />
                  <View className="mt-s4">
                    <NeonButton title="FIND YOUR ORIGIN" onPress={() => setStep('candidates')} testID="origin-to-candidates" />
                  </View>
                </>
              ) : (
                <View className="items-center py-s6">
                  <ActivityIndicator color={colors.accent} />
                  <Text className="mt-s3 text-xs text-text-mute">Reading your training profile…</Text>
                </View>
              )}
            </>
          ) : null}

          {step === 'candidates' ? (
            <>
              {candidates.isPending || (result && !result.ok && !candidates.isError) ? (
                <View className="items-center py-s6">
                  <ActivityIndicator color={colors.accent} />
                  <Text className="mt-s3 text-xs text-text-mute">
                    {result && !result.ok ? 'Calibrating…' : 'Forging your candidates…'}
                  </Text>
                </View>
              ) : candidateList ? (
                <>
                  {candidateList.map((c) => (
                    <View key={c.originId} className="mb-s3">
                      <OriginCandidateCard
                        candidate={c}
                        recommended={result?.recommended_origin === c.originId}
                        selected={selected === c.originId}
                        onSelect={() => {
                          setSelected(c.originId as OriginId);
                          track('origin_selected', {
                            ...FLOW_PROPS,
                            user_type: userType,
                            origin_id: c.originId,
                            type: c.recommendationType,
                            followed_recommendation: result?.recommended_origin === c.originId,
                          });
                        }}
                        sex={sex}
                        testID={`origin-candidate-${c.originId}`}
                      />
                    </View>
                  ))}
                  <Text className="mb-s3 text-2xs text-text-mute">
                    Three Origins fit your rating, your goal and your style. The choice is yours —
                    and after three real workouts you earn one free Reforge.
                  </Text>
                  <NeonButton
                    title="CONTINUE"
                    disabled={!selected}
                    onPress={() => setStep('confirm')}
                    testID="origin-confirm-open"
                  />
                </>
              ) : (
                <GlowCard glow={colors.danger} padding={16}>
                  <Text className="text-sm text-text">Your candidates could not be forged.</Text>
                  <Text className="mt-s1 text-xs text-text-dim">
                    Check your connection — this step never blocks your account.
                  </Text>
                  <View className="mt-s3">
                    <NeonButton title="RETRY" onPress={() => void candidates.refetch()} testID="origin-candidates-retry" />
                  </View>
                </GlowCard>
              )}
            </>
          ) : null}

          {step === 'confirm' && selected ? (
            <GlowCard glow={colors.legendary} padding={18}>
              <Text
                className="text-text"
                allowFontScaling={false}
                style={{ fontSize: 15, letterSpacing: 0, ...pixelFont() }}
              >
                BIND {PATH_NAMES[selected]?.toUpperCase() ?? selected.toUpperCase()}?
              </Text>
              <Text className="mt-s2 text-xs text-text-dim">
                Your Origin is recorded permanently as your Firstbound and your Stage 1 Champion
                awakens immediately. Origin Mastery and Champion Bond never decrease. One free
                Reforge unlocks after three valid workouts.
              </Text>
              <View className="mt-s4 gap-s2">
                <NeonButton
                  title={bind.isPending ? 'BINDING' : 'BIND ORIGIN'}
                  busy={bind.isPending}
                  onPress={() => void doBind()}
                  testID="origin-bind"
                />
                <NeonButton
                  title="BACK"
                  variant="ghost"
                  disabled={bind.isPending}
                  onPress={() => setStep('candidates')}
                  testID="origin-bind-back"
                />
              </View>
            </GlowCard>
          ) : null}

          {step === 'awakening' && boundOrigin ? (
            <>
              <AwakeningCeremony
                originId={boundOrigin}
                originName={PATH_NAMES[boundOrigin] ?? boundOrigin}
                sex={sex}
                testID="origin-awakening"
              />
              <View className="mt-s4">
                <NeonButton title="ENTER THE FORGE" onPress={finish} testID="origin-finish" />
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

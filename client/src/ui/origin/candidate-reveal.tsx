/**
 * EXISTING-USER ORIGIN INTRODUCTION (047 program, Phase 5 —
 * docs/EXISTING_USER_ORIGIN_MIGRATION.md): the Forge reveal upgraded to the
 * v5 three-candidate experience behind ORIGIN_FLAGS.candidateRevealEnabled.
 * Shares the onboarding Act II components so both surfaces can never drift.
 *
 * Existing users are NEVER routed through /onboarding (the gate needs
 * onboarding_flow_version >= 2, which only the new-flow insert writes).
 * The v5 engine's tier-S/goal fallbacks guarantee three cards even for a
 * minimal legacy profile — nobody hits a dead end (E-4).
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { track } from '@/data/analytics';
import { useProfile } from '@/data/hooks';
import {
  PATH_NAMES,
  useBindOrigin,
  useOriginCandidates,
} from '@/data/origin';
import type { OriginId } from '@/domain/origin/types';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useToastStore } from '@/state/toast-store';
import { NeonButton } from '@/ui/core/neon-button';
import { playPowerUp } from '@/ui/core/sound';
import { GlowCard } from '@/ui/core/shell';

import { OriginCandidateCard } from './candidate-card';

const FLOW_PROPS = { calibration_version: 5, user_type: 'migrated' as const };

export function CandidateReveal() {
  const colors = useThemeColors();
  const profile = useProfile();
  const candidates = useOriginCandidates(true);
  const bind = useBindOrigin();
  const [selected, setSelected] = useState<OriginId | null>(null);
  const tracked = useRef(false);

  const result = candidates.data;
  const list = result?.ok && result.candidates ? result.candidates : null;

  useEffect(() => {
    if (!list || !result || tracked.current) return;
    tracked.current = true;
    track('origin_calibration_started', FLOW_PROPS);
    track('origin_candidates_generated', {
      ...FLOW_PROPS,
      candidate_ids: list.map((c) => c.originId),
      types: list.map((c) => c.recommendationType),
      recommended: result.recommended_origin ?? null,
      model_version: result.candidate_model_version ?? 5,
    });
    track('origin_candidates_revealed', {
      ...FLOW_PROPS,
      candidate_ids: list.map((c) => c.originId),
      recommended: result.recommended_origin ?? null,
    });
  }, [list, result]);

  const doBind = async () => {
    if (!selected || bind.isPending) return;
    track('origin_binding_started', { ...FLOW_PROPS, origin_id: selected });
    try {
      const r = await bind.mutateAsync(selected);
      if (!r.ok) {
        track('origin_binding_failed', { ...FLOW_PROPS, reason: r.reason ?? 'unknown' });
        useToastStore.getState().push({ kind: 'error', title: 'NOT BOUND', subtitle: 'Try again.' });
        return;
      }
      track('origin_binding_completed', {
        ...FLOW_PROPS,
        origin_id: selected,
        followed_recommendation: r.followed_recommendation ?? null,
      });
      playPowerUp();
      useToastStore.getState().push({
        kind: 'achievement',
        title: 'ORIGIN BOUND',
        subtitle: `${PATH_NAMES[selected] ?? selected} — Stage 1 unlocked, Firstbound recorded`,
      });
    } catch {
      track('origin_binding_failed', { ...FLOW_PROPS, reason: 'network' });
      useToastStore.getState().push({ kind: 'error', title: 'NOT BOUND', subtitle: 'Connection problem — try again.' });
    }
  };

  if (candidates.isPending) {
    return (
      <GlowCard glow={colors.legendary} padding={16}>
        <View className="items-center py-s3">
          <ActivityIndicator color={colors.accent} />
          <Text className="mt-s2 text-xs text-text-mute">Forging your candidates…</Text>
        </View>
      </GlowCard>
    );
  }

  if (!list) {
    // The candidates RPC failed — never a dead end: the legacy discover
    // banner copy still applies (scan + training sharpen the reveal).
    return (
      <View
        className="rounded-xl border p-s3"
        style={{ borderColor: `${colors.legendary}45`, backgroundColor: 'rgba(251,191,36,0.05)' }}
        testID="origin-banner"
      >
        <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.legendary, letterSpacing: 1.5, ...pixelFont(false) }}>
          ✦ YOUR ORIGIN AWAITS
        </Text>
        <Text className="mt-s1 text-2xs text-text-mute">
          Keep training and run an Evo scan — once EvoForge knows enough about you, your Origin Path is
          revealed and its Stage 1 champion joins your collection. Your current champion will not change.
        </Text>
        <View className="mt-s3">
          <NeonButton title="RETRY" variant="ghost" onPress={() => void candidates.refetch()} testID="origin-candidates-retry" />
        </View>
      </View>
    );
  }

  return (
    <GlowCard glow={colors.legendary} padding={14}>
      <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.legendary, letterSpacing: 2, ...pixelFont(false) }}>
        CHOOSE YOUR ORIGIN
      </Text>
      <Text className="mt-s1 mb-s3 text-2xs text-text-mute">
        Three Origins fit your rating, your goal and your style. The choice is permanent and
        Firstbound — with one free Reforge earned after three valid workouts.
      </Text>
      {list.map((c) => (
        <View key={c.originId} className="mb-s3">
          <OriginCandidateCard
            candidate={c}
            recommended={result?.recommended_origin === c.originId}
            selected={selected === c.originId}
            onSelect={() => {
              setSelected(c.originId as OriginId);
              track('origin_selected', {
                ...FLOW_PROPS,
                origin_id: c.originId,
                type: c.recommendationType,
                followed_recommendation: result?.recommended_origin === c.originId,
              });
            }}
            sex={profile.data?.sex ?? 'male'}
            testID={`origin-candidate-${c.originId}`}
          />
        </View>
      ))}
      <NeonButton
        title={selected ? `BIND ${(PATH_NAMES[selected] ?? selected).toUpperCase()} · STAGE 1` : 'CHOOSE YOUR ORIGIN'}
        disabled={!selected}
        busy={bind.isPending}
        pixel
        onPress={() => void doBind()}
        testID="origin-claim"
      />
    </GlowCard>
  );
}

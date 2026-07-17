import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  ORIGIN_FLAGS,
  PATH_NAMES,
  useAssignOrigin,
  useClassification,
  useOriginStatus,
  useUserPaths,
} from '@/data/origin';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { playPowerUp } from '@/ui/core/sound';
import { GlowCard } from '@/ui/core/shell';
import { CandidateReveal } from '@/ui/origin/candidate-reveal';

/**
 * ORIGIN PANEL (Releases 4+5, ORIGIN_PATH_PLAN.md) — one component, three
 * states, mounted on the Forge screen:
 *   1. Origin unset + classification OK → the REVEAL. With
 *      ORIGIN_FLAGS.candidateRevealEnabled (047 program, Phase 5) this is
 *      the v5 three-candidate experience (<CandidateReveal/>); flag OFF
 *      renders the deployed v4 choice reveal unchanged. Since 042, claiming
 *      EQUIPS the origin champion (assign sets active_path unconditionally).
 *   2. Origin unset + not enough data → the DISCOVER banner ("your current
 *      champion will not change").
 *   3. Origin set → the PATH ROSTER: every unlocked path, its stage, the
 *      ORIGIN and ACTIVE tags.
 */
export function OriginPanel() {
  const colors = useThemeColors();
  const status = useOriginStatus();
  const originUnset = status.data != null && status.data.origin_path == null;
  const classification = useClassification(
    ORIGIN_FLAGS.originRevealEnabled && !ORIGIN_FLAGS.candidateRevealEnabled && originUnset,
  );
  const assign = useAssignOrigin();
  const paths = useUserPaths();
  const [picked, setPicked] = useState<string | null>(null);

  if (!ORIGIN_FLAGS.originRevealEnabled || status.data == null) return null;

  // 3 · roster
  if (status.data.origin_path != null) {
    if (!ORIGIN_FLAGS.pathRosterEnabled || !paths.data || paths.data.length === 0) return null;
    return (
      <GlowCard padding={14}>
        <Text allowFontScaling={false} style={{ fontSize: 10, color: colors['text-mute'], letterSpacing: 1.5, ...pixelFont(false) }}>
          YOUR PATHS
        </Text>
        <View className="mt-s2 gap-s1">
          {paths.data.filter((p) => p.is_unlocked).map((p) => (
            <View key={p.path} className="flex-row items-center justify-between" style={{ minHeight: 28 }}>
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <Text className="text-sm font-bold text-text">{PATH_NAMES[p.path] ?? p.path}</Text>
                {p.is_origin ? (
                  <Text allowFontScaling={false} style={{ fontSize: 8, color: colors.legendary, letterSpacing: 0.5, ...pixelFont(false) }}>
                    ORIGIN
                  </Text>
                ) : null}
                {status.data?.active_path === p.path ? (
                  <Text allowFontScaling={false} style={{ fontSize: 8, color: colors.accent, letterSpacing: 0.5, ...pixelFont(false) }}>
                    ACTIVE
                  </Text>
                ) : null}
              </View>
              <Text allowFontScaling={false} style={{ fontSize: 11, color: colors['text-dim'], ...pixelFont() }}>
                STAGE {p.current_stage}
              </Text>
            </View>
          ))}
        </View>
      </GlowCard>
    );
  }

  // 1b · the v5 candidate reveal (047, Phase 5) — existing users' upgraded
  // introduction flow, sharing the onboarding Act II components.
  if (ORIGIN_FLAGS.candidateRevealEnabled) {
    return <CandidateReveal />;
  }

  // 2 · discover banner (no/insufficient data — never guess)
  const cls = classification.data;
  if (!cls || !cls.ok) {
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
      </View>
    );
  }

  // 1 · the reveal
  const choices = cls.choices ?? [];
  const offerChoice = Boolean(cls.requires_choice) && choices.length > 1;
  const selection = offerChoice ? picked : (cls.recommended_path ?? null);
  return (
    <GlowCard glow={colors.legendary} padding={14}>
      <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.legendary, letterSpacing: 2, ...pixelFont(false) }}>
        ORIGIN PATH DISCOVERED
      </Text>
      <Text className="mt-s1 text-2xs text-text-mute">
        {cls.shredder_auto
          ? 'You are cutting from a heavy build — your journey IS the character. The Shredder walks with you until the cut is done.'
          : offerChoice
            ? 'Your scores are close — choose the path that defines you. This choice is permanent.'
            : `Your training points one way: ${PATH_NAMES[cls.recommended_path ?? ''] ?? ''}. Claiming unlocks its Stage 1 champion.`}
      </Text>
      {/* score breakdown — ordered by the server's affinity ranking (v3):
          the raw numbers sit on different per-pillar scales, so raw-desc
          order would contradict the recommendation. */}
      <View className="mt-s2 flex-row flex-wrap" style={{ gap: 6 }}>
        {Object.entries(cls.scores ?? {})
          .sort((a, b) => {
            const rank = cls.ranking ?? [];
            const ra = rank.indexOf(a[0]);
            const rb = rank.indexOf(b[0]);
            if (ra !== rb) return (ra === -1 ? rank.length : ra) - (rb === -1 ? rank.length : rb);
            return b[1] - a[1];
          })
          .map(([k, v]) => (
          <Text key={k} allowFontScaling={false} style={{ fontSize: 8, color: colors['text-dim'], letterSpacing: 0.5, ...pixelFont(false) }}>
            {(PATH_NAMES[k] ?? k).toUpperCase()} {Math.round(v)}
          </Text>
        ))}
      </View>
      {offerChoice ? (
        <View className="mt-s2 flex-row flex-wrap" style={{ gap: 6 }}>
          {choices.map((c) => (
            <Pressable
              key={c}
              onPress={() => setPicked(c)}
              accessibilityRole="button"
              testID={`origin-choice-${c}`}
              className="rounded-lg border px-s3 py-s2"
              style={{
                minHeight: 40,
                justifyContent: 'center',
                borderColor: picked === c ? `${colors.legendary}b3` : colors.border,
                backgroundColor: picked === c ? 'rgba(251,191,36,0.10)' : 'rgba(13,21,36,0.5)',
              }}
            >
              <Text allowFontScaling={false} style={{ fontSize: 10, color: picked === c ? colors.legendary : colors['text-dim'], ...pixelFont() }}>
                {PATH_NAMES[c] ?? c}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View className="mt-s3">
        <NeonButton
          title={selection ? `CLAIM ${(PATH_NAMES[selection] ?? selection).toUpperCase()} · STAGE 1` : 'CHOOSE YOUR PATH'}
          disabled={!selection}
          busy={assign.isPending}
          pixel
          onPress={() => {
            if (!selection) return;
            assign.mutate(selection, { onSuccess: (r) => { if (r.ok) playPowerUp(); } });
          }}
          testID="origin-claim"
        />
      </View>
    </GlowCard>
  );
}

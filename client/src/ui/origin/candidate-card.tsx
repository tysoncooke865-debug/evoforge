/**
 * ORIGIN ONBOARDING — one candidate card (docs/ORIGIN_ONBOARDING_SPEC.md §9).
 *
 * Recommendation copy comes ONLY from reasonText(reasonCodes) — components
 * never invent strings (C-8). Art is the candidate's OWN line only (never a
 * substitute body): stage-1 still/painted + the stage-4 silhouette as a
 * tinted still. Battle preview derives from the EXISTING domain
 * (championForBranch → CHAMPIONS / movesForChampion / styleOfChampion) —
 * nothing is duplicated.
 */

import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { track } from '@/data/analytics';
import type { OriginCandidatePayload } from '@/data/origin';
import { PATH_NAMES } from '@/data/origin';
import { championForBranch, CHAMPIONS } from '@/domain/battle-rpg/champions';
import { movesForChampion } from '@/domain/battle-rpg/moves';
import { STYLE_META, styleOfChampion } from '@/domain/battle-rpg/style';
import type { BranchV2 } from '@/domain/branches-v2';
import { reasonText } from '@/domain/origin/candidates';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { avatarArtV2, stillAvatar } from '@/ui/character/avatar-art';
import { GlowCard } from '@/ui/core/shell';

const TYPE_LABEL: Record<OriginCandidatePayload['recommendationType'], string> = {
  resonant: 'RESONANT',
  destined: 'DESTINED',
  anomaly: 'ANOMALY',
};

const TYPE_BLURB: Record<OriginCandidatePayload['recommendationType'], string> = {
  resonant: 'Who you already are',
  destined: 'Who you want to become',
  anomaly: 'The wild card',
};

function artFor(branch: BranchV2, stage: number, sex: 'male' | 'female') {
  return stillAvatar(branch, stage, sex) ?? avatarArtV2(branch, stage, sex).source ?? null;
}

function AlignBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View className="mt-s1 flex-row items-center gap-s2">
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ width: 74, fontSize: 8, letterSpacing: 0.5, ...pixelFont(false) }}
      >
        {label}
      </Text>
      <View className="h-[6px] flex-1 overflow-hidden rounded-full bg-surface-2">
        <View style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: 6, backgroundColor: color }} />
      </View>
    </View>
  );
}

export function OriginCandidateCard({
  candidate,
  recommended,
  selected,
  onSelect,
  sex,
  testID,
}: {
  candidate: OriginCandidatePayload;
  recommended: boolean;
  selected: boolean;
  onSelect: () => void;
  sex: 'male' | 'female';
  testID?: string;
}) {
  const colors = useThemeColors();
  const [preview, setPreview] = useState(false);
  const openedAt = useRef<number>(0);

  const branch = candidate.originId as BranchV2;
  const champion = CHAMPIONS[championForBranch(branch as never)];
  const style = STYLE_META[styleOfChampion(champion.id)];
  const moves = movesForChampion(champion.id).slice(0, 3);
  const stage1 = artFor(branch, 1, sex);
  const stage4 = artFor(branch, 4, sex);
  const name = PATH_NAMES[candidate.originId] ?? candidate.originId;

  const togglePreview = () => {
    if (!preview) {
      openedAt.current = Date.now();
      track('origin_candidate_viewed', { origin_id: candidate.originId, type: candidate.recommendationType });
      onSelect();
    } else {
      track('origin_candidate_viewed', {
        origin_id: candidate.originId,
        type: candidate.recommendationType,
        dwell_ms: Date.now() - openedAt.current,
      });
    }
    setPreview(!preview);
  };

  return (
    <Pressable
      onPress={togglePreview}
      accessibilityRole="button"
      accessibilityLabel={`${TYPE_LABEL[candidate.recommendationType]} origin ${name}${recommended ? ', recommended' : ''}`}
      accessibilityState={{ selected, expanded: preview }}
      testID={testID}
    >
      <GlowCard glow={selected ? colors.accent : colors.border} padding={14}>
        <View className="flex-row items-center gap-s3">
          <View
            className="items-center justify-center rounded-md bg-surface-2"
            style={{ width: 72, height: 88, overflow: 'hidden' }}
          >
            {stage1 ? (
              <Image source={stage1} style={{ width: 66, height: 82 }} contentFit="contain" />
            ) : (
              <Text className="text-2xl text-text-mute">?</Text>
            )}
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-s2">
              <Text
                allowFontScaling={false}
                style={{ fontSize: 9, letterSpacing: 1, color: colors.epic, ...pixelFont(false) }}
              >
                {TYPE_LABEL[candidate.recommendationType]}
              </Text>
              {recommended ? (
                <Text
                  allowFontScaling={false}
                  style={{ fontSize: 9, letterSpacing: 1, color: colors.legendary, ...pixelFont(false) }}
                >
                  ★ RECOMMENDED
                </Text>
              ) : null}
            </View>
            <Text
              className="mt-s1 text-text"
              allowFontScaling={false}
              style={{ fontSize: 15, letterSpacing: 0, ...pixelFont() }}
            >
              {name}
            </Text>
            <Text className="text-2xs text-text-mute">{TYPE_BLURB[candidate.recommendationType]}</Text>
            <Text className="mt-s1 text-xs text-text-dim" numberOfLines={preview ? undefined : 2}>
              {candidate.reasonCodes.map((c) => reasonText(c as never)).join(' · ')}
            </Text>
          </View>
        </View>

        {preview ? (
          <View className="mt-s3 border-t border-border pt-s3">
            <AlignBar label="CURRENT FIT" value={candidate.currentStrengthMatch} color={colors.accent} />
            <AlignBar label="GOAL MATCH" value={candidate.goalAlignment} color={colors.epic} />
            <AlignBar label="PLAYSTYLE" value={candidate.playstyleAlignment} color={colors.success} />

            <View className="mt-s3 flex-row gap-s3">
              {stage4 ? (
                <View className="items-center">
                  <View
                    className="items-center justify-center rounded-md bg-surface-2"
                    style={{ width: 56, height: 68, overflow: 'hidden' }}
                  >
                    <Image
                      source={stage4}
                      style={{ width: 52, height: 62, tintColor: 'rgba(34,211,238,0.35)' }}
                      contentFit="contain"
                    />
                  </View>
                  <Text className="mt-s1 text-2xs text-text-mute">STAGE 4</Text>
                </View>
              ) : null}
              <View className="flex-1">
                <Text
                  allowFontScaling={false}
                  style={{ fontSize: 9, letterSpacing: 1, color: colors['text-mute'], ...pixelFont(false) }}
                >
                  BATTLE KIT — {champion.name.toUpperCase()}
                </Text>
                <Text className="mt-s1 text-2xs text-text-dim">{champion.identity}</Text>
                <Text className="mt-s1 text-2xs" style={{ color: style.color }}>
                  {style.icon} {style.label} STYLE
                </Text>
                {moves.map((m) => (
                  <Text key={m.id} className="mt-s1 text-2xs text-text-dim" numberOfLines={1}>
                    {m.name}{m.basePower > 0 ? ` · ${m.basePower}` : ''}
                  </Text>
                ))}
              </View>
            </View>
            <Pressable
              onPress={() => track('origin_candidate_trialled', { origin_id: candidate.originId })}
              accessibilityRole="button"
              testID={testID ? `${testID}-trial` : undefined}
            >
              <Text className="mt-s2 text-2xs text-text-mute">
                Signature moves scale with your real training. Full battles unlock in the Arena.
              </Text>
            </Pressable>
          </View>
        ) : null}
      </GlowCard>
    </Pressable>
  );
}

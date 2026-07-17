/**
 * PROGRESSION_OVERHAUL P5 — the EVO CORE (spec §30). Home's window into
 * the new progression: rating + descriptor, Evolution Progress, the four
 * pillars, the limiting pillar, next review, pending evidence. Flag-off
 * or no data → renders nothing (never a mocked state). No confirmed
 * rating yet → the DISCOVER door runs the first official review.
 */

import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { progressionFeatures } from '@/data/progression/features';
import { todayIso as calendarToday } from '@/domain/today';
import {
  useEvoRatingCurrent,
  usePendingEvoEvidence,
  useRunEvoReview,
} from '@/data/progression/use-evo-rating';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { GlowCard } from '@/ui/core/shell';
import { NeonButton } from '@/ui/core/neon-button';

const PILLAR_ROWS: readonly (readonly [key: string, label: string])[] = [
  ['size_score', 'SIZE'],
  ['aesthetics_score', 'AESTHETICS'],
  ['strength_score', 'STRENGTH'],
  ['cardio_score', 'CARDIO'],
];

export function EvoCore() {
  const colors = useThemeColors();
  const current = useEvoRatingCurrent();
  const pending = usePendingEvoEvidence();
  const review = useRunEvoReview();

  if (!progressionFeatures.newProgressionEnabled) return null;
  if (current.isPending) return null;

  const row = current.data as Record<string, unknown> | null;

  if (!row) {
    return (
      <GlowCard glow={colors.epic} padding={16}>
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
          EVO RATING
        </Text>
        <Text className="mt-s2 text-text" allowFontScaling={false} style={{ fontSize: 19, letterSpacing: 0, ...pixelFont() }}>
          DISCOVER YOUR EVO RATING
        </Text>
        <Text className="mt-s1 text-sm text-text-dim">
          Your real-world gym level from Size, Aesthetics, Strength and Cardio.
        </Text>
        <View className="mt-s3">
          <NeonButton
            title="RUN FIRST EVO REVIEW"
            pixel
            busy={review.isPending}
            onPress={() => review.mutate({ force: true })}
            testID="evo-discover"
          />
        </View>
      </GlowCard>
    );
  }

  const rating = Number(row.displayed_rating ?? 1);
  const progress = Number(row.evolution_progress ?? 0);
  const descriptor = String(row.descriptor ?? 'Untrained').toUpperCase();
  const limiting = row.limiting_pillar ? String(row.limiting_pillar).toUpperCase() : null;
  const status = String(row.status ?? 'provisional');
  // Day-resolution countdown off the local calendar day (todayIso is the
  // app-wide clock seam; Date.now() in render trips the compiler's purity).
  const nextReviewAt = row.next_review_at ? Date.parse(String(row.next_review_at)) : null;
  const todayStart = Date.parse(`${calendarToday()}T00:00:00Z`);
  const daysToReview =
    nextReviewAt !== null ? Math.max(0, Math.ceil((nextReviewAt - todayStart) / 86_400_000)) : null;
  const pendingCount = pending.data?.length ?? 0;
  const reviewDue = daysToReview === 0;

  return (
    <Pressable
      onPress={() => router.push('/evo' as never)}
      accessibilityRole="button"
      accessibilityLabel={`Evo Rating ${rating}, ${descriptor}. ${progress} of 100 toward ${Math.min(rating + 1, 100)}. Opens the Evo Rating page.`}
      testID="evo-core"
    >
      <GlowCard glow={colors.epic} padding={16}>
        <View className="flex-row items-start justify-between">
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              EVO RATING{status === 'provisional' ? ' · PROVISIONAL' : ''}
            </Text>
            <View className="flex-row items-baseline" style={{ gap: 8 }}>
              <Text
                allowFontScaling={false}
                style={{ fontSize: 44, lineHeight: 50, letterSpacing: 0, color: colors.epic, textShadowColor: 'rgba(168,85,247,0.5)', textShadowRadius: 14, ...pixelFont() }}
              >
                {rating}
              </Text>
              <Text className="text-text" allowFontScaling={false} style={{ fontSize: 12, letterSpacing: 0, ...pixelFont() }}>
                {descriptor}
              </Text>
            </View>
          </View>
          <View className="items-end">
            {PILLAR_ROWS.map(([key, label]) => (
              <View key={key} className="flex-row items-baseline" style={{ gap: 6 }}>
                <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 0.5, ...pixelFont(false) }}>
                  {label}
                </Text>
                <Text
                  allowFontScaling={false}
                  style={{ fontSize: 13, letterSpacing: 0, minWidth: 26, textAlign: 'right', color: limiting === label ? colors.warn : colors.text, ...pixelFont() }}
                >
                  {Math.floor(Number(row[key] ?? 1))}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Evolution Progress toward the next rating. */}
        <View className="mt-s3">
          <View className="flex-row items-center justify-between">
            <Text className="text-2xs text-text-dim" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont(false) }}>
              EVOLUTION {progress}/100
            </Text>
            <Text className="text-2xs text-text-mute" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont(false) }}>
              TOWARD {Math.min(rating + 1, 100)}
            </Text>
          </View>
          <View className="mt-s1 overflow-hidden rounded-pill" style={{ height: 6, backgroundColor: colors['surface-3'] }}>
            <View style={{ width: `${progress}%`, minWidth: progress > 0 ? 4 : 0, height: '100%', borderRadius: 999, backgroundColor: colors.epic }} />
          </View>
        </View>

        <View className="mt-s2 flex-row items-center justify-between">
          <Text className="text-2xs text-text-mute" numberOfLines={1}>
            {limiting ? `Limiting pillar: ${limiting.toLowerCase()}` : ' '}
          </Text>
          <Text className="text-2xs" style={{ color: reviewDue || pendingCount > 0 ? colors.accent : colors['text-mute'] }} numberOfLines={1}>
            {reviewDue
              ? 'EVO REVIEW READY ›'
              : daysToReview !== null
                ? `Next review: ${daysToReview}d${pendingCount > 0 ? ` · ${pendingCount} pending` : ''}`
                : ''}
          </Text>
        </View>
      </GlowCard>
    </Pressable>
  );
}

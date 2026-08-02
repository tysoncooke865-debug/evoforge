/**
 * PROGRESSION_OVERHAUL P5 — the EVO CORE (spec §30). Home's window into
 * the new progression. Flag-off or no data → renders nothing (never a
 * mocked state). No confirmed rating yet → the DISCOVER door runs the
 * first official review.
 *
 * SIMPLIFIED 2026-08-02 (Tyson: "make the evo rating display more simple").
 * The card used to say eight things at once — rating, descriptor, status,
 * four pillar scores, a progress bar with two captions, the limiting
 * pillar and a review countdown — so the one number it exists to show had
 * to compete with seven others. It now says THREE: the rating, where it is
 * heading, and (only when there is something to act on) the review door.
 * The pillars, the limiting pillar and the countdown were not deleted —
 * they live on /evo, which this whole card is the door to.
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
import { SectionLabel } from '@/ui/core/screen-header';
import { GlowCard } from '@/ui/core/shell';
import { NeonButton } from '@/ui/core/neon-button';

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
        <SectionLabel size="lg">EVO RATING</SectionLabel>
        <Text className="text-text" allowFontScaling={false} style={{ fontSize: 19, letterSpacing: 0, ...pixelFont() }}>
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
  const status = String(row.status ?? 'provisional');
  // Day-resolution countdown off the local calendar day (todayIso is the
  // app-wide clock seam; Date.now() in render trips the compiler's purity).
  // Only its ZERO matters to this card now — the door lights up the day a
  // review is available; the countdown itself reads on /evo.
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
      <GlowCard glow={colors.epic} padding={14}>
        {/* Line 1 — the label, and the ONLY status worth a pixel here: a
            review you can act on right now. A countdown to one you can't
            ("Next review: 5d") is not a thing to do, so it stays on /evo. */}
        <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            EVO RATING
          </Text>
          {reviewDue || pendingCount > 0 ? (
            <Text
              className="text-2xs"
              numberOfLines={1}
              style={{ letterSpacing: 1, color: colors.accent }}
              testID="evo-review-ready"
            >
              {reviewDue ? 'EVO REVIEW READY ›' : `${pendingCount} PENDING ›`}
            </Text>
          ) : status === 'provisional' ? (
            <Text className="text-2xs text-text-mute" numberOfLines={1} style={{ letterSpacing: 1 }}>
              PROVISIONAL
            </Text>
          ) : null}
        </View>

        {/* Line 2 — the number, and the word for it. Nothing else. */}
        <View className="mt-s1 flex-row items-baseline" style={{ gap: 10 }}>
          <Text
            allowFontScaling={false}
            style={{ fontSize: 40, lineHeight: 44, letterSpacing: 0, color: colors.epic, textShadowColor: 'rgba(168,85,247,0.5)', textShadowRadius: 14, ...pixelFont() }}
          >
            {rating}
          </Text>
          <Text
            className="text-text"
            numberOfLines={1}
            allowFontScaling={false}
            style={{ flex: 1, fontSize: 12, letterSpacing: 0, ...pixelFont() }}
          >
            {descriptor}
          </Text>
        </View>

        {/* Line 3 — where it is heading. The bar and its caption share a row
            (they were two stacked rows saying the same thing twice). */}
        <View className="mt-s2 flex-row items-center" style={{ gap: 10 }}>
          <View className="flex-1 overflow-hidden rounded-pill" style={{ height: 6, backgroundColor: colors['surface-3'] }}>
            <View style={{ width: `${progress}%`, minWidth: progress > 0 ? 4 : 0, height: '100%', borderRadius: 999, backgroundColor: colors.epic }} />
          </View>
          {/* "TO", not "→": Jersey10's cmap has no U+2192 (checked), and a
              missing glyph in a pixel face renders as tofu on web. */}
          <Text className="text-2xs text-text-mute" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont(false) }}>
            {progress}/100 TO {Math.min(rating + 1, 100)}
          </Text>
        </View>
      </GlowCard>
    </Pressable>
  );
}

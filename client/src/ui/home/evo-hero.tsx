/**
 * HOME §1 (2026-08-03) — THE EVO RATING HERO.
 *
 * This replaces the old EVO CORE card. Same hooks, same states, same doors —
 * a different job. The card treated the rating as one statistic among many
 * on a page of cards; the brief's whole thesis is that the rating IS the
 * product ("I'm Evo 51", not "I bench 90kg"), so it is now the first thing
 * on the page, rendered at 2-3x the card's 40pt numeral, on a crest, with
 * nothing beside it.
 *
 * WHAT MOVED, NOT WHAT WAS DELETED: the 0-100 bar toward the next INTEGER
 * rating left this block for /evo, because the page now answers the bigger
 * question one section lower (NextRankCard — how far to the next TIER). Two
 * progress bars stacked, one measuring 51->52 and one measuring 51->55, is
 * exactly the duplicate the brief asks to merge.
 *
 * Every state the card had survives: flag off renders nothing, loading holds
 * the block's height so the champion never jumps, no rating yet is the
 * DISCOVER door that runs the first official review, and a review you can
 * act on right now still lights up. Nothing is mocked — no row, no number.
 */

import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { progressionFeatures } from '@/data/progression/features';
import {
  useEvoRatingCurrent,
  usePendingEvoEvidence,
  useRunEvoReview,
} from '@/data/progression/use-evo-rating';
import { todayIso as calendarToday } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

import { EvoEmblem } from './evo-emblem';
import { useHomeScale } from './home-scale';

/** The identity block's height at a given scale — loading reserves it so the
 *  champion below never jumps when the rating lands. */
const blockHeight = (rating: number, gap: number) => 13 + gap + Math.round(rating * 1.06) + gap + 26;

export function EvoHero({
  suppressEmptyState = false,
}: {
  /** ORIGIN: an athlete who has not forged one already has exactly one thing
   *  to do, and the gold button on the podium below is it. Suppressing the
   *  DISCOVER door here keeps the first screen to ONE call to action instead
   *  of three. Athletes with an Origin still get it. */
  suppressEmptyState?: boolean;
} = {}) {
  const colors = useThemeColors();
  const scale = useHomeScale();
  const current = useEvoRatingCurrent();
  const pending = usePendingEvoEvidence();
  const review = useRunEvoReview();

  if (!progressionFeatures.newProgressionEnabled) return null;

  const reserve = blockHeight(scale.rating, scale.heroGap);

  if (current.isPending) {
    return <View style={{ height: reserve }} testID="evo-hero-loading" />;
  }

  const row = current.data as Record<string, unknown> | null;

  // No confirmed rating yet. The rating is the page's identity, so its empty
  // state is an invitation to earn one — not a hidden section and never a 0.
  if (!row) {
    if (suppressEmptyState) return null;
    return (
      <View className="items-center" testID="evo-hero-empty">
        <Label colour={colors.epic}>EVO RATING</Label>
        <View className="items-center justify-center" style={{ marginTop: scale.heroGap }}>
          <View pointerEvents="none" style={{ position: 'absolute' }}>
            <EvoEmblem width={Math.round(scale.rating * 3.4)} colour={colors.epic} />
          </View>
          <Text
            allowFontScaling={false}
            style={{
              fontSize: Math.round(scale.rating * 0.8),
              lineHeight: Math.round(scale.rating * 0.9),
              color: colors['text-mute'],
              letterSpacing: 0,
              ...pixelFont(),
            }}
          >
            ??
          </Text>
        </View>
        <Text className="mt-s1 text-center text-sm text-text-dim">
          Your real-world gym level from Size, Aesthetics, Strength and Cardio.
        </Text>
        <View className="mt-s3 w-full">
          <NeonButton
            title="RUN FIRST EVO REVIEW"
            pixel
            busy={review.isPending}
            onPress={() => review.mutate({ force: true })}
            testID="evo-discover"
          />
        </View>
      </View>
    );
  }

  const rating = Number(row.displayed_rating ?? 1);
  const descriptor = String(row.descriptor ?? 'Untrained').toUpperCase();
  const status = String(row.status ?? 'provisional');
  // Day-resolution countdown off the local calendar day (todayIso is the
  // app-wide clock seam; Date.now() in render trips the compiler's purity).
  // Only its ZERO matters here — the door lights up the day a review is
  // available; the countdown itself reads on /evo.
  const nextReviewAt = row.next_review_at ? Date.parse(String(row.next_review_at)) : null;
  const todayStart = Date.parse(`${calendarToday()}T00:00:00Z`);
  const daysToReview =
    nextReviewAt !== null ? Math.max(0, Math.ceil((nextReviewAt - todayStart) / 86_400_000)) : null;
  const pendingCount = pending.data?.length ?? 0;
  const reviewDue = daysToReview === 0;

  // ONE status line, and only when there is something to DO. "Provisional" is
  // not a thing to do — it is an adjective on the rating, so it rides the
  // descriptor pill instead of buying a caption of its own (that caption cost
  // 19pt of the first screen to say a word that already had a home).
  const statusLine = reviewDue
    ? { text: 'EVO REVIEW READY ›', colour: colors.accent }
    : pendingCount > 0
      ? { text: `${pendingCount} PENDING ›`, colour: colors.accent }
      : null;
  const provisional = status === 'provisional';

  return (
    <Pressable
      onPress={() => router.push('/evo' as never)}
      accessibilityRole="button"
      accessibilityLabel={`Your Evo Rating is ${rating}, ${descriptor}. Opens the Evo Rating page.`}
      testID="evo-hero"
      className="items-center"
    >
      <Label colour={colors.epic}>EVO RATING</Label>

      <View className="items-center justify-center" style={{ marginTop: scale.heroGap }}>
        {/* The crest sits BEHIND the number, centred on it. */}
        <View pointerEvents="none" style={{ position: 'absolute' }}>
          <EvoEmblem width={Math.round(scale.rating * 3.4)} colour={colors.epic} />
        </View>
        <Text
          allowFontScaling={false}
          testID="evo-hero-rating"
          style={{
            fontSize: scale.rating,
            lineHeight: Math.round(scale.rating * 1.06),
            letterSpacing: 0,
            color: colors.text,
            // The one place on Home where a glow is loud: this number is the
            // athlete's identity, and the neon policy allows it on exactly
            // this kind of moment.
            textShadowColor: 'rgba(168,85,247,0.6)',
            textShadowRadius: Math.round(scale.rating * 0.32),
            ...pixelFont(),
          }}
        >
          {rating}
        </Text>
      </View>

      <View
        className="rounded-pill border px-s3"
        style={{
          marginTop: scale.heroGap,
          minHeight: 26,
          justifyContent: 'center',
          borderColor: `${colors.epic}4d`,
          backgroundColor: 'rgba(168,85,247,0.08)',
        }}
      >
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{ fontSize: 12, letterSpacing: 1.5, color: colors['text-dim'], ...pixelFont(false) }}
        >
          {descriptor}
          {provisional ? (
            <Text style={{ color: colors['text-mute'] }} testID="evo-provisional">
              {'  ·  PROVISIONAL'}
            </Text>
          ) : null}
        </Text>
      </View>

      {statusLine ? (
        <Text
          className="mt-s1 text-2xs"
          numberOfLines={1}
          allowFontScaling={false}
          testID="evo-review-ready"
          style={{ letterSpacing: 1.5, color: statusLine.colour, ...pixelFont(false) }}
        >
          {statusLine.text}
        </Text>
      ) : null}
    </Pressable>
  );
}

function Label({ colour, children }: { colour: string; children: string }) {
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={{ fontSize: 11, letterSpacing: 3.5, color: colour, ...pixelFont(false) }}
    >
      {children}
    </Text>
  );
}

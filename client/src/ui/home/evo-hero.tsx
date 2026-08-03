/**
 * HOME §1 — THE EVO RATING HERO.
 *
 * The brief's whole thesis is that the rating IS the product ("I'm Evo 51",
 * not "I bench 90kg"), so it is the first thing on the page, rendered on a
 * crest, with nothing beside it. Every state the old EVO CORE card had
 * survives: flag off renders nothing, loading holds the block's height so the
 * champion never jumps, no rating yet is the DISCOVER door that runs the first
 * official review, and a review you can act on right now still lights up.
 * Nothing is mocked — no row, no number.
 *
 * ---- PREMIUM PASS (2026-08-03, second brief) ----
 *
 * FOUR THINGS CHANGED, and each answers a specific line of the brief:
 *
 * 1. IT SAYS WHAT IT IS. "OVERALL FITNESS SCORE" sits under the numeral. The
 *    page used to assume the athlete already knew, which is the single
 *    biggest reason a new signup bounces off their own identity.
 * 2. IT IS THE LOUDEST THING ON THE PAGE. The numeral grew ~15% and the
 *    masthead's wordmark gave up its glow to make room in the visual budget —
 *    "prestige" is a contrast relationship, not a font size.
 * 3. NEXT RANK MOVED IN. It was a second purple module a section below; it is
 *    now the crest's bottom rail, so one block answers who-am-I and why-care
 *    together and there is ONE tap target for the whole identity.
 * 4. TAPPING OPENS THE SHEET, not a page. `evo-detail.tsx` explains the four
 *    pillars, the ladder and the five levers in place; /evo is one tap
 *    further for the history and the forecasts. The athlete never has to
 *    leave their champion to find out what their number means.
 *
 * MOTION — ONE LOOP for the whole hero (`pulse`, 7s). The breathing bloom and
 * the crest's light sweep are both derived from it inside worklets, because on
 * web every Reanimated loop runs on the main JS thread and the "everything
 * lags" rule is that you pay per DRIVER, not per effect. It rides `useAmbient`
 * like every other loop: an unfocused tab, reduced motion or perf mode all
 * hold it still and lit. The rating-increase burst is a ONE-SHOT and is
 * deliberately not gated (the animations.ts doctrine).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { progressionFeatures } from '@/data/progression/features';
import {
  useEvoRatingCurrent,
  usePendingEvoEvidence,
  useRunEvoReview,
} from '@/data/progression/use-evo-rating';
import { todayIso as calendarToday } from '@/domain/today';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { playPowerUp, playSelect } from '@/ui/core/sound';
import { useAmbient } from '@/ui/core/use-ambient';

import { EvoBurst } from './evo-burst';
import { EvoCoachMark } from './evo-coach-mark';
import { EvoDetailSheet } from './evo-detail';
import { EvoEmblem } from './evo-emblem';
import { useHomeScale } from './home-scale';
import { NextRankRail } from './next-rank-card';

/** The rating this DEVICE last showed. One integer; see useRatingCelebration. */
const SEEN_RATING_KEY = 'evoforge-evo-seen-rating-v1';

/** The identity block's height at a given scale — loading reserves it so the
 *  champion below never jumps when the rating lands. Kept in step with the
 *  render: label · numeral · subtitle · descriptor pill · rank rail. */
const blockHeight = (rating: number, gap: number) =>
  13 + gap + Math.round(rating * 1.06) + gap + 13 + 6 + 26 + 12 + 22;

/**
 * Fires once when the athlete's rating has genuinely gone UP since the last
 * time this device rendered it. Returns a counter the burst keys off.
 *
 * The baseline is written on the FIRST reading and celebrates nothing — there
 * is no achievement in arriving, and a burst on every fresh install would
 * teach athletes that the burst means nothing. A drop (a recalibration) is
 * recorded silently: the number moving down is a conversation for /evo, not a
 * moment on Home.
 */
function useRatingCelebration(rating: number | null): number {
  const [fire, setFire] = useState(0);
  /** undefined = not read from storage yet; null = no baseline stored. */
  const seenRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (rating === null) return;
    let cancelled = false;
    void (async () => {
      let prev: number | null;
      if (seenRef.current === undefined) {
        try {
          const raw = await AsyncStorage.getItem(SEEN_RATING_KEY);
          const parsed = raw === null ? NaN : Number(raw);
          prev = Number.isFinite(parsed) ? parsed : null;
        } catch {
          prev = null; // a storage failure must never invent a celebration
        }
      } else {
        prev = seenRef.current;
      }
      if (cancelled) return;
      seenRef.current = rating;
      void AsyncStorage.setItem(SEEN_RATING_KEY, String(rating)).catch(() => undefined);
      if (prev === null || rating <= prev) return;

      setFire((n) => n + 1);
      playPowerUp();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      // The toast is also what makes the CHAMPION react: HeroStage blooms its
      // stage light on every xp/pr/achievement toast, so the athlete's own
      // character visibly answers the rating going up.
      useToastStore.getState().push({
        kind: 'achievement',
        title: `EVO ${rating}`,
        subtitle: `+${rating - prev} Evo. Your training is showing.`,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [rating]);

  return fire;
}

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
  const ambient = useAmbient();
  const current = useEvoRatingCurrent();
  const pending = usePendingEvoEvidence();
  const review = useRunEvoReview();
  const [sheetOpen, setSheetOpen] = useState(false);

  const row = (current.data ?? null) as Record<string, unknown> | null;
  const ratingValue = row ? Number(row.displayed_rating ?? 1) : null;
  const fire = useRatingCelebration(current.isPending ? null : ratingValue);

  // ---- The hero's ONE ambient driver. 7s: the bloom breathes twice inside
  // it (3.5s in/out, the same tempo as the champion's own float) and the
  // crest catches the light once. ----
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!ambient) {
      pulse.value = 0;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration: 7000, easing: Easing.linear }), -1);
  }, [ambient, pulse]);

  const crestW = Math.round(scale.rating * 3.4);
  const crestH = Math.round((crestW * 156) / 240);

  const bloomStyle = useAnimatedStyle(() => {
    // Two full breaths per loop, eased by the sine itself.
    const breath = (1 - Math.cos(pulse.value * Math.PI * 4)) / 2; // 0..1..0..1..0
    return { opacity: 0.5 + breath * 0.5, transform: [{ scale: 0.94 + breath * 0.1 }] };
  });

  const SHEEN_W = 96;
  const sweepStyle = useAnimatedStyle(() => {
    // The sweep owns the first 16% of the loop; the remaining ~5.9s is
    // stillness, so the crest "occasionally catches the light" instead of
    // strobing. Travel is crest-width plus the bar, so it enters and leaves.
    const p = pulse.value / 0.16;
    if (p > 1) return { opacity: 0, transform: [{ translateX: -SHEEN_W }] };
    return {
      opacity: Math.sin(p * Math.PI) * 0.9,
      transform: [{ translateX: -SHEEN_W + p * (crestW + SHEEN_W) }],
    };
  });

  if (!progressionFeatures.newProgressionEnabled) return null;

  const reserve = blockHeight(scale.rating, scale.heroGap);

  if (current.isPending) {
    return <View style={{ height: reserve }} testID="evo-hero-loading" />;
  }

  // No confirmed rating yet. The rating is the page's identity, so its empty
  // state is an invitation to earn one — not a hidden section and never a 0.
  if (!row) {
    if (suppressEmptyState) return null;
    return (
      <View className="items-center" testID="evo-hero-empty">
        <Label colour={colors.epic}>EVO RATING</Label>
        <View className="items-center justify-center" style={{ marginTop: scale.heroGap }}>
          <View pointerEvents="none" style={{ position: 'absolute' }}>
            <EvoEmblem width={crestW} colour={colors.epic} />
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
        <Subtitle size={scale.ratingSub}>OVERALL FITNESS SCORE</Subtitle>
        <Text className="mt-s2 text-center text-sm text-text-dim">
          Your real-world gym level from Size, Physique, Strength and Cardio.
        </Text>
        <View className="mt-s3 w-full">
          {/* EPIC, NOT PRIMARY (fixed after the browser tour). As a cyan
              gradient this was pixel-for-pixel the same button as START
              MISSION one section below it, so an athlete with no rating met
              TWO identical dominant CTAs and the page had no answer to "what
              do I do next". Purple makes it unmistakably the RATING's door
              and lets the cyan CTA stay the page's one dominant action —
              which is right, because a first review needs training evidence
              to read anyway. */}
          <NeonButton
            title="RUN FIRST EVO REVIEW"
            variant="epic"
            pixel
            busy={review.isPending}
            onPress={() => review.mutate({ force: true })}
            testID="evo-discover"
          />
        </View>
      </View>
    );
  }

  const rating = ratingValue ?? 1;
  const descriptor = String(row.descriptor ?? 'Untrained').toUpperCase();
  const status = String(row.status ?? 'provisional');
  const evolutionProgress = Number(row.evolution_progress ?? 0);
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
  // descriptor pill instead of buying a caption of its own.
  const statusLine = reviewDue
    ? { text: 'EVO REVIEW READY ›', colour: colors.accent }
    : pendingCount > 0
      ? { text: `${pendingCount} PENDING ›`, colour: colors.accent }
      : null;
  const provisional = status === 'provisional';

  return (
    <View className="w-full items-center">
      <Pressable
        onPress={() => {
          playSelect();
          if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSheetOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Your Evo Rating is ${rating}, ${descriptor}. Your overall fitness score. Opens the breakdown.`}
        testID="evo-hero"
        className="w-full items-center"
      >
        <Label colour={colors.epic}>EVO RATING</Label>

        <View className="items-center justify-center" style={{ marginTop: scale.heroGap }}>
          {/* The breathing bloom, BEHIND the crest — the rating's own light,
              not a border effect. */}
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                width: crestH,
                height: crestH,
                borderRadius: crestH / 2,
                backgroundColor: 'rgba(168,85,247,0.10)',
                shadowColor: colors.epic,
                shadowOpacity: 0.55,
                shadowRadius: 34,
                elevation: 10,
              },
              bloomStyle,
            ]}
          />
          {/* The crest sits BEHIND the number, centred on it. */}
          <View pointerEvents="none" style={{ position: 'absolute' }}>
            <EvoEmblem width={crestW} colour={colors.epic} />
          </View>
          {/* The light sweep, clipped to the crest's own box. It crosses the
              EMBLEM rather than the glyph: masking a shimmer to text needs
              MaskedView, and an unmasked bar over the numeral would read as a
              rendering fault rather than a shine. */}
          <View
            pointerEvents="none"
            className="overflow-hidden"
            style={{ position: 'absolute', width: crestW, height: crestH, borderRadius: crestH / 2 }}
          >
            <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: SHEEN_W }, sweepStyle]}>
              <LinearGradient
                colors={['rgba(216,180,254,0)', 'rgba(216,180,254,0.30)', 'rgba(216,180,254,0)']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={{ flex: 1 }}
              />
            </Animated.View>
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

          <EvoBurst fire={fire} colour={colors.epic} radius={Math.round(crestW * 0.44)} />
        </View>

        {/* THE LINE THAT STOPS THE PAGE ASSUMING. Understated on purpose —
            it is a gloss on the number, and a loud gloss would compete with
            the thing it is glossing. */}
        <Subtitle size={scale.ratingSub}>OVERALL FITNESS SCORE</Subtitle>

        <View
          className="rounded-pill border px-s3"
          style={{
            marginTop: 6,
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

        {/* WHY CARE — the name the number is about to become.
            WIDTH IS THE CREST'S, NOT THE COLUMN'S (fixed after the first
            browser tour). At 320 the rail spanned nearly the full page and
            read as a divider between the rating and the champion — an orphan
            bar belonging to neither. Matched to the crest it is unmistakably
            the bottom line of the same object. */}
        <View style={{ marginTop: 10, width: crestW }}>
          <NextRankRail rating={rating} evolutionProgress={evolutionProgress} />
        </View>
      </Pressable>

      {sheetOpen ? <EvoDetailSheet row={row} onClose={() => setSheetOpen(false)} /> : null}
      {/* The one-time explanation. It self-suppresses behind the first-run
          tutorial and the home help tour — see evo-coach-mark.tsx. */}
      <EvoCoachMark enabled={!sheetOpen} />
    </View>
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

/** The plain-English gloss under the numeral. Letter-spaced small caps rather
 *  than sentence case: it has to read as a LABEL on the number, not as a
 *  sentence competing with the descriptor pill below it. */
function Subtitle({ size, children }: { size: number; children: string }) {
  const colors = useThemeColors();
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      testID="evo-hero-subtitle"
      style={{
        marginTop: 2,
        fontSize: size,
        letterSpacing: 2.4,
        color: colors['text-dim'],
        ...pixelFont(false),
      }}
    >
      {children}
    </Text>
  );
}

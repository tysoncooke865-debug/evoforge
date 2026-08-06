/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside effects and focus callbacks by design; the compiler lint
   cannot see that .value writes are UI-thread animation state, not render
   state, and it treats a shared value in a useCallback dep list as an
   argument it must protect. (The same documented exception as
   neon-button.tsx and avatar-hero.tsx.) */
/**
 * HOME §1 — THE EVO RATING HERO.
 *
 * The brief's thesis is that the rating IS the product ("I'm Evo 51", not "I
 * bench 90kg"), so it is the first thing on the page, on a crest, with nothing
 * beside it. Every state the old EVO CORE card had survives: flag off renders
 * nothing, loading holds the block's height so the champion never jumps, no
 * rating yet is the DISCOVER door that runs the first official review, and a
 * review you can act on right now still lights up. Nothing is mocked.
 *
 * ---- THE ENTRANCE (2026-08-03, third brief) ----
 *
 * "Do not let it behave like ordinary text." Every time Home is focused the
 * rating assembles itself over ~700ms, in the order the brief describes, all
 * of it derived from ONE 0→1 clock inside worklets:
 *
 *     0–140ms   the energy ring fades in and settles from 0.9 scale
 *   100–280ms   the crest glyphs illuminate
 *   170–410ms   the purple glow expands
 *   270–530ms   the digits materialise — twelve pixel shards converge on the
 *               numeral as it resolves from 1.18 scale
 *   530–620ms   it locks, with one soft overshoot
 *   620–700ms   the ambient glow takes over
 *
 * It is a ONE-SHOT, so perf mode does not disable it (the animations.ts
 * doctrine); reduced motion pins it complete on the first frame, because an
 * athlete who asked for less movement should still see their number instantly.
 *
 * ---- THE LEVEL-UP (≤1s) ----
 *
 * On a real increase: the digits COUNT (51 → 52), a soft camera emphasis
 * scales the crest and dims its surroundings, twelve shards burst outward, a
 * success haptic fires, and an achievement toast goes up — which is what makes
 * the CHAMPION bloom and the PLATFORM brighten, because both subscribe to that
 * same store. One event, four surfaces reacting, no new plumbing.
 *
 * ---- MOTION BUDGET ----
 *
 * THREE drivers for everything above: `intro` (one-shot), `pulse` (the only
 * ambient loop — bloom breath, crest sweep and ring rotation all derive from
 * it) and `emphasis` (one-shot). On web every Reanimated loop runs on the main
 * JS thread, so the count that matters is DRIVERS, not effects.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { progressionFeatures } from '@/data/progression/features';
import { useCalibration } from '@/data/progression/use-calibration';
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
import { EvoEmblem, EvoEnergyRing } from './evo-emblem';
import { useHomeScale } from './home-scale';
import { NextRankRail } from './next-rank-card';

/** The rating this DEVICE last showed. One integer; see useRatingCelebration. */
const SEEN_RATING_KEY = 'evoforge-evo-seen-rating-v1';

const INTRO_MS = 700;
/** The count-up. Short enough to finish inside the brief's one second. */
const COUNT_MS = 620;

/** The identity block's height at a given scale — loading reserves it so the
 *  champion below never jumps when the rating lands. Kept in step with the
 *  render: label · numeral · subtitle · descriptor pill · rank rail. */
const blockHeight = (rating: number, gap: number) =>
  13 + gap + Math.round(rating * 1.06) + gap + 13 + 6 + 26 + 12 + 22;

interface Celebration {
  /** Bumped once per real increase. */
  fire: number;
  from: number | null;
  to: number | null;
}

/**
 * Fires once when the athlete's rating has genuinely gone UP since the last
 * time this device rendered it.
 *
 * The baseline is written on the FIRST reading and celebrates nothing — there
 * is no achievement in arriving, and a burst on every fresh install would
 * teach athletes that the burst means nothing. A drop (a recalibration) is
 * recorded silently: the number moving down is a conversation for /evo, not a
 * moment on Home.
 */
function useRatingCelebration(rating: number | null): Celebration {
  const [state, setState] = useState<Celebration>({ fire: 0, from: null, to: null });
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

      setState((s) => ({ fire: s.fire + 1, from: prev, to: rating }));
      playPowerUp();
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      // This toast is the SIGNAL the rest of the screen listens to: HeroStage
      // blooms the champion's spotlight on it and PlatformTech surges the
      // podium. One real event, three surfaces reacting.
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

  return state;
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
  const reduced = useReducedMotion();
  const current = useEvoRatingCurrent();
  const pending = usePendingEvoEvidence();
  const review = useRunEvoReview();
  const calibration = useCalibration();
  const [sheetOpen, setSheetOpen] = useState(false);

  const row = (current.data ?? null) as Record<string, unknown> | null;
  const ratingValue = row ? Number(row.displayed_rating ?? 1) : null;
  const celebration = useRatingCelebration(current.isPending ? null : ratingValue);

  // ---- THE ENTRANCE. Replays on every focus, because the brief asks the
  // athlete to look at this number *every time they open the app*. ----
  const intro = useSharedValue(reduced ? 1 : 0);
  const [converge, setConverge] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (reduced) {
        intro.value = 1;
        return;
      }
      intro.value = 0;
      intro.value = withTiming(1, { duration: INTRO_MS, easing: Easing.out(Easing.cubic) });
      // The shards fly in as the digits resolve — 270ms into the sequence.
      const t = setTimeout(() => setConverge((n) => n + 1), 250);
      return () => clearTimeout(t);
    }, [reduced, intro])
  );

  // ---- The ONE ambient driver: bloom breath, crest sweep, ring rotation. ----
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!ambient) {
      pulse.value = 0;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration: 7000, easing: Easing.linear }), -1);
  }, [ambient, pulse]);

  // ---- THE LEVEL-UP: soft camera emphasis, and the digits counting. ----
  const emphasis = useSharedValue(0);
  const [counting, setCounting] = useState<number | null>(null);
  useEffect(() => {
    if (celebration.fire === 0 || celebration.from === null || celebration.to === null) return;
    const from = celebration.from;
    const to = celebration.to;
    if (!reduced) {
      emphasis.value = withSequence(
        withTiming(1, { duration: 260, easing: Easing.out(Easing.back(1.6)) }),
        withTiming(0, { duration: 420, easing: Easing.inOut(Easing.quad) })
      );
    }
    if (reduced || to <= from) return;
    // No clock call anywhere: the first rAF timestamp IS the start.
    let raf = 0;
    let start = 0;
    const step = (now: number) => {
      if (start === 0) start = now;
      const p = Math.min(1, (now - start) / COUNT_MS);
      setCounting(Math.round(from + (to - from) * p));
      if (p < 1) raf = requestAnimationFrame(step);
      else setCounting(null);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      setCounting(null);
    };
  }, [celebration.fire, celebration.from, celebration.to, reduced, emphasis]);

  const crestW = Math.round(scale.rating * 3.4);
  const crestH = Math.round((crestW * 156) / 240);
  // 0.64, not 0.78, and lifted 6pt: anything centred on the numeral that is
  // taller than the numeral's own box overflows into the subtitle below it.
  // The emblem does too, but at ≤0.26 opacity it reads as a halo; the ring at
  // foreground weight read as a line struck through the text. Inside the
  // emblem's outer arcs and at the emblem's own opacities, the two read as one
  // concentric crest.
  const ringW = Math.round(crestW * 0.64);
  const SHEEN_W = 96;

  /** A 0→1 ramp across [a,b] of the entrance clock. */
  const seg = (t: number, a: number, b: number): number => {
    'worklet';
    return Math.max(0, Math.min(1, (t - a) / (b - a)));
  };

  const ringStyle = useAnimatedStyle(() => {
    const e = seg(intro.value, 0, 0.2);
    // A third of a turn per 7s loop — ~21s per revolution. Any faster and an
    // identity crest reads as a loading spinner.
    return {
      opacity: e * (0.85 + 0.15 * Math.sin(pulse.value * Math.PI * 2)),
      transform: [{ translateY: -6 }, { scale: 0.9 + e * 0.1 }, { rotate: `${pulse.value * 120}deg` }],
    };
  });

  const glyphStyle = useAnimatedStyle(() => ({ opacity: seg(intro.value, 0.14, 0.4) }));

  const bloomStyle = useAnimatedStyle(() => {
    const e = seg(intro.value, 0.24, 0.58);
    const breath = (1 - Math.cos(pulse.value * Math.PI * 4)) / 2; // two breaths per loop
    return {
      opacity: e * (0.5 + breath * 0.5 + emphasis.value * 0.6),
      transform: [{ scale: (0.72 + e * 0.22) * (0.94 + breath * 0.1 + emphasis.value * 0.18) }],
    };
  });

  const digitsStyle = useAnimatedStyle(() => {
    const e = seg(intro.value, 0.38, 0.76);
    // The lock: one soft overshoot as the number seats itself.
    const lock = Math.sin(seg(intro.value, 0.76, 0.94) * Math.PI) * 0.05;
    return {
      opacity: e,
      transform: [{ scale: 1.18 - e * 0.18 + lock + emphasis.value * 0.1 }],
    };
  });

  const sweepStyle = useAnimatedStyle(() => {
    // The sweep owns the first 16% of the loop; the remaining ~5.9s is
    // stillness, so the crest "occasionally catches the light" instead of
    // strobing. It waits for the entrance to finish.
    const p = pulse.value / 0.16;
    if (p > 1 || intro.value < 0.9) return { opacity: 0, transform: [{ translateX: -SHEEN_W }] };
    return {
      opacity: Math.sin(p * Math.PI) * 0.9,
      transform: [{ translateX: -SHEEN_W + p * (crestW + SHEEN_W) }],
    };
  });

  /** The soft camera emphasis: everything around the crest dips as it swells. */
  const vignetteStyle = useAnimatedStyle(() => ({ opacity: emphasis.value * 0.55 }));

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
          {/* "??" said the app did not know. CALIBRATING says the app is
              WORKING ON IT and something the athlete does will finish it —
              which is true, and is the difference between an empty state and
              an invitation (spec §5). */}
          <Text
            allowFontScaling={false}
            style={{
              fontSize: Math.round(scale.rating * 0.34),
              lineHeight: Math.round(scale.rating * 0.42),
              color: colors['text-mute'],
              letterSpacing: 1,
              ...pixelFont(),
            }}
          >
            CALIBRATING
          </Text>
        </View>
        <Subtitle size={scale.ratingSub}>OVERALL FITNESS SCORE</Subtitle>
        {/* ONBOARDING V3 (spec §5, §8): the rating CALIBRATES rather than
            sitting empty. An athlete who has never trained is told the one
            thing that starts it, and is NOT offered a first review — a review
            with no training evidence produces a number about nothing, which
            is the same objection the button's own note makes below. */}
        <Text className="mt-s2 text-center text-sm text-text-dim">
          {calibration.summary.sub}
        </Text>
        <View className="mt-s3 w-full">
          {/* EPIC, NOT PRIMARY. As a cyan gradient this was pixel-for-pixel the
              same button as START MISSION one section below, so an athlete
              with no rating met TWO identical dominant CTAs and the page had
              no answer to "what do I do next". Purple makes it the RATING's
              door and lets the cyan CTA stay the page's one dominant action —
              which is right, because a first review needs training evidence
              to read anyway. */}
          {/* NO BUTTON while training is the thing that is waiting. Home
              already carries START MISSION as its one dominant action, and it
              sits directly above this for an athlete who has never trained
              (app/(main)/index.tsx). A second CTA saying the same thing in a
              different colour is the "five competing buttons" failure the v3
              brief is about — the crest's job here is to EXPLAIN. */}
          {calibration.summary.areas.find((a) => a.key === 'training')?.state === 'waiting' ? null : (
            <NeonButton
              title="CALCULATE MY EVO RATING"
              variant="epic"
              pixel
              busy={review.isPending}
              onPress={() => review.mutate({ force: true })}
              testID="evo-discover"
            />
          )}
        </View>
      </View>
    );
  }

  const rating = ratingValue ?? 1;
  const shown = counting ?? rating;
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
    ? { text: 'RATING UPDATE READY ›', colour: colors.accent }
    : pendingCount > 0
      ? { text: `${pendingCount} PENDING ›`, colour: colors.accent }
      : null;
  const provisional = status === 'provisional';

  return (
    <View className="w-full items-center">
      {/* The camera emphasis' vignette. pointerEvents none and drawn behind
          the crest, so it dips the page without ever blocking a tap — a UI
          that freezes on a reward is a UI that dropped your input. */}
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', top: -400, bottom: -900, left: -400, right: -400, backgroundColor: '#04070e' },
          vignetteStyle,
        ]}
      />

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
          {/* 1. THE ENERGY RING — first in, and the only thing that turns. */}
          <Animated.View pointerEvents="none" style={[{ position: 'absolute' }, ringStyle]}>
            <EvoEnergyRing size={ringW} colour={colors.epic} />
          </Animated.View>

          {/* 2. THE GLOW, behind the crest — the rating's own light. */}
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

          {/* 3. THE GLYPHS. */}
          <Animated.View pointerEvents="none" style={[{ position: 'absolute' }, glyphStyle]}>
            <EvoEmblem width={crestW} colour={colors.epic} />
          </Animated.View>

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

          {/* 4. THE DIGITS, materialising. */}
          <Animated.View style={digitsStyle}>
            <Text
              allowFontScaling={false}
              testID="evo-hero-rating"
              style={{
                fontSize: scale.rating,
                lineHeight: Math.round(scale.rating * 1.06),
                letterSpacing: 0,
                color: colors.text,
                // The one place on Home where a glow is loud: this number is
                // the athlete's identity, and the neon policy allows it on
                // exactly this kind of moment.
                textShadowColor: 'rgba(168,85,247,0.6)',
                textShadowRadius: Math.round(scale.rating * 0.32),
                ...pixelFont(),
              }}
            >
              {shown}
            </Text>
          </Animated.View>

          <EvoBurst
            fire={celebration.fire}
            converge={converge}
            colour={colors.epic}
            radius={Math.round(crestW * 0.44)}
          />
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

        {/* WHY CARE — the name the number is about to become. The rail's width
            is the CREST'S, not the column's: spanning the page it read as a
            divider between the rating and the champion, an orphan bar
            belonging to neither. */}
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

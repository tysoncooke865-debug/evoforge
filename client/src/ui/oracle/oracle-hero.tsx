/**
 * THE ORACLE HERO (2026-08-05) — the consistency pass that merges
 * `OracleHeader` and `EvolutionImpactCard` into the ONE dominant hero the
 * Home/Train standard asks for. They used to be two separate GlowCards
 * stacked back to back (a masthead, then a "widget" beneath it) — visually
 * two things, when Home and Train each answer "what should I do next" with
 * exactly one.
 *
 * Composition, top to bottom, one card:
 *   kicker + ORACLE title + champion (frame pulses while any scan tool below
 *   is busy — unchanged from OracleHeader) + Forge Level
 *   ── hairline ──
 *   EVO RATING, counting up, with its descriptor pill
 *   PHYSIQUE / SIZE pillar chips — the two evidence pillars an Oracle scan
 *   actually feeds
 *   NextRankRail — the SAME rank-ladder rail Home's crest uses
 *   (ui/home/next-rank-card.tsx), not a second implementation of
 *   evoTierStanding
 *   the honest "applied at your next rating update" line
 *
 * Every number is real, on the same terms EvolutionImpactCard always
 * enforced: no rating yet (or the flag off) shows the "run your first
 * review" discover state instead of inventing one, and the pillars/rank
 * come straight off `evo_rating_current` — a physique verdict is EVIDENCE
 * that re-derives them at the next scheduled review, never a rating minted
 * on the spot.
 */

import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { progressionFeatures } from '@/data/progression/features';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { useEvoRatingCurrent } from '@/data/progression/use-evo-rating';
import { todayIso as calendarToday } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CompanionMenuButton } from '@/ui/character/companion-menu';
import { useCountUp } from '@/ui/core/count-up';
import { NextRankRail } from '@/ui/home/next-rank-card';
import { ScanBackdrop } from '@/ui/oracle/scan-backdrop';

export function OracleHero({ scanning = false }: { scanning?: boolean }) {
  const colors = useThemeColors();
  const forge = useForgeProgression();
  const level = forgeProgressFromRow(forge.data ?? null).level;
  const current = useEvoRatingCurrent();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (scanning && !reduced) {
      pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      pulse.value = withTiming(scanning ? 1 : 0, { duration: 200 });
    }
  }, [scanning, reduced, pulse]);

  const frameStyle = useAnimatedStyle(() => ({
    shadowOpacity: 0.4 + pulse.value * 0.5,
    shadowRadius: 14 + pulse.value * 10,
  }));

  const evoEnabled = progressionFeatures.newProgressionEnabled;
  const row = (current.data ?? null) as Record<string, unknown> | null;

  return (
    <View
      className="w-full overflow-hidden rounded-xl border"
      style={{ borderColor: `${colors.accent}33`, backgroundColor: 'rgba(6,12,24,0.5)' }}
      testID="oracle-hero"
    >
      <ScanBackdrop />
      <View className="p-s4">
        {/* 1 — THE MASTHEAD. */}
        <View className="flex-row items-start justify-between">
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', ...pixelFont(false) }}
            >
              THE ORACLE
            </Text>
            <Text
              className="text-text"
              allowFontScaling={false}
              style={{
                fontSize: 34,
                lineHeight: 40,
                letterSpacing: 0,
                textShadowColor: 'rgba(34, 211, 238, 0.65)',
                textShadowRadius: 22,
                ...pixelFont(),
              }}
            >
              ORACLE
            </Text>
            <Text className="mt-s1 text-sm text-text-dim">Your AI fitness analyst.</Text>
          </View>
          <View className="items-center">
            <Animated.View
              className="rounded-lg border p-s1"
              style={[
                {
                  borderColor: `${colors.accent}8c`,
                  backgroundColor: 'rgba(13,21,36,0.72)',
                  shadowColor: colors.accent,
                },
                frameStyle,
              ]}
              testID="oracle-header-frame"
            >
              <CompanionMenuButton anim="idle" height={48} />
            </Animated.View>
            {scanning ? (
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={{ marginTop: 3, fontSize: 8, letterSpacing: 1, color: colors.accent, ...pixelFont(false) }}
                testID="oracle-header-scanning"
              >
                SCANNING
              </Text>
            ) : null}
            <Pressable
              onPress={() => router.push('/profile' as never)}
              accessibilityRole="button"
              accessibilityLabel="open profile"
              testID="oracle-header-level"
              className="mt-s1 items-center justify-center"
              style={{ minHeight: 24, minWidth: 44 }}
              hitSlop={{ top: 4, bottom: 16, left: 8, right: 8 }}
            >
              <Text className="text-2xs text-accent" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont() }}>
                FORGE LV. {level} ›
              </Text>
            </Pressable>
          </View>
        </View>

        {/* 2 — EVO RATING, or the honest discover state. */}
        {!evoEnabled || current.isPending ? null : !row ? (
          <Pressable
            onPress={() => router.push('/evo' as never)}
            accessibilityRole="button"
            accessibilityLabel="Open the Evo Rating page to run your first review"
            testID="evo-impact-discover"
            className="mt-s4 border-t border-border-soft pt-s4"
          >
            <Text
              className="text-epic"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.8, ...pixelFont(false) }}
            >
              ◈ YOUR CHAMPION EVOLUTION
            </Text>
            <Text className="mt-s1 text-sm text-text-dim">
              Calculate your Evo Rating to see how each Oracle scan shapes your champion&apos;s
              Physique and Size. ›
            </Text>
          </Pressable>
        ) : (
          <EvoRatingBlock row={row} />
        )}
      </View>
    </View>
  );
}

function EvoRatingBlock({ row }: { row: Record<string, unknown> }) {
  const colors = useThemeColors();
  const rating = Number(row.displayed_rating ?? 1);
  const evolutionProgress = Number(row.evolution_progress ?? 0);
  const descriptor = String(row.descriptor ?? 'Untrained').toUpperCase();
  const aesthetics = Math.floor(Number(row.aesthetics_score ?? 0));
  const size = Math.floor(Number(row.size_score ?? 0));
  const nextReviewAt = row.next_review_at ? Date.parse(String(row.next_review_at)) : null;
  const todayStart = Date.parse(`${calendarToday()}T00:00:00Z`);
  const daysToReview =
    nextReviewAt !== null ? Math.max(0, Math.ceil((nextReviewAt - todayStart) / 86_400_000)) : null;
  const reviewDue = daysToReview === 0;
  const shown = useCountUp(rating, true, 900);

  return (
    <Pressable
      onPress={() => router.push('/evo' as never)}
      accessibilityRole="button"
      accessibilityLabel={`Evo Rating ${rating}, ${descriptor}. This scan feeds Physique and Size. Opens the Evo Rating page.`}
      testID="evo-impact"
      className="mt-s4 border-t border-border-soft pt-s4"
    >
      <View className="items-center">
        <Text
          className="text-epic"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1.8, ...pixelFont(false) }}
        >
          ◈ EVO RATING
        </Text>
        <View className="mt-s1 flex-row items-baseline" style={{ gap: 8 }}>
          <Text
            allowFontScaling={false}
            style={{
              fontSize: 46,
              lineHeight: 52,
              color: colors.epic,
              textShadowColor: 'rgba(168,85,247,0.55)',
              textShadowRadius: 20,
              ...pixelFont(),
            }}
            testID="oracle-hero-rating"
          >
            {Math.round(shown)}
          </Text>
          <View
            className="rounded-pill border px-s2"
            style={{ borderColor: `${colors.epic}8c`, backgroundColor: `${colors.epic}1a`, paddingVertical: 2 }}
          >
            <Text allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 1.5, color: colors.epic, ...pixelFont() }}>
              {descriptor}
            </Text>
          </View>
        </View>
      </View>

      {/* The two pillars an Oracle scan is evidence for. */}
      <View className="mt-s3 flex-row" style={{ gap: 10 }}>
        <PillarChip label="PHYSIQUE" value={aesthetics} colour={colors.epic} />
        <PillarChip label="SIZE" value={size} colour={colors.accent} />
      </View>

      <View className="mt-s3">
        <NextRankRail rating={rating} evolutionProgress={evolutionProgress} />
      </View>

      <Text className="mt-s3 text-2xs text-text-dim">
        This verdict updates your Physique and Size evidence.{' '}
        {/* The countdown reads next_review_at — the RATING UPDATE, not Reforge
            Day. Naming the 28-day ceremony here would state the wrong date. */}
        {reviewDue
          ? 'Your rating update is ready now ›'
          : daysToReview !== null
            ? `Applied at your next rating update in ${daysToReview}d ›`
            : 'Applied at your next rating update ›'}
      </Text>
    </Pressable>
  );
}

function PillarChip({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <View
      className="flex-1 rounded-lg border p-s3"
      style={{ borderColor: `${colour}45`, backgroundColor: `${colour}0f` }}
    >
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 8, letterSpacing: 1, ...pixelFont(false) }}
      >
        {label}
      </Text>
      <Text allowFontScaling={false} style={{ fontSize: 22, color: colour, ...pixelFont() }}>
        {value}
        <Text className="text-2xs text-text-mute"> / 100</Text>
      </Text>
    </View>
  );
}

import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { progressionFeatures } from '@/data/progression/features';
import { useEvoRatingCurrent } from '@/data/progression/use-evo-rating';
import { todayIso as calendarToday } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { SpriteCompanion } from '@/ui/character/sprite-avatar';
import { GlowCard } from '@/ui/core/shell';

/**
 * ORACLE_REDESIGN — YOUR CHAMPION EVOLUTION. The honest tie between a scan and
 * progression: a physique verdict is EVIDENCE that re-derives the Aesthetics
 * and Size pillars at the next scheduled Evo Review — it does not mint a
 * rating on the spot, and this card never pretends it does. It shows the REAL
 * current rating + those two pillars + when the evidence applies.
 *
 * Flag off, or no confirmed rating yet → the card points at the Evo Rating
 * page rather than inventing numbers (the house rule: hidden, never mocked).
 */
export function EvolutionImpactCard() {
  const colors = useThemeColors();
  const current = useEvoRatingCurrent();

  if (!progressionFeatures.newProgressionEnabled) return null;
  if (current.isPending) return null;

  const row = current.data as Record<string, unknown> | null;

  if (!row) {
    return (
      <Pressable
        onPress={() => router.push('/evo' as never)}
        accessibilityRole="button"
        accessibilityLabel="Open the Evo Rating page to run your first review"
        testID="evo-impact-discover"
      >
        <GlowCard glow={colors.epic}>
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            YOUR CHAMPION EVOLUTION
          </Text>
          <Text className="mt-s2 text-sm text-text-dim">
            Run your first Evo Review to see how each Oracle scan shapes your champion&apos;s
            Aesthetics and Size. ›
          </Text>
        </GlowCard>
      </Pressable>
    );
  }

  const rating = Number(row.displayed_rating ?? 1);
  const descriptor = String(row.descriptor ?? 'Untrained').toUpperCase();
  const aesthetics = Math.floor(Number(row.aesthetics_score ?? 0));
  const size = Math.floor(Number(row.size_score ?? 0));
  const nextReviewAt = row.next_review_at ? Date.parse(String(row.next_review_at)) : null;
  const todayStart = Date.parse(`${calendarToday()}T00:00:00Z`);
  const daysToReview =
    nextReviewAt !== null ? Math.max(0, Math.ceil((nextReviewAt - todayStart) / 86_400_000)) : null;
  const reviewDue = daysToReview === 0;

  return (
    <Pressable
      onPress={() => router.push('/evo' as never)}
      accessibilityRole="button"
      accessibilityLabel={`Evo Rating ${rating}, ${descriptor}. This scan feeds Aesthetics and Size. Opens the Evo Rating page.`}
      testID="evo-impact"
    >
      <GlowCard glow={colors.epic}>
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
          YOUR CHAMPION EVOLUTION
        </Text>
        <View className="mt-s2 flex-row items-center" style={{ gap: 14 }}>
          <View
            className="items-center justify-center rounded-lg border p-s1"
            style={{ borderColor: `${colors.epic}59`, backgroundColor: 'rgba(13,21,36,0.6)' }}
          >
            <SpriteCompanion anim="idle" height={52} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View className="flex-row items-baseline" style={{ gap: 8 }}>
              <Text
                allowFontScaling={false}
                style={{
                  fontSize: 34,
                  lineHeight: 40,
                  color: colors.epic,
                  textShadowColor: 'rgba(168,85,247,0.5)',
                  textShadowRadius: 14,
                  ...pixelFont(),
                }}
              >
                {rating}
              </Text>
              <Text className="text-text" allowFontScaling={false} style={{ fontSize: 11, ...pixelFont() }}>
                {descriptor}
              </Text>
            </View>
            <Text className="text-2xs text-text-mute">Current Evo Rating</Text>
          </View>
        </View>

        {/* The two pillars this scan is evidence for. */}
        <View className="mt-s3 flex-row" style={{ gap: 10 }}>
          <PillarChip label="AESTHETICS" value={aesthetics} colour={colors.epic} />
          <PillarChip label="SIZE" value={size} colour={colors.accent} />
        </View>

        <Text className="mt-s3 text-2xs text-text-dim">
          This verdict updates your Aesthetics and Size evidence.{' '}
          {reviewDue
            ? 'Your Evo Review is ready now ›'
            : daysToReview !== null
              ? `Applied at your next Evo Review in ${daysToReview}d ›`
              : 'Applied at your next Evo Review ›'}
        </Text>
      </GlowCard>
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

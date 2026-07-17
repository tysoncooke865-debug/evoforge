/**
 * ORIGIN ONBOARDING — the Evo Rating reveal (Act II step 1).
 *
 * The rating row comes from evo_rating_current (written by the first Evo
 * Review, which this step runs inline before rendering). Reuses the Evo
 * Core's vocabulary: big rating + descriptor + the four pillars, PROVISIONAL
 * honesty when confidence is low. No mocked states: pending/error render
 * their own cards and the reveal only renders a real row.
 */

import { Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { GlowCard } from '@/ui/core/shell';

const PILLARS: readonly (readonly [key: string, label: string])[] = [
  ['size_score', 'SIZE'],
  ['aesthetics_score', 'AESTHETICS'],
  ['strength_score', 'STRENGTH'],
  ['cardio_score', 'CARDIO'],
];

export function RatingReveal({ row, testID }: { row: Record<string, unknown>; testID?: string }) {
  const colors = useThemeColors();
  const rating = Number(row.displayed_rating ?? 0);
  const descriptor = String(row.descriptor ?? '');
  const provisional = String(row.confidence_label ?? '') !== 'confirmed';

  return (
    <GlowCard glow={colors.accent} padding={20}>
      <View testID={testID}>
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          YOUR EVO RATING{provisional ? ' · PROVISIONAL' : ''}
        </Text>
        <View className="mt-s2 flex-row items-end justify-between">
          <Text
            allowFontScaling={false}
            style={{
              fontSize: 56,
              lineHeight: 60,
              color: colors.accent,
              textShadowColor: 'rgba(34,211,238,0.6)',
              textShadowRadius: 18,
              ...pixelFont(),
            }}
          >
            {rating}
          </Text>
          <Text
            className="text-epic"
            allowFontScaling={false}
            style={{ fontSize: 14, letterSpacing: 1, ...pixelFont() }}
          >
            {descriptor.toUpperCase()}
          </Text>
        </View>
        <Text className="mt-s2 text-xs text-text-dim">
          This is where you stand today — from your real Size, Aesthetics, Strength and Cardio.
          It rises and falls with your training. Now let&apos;s find what you could become.
        </Text>
        <View className="mt-s3">
          {PILLARS.map(([key, label]) => {
            const score = Math.round(Number(row[key] ?? 0));
            return (
              <View key={key} className="mt-s2 flex-row items-center gap-s2">
                <Text
                  className="text-text-mute"
                  allowFontScaling={false}
                  style={{ width: 86, fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
                >
                  {label}
                </Text>
                <View className="h-[8px] flex-1 overflow-hidden rounded-full bg-surface-2">
                  <View style={{ width: `${Math.max(0, Math.min(100, score))}%`, height: 8, backgroundColor: colors.accent }} />
                </View>
                <Text
                  className="text-text"
                  allowFontScaling={false}
                  style={{ width: 28, textAlign: 'right', fontSize: 11, ...pixelFont() }}
                >
                  {score}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </GlowCard>
  );
}

import { Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { PixelBars, PixelHeart } from '@/ui/core/pixel-icons';
import { GlowCard } from '@/ui/core/shell';

/**
 * CARDIO_REDESIGN — the live reward preview. ONLY real values: +Forge XP is
 * floor(minutes × 2), the migration literal the save actually grants. The
 * Conditioning tie-in is deliberately NOT a fabricated "+N" — logging cardio
 * earns Forge XP and builds training history; the Conditioning PILLAR is
 * measured from fitness TESTS at the scheduled Evo Review (cardio-score.ts's
 * explicit rule: "logging sessions earns Forge XP, never Cardio Score"). So
 * this card promises exactly what lands, and nothing the backend won't grant.
 */
export function CardioRewardPreview({ xp, minutes }: { xp: number; minutes: number }) {
  const colors = useThemeColors();
  const ready = minutes > 0;
  return (
    <GlowCard glow={ready ? colors.legendary : undefined} padding={16}>
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        EXPECTED REWARD
      </Text>
      <View className="mt-s2 flex-row items-center" style={{ gap: 12 }}>
        <View
          className="items-center justify-center rounded-lg border"
          style={{ width: 46, height: 46, borderColor: `${colors.legendary}8c`, backgroundColor: `${colors.legendary}14` }}
        >
          <PixelBars size={20} color={colors.legendary} />
        </View>
        <View style={{ flex: 1 }}>
          <View className="flex-row items-baseline" style={{ gap: 6 }}>
            <Text
              allowFontScaling={false}
              style={{ fontSize: 24, color: ready ? colors.legendary : colors['text-mute'], ...pixelFont() }}
              testID="cardio-xp-preview"
            >
              +{xp}
            </Text>
            <Text className="text-2xs text-text-mute" allowFontScaling={false} style={{ letterSpacing: 1, ...pixelFont(false) }}>
              FORGE XP
            </Text>
          </View>
          <Text className="text-2xs text-text-mute">
            {ready ? `${Math.trunc(minutes)} min × 2 XP — granted on save` : 'Enter your minutes to see the reward'}
          </Text>
        </View>
      </View>
      <View className="mt-s3 flex-row items-center border-t border-border-soft pt-s2" style={{ gap: 6 }}>
        <PixelHeart size={12} color={colors.accent} />
        <Text className="flex-1 text-2xs text-text-dim">
          Builds stamina and your Conditioning base. Your Conditioning pillar is measured from fitness
          tests at your next Evo Review.
        </Text>
      </View>
    </GlowCard>
  );
}

import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CompanionMenuButton } from '@/ui/character/companion-menu';

/**
 * FUEL_REDESIGN — the masthead: kicker + neon title + hairline on the left,
 * the champion in the Train-style outlined frame with the Forge Level
 * underneath on the right. Hand-rolled (not ScreenHeader) because the framed
 * sprite column needs top alignment, exactly like today.tsx's compact header.
 */
export function FuelHeader({ anim }: { anim: 'idle' | 'victory' }) {
  const colors = useThemeColors();
  const router = useRouter();
  const forge = useForgeProgression();
  const level = forgeProgressFromRow(forge.data ?? null).level;
  return (
    <View className="w-full">
      <View className="w-full flex-row items-start justify-between">
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', ...pixelFont(false) }}
          >
            EAT LIKE YOU TRAIN
          </Text>
          <Text
            className="text-text"
            allowFontScaling={false}
            style={{
              fontSize: 30,
              lineHeight: 36,
              letterSpacing: 0,
              textShadowColor: 'rgba(34, 211, 238, 0.55)',
              textShadowRadius: 18,
              ...pixelFont(),
            }}
          >
            FUEL
          </Text>
          <LinearGradient
            colors={[colors.accent, 'rgba(34, 211, 238, 0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ height: 2, borderRadius: 1, marginTop: 8, width: '80%' }}
          />
        </View>
        <View className="items-center">
          <View
            className="rounded-lg border p-s1"
            style={{ borderColor: `${colors.accent}59`, backgroundColor: 'rgba(13,21,36,0.6)' }}
          >
            <CompanionMenuButton anim={anim} height={44} />
          </View>
          <Pressable
            onPress={() => router.push('/profile' as never)}
            accessibilityRole="button"
            accessibilityLabel="open profile"
            testID="fuel-header-level"
            className="mt-s1 items-center justify-center"
            style={{ minHeight: 24, minWidth: 44 }}
            // 24px text row → 44px effective target, grown DOWN into free
            // space so it never overlaps the companion button above.
            hitSlop={{ top: 4, bottom: 16, left: 8, right: 8 }}
          >
            <Text className="text-2xs text-accent" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont() }}>
              LV. {level} ›
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

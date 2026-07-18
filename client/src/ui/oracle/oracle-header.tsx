import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CompanionMenuButton } from '@/ui/character/companion-menu';
import { ScanBackdrop } from '@/ui/oracle/scan-backdrop';

/**
 * ORACLE_REDESIGN — the hero masthead. A glowing title over the scan
 * backdrop, the analyst's creed, and the champion framed top-right with the
 * Forge Level (the Train/Fuel header pattern). The champion plays a subtle
 * idle; it never dominates — the title owns the top.
 */
export function OracleHeader() {
  const colors = useThemeColors();
  const router = useRouter();
  const forge = useForgeProgression();
  const level = forgeProgressFromRow(forge.data ?? null).level;

  return (
    <View
      className="w-full overflow-hidden rounded-xl border"
      style={{ borderColor: `${colors.accent}33`, backgroundColor: 'rgba(6,12,24,0.5)' }}
    >
      <ScanBackdrop />
      <View className="flex-row items-start justify-between p-s4">
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
          <LinearGradient
            colors={[colors.accent, 'rgba(34, 211, 238, 0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ height: 2, borderRadius: 1, marginTop: 10, width: '70%' }}
          />
        </View>
        <View className="items-center">
          <View
            className="rounded-lg border p-s1"
            style={{
              borderColor: `${colors.accent}8c`,
              backgroundColor: 'rgba(13,21,36,0.72)',
              shadowColor: colors.accent,
              shadowOpacity: 0.4,
              shadowRadius: 14,
            }}
          >
            <CompanionMenuButton anim="idle" height={48} />
          </View>
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
              LV. {level} ›
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { PixelCalendar } from '@/ui/core/pixel-icons';

/**
 * HOME_REDESIGN §9 — the weekly schedule door. One compact card into the
 * existing Edit Schedule screen, using the app's settled terminology.
 */
export function WeeklyScheduleCard() {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() => router.push('/schedule' as never)}
      accessibilityRole="button"
      accessibilityLabel="Weekly schedule. View and edit your training week."
      testID="weekly-schedule-card"
      className="flex-row items-center rounded-xl border p-s4"
      style={{ gap: 12, minHeight: 56, borderColor: colors.border, backgroundColor: colors['surface-2'] }}
    >
      <View
        className="items-center justify-center rounded-md border"
        style={{ width: 36, height: 36, borderColor: `${colors.accent}45`, backgroundColor: 'rgba(34,211,238,0.07)' }}
      >
        <PixelCalendar size={16} color={colors.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text className="text-text" allowFontScaling={false} style={{ fontSize: 12, letterSpacing: 0, ...pixelFont() }}>
          WEEKLY SCHEDULE
        </Text>
        <Text className="text-2xs text-text-mute" numberOfLines={1}>
          View and edit your training week
        </Text>
      </View>
      <Text className="text-base font-bold text-accent">›</Text>
    </Pressable>
  );
}

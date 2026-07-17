import { Pressable, Text, View } from 'react-native';

import type { NutritionTargetRow } from '@/data/nutrition';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { PixelPencil } from '@/ui/core/pixel-icons';
import { GlowCard } from '@/ui/core/shell';
import { SectionLabel } from '@/ui/core/screen-header';

/** The goal, in the card's own words — "Based on fat-loss goal". */
const GOAL_BASIS: Record<NutritionTargetRow['goal'], string> = {
  lose: 'Based on fat-loss goal',
  maintain: 'Based on maintenance goal',
  gain: 'Based on muscle-gain goal',
};

/**
 * FUEL_REDESIGN — where the budget comes from. Same two doors as before:
 * RECALCULATE re-opens the AI intake, EDIT the manual sheet; both save
 * through the one target mutation. The ring is decoration, not data.
 */
export function DailyTargetCard({
  target,
  onRecalculate,
  onEdit,
}: {
  target: NutritionTargetRow;
  onRecalculate: () => void;
  onEdit: () => void;
}) {
  const colors = useThemeColors();
  return (
    <GlowCard>
      <View className="flex-row items-start justify-between">
        <View style={{ flex: 1, minWidth: 0 }}>
          <SectionLabel>DAILY TARGET</SectionLabel>
          <Text
            className="text-text"
            allowFontScaling={false}
            style={{
              fontSize: 30,
              lineHeight: 36,
              textShadowColor: 'rgba(34,211,238,0.35)',
              textShadowRadius: 12,
              ...pixelFont(),
            }}
            testID="fuel-target-value"
          >
            {target.daily_kcal.toLocaleString()}{' '}
            <Text className="text-text-mute" style={{ fontSize: 16 }}>
              KCAL
            </Text>
          </Text>
          <Text className="mt-s1 text-2xs text-text-mute">
            {GOAL_BASIS[target.goal]} · since {target.effective_from}
          </Text>
        </View>
        {/* The target ring — pure decoration, echoing the reference mock. */}
        <View
          className="items-center justify-center rounded-pill border"
          style={{ width: 56, height: 56, borderColor: `${colors.accent}40` }}
          pointerEvents="none"
        >
          <View
            className="items-center justify-center rounded-pill border"
            style={{ width: 38, height: 38, borderColor: `${colors.accent}8c` }}
          >
            <View
              className="rounded-pill"
              style={{ width: 14, height: 14, backgroundColor: colors.accent }}
            />
          </View>
        </View>
      </View>
      <View className="mt-s2 flex-row items-center border-t border-border-soft pt-s2">
        <Pressable
          onPress={onRecalculate}
          accessibilityRole="button"
          testID="fuel-recalculate"
          className="flex-row items-center justify-center px-s2"
          style={{ minHeight: 44, gap: 6 }}
        >
          <Text
            className="text-epic"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
          >
            ✦ RECALCULATE
          </Text>
        </Pressable>
        <View style={{ width: 1, height: 16, backgroundColor: colors['border-soft'] }} />
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          testID="fuel-edit-target"
          className="flex-row items-center justify-center px-s2"
          style={{ minHeight: 44, gap: 6 }}
        >
          <PixelPencil size={11} color={colors.accent} />
          <Text
            className="text-accent"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
          >
            EDIT
          </Text>
        </Pressable>
      </View>
    </GlowCard>
  );
}

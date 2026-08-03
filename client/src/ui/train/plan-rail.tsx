/**
 * THE PLAN RAIL (2026-08-03, TRAIN brief) — "Current utility cards ... feel
 * administrative. Primary: Current Plan. Secondary: Manage Plan."
 *
 * It replaces three grey cards (CHOOSE/UPLOAD MY WORKOUT · QUICK WORKOUT ·
 * EDIT SCHEDULE) and the explanatory line under them with ONE row. Nothing was
 * deleted: all four doors moved inside manage-plan-sheet.tsx, which is where
 * the brief put them.
 *
 * WHAT THAT BUYS, AND WHAT IT COSTS. It buys ~68pt of the first screen and,
 * more importantly, it stops the page offering four different administrative
 * decisions immediately under the one action it wants taken. It costs one tap
 * on the way to QUICK WORKOUT and EDIT SCHEDULE — both of which are things an
 * athlete does occasionally, unlike START WORKOUT, which is the thing they are
 * here for. An athlete with NO plan never pays that tap: their hero card is the
 * ADD WORKOUT door, unchanged.
 */

import { Pressable, Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { PixelSwap } from '@/ui/core/pixel-icons';

export function PlanRail({
  planName,
  onSwitch,
  onManage,
}: {
  /** The plan today's workout actually came from. */
  planName: string;
  onSwitch: () => void;
  onManage: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View
      className="flex-row items-center justify-between rounded-md border px-s3"
      style={{ minHeight: 46, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}
    >
      <Pressable
        onPress={onSwitch}
        accessibilityRole="button"
        accessibilityLabel={`current plan ${planName}, switch plan`}
        testID="change-workout"
        className="flex-row items-center"
        style={{ flexShrink: 1, minHeight: 44, gap: 7 }}
      >
        <PixelSwap size={15} color={colors.accent} />
        <View style={{ flexShrink: 1 }}>
          <Text
            allowFontScaling={false}
            style={{ fontSize: 8, letterSpacing: 1.5, color: colors['text-mute'], ...pixelFont(false) }}
          >
            CURRENT PLAN
          </Text>
          <Text
            className="text-text"
            numberOfLines={1}
            allowFontScaling={false}
            style={{ fontSize: 12, letterSpacing: 0, ...pixelFont() }}
            testID="plan-rail-name"
          >
            {planName.toUpperCase()}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onManage}
        accessibilityRole="button"
        testID="manage-plan"
        className="items-center justify-center px-s2"
        style={{ minHeight: 44 }}
      >
        <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
          MANAGE PLAN ›
        </Text>
      </Pressable>
    </View>
  );
}

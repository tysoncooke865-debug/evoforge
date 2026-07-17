import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { animations, durations } from '@/theme/animations';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * The RPG stat row — the mobile-first replacement for the radar as the
 * default read: `STR  77  ▬▬▬▬▬▬▬░░░`. Abbreviation loud, value louder,
 * animated fill in the stat's colour identity. Reads in under a second.
 */
export function StatBar({
  abbr,
  name,
  value,
  colour,
}: {
  abbr: string;
  name?: string;
  value: number;
  colour?: string;
}) {
  const colors = useThemeColors();
  const colourResolved = colour ?? colors.accent;
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withTiming(clamped, {
      duration: animations.fillGrow.duration,
      easing: Easing.bezier(...(animations.fillGrow.easing as readonly [number, number, number, number])),
    });
  }, [clamped, width]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }));

  return (
    <View className="mb-s3 flex-row items-center gap-s3">
      {/* Wide enough for the longest name (Aesthetic) — the label column
          must never wrap a word ("Aestheti/c" is a banned fragment). */}
      <View style={{ width: 64 }}>
        <Text
          className="text-text"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 14, letterSpacing: 0.5, ...pixelFont() }}
        >
          {abbr}
        </Text>
        {name ? (
          <Text className="text-2xs text-text-mute" numberOfLines={1}>
            {name}
          </Text>
        ) : null}
      </View>
      <Text
        className="w-s8 text-right"
        allowFontScaling={false}
        style={{ fontSize: 16, color: colourResolved, ...pixelFont() }}
      >
        {clamped}
      </Text>
      <View className="h-s2 flex-1 overflow-hidden rounded-pill" style={{ backgroundColor: colors['surface-3'] }}>
        <Animated.View
          style={[
            {
              height: '100%',
              borderRadius: 999,
              backgroundColor: colourResolved,
              minWidth: clamped > 0 ? 4 : 0,
              shadowColor: colourResolved,
              shadowOpacity: 0.5,
              shadowRadius: 6,
            },
            fillStyle,
          ]}
        />
      </View>
    </View>
  );
}

export const STAT_DURATION = durations.reward;

import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useCountUp } from '@/ui/oracle/oracle-anim';

/**
 * ORACLE_REDESIGN — one attribute row: label, a bar that FILLS from empty to
 * value/max, the number counting up, and a one-line read of what it means.
 * The fill is a Reanimated width (inline style — the xp-bar interop lesson);
 * reduced motion pins it full at once. Visibility never waits on the fill.
 */
export function AttributeBar({
  label,
  value,
  max = 15,
  colour,
  note,
  reveal,
  delayMs = 0,
}: {
  label: string;
  value: number;
  max?: number;
  colour: string;
  note?: string;
  /** Flip true once the verdict is revealed — starts the fill + count. */
  reveal: boolean;
  delayMs?: number;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const fill = useSharedValue(reveal && !reduced ? 0 : 1);
  const pct = Math.max(0, Math.min(1, value / max));

  useEffect(() => {
    if (!reveal) {
      fill.value = 1;
      return;
    }
    if (reduced) {
      fill.value = 1;
      return;
    }
    fill.value = 0;
    fill.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) });
  }, [reveal, reduced, fill]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${pct * 100 * fill.value}%`,
  }));

  const shown = useCountUp(value, reveal, 800 + delayMs);

  return (
    <View className="mb-s3">
      <View className="mb-s1 flex-row items-center justify-between">
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
        >
          {label}
        </Text>
        <Text allowFontScaling={false} style={{ fontSize: 15, color: colour, ...pixelFont() }}>
          {Math.round(shown)}
          <Text className="text-2xs text-text-mute"> / {max}</Text>
        </Text>
      </View>
      <View className="overflow-hidden rounded-pill" style={{ height: 7, backgroundColor: colors['surface-3'] }}>
        <Animated.View
          style={[
            {
              height: '100%',
              borderRadius: 999,
              backgroundColor: colour,
              shadowColor: colour,
              shadowOpacity: 0.6,
              shadowRadius: 8,
            },
            barStyle,
          ]}
        />
      </View>
      {note ? <Text className="mt-s1 text-2xs text-text-mute">{note}</Text> : null}
    </View>
  );
}

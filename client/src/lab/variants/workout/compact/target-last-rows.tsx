import { Pressable, Text, View } from 'react-native';

import type { WeightUnit } from '@/domain/units';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { schemeSentence } from '@/ui/train/scheme-sentence';

/**
 * COMPACT variant — the training-context row:
 *   TARGET   Aim for 12–15 reps                KG ⇄ LB
 * A LAST row used to sit under it; owner cut it — the greyed last-session
 * prefill inside the set inputs already says the same thing, and saying it
 * twice cost a line per card. Rest time stays absent (no data field).
 * The kg⇄lb toggle lives here (writes the per-exercise unit pref).
 */
export function TargetLastRows({
  exercise,
  scheme,
  unit,
  onToggleUnit,
}: {
  exercise: string;
  scheme: string;
  unit: WeightUnit;
  onToggleUnit: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center">
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{ fontSize: 12, letterSpacing: 0.5, color: colors['text-dim'], width: 56, ...pixelFont() }}
      >
        TARGET
      </Text>
      <Text className="flex-1 text-sm" style={{ color: colors.accent }} numberOfLines={2}>
        {schemeSentence(scheme)}
      </Text>
      <Pressable
        onPress={onToggleUnit}
        accessibilityRole="button"
        accessibilityLabel={`switch ${exercise} to ${unit === 'kg' ? 'pounds' : 'kilograms'}`}
        testID={`${exercise}-unit`}
        className="justify-center pl-s2"
        style={{ minHeight: 24 }}
        hitSlop={{ top: 10, bottom: 10 }}
      >
        <Text
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 0.5, color: colors.accent, ...pixelFont(false) }}
        >
          {unit === 'kg' ? 'KG ⇄ LB' : 'LB ⇄ KG'}
        </Text>
      </Pressable>
    </View>
  );
}

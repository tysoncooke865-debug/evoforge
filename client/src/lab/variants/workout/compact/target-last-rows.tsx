import { Pressable, Text, View } from 'react-native';

import type { LastPerformance } from '@/domain/last-performance';
import type { WeightUnit } from '@/domain/units';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { schemeSentence } from '@/ui/train/scheme-sentence';

import { lastSummary } from './model';

/**
 * COMPACT variant — the training-context rows (req 8):
 *   TARGET · Aim for 12–15 reps            KG ⇄ LB
 *   LAST · 14 KG × 12 · 14 KG × 10
 * Muted pixel labels, cyan values. Rest time is deliberately absent — the
 * plan data model carries none (PlanEntry = [name, sets, repsText]).
 * The kg⇄lb toggle moved here from the old column header (behaviour kept:
 * it writes the per-exercise unit pref).
 */
export function TargetLastRows({
  exercise,
  scheme,
  last,
  unit,
  onToggleUnit,
}: {
  exercise: string;
  scheme: string;
  last: LastPerformance | null;
  unit: WeightUnit;
  onToggleUnit: () => void;
}) {
  const colors = useThemeColors();
  const lastText = lastSummary(last, unit);
  // Inline, prominent labels (owner's call: the tiny mute caps read as
  // furniture) — bold pixel face, text-dim, sized with the values they name.
  const label = (text: string) => (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={{ fontSize: 12, letterSpacing: 0.5, color: colors['text-dim'], width: 56, ...pixelFont() }}
    >
      {text}
    </Text>
  );
  return (
    <View style={{ gap: 6 }}>
      <View className="flex-row items-center">
        {label('TARGET')}
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
      {lastText ? (
        <View className="flex-row items-center">
          {label('LAST')}
          <Text
            className="flex-1 text-sm"
            style={{ color: colors.accent, fontVariant: ['tabular-nums'] }}
            numberOfLines={1}
            testID={`${exercise}-last`}
          >
            {lastText}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

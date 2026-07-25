import { Pressable, Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

import { badgeText } from './model';

/**
 * COMPACT variant — the exercise-card header (req 6/7):
 * [NN badge] [name, wraps 2 lines] [⇄] [⋯] [chevron]
 * The badge sits on the first line (items-start); the control group is a
 * fixed cluster so wrapping names never move it. No "EXERCISE 1 OF 6", no
 * header ✕ — destructive removal lives in the ⋯ overflow menu (req 17).
 */
export function CardHeader({
  position,
  exercise,
  isNext,
  done,
  collapsed,
  onToggleCollapsed,
  onSubstitute,
  onOpenMenu,
}: {
  position: number;
  exercise: string;
  isNext: boolean;
  done: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSubstitute?: () => void;
  onOpenMenu?: () => void;
}) {
  const colors = useThemeColors();
  const badgeColor = done ? colors.success : isNext ? colors.epic : colors['text-dim'];
  return (
    <View className="flex-row items-start gap-s2">
      <View
        className="items-center justify-center"
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: done ? `${colors.success}8c` : isNext ? `${colors.epic}8c` : colors.border,
          marginTop: 1,
        }}
      >
        <Text allowFontScaling={false} style={{ fontSize: 12, color: badgeColor, ...pixelFont() }}>
          {badgeText(position)}
        </Text>
      </View>
      <Text className="flex-1 text-base font-bold text-text" numberOfLines={2} style={{ paddingTop: 2 }}>
        {exercise}
      </Text>
      <View className="flex-row items-start">
        {onSubstitute ? (
          <Pressable
            onPress={onSubstitute}
            accessibilityRole="button"
            accessibilityLabel={`substitute ${exercise}`}
            className="items-center justify-center"
            style={{ minWidth: 40, minHeight: 40 }}
            testID={`${exercise}-substitute`}
          >
            <Text className="text-base" style={{ color: colors.accent }}>⇄</Text>
          </Pressable>
        ) : null}
        {onOpenMenu ? (
          <Pressable
            onPress={onOpenMenu}
            accessibilityRole="button"
            accessibilityLabel={`more actions for ${exercise}`}
            className="items-center justify-center"
            style={{ minWidth: 40, minHeight: 40 }}
            testID={`${exercise}-menu`}
          >
            <Text className="text-base text-text-dim">⋯</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onToggleCollapsed}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? `expand ${exercise}` : `collapse ${exercise}`}
          accessibilityState={{ expanded: !collapsed }}
          className="items-center justify-center"
          style={{ minWidth: 40, minHeight: 40 }}
          testID={`${exercise}-collapse`}
        >
          <Text className="text-sm text-text-dim">{collapsed ? '⌄' : '⌃'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

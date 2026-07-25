import { Modal, Pressable, Text } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * COMPACT variant — the ⋯ overflow menu (req 17). Destructive removal moves
 * here, out of the header; each row fires its handler then closes. When
 * banked sets make removal degrade to a skip (removeAction), the row says
 * so — red is reserved for the genuinely destructive case (req 20).
 */
export function OverflowMenu({
  visible,
  exercise,
  onClose,
  onSubstitute,
  onSkip,
  onRemove,
  removeDegradesToSkip,
}: {
  visible: boolean;
  exercise: string;
  onClose: () => void;
  onSubstitute?: () => void;
  onSkip?: () => void;
  onRemove?: () => void;
  removeDegradesToSkip: boolean;
}) {
  const colors = useThemeColors();
  const row = (
    label: string,
    sub: string | null,
    color: string,
    onPress: (() => void) | undefined,
    testID: string
  ) =>
    onPress ? (
      <Pressable
        onPress={() => {
          onPress();
          onClose();
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label.toLowerCase()} ${exercise}`}
        className="justify-center px-s4"
        style={{ minHeight: 52 }}
        testID={testID}
      >
        <Text allowFontScaling={false} style={{ fontSize: 13, letterSpacing: 0.5, color, ...pixelFont() }}>
          {label}
        </Text>
        {sub ? (
          <Text
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 0.5, color: colors['text-mute'], ...pixelFont(false) }}
          >
            {sub}
          </Text>
        ) : null}
      </Pressable>
    ) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(4,7,14,0.72)' }}
        onPress={onClose}
        accessibilityLabel="close menu"
      >
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t px-s2 pb-s6 pt-s3"
          style={{ borderColor: colors.border, backgroundColor: colors.surface }}
        >
          <Text
            allowFontScaling={false}
            className="px-s4 pb-s2"
            style={{ fontSize: 10, letterSpacing: 1.5, color: colors['text-mute'], ...pixelFont(false) }}
            numberOfLines={1}
          >
            {exercise.toUpperCase()}
          </Text>
          {row('⇄ REPLACE', null, colors.accent, onSubstitute, `${exercise}-menu-replace`)}
          {row('SKIP TODAY', null, colors['text-dim'], onSkip, `${exercise}-menu-skip`)}
          {row(
            '✕ REMOVE FROM WORKOUT',
            removeDegradesToSkip ? 'KEEPS BANKED SETS — SKIPS INSTEAD' : null,
            removeDegradesToSkip ? colors['text-dim'] : colors.danger,
            onRemove,
            `${exercise}-remove`
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

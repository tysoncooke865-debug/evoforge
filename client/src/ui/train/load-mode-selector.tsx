import { Platform, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { MODE_LABEL, type ExerciseLoadMode } from '@/domain/exercise-load';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * BODYWEIGHT / WEIGHTED / ASSISTED — the segmented control (133).
 *
 * Renders NOTHING when the exercise offers a single mode, which is every
 * ordinary lift: a bench press has no ambiguity to resolve, and a selector
 * with one option is noise in the middle of a working set.
 *
 * THE SELECTED STATE IS TEXT AND LAYOUT, NOT COLOUR. The active segment
 * carries a filled background, a border and a leading dot; colour merely
 * agrees with it. Accessibility state is published for screen readers too —
 * a colour-only "selected" is invisible to a third of the reasons people
 * cannot see it.
 *
 * Tap targets are 44pt minimum and the row wraps rather than shrinking, so
 * three modes stay usable one-handed on a 320pt phone.
 */
export function LoadModeSelector({
  modes,
  value,
  onChange,
  tint,
  testID,
}: {
  modes: readonly ExerciseLoadMode[];
  value: ExerciseLoadMode;
  onChange: (mode: ExerciseLoadMode) => void;
  tint: string;
  testID?: string;
}) {
  const colors = useThemeColors();
  if (modes.length < 2) return null;

  return (
    <View
      className="mb-s1 flex-row flex-wrap px-[2px]"
      style={{ gap: 6 }}
      accessibilityRole="radiogroup"
      accessibilityLabel="How was this set loaded?"
      testID={testID}
    >
      {modes.map((mode) => {
        const active = mode === value;
        return (
          <Pressable
            key={mode}
            onPress={() => {
              if (active) return;
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              onChange(mode);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={MODE_LABEL[mode]}
            testID={`${testID ?? 'load-mode'}-${mode}`}
            className="flex-row items-center rounded-md border px-s2"
            style={{
              minHeight: 44,
              gap: 6,
              borderColor: active ? tint : colors.border,
              borderWidth: active ? 1.5 : 1,
              backgroundColor: active ? `${tint}24` : 'rgba(13,21,36,0.6)',
            }}
          >
            {/* A shape, not a hue: the selected segment is legible in
                greyscale and to anyone who cannot distinguish the tint. */}
            <Text allowFontScaling={false} style={{ fontSize: 11, color: active ? tint : colors['text-mute'] }}>
              {active ? '●' : '○'}
            </Text>
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={{
                fontSize: 10,
                letterSpacing: 0.5,
                color: active ? tint : colors['text-mute'],
                ...pixelFont(active),
              }}
            >
              {MODE_LABEL[mode]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

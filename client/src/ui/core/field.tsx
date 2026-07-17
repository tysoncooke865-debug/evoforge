import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useThemeColors } from '@/theme/use-theme';
import { KeyPad } from '@/ui/core/number-field';
import { USE_CUSTOM_PAD } from '@/ui/core/pad-env';

/** Labelled decimal input — extracted from log.tsx (P2 C3) so the cardio
 *  logger (now on Today) and the Stats cards share one control. On touch
 *  screens tapping it opens EvoForge's in-app numpad (the same KeyPad the
 *  weight field uses); desktop web keeps a typeable input for the tours. */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  testID,
  integer = false,
  tint: tintProp,
  keypadLabel,
  accessory,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testID?: string;
  /** Whole numbers only (e.g. calories, rounds) — the keypad hides the dot. */
  integer?: boolean;
  tint?: string;
  /** Heading shown on the numpad; defaults to `label`. */
  keypadLabel?: string;
  /** Optional node on the right of the label row (e.g. a unit toggle). */
  accessory?: ReactNode;
}) {
  const colors = useThemeColors();
  const tint = tintProp ?? colors.accent;
  const [padOpen, setPadOpen] = useState(false);
  return (
    <View className="flex-1">
      <View className="mb-s1 flex-row items-center justify-between" style={{ minHeight: 16 }}>
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
          {label}
        </Text>
        {accessory}
      </View>
      <View>
        <TextInput
          className="min-h-[44px] rounded-md border border-border bg-surface-2 p-s2 text-text"
          inputMode={USE_CUSTOM_PAD ? 'none' : integer ? 'numeric' : 'decimal'}
          placeholder={placeholder}
          placeholderTextColor="#64758f"
          value={value}
          onChangeText={onChange}
          showSoftInputOnFocus={!USE_CUSTOM_PAD}
          pointerEvents={USE_CUSTOM_PAD ? 'none' : 'auto'}
          testID={testID}
        />
        {USE_CUSTOM_PAD ? (
          <Pressable
            onPress={() => setPadOpen(true)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            accessibilityRole="button"
            accessibilityLabel={`edit ${label}`}
            testID={testID ? `${testID}-tap` : undefined}
          />
        ) : null}
      </View>
      {USE_CUSTOM_PAD && padOpen ? (
        <KeyPad
          label={keypadLabel ?? label}
          initial={value}
          integer={integer}
          tint={tint}
          onDone={onChange}
          onClose={() => setPadOpen(false)}
        />
      ) : null}
    </View>
  );
}

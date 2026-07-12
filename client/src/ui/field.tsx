import { Text, TextInput, View } from 'react-native';

/** Labelled decimal input — extracted from log.tsx (P2 C3) so the cardio
 *  logger (now on Today) and the Stats cards share one control. */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testID?: string;
}) {
  return (
    <View className="flex-1">
      <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
        {label}
      </Text>
      <TextInput
        className="min-h-[44px] rounded-md border border-border bg-surface-2 p-s2 text-text"
        inputMode="decimal"
        placeholder={placeholder}
        placeholderTextColor="#64758f"
        value={value}
        onChangeText={onChange}
        testID={testID}
      />
    </View>
  );
}

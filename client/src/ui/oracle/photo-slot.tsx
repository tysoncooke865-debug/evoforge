import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * ORACLE_REDESIGN — one upload slot in the body scanner. Empty: a dashed
 * frame with a ＋ and the pose label. Filled: the photo, a solid cyan frame,
 * a ✓ badge, and a cyan glow — the "scanner locked on" beat. Photos live in
 * the parent's state only and are dropped after the analysis returns.
 */
export function PhotoSlot({
  label,
  uri,
  onPick,
}: {
  label: string;
  uri: string | null;
  onPick: () => void;
}) {
  const colors = useThemeColors();
  const filled = uri !== null;
  return (
    <Pressable
      onPress={onPick}
      accessibilityRole="button"
      accessibilityLabel={`${filled ? 'Replace' : 'Add'} ${label.toLowerCase()} photo`}
      className="flex-1 items-center rounded-lg p-s2"
      style={{
        borderWidth: 1,
        borderStyle: filled ? 'solid' : 'dashed',
        borderColor: filled ? colors.accent : colors.border,
        backgroundColor: filled ? 'rgba(34,211,238,0.08)' : colors['surface-2'],
        shadowColor: colors.accent,
        shadowOpacity: filled ? 0.4 : 0,
        shadowRadius: 12,
      }}
      testID={`oracle-slot-${label.toLowerCase()}`}
    >
      <View style={{ width: 72, height: 96 }}>
        {filled ? (
          <>
            <Image source={{ uri }} style={{ width: 72, height: 96, borderRadius: 8 }} contentFit="cover" />
            <View
              className="absolute items-center justify-center rounded-pill"
              style={{
                top: 4,
                right: 4,
                width: 20,
                height: 20,
                backgroundColor: colors.accent,
                shadowColor: colors.accent,
                shadowOpacity: 0.8,
                shadowRadius: 6,
              }}
            >
              <Text style={{ fontSize: 11, color: colors['accent-ink'], fontWeight: '900' }}>✓</Text>
            </View>
          </>
        ) : (
          <View className="h-full w-full items-center justify-center">
            <Text className="text-2xl text-text-mute">＋</Text>
            <Text className="mt-s1 text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
              UPLOAD
            </Text>
          </View>
        )}
      </View>
      <Text
        className={`mt-s2 ${filled ? 'text-accent' : 'text-text-mute'}`}
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import tokens from '@/theme/tokens';

/**
 * HUD primitives: floating information without the card chrome. The layered-
 * game-HUD look — chips, edge labels and glowing dividers replace "another
 * rounded rectangle" wherever a full card adds nothing.
 */

/** A floating stat pill: value loud, label whispered. Optional accent tint. */
export function HUDChip({
  label,
  value,
  tint = tokens.colors.accent,
  icon,
}: {
  label: string;
  value: string | number;
  tint?: string;
  icon?: ReactNode;
}) {
  return (
    <View
      className="flex-row items-center gap-s2 rounded-pill px-s3 py-s2"
      style={{
        borderWidth: 1,
        borderColor: `${tint}38`,
        backgroundColor: `${tint}0f`,
      }}
    >
      {icon}
      <Text className="text-base font-bold text-text">{value}</Text>
      <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
        {label}
      </Text>
    </View>
  );
}

/** A small edge-aligned label — section naming without a container. */
export function EdgeLabel({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2.5 }}>
        {children}
      </Text>
      {right}
    </View>
  );
}

/** A glowing hairline divider that fades at both ends. */
export function DividerGlow() {
  return (
    <LinearGradient
      colors={['rgba(34,211,238,0)', 'rgba(34,211,238,0.45)', 'rgba(34,211,238,0)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={{ height: 1, width: '100%', marginVertical: 4 }}
    />
  );
}

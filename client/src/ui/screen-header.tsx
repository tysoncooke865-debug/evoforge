import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';

import tokens from '@/theme/tokens';

/**
 * The screen masthead: a whispered kicker, a dominant hero title with neon
 * bloom, and a gradient hairline that fades out -- headers should dominate,
 * everything under them should defer.
 */
export function ScreenHeader({
  kicker,
  title,
  right,
  titleLines = 1,
  autoSize = false,
}: {
  kicker: string;
  title: string;
  right?: React.ReactNode;
  /** Allow wrapping instead of the default single ellipsized line. */
  titleLines?: number;
  /** Step long titles down one size token. adjustsFontSizeToFit is NOT
   *  supported on react-native-web, so the step is a pure length rule —
   *  the battle catalogs are closed and a vitest pins that every title fits. */
  autoSize?: boolean;
}) {
  const big = !autoSize || title.length <= 14;
  return (
    <View className="mb-s1 w-full">
      <View className="flex-row items-end justify-between">
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text
            className="text-2xs font-bold text-text-mute"
            style={{ letterSpacing: 3, textTransform: 'uppercase' }}
          >
            {kicker}
          </Text>
          <Text
            className={`${big ? 'text-3xl' : 'text-2xl'} font-bold text-text`}
            style={{
              letterSpacing: 0.5,
              textShadowColor: 'rgba(34, 211, 238, 0.5)',
              textShadowRadius: 18,
            }}
            numberOfLines={titleLines}
          >
            {title}
          </Text>
        </View>
        {right}
      </View>
      <LinearGradient
        colors={[tokens.colors.accent, 'rgba(34, 211, 238, 0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ height: 2, borderRadius: 1, marginTop: 8, width: '55%' }}
      />
    </View>
  );
}

/** A section label inside a card: small, spaced, quiet. */
export function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-s3 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2.5 }}>
      {children}
    </Text>
  );
}

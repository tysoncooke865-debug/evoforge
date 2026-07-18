import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

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
  hero = false,
  onBack,
}: {
  kicker: string;
  title: string;
  right?: React.ReactNode;
  /** TRAIN_PAGE_V2: a pushed page gets a back chevron (44pt), left of the
   *  kicker. Absent on tab screens — there is nothing to go back to. */
  onBack?: () => void;
  /** Allow wrapping instead of the default single ellipsized line. */
  titleLines?: number;
  /** Step long titles down one size token. adjustsFontSizeToFit is NOT
   *  supported on react-native-web, so the step is a pure length rule —
   *  the battle catalogs are closed and a vitest pins that every title fits. */
  autoSize?: boolean;
  /** TRAIN_OVERHAUL: the hub's masthead outgrows the type scale — an inline
   *  size bump + stronger bloom (deliberately NOT a token: the scale caps at
   *  3xl and verify-tokens pins the token file against styles.css). */
  hero?: boolean;
}) {
  const colors = useThemeColors();
  const big = !autoSize || title.length <= 14;
  return (
    <View className="mb-s1 w-full">
      <View className="flex-row items-end justify-between">
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="back"
            testID="screen-back"
            className="mr-s1 items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <Text className="text-2xl text-text-dim">‹</Text>
          </Pressable>
        ) : null}
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', ...pixelFont(false) }}
          >
            {kicker}
          </Text>
          <Text
            className="text-text"
            allowFontScaling={false}
            style={{
              letterSpacing: 0,
              textShadowColor: hero ? 'rgba(34, 211, 238, 0.65)' : 'rgba(34, 211, 238, 0.55)',
              textShadowRadius: hero ? 26 : 18,
              ...(hero
                ? { fontSize: 44, lineHeight: 50 }
                : big
                  ? { fontSize: 30, lineHeight: 36 }
                  : { fontSize: 24, lineHeight: 30 }),
              ...pixelFont(),
            }}
            numberOfLines={titleLines}
          >
            {title}
          </Text>
        </View>
        {right}
      </View>
      <LinearGradient
        colors={[colors.accent, 'rgba(34, 211, 238, 0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ height: 2, borderRadius: 1, marginTop: 8, width: '55%' }}
      />
    </View>
  );
}

/** A section label inside a card: small, spaced, quiet — or, as
 *  `size="lg"` (2026-07-19, Tyson: "make the titles more prominent"), a
 *  card-owning pixel title with a soft cyan bloom. Default is unchanged for
 *  every existing call site. */
export function SectionLabel({ children, size = 'md' }: { children: string; size?: 'md' | 'lg' }) {
  if (size === 'lg') {
    return (
      <Text
        className="mb-s3 text-text"
        allowFontScaling={false}
        style={{
          fontSize: 17,
          lineHeight: 22,
          letterSpacing: 0.5,
          textShadowColor: 'rgba(34, 211, 238, 0.4)',
          textShadowRadius: 12,
          ...pixelFont(),
        }}
      >
        {children}
      </Text>
    );
  }
  return (
    <Text
      className="mb-s3 text-text-mute"
      allowFontScaling={false}
      style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
    >
      {children}
    </Text>
  );
}

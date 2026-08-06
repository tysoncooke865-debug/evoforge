import { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColors } from '@/theme/use-theme';

/**
 * LOADING SKELETONS (Tyson, 2026-08-06: "avoid showing only a branded loading
 * animation while the page content is unavailable").
 *
 * Progress, Awards, Streak, Coins and Data had no loading state AT ALL — they
 * rendered `data ?? []` straight away, so a slow connection showed a fully
 * laid-out page of zeros and empty lists that then silently rearranged itself.
 * Zeros are a claim about the athlete's training. A skeleton is not.
 *
 * A shape, not a spinner: the block sits where the content will sit, so the
 * page does not jump when the data lands.
 *
 * REDUCED MOTION pins the pulse — a shimmer is decoration, and this must stay
 * legible without it. `accessibilityLabel` is on the group, not each bar, so a
 * screen reader hears "Loading" once rather than eleven times.
 */
export function SkeletonBlock({
  height = 16,
  width,
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  style?: ViewStyle;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [reduced, pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: reduced ? 0.6 : pulse.value }));

  return (
    <Animated.View
      style={[
        { height, width: width ?? '100%', borderRadius: 6, backgroundColor: colors['surface-3'] },
        style,
        animated,
      ]}
    />
  );
}

/**
 * A card-shaped placeholder: a short label bar and `lines` content bars.
 * Announced once as "Loading", with `aria-busy` for the web build.
 */
export function SkeletonCard({
  lines = 3,
  label = 'Loading',
  testID,
}: {
  lines?: number;
  label?: string;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      aria-busy
      testID={testID}
      className="w-full rounded-xl border p-s4"
      style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.4)', gap: 10 }}
    >
      <SkeletonBlock height={9} width="38%" />
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonBlock key={i} height={14} width={i === lines - 1 ? '62%' : '100%'} />
      ))}
    </View>
  );
}

/** The usual page shape: a few cards, so a whole screen can say "loading"
 *  without every caller hand-rolling one. */
export function SkeletonScreen({ cards = 3, testID }: { cards?: number; testID?: string }) {
  return (
    <View style={{ gap: 14 }} testID={testID}>
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} lines={i === 0 ? 4 : 2} label={i === 0 ? 'Loading' : ''} />
      ))}
    </View>
  );
}

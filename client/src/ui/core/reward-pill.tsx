/**
 * ONE REWARD TOKEN, shared by Home's mission card and Train's mission brief.
 *
 * It was Home's private component until 2026-08-03, when the Train brief asked
 * for the same block ("Estimated Rewards / +0.4 EVO / +210 XP") on the other
 * screen. Two copies of a reward chip is how the two screens end up disagreeing
 * about what a workout pays — which is the opposite of "The Home page and Train
 * page should feel connected".
 *
 * `lead` is the Evo gain: bigger type, a heavier outline and a soft bloom, so
 * the reward the whole app is about outranks the XP beside it at a glance
 * rather than by reading order alone.
 *
 * ---- TWO WAYS TO ARRIVE ----
 *
 * Each pill POPS IN once — the brief's "reward chips pulse when appearing".
 * On HOME the card mounts with the screen, so a self-driven `delay` is right.
 * On TRAIN the card stays mounted across tab changes (the carousel is inside a
 * tab screen), so a mount-driven pop would fire once per app launch and never
 * again; there the page passes its shared entrance clock and a window on it,
 * and the chip arrives with the rest of the briefing every time Train opens.
 *
 * Both paths are ONE-SHOTS, so per the animations doctrine neither is
 * perf-gated — but reduced motion pins the pill at rest, fully visible. A
 * reward chip that never arrives is worse than one that does not bounce.
 */

import { useEffect } from 'react';
import { Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { pixelFont } from '@/theme/fonts';

export function RewardPill({
  icon,
  label,
  tint,
  testID,
  size = 'base',
  delay = 0,
  clock,
  from = 0,
  to = 1,
}: {
  icon?: React.ReactNode;
  label: string;
  tint: string;
  testID?: string;
  size?: 'base' | 'lead';
  /** Self-driven path: milliseconds after mount before the pop. */
  delay?: number;
  /** Clock-driven path: the page's 0→1 entrance value. */
  clock?: SharedValue<number>;
  /** The window on `clock` this pill occupies. */
  from?: number;
  to?: number;
}) {
  const reduced = useReducedMotion();
  const lead = size === 'lead';
  const pop = useSharedValue(reduced ? 1 : 0);
  // Captured once per render and never changed by the worklet — which is what
  // makes the branch below legal inside one.
  const driven = clock !== undefined;

  useEffect(() => {
    if (reduced || driven) return;
    pop.value = withDelay(delay, withTiming(1, { duration: 320, easing: Easing.out(Easing.back(2)) }));
  }, [reduced, driven, delay, pop]);

  const style = useAnimatedStyle(() => {
    const raw = driven ? Math.max(0, Math.min(1, (clock!.value - from) / (to - from))) : pop.value;
    // The overshoot the self-driven path gets from Easing.back, reproduced on
    // the clock-driven one so the two look identical side by side.
    const eased = driven ? 1 - Math.pow(1 - raw, 3) : raw;
    const overshoot = driven ? Math.sin(Math.min(1, raw) * Math.PI) * 0.06 : 0;
    return {
      opacity: Math.min(1, eased * 1.6),
      transform: [{ scale: 0.86 + eased * 0.14 + overshoot }],
    };
  });

  return (
    <Animated.View
      testID={testID}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 999,
          borderWidth: lead ? 1.5 : 1,
          paddingHorizontal: lead ? 12 : 8,
          gap: 5,
          minHeight: lead ? 32 : 26,
          borderColor: lead ? `${tint}8c` : `${tint}45`,
          backgroundColor: lead ? `${tint}1f` : `${tint}12`,
          ...(lead ? { shadowColor: tint, shadowOpacity: 0.45, shadowRadius: 12, elevation: 4 } : null),
        },
        style,
      ]}
    >
      {icon}
      <Text
        className="text-center"
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: lead ? 15 : 11, letterSpacing: 0, color: tint, ...pixelFont() }}
      >
        {label.toUpperCase()}
      </Text>
    </Animated.View>
  );
}

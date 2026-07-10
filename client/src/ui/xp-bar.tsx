import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';

import { progressPercent } from '@/domain/xp';
import { animations } from '@/theme/animations';

interface XpBarProps {
  xpIntoLevel: number;
  xpNeeded: number;
  /** Show "123 / 500 XP" under the bar. */
  showNumbers?: boolean;
}

const fill = animations.fillGrowXp;

/**
 * The XP progress bar. The percentage comes from progressPercent() -- the same
 * function that grants the level -- so the bar reaches exactly 100% at
 * level-up. Never divide by hand (root CLAUDE.md, XP contract).
 * Animation: fillGrow's XP variant, 700ms ease-out, growing to the value.
 */
export function XpBar({ xpIntoLevel, xpNeeded, showNumbers = true }: XpBarProps) {
  const pct = progressPercent(xpIntoLevel, xpNeeded);
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withTiming(pct, {
      duration: fill.duration,
      easing: Easing.bezier(...(fill.easing as readonly [number, number, number, number])),
    });
  }, [pct, width]);

  const animatedStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }));

  return (
    <View>
      <View className="h-s3 overflow-hidden rounded-pill border border-border-soft bg-surface-2">
        <Animated.View className="h-full rounded-pill bg-accent shadow-glow-sm" style={animatedStyle} />
      </View>
      {showNumbers ? (
        <Text className="mt-s1 text-xs text-text-dim">
          {xpIntoLevel} / {xpNeeded} XP
        </Text>
      ) : null}
    </View>
  );
}

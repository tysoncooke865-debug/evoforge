import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { animations } from '@/theme/animations';
import tokens from '@/theme/tokens';

/**
 * A labelled 0-100 stat meter -- the RPG character sheet row. Fill animates
 * with fillGrow (one-shot, always plays); the value wears text tokens, the
 * bar carries the colour.
 */
export function StatMeter({ label, value, colour = tokens.colors.accent }: { label: string; value: number; colour?: string }) {
  const width = useSharedValue(0);
  const clamped = Math.max(0, Math.min(100, value));

  useEffect(() => {
    width.value = withTiming(clamped, {
      duration: animations.fillGrow.duration,
      easing: Easing.bezier(...(animations.fillGrow.easing as readonly [number, number, number, number])),
    });
  }, [clamped, width]);

  const style = useAnimatedStyle(() => ({ width: `${width.value}%` }));

  return (
    <View className="mb-s2">
      <View className="mb-s1 flex-row justify-between">
        <Text className="text-2xs font-bold text-text-mute">{label}</Text>
        <Text className="text-2xs font-bold text-text-dim">{clamped}</Text>
      </View>
      <View className="h-s2 overflow-hidden rounded-pill bg-surface-3">
        <Animated.View className="h-full rounded-pill" style={[{ backgroundColor: colour }, style]} />
      </View>
    </View>
  );
}

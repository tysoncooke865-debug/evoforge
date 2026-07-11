import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useSettingsStore } from '@/state/settings-store';

/**
 * Six drifting energy motes. Pure ambience: gated by perf mode and reduced
 * motion (renders nothing when either is on — an invisible particle costs
 * nothing). Each mote loops its own rise/fade on the UI thread.
 */
const MOTES = [
  { left: '18%', size: 3, delay: 0, duration: 5200 },
  { left: '32%', size: 2, delay: 1400, duration: 6400 },
  { left: '48%', size: 4, delay: 600, duration: 4800 },
  { left: '61%', size: 2, delay: 2200, duration: 7000 },
  { left: '74%', size: 3, delay: 900, duration: 5600 },
  { left: '86%', size: 2, delay: 1800, duration: 6200 },
] as const;

export function ParticleLayer({ colour, height = 240 }: { colour: string; height?: number }) {
  const reducedMotion = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  if (reducedMotion || perfMode) return null;

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height }}>
      {MOTES.map((m, i) => (
        <Mote key={i} left={m.left} size={m.size} delay={m.delay} duration={m.duration} colour={colour} travel={height} />
      ))}
    </View>
  );
}

function Mote({
  left,
  size,
  delay,
  duration,
  colour,
  travel,
}: {
  left: string;
  size: number;
  delay: number;
  duration: number;
  colour: string;
  travel: number;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -t.value * travel }],
    opacity: t.value < 0.15 ? t.value * 4 : (1 - t.value) * 0.7,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          bottom: 0,
          left: left as `${number}%`,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colour,
          shadowColor: colour,
          shadowOpacity: 0.8,
          shadowRadius: 4,
        },
        style,
      ]}
    />
  );
}

import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useAmbient } from '@/ui/core/use-ambient';
import { useThemeColors } from '@/theme/use-theme';

/**
 * ORACLE_REDESIGN — the laboratory backdrop: a static field of faint scan
 * motes plus ONE slow vertical sweep line. A single ambient loop (gated by
 * useAmbient — the "everything lags" rule: no off-screen loops), and the
 * motes are static so visibility never depends on the animation firing.
 * pointerEvents none — purely atmosphere behind the hero.
 */
const MOTES = [
  { top: '18%', left: '12%', size: 3, o: 0.5 },
  { top: '62%', left: '24%', size: 2, o: 0.35 },
  { top: '34%', left: '46%', size: 2, o: 0.4 },
  { top: '74%', left: '58%', size: 3, o: 0.3 },
  { top: '22%', left: '72%', size: 2, o: 0.45 },
  { top: '54%', left: '86%', size: 3, o: 0.35 },
  { top: '82%', left: '40%', size: 2, o: 0.3 },
] as const;

export function ScanBackdrop() {
  const colors = useThemeColors();
  const ambient = useAmbient();
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (ambient) {
      sweep.value = withRepeat(withTiming(1, { duration: 3600, easing: Easing.inOut(Easing.quad) }), -1, false);
    } else {
      sweep.value = 0;
    }
  }, [ambient, sweep]);

  const sweepStyle = useAnimatedStyle(() => ({
    top: `${sweep.value * 100}%`,
    opacity: 0.14 * (1 - Math.abs(sweep.value - 0.5) * 1.4),
  }));

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      {MOTES.map((m, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            top: m.top,
            left: m.left,
            width: m.size,
            height: m.size,
            borderRadius: m.size,
            backgroundColor: colors.accent,
            opacity: m.o * 0.5,
          }}
        />
      ))}
      <Animated.View
        style={[
          { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.accent },
          sweepStyle,
        ]}
      />
    </View>
  );
}

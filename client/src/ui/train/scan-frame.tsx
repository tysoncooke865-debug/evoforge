import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColors } from '@/theme/use-theme';

export type ScanState = 'idle' | 'ready' | 'analysing' | 'confirm' | 'complete' | 'error';

// Colour as a token KEY, resolved through the theme at render.
const STATUS: Record<ScanState, { text: string; colour: 'text-mute' | 'accent' | 'warn' | 'success' | 'danger' }> = {
  idle: { text: 'AWAITING SUBJECT', colour: 'text-mute' },
  ready: { text: 'SUBJECT LOCKED · READY TO ANALYSE', colour: 'accent' },
  analysing: { text: 'ANALYSING…', colour: 'accent' },
  confirm: { text: 'CONFIRM PHOTO CONDITIONS', colour: 'warn' },
  complete: { text: 'ANALYSIS COMPLETE', colour: 'success' },
  error: { text: 'ANALYSIS FAILED', colour: 'danger' },
};

/**
 * The Oracle's scan chamber: corner brackets, a sweep line while a REAL
 * request is in flight, and a system status line. States map 1:1 to the
 * actual invoke lifecycle -- the sweep never runs while nothing is happening.
 */
export function ScanFrame({ state, children }: { state: ScanState; children: ReactNode }) {
  const colors = useThemeColors();
  const reducedMotion = useReducedMotion();
  const sweep = useSharedValue(0);
  const scanning = state === 'analysing';

  useEffect(() => {
    if (scanning && !reducedMotion) {
      sweep.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      sweep.value = withTiming(0, { duration: 200 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning, reducedMotion]);

  const sweepStyle = useAnimatedStyle(() => ({
    top: `${8 + sweep.value * 78}%`,
    opacity: scanning ? 0.85 : 0,
  }));

  const edge = colors[STATUS[state].colour];

  return (
    <View>
      <View style={{ position: 'relative', padding: 10 }}>
        {/* Corner brackets */}
        {(
          [
            { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2 },
            { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2 },
            { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2 },
            { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2 },
          ] as const
        ).map((corner, i) => (
          <View
            key={i}
            pointerEvents="none"
            style={{ position: 'absolute', width: 22, height: 22, borderColor: `${edge}99`, ...corner }}
          />
        ))}

        {children}

        {/* Sweep line, only while genuinely analysing. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 6,
              right: 6,
              height: 2,
              backgroundColor: colors.accent,
              shadowColor: colors.accent,
              shadowOpacity: 0.9,
              shadowRadius: 8,
            },
            sweepStyle,
          ]}
        />
      </View>
      <Text className="mt-s1 text-center text-2xs font-bold" style={{ color: edge, letterSpacing: 2 }}>
        {STATUS[state].text}
      </Text>
    </View>
  );
}

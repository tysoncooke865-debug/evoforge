import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { requirementProgress } from '@/domain/evolution-readiness';
import type { EvolutionRequirement } from '@/domain/next-evolution';
import { animations } from '@/theme/animations';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * A body fat of 0.0% is not a measurement, it is the absence of one.
 *
 * The domain ports coalesce a missing reading to 0 (`bfMid ?? 0`) and every
 * CALCULATION already treats that as unmeasured — `requirementProgress`
 * returns honest zero for `current <= 0`, and `met` is false unless a real
 * reading exists. Only the label lied, printing "0.0%" next to a 12.0%
 * target as though the athlete had been measured at zero per cent body fat.
 *
 * Same rule as the domain, applied to the text: at or below zero, say so.
 */
function format(label: string, value: number): string {
  if (label === 'Bench') return `${value.toFixed(0)}kg`;
  if (label === 'Body Fat' || label === 'Starting Body Fat') {
    return value > 0 ? `${value.toFixed(1)}%` : '—';
  }
  return String(Math.trunc(value));
}

/**
 * One evolution requirement as a visual row: label, current/target, animated
 * completion bar, done state, and an optional priority chip (NEXT UP for the
 * nearest, THE WALL for the hardest). Body-fat runs downward honestly.
 */
export function RequirementRow({
  req,
  priority,
}: {
  req: EvolutionRequirement;
  priority?: 'nearest' | 'hardest';
}) {
  const colors = useThemeColors();
  const progress = requirementProgress(req) * 100;
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withTiming(progress, {
      duration: animations.fillGrow.duration,
      easing: Easing.bezier(...(animations.fillGrow.easing as readonly [number, number, number, number])),
    });
  }, [progress, width]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  const colour = req.met ? colors.success : colors.accent;

  return (
    <View className="mb-s3">
      <View className="mb-s1 flex-row items-center justify-between">
        <View className="flex-row items-center gap-s2">
          <Text className={`text-sm font-bold ${req.met ? 'text-success' : 'text-text'}`}>
            {req.met ? '✓ ' : ''}
            {req.label}
          </Text>
          {priority === 'nearest' && !req.met ? (
            <Text
              className="rounded-pill px-s2 text-accent"
              allowFontScaling={false}
              style={{ backgroundColor: 'rgba(34,211,238,0.12)', fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
            >
              NEXT UP
            </Text>
          ) : null}
          {priority === 'hardest' && !req.met ? (
            <Text
              className="rounded-pill px-s2 text-warn"
              allowFontScaling={false}
              style={{ backgroundColor: 'rgba(251,191,36,0.12)', fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
            >
              THE WALL
            </Text>
          ) : null}
        </View>
        <Text className="text-text-dim" allowFontScaling={false} style={{ fontSize: 12, ...pixelFont() }}>
          {format(req.label, req.current)} <Text className="text-text-mute">/ {format(req.label, req.target)}</Text>
        </Text>
      </View>
      <View className="h-s1 overflow-hidden rounded-pill" style={{ backgroundColor: colors['surface-3'] }}>
        <Animated.View
          style={[
            {
              height: '100%',
              borderRadius: 999,
              backgroundColor: colour,
              minWidth: progress > 0 ? 3 : 0,
            },
            fillStyle,
          ]}
        />
      </View>
    </View>
  );
}

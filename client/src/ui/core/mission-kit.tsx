/**
 * MISSION KIT (2026-08-04) — the two small pieces Train's mission brief and
 * Cardio's mission card both need, pulled out so a shared visual language
 * stays ONE component rather than two copies that quietly drift apart.
 * Extracted verbatim from ui/train/mission-brief.tsx (2026-08-03) — no
 * behaviour change there, just a new address.
 */

import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/** A small spaced eyebrow label, used above a value inside a mission card. */
export function MissionLabel({ children }: { children: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={{ fontSize: 8.5, letterSpacing: 1.6, color: colors['text-mute'], ...pixelFont(false) }}
    >
      {children}
    </Text>
  );
}

/**
 * The fill, with a shimmer travelling along it. The shimmer rides the page's
 * ambient clock rather than one of its own — a per-bar loop becomes a real
 * frame cost on web (every Reanimated loop runs on the main JS thread there).
 */
export function MissionProgressBar({
  done,
  total,
  clock,
  tint,
  track,
}: {
  done: number;
  total: number;
  clock: SharedValue<number>;
  tint: string;
  track: string;
}) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const shimmer = useAnimatedStyle(() => {
    const p = clock.value / 0.34;
    if (p > 1) return { opacity: 0, transform: [{ translateX: -60 }] };
    return { opacity: Math.sin(p * Math.PI) * 0.75, transform: [{ translateX: -60 + p * 320 }] };
  });
  return (
    <View
      className="mt-s1 self-stretch overflow-hidden rounded-pill"
      style={{ height: 6, backgroundColor: track }}
    >
      <View
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: 999,
          backgroundColor: tint,
          overflow: 'hidden',
          shadowColor: tint,
          shadowOpacity: 0.6,
          shadowRadius: 8,
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: 0, bottom: 0, width: 44, backgroundColor: 'rgba(255,255,255,0.5)' },
            shimmer,
          ]}
        />
      </View>
    </View>
  );
}

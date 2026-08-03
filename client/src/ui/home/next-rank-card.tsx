/**
 * HOME §1a — NEXT RANK, as a rail inside the Evo crest.
 *
 * It shipped on 2026-08-03 as a standalone card between the champion and the
 * mission. The PREMIUM PASS the same day merged it INTO the rating block, and
 * the reason is hierarchy, not space (though it bought ~58pt of fold, which is
 * what paid for the bigger numeral and its subtitle):
 *
 *   The card was a second purple module, with its own 20pt tier name, its own
 *   40pt badge and its own tap target, sitting one section below a purple
 *   rating with the same accent. Two modules about ONE number is exactly the
 *   duplicate the brief asks to merge — and while both were on screen neither
 *   could be the page's single answer to "who am I".
 *
 * Nothing was lost. The tier name, the countdown, the sub-integer bar and the
 * door to /evo all survive; they are now the bottom line of the crest, which
 * is where the sentence they finish begins. `testID="next-rank-card"` is kept
 * on the rail so existing tours and help targeting still find it.
 *
 * Every value is real: the ladder is EVO_RATING_TIERS (the same descriptors
 * /evo and the leaderboard use) and the position between tiers comes from the
 * review's own `evolution_progress` hundredths, so "4 EVO TO GO" is arithmetic
 * on the athlete's actual rating, not a motivational number.
 */

import { useEffect, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { evoTierStanding } from '@/domain/progression/evo-rating';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useAmbient } from '@/ui/core/use-ambient';

/**
 * The rail. Renders NOTHING of its own chrome — no border, no background, no
 * press handler: it is drawn inside the crest's own Pressable, so the whole
 * identity block is one tap target instead of two.
 */
export function NextRankRail({
  rating,
  evolutionProgress,
}: {
  rating: number;
  /** The review's stored hundredths toward the next integer. */
  evolutionProgress: number;
}) {
  const colors = useThemeColors();
  const standing = evoTierStanding(rating, evolutionProgress);
  const maxed = standing.nextTier === null;

  return (
    <View className="w-full" testID="next-rank-card">
      <View className="mb-s1 flex-row items-end justify-between" style={{ gap: 8 }}>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={{
            flex: 1,
            fontSize: 10,
            letterSpacing: 1.4,
            color: colors['text-dim'],
            ...pixelFont(false),
          }}
        >
          {maxed ? 'THE SUMMIT' : 'NEXT RANK'}
          <Text style={{ color: colors.epic }}>
            {`  ·  ${(maxed ? standing.tier : standing.nextTier ?? '').toUpperCase()}`}
          </Text>
        </Text>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          testID="next-rank-togo"
          style={{ fontSize: 12, letterSpacing: 0.5, color: colors.epic, ...pixelFont() }}
        >
          {maxed ? 'MAX' : `${standing.evoToGo} TO GO`}
        </Text>
      </View>
      <ProgressBar value={standing.progress} colour={colors.epic} track={colors['surface-3']} />
    </View>
  );
}

const SHEEN_W = 56;

/** The tier bar with a slow sheen crossing the filled portion. The sheen is
 *  an AMBIENT LOOP, so it obeys useAmbient (focus + reduced motion + perf
 *  mode) exactly like every other loop in the app — an unfocused Home tab
 *  animates nothing. */
function ProgressBar({ value, colour, track }: { value: number; colour: string; track: string }) {
  const ambient = useAmbient();
  const [fillW, setFillW] = useState(0);
  const t = useSharedValue(0);

  useEffect(() => {
    if (!ambient || fillW <= 0) {
      t.value = 0;
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.linear }), -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambient, fillW]);

  // The sweep occupies the first 40% of the loop; the rest is stillness, so
  // the bar reads as "occasionally catches the light" rather than a strobe.
  const sheenStyle = useAnimatedStyle(() => {
    const travel = Math.min(1, t.value / 0.4);
    return {
      opacity: t.value < 0.4 ? 1 : 0,
      transform: [{ translateX: -SHEEN_W + travel * (fillW + SHEEN_W) }],
    };
  });

  return (
    <View className="w-full overflow-hidden rounded-pill" style={{ height: 6, backgroundColor: track }}>
      <View
        onLayout={(e) => setFillW(Math.round(e.nativeEvent.layout.width))}
        className="overflow-hidden rounded-pill"
        style={{
          width: `${Math.round(value * 100)}%`,
          minWidth: value > 0 ? 6 : 0,
          height: '100%',
          backgroundColor: colour,
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', top: 0, bottom: 0, width: SHEEN_W }, sheenStyle]}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </View>
    </View>
  );
}

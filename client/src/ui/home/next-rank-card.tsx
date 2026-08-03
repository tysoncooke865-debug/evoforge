/**
 * HOME §3 (2026-08-03) — NEXT RANK.
 *
 * One compact horizontal card between the champion and the mission, and the
 * only place on Home that answers "why should I care": the rating is a
 * number, this is the NAME it is about to become. It creates the pull
 * without spending vertical budget — ~70pt, no button, one tap target.
 *
 * Every value is real: the ladder is EVO_RATING_TIERS (the same descriptors
 * /evo and the leaderboard use) and the position between tiers comes from
 * the review's own `evolution_progress` hundredths, so "4 EVO TO GO" is
 * arithmetic on the athlete's actual rating, not a motivational number.
 *
 * Self-hides when the progression flag is off or no review has run — the
 * EVO HERO above owns that empty state, and two invitations to run the same
 * review is one too many.
 */

import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Polygon } from 'react-native-svg';

import { progressionFeatures } from '@/data/progression/features';
import { useEvoRatingCurrent } from '@/data/progression/use-evo-rating';
import { evoTierStanding } from '@/domain/progression/evo-rating';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useAmbient } from '@/ui/core/use-ambient';

import { DECORATIVE } from './evo-emblem';

export function NextRankCard() {
  const colors = useThemeColors();
  const current = useEvoRatingCurrent();

  if (!progressionFeatures.newProgressionEnabled) return null;
  if (current.isPending) return null;
  const row = current.data as Record<string, unknown> | null;
  if (!row) return null;

  const rating = Number(row.displayed_rating ?? 1);
  const standing = evoTierStanding(rating, Number(row.evolution_progress ?? 0));
  const maxed = standing.nextTier === null;

  return (
    <Pressable
      onPress={() => router.push('/evo' as never)}
      accessibilityRole="button"
      accessibilityLabel={
        maxed
          ? `You have reached ${standing.tier}, the top of the Evo ladder. Opens the Evo Rating page.`
          : `You are ${standing.evoToGo} Evo away from ${standing.nextTier}. Opens the Evo Rating page.`
      }
      testID="next-rank-card"
      className="w-full flex-row items-center rounded-xl border px-s3 py-s2"
      style={{
        gap: 12,
        borderColor: `${colors.epic}3d`,
        backgroundColor: 'rgba(13,21,36,0.62)',
        shadowColor: colors.epic,
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      }}
    >
      <RankCrest colour={colors.epic} />

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          className="text-text-mute"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          {maxed ? 'YOU HAVE REACHED THE SUMMIT' : `YOU'RE ${standing.evoToGo} EVO AWAY FROM`}
        </Text>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={{
            fontSize: 20,
            lineHeight: 22,
            letterSpacing: 0,
            color: colors.epic,
            textShadowColor: 'rgba(168,85,247,0.45)',
            textShadowRadius: 10,
            ...pixelFont(),
          }}
        >
          {(maxed ? standing.tier : standing.nextTier ?? '').toUpperCase()}
        </Text>
        <ProgressBar value={standing.progress} colour={colors.epic} track={colors['surface-3']} />
      </View>

      <View className="items-center" style={{ width: 56 }}>
        <View
          className="items-center justify-center rounded-pill border"
          style={{ width: 40, height: 40, borderColor: `${colors.epic}66`, backgroundColor: 'rgba(168,85,247,0.1)' }}
        >
          <Text
            allowFontScaling={false}
            style={{ fontSize: maxed ? 14 : 18, letterSpacing: 0, color: colors.text, ...pixelFont() }}
          >
            {maxed ? 'MAX' : standing.evoToGo}
          </Text>
        </View>
        <Text
          className="mt-s1 text-center text-text-mute"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 8, letterSpacing: 0.5, ...pixelFont(false) }}
        >
          {maxed ? 'EVO RANK' : 'EVO TO GO'}
        </Text>
      </View>
    </Pressable>
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
    <View
      className="mt-s2 w-full overflow-hidden rounded-pill"
      style={{ height: 6, backgroundColor: track }}
    >
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

/** The rank sigil: a shield, a star, a pair of chevrons. Geometry, not an
 *  asset — it tints to whatever accent the card is drawn in. */
function RankCrest({ colour }: { colour: string }) {
  return (
    <View style={{ width: 34, height: 38 }} {...DECORATIVE}>
    <Svg width={34} height={38} viewBox="0 0 40 44">
      <Polygon
        points="20,2 37,10 37,26 20,42 3,26 3,10"
        fill={colour}
        fillOpacity={0.13}
        stroke={colour}
        strokeOpacity={0.55}
        strokeWidth={1.4}
      />
      <Polygon
        points="20,11.5 21.9,16.4 27.1,16.7 23,20 24.4,25.1 20,22.2 15.6,25.1 17,20 12.9,16.7 18.1,16.4"
        fill={colour}
        fillOpacity={0.85}
      />
      <Path d="M 10 31 L 20 36 L 30 31" stroke={colour} strokeOpacity={0.5} strokeWidth={1.6} fill="none" />
    </Svg>
    </View>
  );
}

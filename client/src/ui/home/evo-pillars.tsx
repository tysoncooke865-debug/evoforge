import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { progressionFeatures } from '@/data/progression/features';
import { useEvoRatingCurrent } from '@/data/progression/use-evo-rating';
import { useMomentum } from '@/data/progression/use-forge';
import {
  consistencyFromMomentum,
  projectPillars,
  type PillarScores,
} from '@/domain/progression/projection';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { StatRadar, type RadarStat } from '@/ui/character/stat-radar';

/**
 * THE FOUR PILLARS — what the Evo Rating is actually made of.
 *
 * THIS REPLACED THE RADAR ON HOME (2026-08-07), and the reasoning matters
 * because the radar was not bad, it was mis-shaped:
 *
 *   A FOUR-AXIS RADAR IS A DIAMOND. Four points is the fewest a polygon can
 *   have and still be one, so the shape carries almost no information at phone
 *   size — two athletes with very different pillars draw near-identical
 *   diamonds. Bars resolve four values exactly.
 *
 *   THE PROJECTION WAS THE VALUABLE PART, and it survives. Each bar carries a
 *   ghost segment showing where that pillar heads after a block of consistent
 *   training — the same projectPillars model, now legible per pillar instead
 *   of as a second polygon overlapping the first.
 *
 *   IT REINFORCES THE RATING INSTEAD OF COMPETING WITH IT. The crest above
 *   says 52; this says which four numbers made it and which one is holding it
 *   back. That is the difference between a statistic and a reason to train.
 *
 * The radar itself is KEPT for athletes with no confirmed rating yet: before a
 * first review there are no pillars, and the legacy live stats it draws are
 * five axes, where a polygon does work.
 */

const HORIZONS = [8, 12, 16] as const;

const PILLARS: readonly (readonly [key: keyof PillarScores, label: string])[] = [
  ['strength', 'STRENGTH'],
  ['size', 'SIZE'],
  ['aesthetics', 'PHYSIQUE'],
  ['cardio', 'CARDIO'],
];

export function EvoPillars({ fallbackStats }: { fallbackStats: RadarStat[] }) {
  const colors = useThemeColors();
  const current = useEvoRatingCurrent();
  const { momentum } = useMomentum();
  const [weeks, setWeeks] = useState<number>(12);

  const row = current.data as Record<string, unknown> | null;

  // No confirmed rating yet: the legacy FIVE-axis live radar, where a polygon
  // genuinely reads. Unchanged behaviour for a brand-new athlete.
  if (!progressionFeatures.newProgressionEnabled || current.isPending || !row) {
    return <StatRadar stats={fallbackStats} />;
  }

  // Math.floor to match the EVO CORE card exactly — the whole point is that
  // every surface shows the same integers.
  const pillars: PillarScores = {
    size: Math.floor(Number(row.size_score ?? 1)),
    aesthetics: Math.floor(Number(row.aesthetics_score ?? 1)),
    strength: Math.floor(Number(row.strength_score ?? 1)),
    cardio: Math.floor(Number(row.cardio_score ?? 1)),
  };
  const projected = projectPillars(pillars, weeks, consistencyFromMomentum(momentum?.current ?? 0));

  // The weakest pillar is the one worth naming — "what is holding me back" is
  // actionable in a way that four equal bars are not.
  const weakest = PILLARS.reduce((lo, p) => (pillars[p[0]] < pillars[lo[0]] ? p : lo), PILLARS[0]);

  return (
    <View>
      {PILLARS.map(([key, label], i) => (
        <Pillar
          key={key}
          label={label}
          value={pillars[key]}
          projected={projected[key]}
          index={i}
          weakest={key === weakest[0]}
        />
      ))}

      <View className="mt-s3 flex-row items-center justify-center gap-s2">
        <Text
          className="text-2xs text-text-mute"
          allowFontScaling={false}
          style={{ letterSpacing: 0.5, ...pixelFont(false) }}
        >
          PROJECT
        </Text>
        {HORIZONS.map((h) => {
          const active = h === weeks;
          return (
            <Pressable
              key={h}
              onPress={() => setWeeks(h)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Project ${h} weeks ahead`}
              testID={`radar-horizon-${h}`}
              className="rounded-pill border px-s2"
              style={{
                minHeight: 44,
                justifyContent: 'center',
                borderColor: active ? `${colors.epic}99` : colors.border,
                backgroundColor: active ? 'rgba(168,85,247,0.12)' : 'transparent',
              }}
            >
              <Text
                allowFontScaling={false}
                style={{ fontSize: 10, color: active ? colors.epic : colors['text-mute'], ...pixelFont() }}
              >
                {h}W
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="mt-s1 text-center text-2xs text-text-mute">
        The faint segment is where each pillar heads after {weeks} weeks of consistent training.
      </Text>
    </View>
  );
}

/**
 * One pillar. The filled bar is now; the faint segment beyond it is the
 * projection. Both animate in on mount — a bar that arrives full has not shown
 * the athlete anything.
 */
function Pillar({
  label,
  value,
  projected,
  index,
  weakest,
}: {
  label: string;
  value: number;
  projected: number;
  index: number;
  weakest: boolean;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const grow = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      grow.value = 1;
      return;
    }
    // A ONE-SHOT entrance, staggered down the four. Never perf-gated: the
    // animations.ts doctrine keeps one-shots alive so the page still feels
    // like it arrived rather than blinked.
    grow.value = 0;
    grow.value = withTiming(1, {
      duration: 620 + index * 90,
      easing: Easing.out(Easing.cubic),
    });
  }, [reduced, grow, index]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(100, value)) * grow.value}%` }));
  const ghostStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(100, projected)) * grow.value}%`,
  }));

  const gain = Math.max(0, Math.round(projected - value));

  return (
    <View className="mt-s2">
      <View className="flex-row items-baseline justify-between">
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 8, letterSpacing: 1.2, ...pixelFont(false) }}
        >
          {label}
          {weakest ? <Text style={{ color: colors.warn }}>{'  ·  YOUR EDGE'}</Text> : null}
        </Text>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 13, letterSpacing: 0, color: colors.text, ...pixelFont() }}
        >
          {value}
          {gain > 0 ? (
            <Text style={{ fontSize: 9, color: colors.epic }}>{`  →${value + gain}`}</Text>
          ) : null}
        </Text>
      </View>
      <View
        className="mt-s1 overflow-hidden rounded-pill"
        style={{ height: 7, backgroundColor: colors['surface-3'] }}
      >
        {/* The projection sits BEHIND the real value, so the filled bar always
            reads as the truth and the ghost as the possibility. */}
        <Animated.View
          style={[
            { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999, backgroundColor: `${colors.epic}40` },
            ghostStyle,
          ]}
        />
        <Animated.View
          style={[
            { height: '100%', borderRadius: 999, backgroundColor: weakest ? colors.warn : colors.accent },
            fillStyle,
          ]}
        />
      </View>
    </View>
  );
}

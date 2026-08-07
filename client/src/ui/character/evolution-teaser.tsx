import { Link } from 'expo-router';
import { useEffect } from 'react';
import { Image, Pressable, Text, View, type ImageSourcePropType } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { Branch } from '@/domain/avatar-stats';
import { getBranchStage } from '@/domain/avatar-stats';
import { massArtStage } from '@/domain/branches-v2';
import { evolutionReadiness } from '@/domain/evolution-readiness';
import type { NextEvolution } from '@/domain/next-evolution';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useAmbient } from '@/ui/core/use-ambient';

import { EdgeLabel } from '@/ui/core/hud';
import { Silhouette } from './silhouette';

/**
 * WHAT AM I BECOMING? — the next form, as a reveal rather than a percentage.
 *
 * It used to read "77% READY" beside a silhouette, which states a fact and
 * generates nothing. The shape now is the brief's: CURRENT FORM → the
 * SILHOUETTE of what is next → progress → the requirement standing in the way.
 * Seeing what you are beside what you could be is the whole motivation; the
 * number is the caption, not the point.
 *
 * THE MYSTERY IS PRESERVED ON PURPOSE. The next form is never the raw asset —
 * always black-tinted, dimmed and glow-rimmed, so the athlete can see the
 * SHAPE of what is coming and not its face. A silhouette that resolves too
 * early spends the reveal it exists to set up.
 *
 * The headline is derived from real readiness, never decoration: "ALMOST
 * EVOLVED" only appears when the requirements say so.
 */

/** Real readiness → the words for it. Nothing here invents progress. */
function headlineFor(percent: number, allMet: boolean): string {
  if (allMet || percent >= 100) return 'READY TO EVOLVE';
  if (percent >= 90) return 'ALMOST EVOLVED';
  if (percent >= 60) return 'TAKING SHAPE';
  if (percent >= 30) return 'FORMING';
  return 'THE NEXT FORM';
}

export function EvolutionTeaser({
  branch,
  evolution,
  currentName,
  currentSource,
}: {
  branch: Branch;
  evolution: NextEvolution;
  /** The form the athlete is in NOW — the left half of the comparison. */
  currentName?: string;
  currentSource?: ImageSourcePropType | null;
}) {
  const colors = useThemeColors();
  const ambient = useAmbient();
  const reduced = useReducedMotion();
  const readiness = evolutionReadiness(evolution.requirements);
  const nextStage =
    branch === 'mass' ? massArtStage(evolution.targetLevel) : getBranchStage(branch, evolution.targetLevel);
  const ready = readiness.percent >= 100 || readiness.nearest === null;

  // THE SILHOUETTE BREATHES. One ambient driver, and only the thing the
  // athlete is meant to want — the current form stays still, so the eye is
  // pulled forward rather than split.
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!ambient) {
      pulse.value = 0;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration: 3400, easing: Easing.linear }), -1);
  }, [ambient, pulse]);

  const auraStyle = useAnimatedStyle(() => {
    if (reduced) return { opacity: 0.35 };
    const wave = (1 - Math.cos(pulse.value * Math.PI * 2)) / 2;
    return { opacity: 0.18 + wave * 0.34 };
  });

  // The bar fills on mount — a progress bar that arrives full has shown the
  // athlete nothing about the distance they covered.
  const grow = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      grow.value = 1;
      return;
    }
    grow.value = 0;
    grow.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [reduced, grow]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${readiness.percent * grow.value}%` }));

  return (
    <Link href="/avatar" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          ready
            ? `You are ready to evolve into ${evolution.targetName}.`
            : `Next evolution: ${evolution.targetName}, ${readiness.percent} percent ready. ${readiness.nearest?.label ?? ''}`
        }
        testID="evolution-teaser"
      >
        <View
          className="rounded-xl p-s4"
          style={{
            borderWidth: 1,
            borderColor: ready ? `${colors.legendary}66` : `${colors.epic}45`,
            backgroundColor: ready ? 'rgba(251,191,36,0.06)' : 'rgba(168, 85, 247, 0.06)',
          }}
        >
          <EdgeLabel>{headlineFor(readiness.percent, ready)}</EdgeLabel>

          {/* NOW → NEXT. The comparison IS the motivation. */}
          <View className="mt-s3 flex-row items-center" style={{ gap: 10 }}>
            <View className="items-center" style={{ width: 62 }}>
              {currentSource ? (
                <Image
                  source={currentSource}
                  style={{ width: 56, height: 68, resizeMode: 'contain' }}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <Silhouette branch={branch} stage={Math.max(1, nextStage - 1)} width={56} height={68} />
              )}
              <Text
                className="mt-s1 text-text-mute"
                numberOfLines={1}
                allowFontScaling={false}
                style={{ fontSize: 7, letterSpacing: 0.8, ...pixelFont(false) }}
              >
                {(currentName ?? 'NOW').toUpperCase()}
              </Text>
            </View>

            <Text
              allowFontScaling={false}
              style={{ fontSize: 18, color: ready ? colors.legendary : colors.epic, opacity: 0.7 }}
            >
              ›
            </Text>

            {/* The unknown, kept unknown. */}
            <View className="items-center" style={{ width: 62 }}>
              <View>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    {
                      position: 'absolute',
                      left: -8,
                      right: -8,
                      top: -6,
                      bottom: -6,
                      borderRadius: 40,
                      backgroundColor: ready ? colors.legendary : colors.epic,
                    },
                    auraStyle,
                  ]}
                />
                <Silhouette branch={branch} stage={nextStage} width={56} height={68} />
              </View>
              <Text
                className="mt-s1"
                numberOfLines={1}
                allowFontScaling={false}
                style={{
                  fontSize: 7,
                  letterSpacing: 0.8,
                  color: ready ? colors.legendary : colors.epic,
                  ...pixelFont(false),
                }}
              >
                {evolution.targetName.toUpperCase()}
              </Text>
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                allowFontScaling={false}
                style={{
                  fontSize: 22,
                  letterSpacing: 0,
                  color: ready ? colors.legendary : colors.epic,
                  ...pixelFont(),
                }}
              >
                {readiness.percent}%
              </Text>
              <View
                className="mt-s1 overflow-hidden rounded-pill"
                style={{ height: 5, backgroundColor: colors['surface-3'] }}
              >
                <Animated.View
                  style={[
                    {
                      height: '100%',
                      borderRadius: 999,
                      backgroundColor: ready ? colors.legendary : colors.epic,
                    },
                    fillStyle,
                  ]}
                />
              </View>
            </View>
          </View>

          {/* WHAT IS IN THE WAY — one requirement, the closest one, so the
              answer to "how do I get there" is a single sentence. */}
          <Text className="mt-s3 text-2xs text-text-mute">
            {ready ? (
              <Text style={{ color: colors.legendary }}>
                Every requirement met. Open the Forge to evolve.
              </Text>
            ) : (
              <>
                NEXT REQUIREMENT · <Text className="text-text-dim">{readiness.nearest?.label}</Text>
              </>
            )}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

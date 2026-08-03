/**
 * THE CHAMPION, CHARGING (2026-08-03, TRAIN brief) — "Keep the Champion
 * present. As sets are completed: Champion gains energy, glow increases, idle
 * animation changes, platform powers. Workout complete: victory pose. The Home
 * page and Train page should feel connected."
 *
 * It is the same companion that has always sat in Train's top-right (it is
 * also the profile menu, and stays one) — it now READS TODAY. Every value
 * below is today's real done/target, the same fraction the hero card's
 * progress bar draws, so the champion cannot celebrate a workout the card says
 * is unfinished:
 *
 *   0 sets            idle, unlit, the plate dark
 *   partway           the punch cycle, glow rising with the fraction, the
 *                     charge plate filling underneath
 *   finished          the victory flex, full glow, the plate solid
 *
 * ---- NO LOOP ----
 *
 * The glow and the plate are DERIVED from a number that only changes when a
 * set lands, so they animate with a 420ms one-shot on change rather than a
 * repeating driver. The sprite's own cycle is the only continuous motion, and
 * SpriteCompanion already gates that on the ambient rule. A champion that
 * pulsed forever in the corner of a page would be a permanent claim on the
 * frame budget for something nobody looks at twice.
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColors } from '@/theme/use-theme';
import { CompanionMenuButton } from '@/ui/character/companion-menu';

export function ChampionCharge({
  done,
  target,
  finished,
  /** CARDIO mode overrides the pose with its own activity animation. */
  overrideAnim,
  height = 44,
}: {
  done: number;
  target: number;
  finished: boolean;
  overrideAnim?: 'idle' | 'run' | 'punch' | 'victory';
  height?: number;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();

  const fraction = finished ? 1 : target > 0 ? Math.min(1, Math.max(0, done / target)) : done > 0 ? 0.5 : 0;
  const anim: 'idle' | 'run' | 'punch' | 'victory' =
    overrideAnim ?? (finished ? 'victory' : fraction > 0 ? 'punch' : 'idle');
  const tint = finished ? colors.success : colors.accent;

  const charge = useSharedValue(reduced ? fraction : 0);
  useEffect(() => {
    if (reduced) {
      charge.value = fraction;
      return;
    }
    charge.value = withTiming(fraction, { duration: 420, easing: Easing.out(Easing.cubic) });
  }, [fraction, reduced, charge]);

  const frame = useAnimatedStyle(() => ({
    shadowOpacity: 0.12 + charge.value * 0.6,
  }));
  const plate = useAnimatedStyle(() => ({
    width: `${charge.value * 100}%` as `${number}%`,
    opacity: 0.4 + charge.value * 0.6,
  }));

  return (
    <View className="items-center">
      <Animated.View
        style={[
          {
            borderRadius: 12,
            borderWidth: 1,
            padding: 4,
            borderColor: `${tint}59`,
            backgroundColor: 'rgba(13,21,36,0.6)',
            shadowColor: tint,
            shadowRadius: 16,
          },
          frame,
        ]}
      >
        <CompanionMenuButton anim={anim} height={height} />
      </Animated.View>
      {/* THE CHARGE PLATE — the champion's platform powering up as the day
          fills. Four points tall: it is a readout, not a second progress bar
          competing with the hero card's.
          THE TRACK IS NEARLY INVISIBLE ON PURPOSE. At `surface-3` it read as a
          stray grey rule under the sprite before any set was logged — a line
          that says nothing is worse than no line. It only becomes an object
          once the plate inside it has something to show. */}
      <View
        className="mt-s1 overflow-hidden rounded-pill"
        style={{ width: height - 6, height: 4, backgroundColor: 'rgba(148,163,184,0.16)' }}
        testID="champion-charge"
      >
        <Animated.View
          style={[
            { height: '100%', borderRadius: 999, backgroundColor: tint, shadowColor: tint, shadowOpacity: 0.8, shadowRadius: 6 },
            plate,
          ]}
        />
      </View>
    </View>
  );
}

/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press handlers by design; the compiler lint cannot see that
   .value writes are UI-thread animation state, not render state. Same
   documented exception as ui/core/neon-button.tsx. */
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { STATUS_LABEL, type WeekBar, type WorkoutStatus } from '@/domain/week-status';
import { useThemeColors } from '@/theme/use-theme';
import { useAmbient } from '@/ui/core/use-ambient';
import { PixelCross, PixelTick } from '@/ui/core/pixel-icons';

/**
 * TRAIN_PAGE_V2 — a bar is a DOOR, not a drawer.
 *
 * Tapping a workout ENTERS it (a pushed page). COMPACT since the target
 * layout (Tyson, 2026-07-15): day · status circle · name over sets-fraction ·
 * status badge · chevron — several rows must fit above the tab bar, so every
 * pixel of chrome earns its place. Today's row is lit cyan.
 *
 * A completed workout is SOFT-locked: tapping it opens the read-only recap,
 * and EDIT (its own 44pt target) reopens it and takes you straight in. One
 * tap from bar to editing is what "soft lock" has to mean, or it is a wall.
 *
 * ---- CAMPAIGN PROGRESSION (2026-08-03, TRAIN brief) ----
 *
 * "Today highlighted · future days locked appearance · completed days animated
 * checkmark and completed glow · current day should pulse subtly." All four
 * are here, and the ROWS survived rather than being replaced by the mock's
 * seven-column strip — a strip cannot carry the sets fraction, the PARTIAL
 * verdict, a day's EXTRA workouts or the EDIT affordance, and losing those to
 * gain a row of icons would be a downgrade wearing a redesign's clothes.
 *
 * ONE loop in the whole week: today's row breathes. Completed rows pop their
 * tick ONCE (a one-shot, so it is never perf-gated) and then hold a static
 * glow. Seven looping rows would have cost seven main-thread drivers on web
 * for an effect no one can look at seven of at once.
 */

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// Colour as a token KEY, resolved through the theme at render.
const BADGE: Partial<Record<WorkoutStatus, { label: string; colour: 'success' | 'warn' | 'danger' | 'accent' }>> = {
  completed: { label: 'COMPLETED', colour: 'success' },
  partial: { label: 'PARTIAL', colour: 'warn' },
  missed: { label: 'MISSED', colour: 'danger' },
  in_progress: { label: 'TODAY', colour: 'accent' },
};

/** The verdict, drawn: an outlined circle; decided states carry their mark. */
function StatusCircle({ status }: { status: WorkoutStatus }) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const D = 20;
  const done = status === 'completed' || status === 'partial';
  const colour =
    status === 'completed'
      ? colors.success
      : status === 'partial'
        ? colors.warn
        : status === 'missed'
          ? colors.danger
          : status === 'in_progress'
            ? colors.accent
            : colors.border;

  // THE TICK LANDING. One shot, on the render where the day becomes decided —
  // which for the day you just finished is the frame you finished it.
  const pop = useSharedValue(reduced || !done ? 1 : 0);
  useEffect(() => {
    if (reduced || !done) return;
    pop.value = 0;
    pop.value = withSpring(1, { damping: 11, stiffness: 220 });
  }, [done, reduced, pop]);
  const tick = useAnimatedStyle(() => ({
    opacity: Math.min(1, pop.value * 2),
    transform: [{ scale: pop.value }],
  }));

  return (
    <View
      testID={`status-circle-${status}`}
      style={{
        width: D,
        height: D,
        borderRadius: D / 2,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: colour,
        // COMPLETED GLOW: a finished day is the only one that emits light.
        shadowColor: colour,
        shadowOpacity: status === 'completed' ? 0.75 : 0,
        shadowRadius: 8,
        elevation: status === 'completed' ? 4 : 0,
      }}
    >
      {done ? (
        <Animated.View style={tick}>
          <PixelTick size={9} color={colour} />
        </Animated.View>
      ) : status === 'missed' ? (
        <PixelCross size={8} color={colour} />
      ) : null}
    </View>
  );
}

export function WeekBarRow({
  bar,
  onOpen,
  onEdit,
  /** Extra (ad-hoc / off-schedule) bars show no weekday — they are today's. */
  showDay = true,
  /** Sets logged / sets the day asks for. Defaults to what the bar itself
   *  carries (domain-threaded since TRAIN_OVERHAUL). */
  sets,
}: {
  bar: WeekBar;
  onOpen: () => void;
  onEdit?: () => void;
  showDay?: boolean;
  sets?: { done: number; target: number };
}) {
  const colors = useThemeColors();
  const ambient = useAmbient();
  const rest = bar.status === 'rest';
  const isToday = bar.status === 'in_progress';
  const upcoming = bar.status === 'upcoming';
  const frac = sets ?? { done: bar.done, target: bar.target };
  const badge = BADGE[bar.status];

  // TODAY BREATHES. The one loop on this list, and only while Train is the
  // focused tab — the ambient gate is what keeps five preloaded screens from
  // ticking five of these at once.
  const beat = useSharedValue(0);
  useEffect(() => {
    if (!ambient || !isToday) {
      beat.value = 0;
      return;
    }
    beat.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [ambient, isToday, beat]);
  // ANIMATED NODES CARRY INLINE STYLES ONLY (the week-strip lesson) — every
  // class that used to live on this row is inline below.
  const breath = useAnimatedStyle(() => ({
    shadowOpacity: isToday ? 0.16 + beat.value * 0.3 : 0,
    borderColor: isToday ? colors.accent : 'transparent',
  }));

  const press = useSharedValue(1);
  const lift = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  return (
    <Animated.View
      style={[
        {
          marginBottom: 4,
          borderRadius: 8,
          borderWidth: isToday ? 1 : 0,
          shadowColor: colors.accent,
          shadowRadius: 16,
        },
        breath,
        lift,
      ]}
    >
      <Pressable
        onPress={rest ? undefined : onOpen}
        onPressIn={() => {
          if (!rest) press.value = withSpring(0.985, { damping: 20, stiffness: 400 });
        }}
        onPressOut={() => {
          press.value = withSpring(1, { damping: 16, stiffness: 300 });
        }}
        disabled={rest}
        accessibilityRole="button"
        accessibilityState={{ disabled: rest }}
        accessibilityLabel={`${bar.workout ?? 'Rest day'}, ${STATUS_LABEL[bar.status]}`}
        testID={`weekbar-${bar.date}${bar.workout ? `-${bar.workout}` : ''}`}
        className="flex-row items-center rounded-md border px-s3"
        style={{
          minHeight: 52,
          gap: 10,
          borderColor: isToday ? `${colors.accent}8c` : colors.border,
          backgroundColor: isToday ? 'rgba(34,211,238,0.08)' : rest ? 'rgba(13,21,36,0.35)' : 'rgba(13,21,36,0.65)',
          // LOCKED APPEARANCE for what has not happened yet. It is still a
          // door — it focuses the carousel on that day — it just stops
          // competing with the day the athlete is standing in.
          opacity: rest ? 0.6 : upcoming ? 0.72 : 1,
        }}
      >
        {showDay ? (
          <Text
            className="text-2xs font-bold"
            numberOfLines={1}
            style={{ width: 34, letterSpacing: 1, color: isToday ? colors.accent : colors['text-mute'] }}
          >
            {WEEKDAYS[bar.dow]}
          </Text>
        ) : (
          <Text className="text-2xs font-bold" style={{ width: 34, color: colors.accent }}>
            ＋
          </Text>
        )}

        <StatusCircle status={bar.status} />

        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text className={`text-sm font-bold ${rest ? 'text-text-mute' : 'text-text'}`} numberOfLines={1}>
            {bar.workout ?? 'Rest'}
          </Text>
          {frac.target > 0 && !rest ? (
            <Text className="text-2xs text-text-mute">
              {frac.done} / {frac.target} sets
            </Text>
          ) : null}
        </View>

        {/* Colour is never the only cue (a11y): the badge says it too. */}
        {badge ? (
          <View
            className="rounded-md px-s2 py-s1"
            style={{ backgroundColor: `${colors[badge.colour]}22` }}
          >
            <Text className="text-2xs font-bold" style={{ color: colors[badge.colour], letterSpacing: 1 }}>
              {badge.label}
            </Text>
          </View>
        ) : upcoming && !rest ? (
          // The campaign's "not yet". A glyph, not a badge: a future day should
          // read as sealed, not as a fourth loud status.
          <Text className="text-2xs" style={{ color: colors['text-mute'] }} testID={`weekbar-locked-${bar.date}`}>
            ▮▯
          </Text>
        ) : null}

        {bar.locked && onEdit ? (
          <Pressable
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel={`reopen and edit ${bar.workout}`}
            testID={`weekbar-edit-${bar.date}`}
            className="items-center justify-center"
            style={{ minWidth: 40, minHeight: 44 }}
          >
            <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
              EDIT
            </Text>
          </Pressable>
        ) : null /* the trailing › implied the row opened a page it doesn't —
          rows only FOCUS the carousel. Removed 2026-07-19 (Tyson). */}
      </Pressable>
    </Animated.View>
  );
}

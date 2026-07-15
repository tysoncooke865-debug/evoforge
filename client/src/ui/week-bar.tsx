import { Pressable, Text, View } from 'react-native';

import { STATUS_LABEL, type WeekBar, type WorkoutStatus } from '@/domain/week-status';
import tokens from '@/theme/tokens';
import { PixelCross, PixelTick } from '@/ui/pixel-icons';

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
 */

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const BADGE: Partial<Record<WorkoutStatus, { label: string; colour: string }>> = {
  completed: { label: 'COMPLETED', colour: tokens.colors.success },
  partial: { label: 'PARTIAL', colour: tokens.colors.warn },
  missed: { label: 'MISSED', colour: tokens.colors.danger },
  in_progress: { label: 'TODAY', colour: tokens.colors.accent },
};

/** The verdict, drawn: an outlined circle; decided states carry their mark. */
function StatusCircle({ status }: { status: WorkoutStatus }) {
  const D = 20;
  const colour =
    status === 'completed'
      ? tokens.colors.success
      : status === 'partial'
        ? tokens.colors.warn
        : status === 'missed'
          ? tokens.colors.danger
          : status === 'in_progress'
            ? tokens.colors.accent
            : tokens.colors.border;
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
      }}
    >
      {status === 'completed' || status === 'partial' ? (
        <PixelTick size={9} color={colour} />
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
  const rest = bar.status === 'rest';
  const isToday = bar.status === 'in_progress';
  const frac = sets ?? { done: bar.done, target: bar.target };
  const badge = BADGE[bar.status];

  return (
    <View className="mb-s1">
      <Pressable
        onPress={rest ? undefined : onOpen}
        disabled={rest}
        accessibilityRole="button"
        accessibilityState={{ disabled: rest }}
        accessibilityLabel={`${bar.workout ?? 'Rest day'}, ${STATUS_LABEL[bar.status]}`}
        testID={`weekbar-${bar.date}${bar.workout ? `-${bar.workout}` : ''}`}
        className="flex-row items-center rounded-md border px-s3"
        style={{
          minHeight: 52,
          gap: 10,
          borderColor: isToday ? `${tokens.colors.accent}8c` : tokens.colors.border,
          backgroundColor: isToday ? 'rgba(34,211,238,0.06)' : rest ? 'rgba(13,21,36,0.35)' : 'rgba(13,21,36,0.65)',
          opacity: rest ? 0.6 : 1,
        }}
      >
        {showDay ? (
          <Text
            className="text-2xs font-bold"
            numberOfLines={1}
            style={{ width: 34, letterSpacing: 1, color: isToday ? tokens.colors.accent : tokens.colors['text-mute'] }}
          >
            {WEEKDAYS[bar.dow]}
          </Text>
        ) : (
          <Text className="text-2xs font-bold" style={{ width: 34, color: tokens.colors.accent }}>
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
            style={{ backgroundColor: `${badge.colour}22` }}
          >
            <Text className="text-2xs font-bold" style={{ color: badge.colour, letterSpacing: 1 }}>
              {badge.label}
            </Text>
          </View>
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
        ) : !rest ? (
          <Text className="text-sm" style={{ color: tokens.colors['text-mute'] }}>
            ›
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

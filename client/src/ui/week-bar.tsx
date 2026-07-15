import { Pressable, Text, View } from 'react-native';

import { STATUS_LABEL, type WeekBar, type WorkoutStatus } from '@/domain/week-status';
import tokens from '@/theme/tokens';
import { PixelCross, PixelTick } from '@/ui/pixel-icons';

/**
 * TRAIN_PAGE_V2 — a bar is a DOOR, not a drawer.
 *
 * Tapping a workout ENTERS it (a pushed page), instead of dropping the logging
 * UI into the middle of the week list. Train is the hub: the week, at a glance,
 * with the truth on the left now (TRAIN_OVERHAUL) — a status circle: empty ring
 * upcoming, accent ring today, green tick completed, red ✕ missed, yellow tick
 * PARTIAL (finished early, and the label says so).
 *
 * A completed workout is SOFT-locked: tapping it opens the read-only recap, and
 * EDIT (its own 44pt target, so it cannot be hit by accident when you meant to
 * look) reopens it and takes you straight in, unlocked. One tap from bar to
 * editing is what "soft lock" has to mean, or it is just a wall. The old 🔒
 * emoji is gone — the circle + label already tell the story, and EDIT is the
 * affordance that matters.
 */

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function statusColour(status: WorkoutStatus): string {
  switch (status) {
    case 'completed':
      return tokens.colors.success;
    case 'partial':
      return tokens.colors.warn;
    case 'missed':
      return tokens.colors.danger;
    case 'in_progress':
      return tokens.colors['text-mute'];
    default:
      return tokens.colors['text-dim'];
  }
}

/** The verdict, drawn: ring for the open states, fill + pixel mark for the
 *  decided ones. Colour is never the only cue — the row label says it too. */
function StatusCircle({ status }: { status: WorkoutStatus }) {
  const D = 22;
  const decided = status === 'completed' || status === 'partial' || status === 'missed';
  const fill =
    status === 'completed'
      ? tokens.colors.success
      : status === 'partial'
        ? tokens.colors.warn
        : status === 'missed'
          ? tokens.colors.danger
          : 'transparent';
  const ring =
    status === 'in_progress'
      ? tokens.colors.accent
      : status === 'rest'
        ? `${tokens.colors.border}88`
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
        backgroundColor: decided ? fill : 'transparent',
        borderWidth: decided ? 0 : 2,
        borderColor: ring,
        // Today's ring glows faintly — it is the live one.
        shadowColor: status === 'in_progress' ? tokens.colors.accent : 'transparent',
        shadowOpacity: status === 'in_progress' ? 0.5 : 0,
        shadowRadius: 8,
      }}
    >
      {status === 'completed' || status === 'partial' ? (
        <PixelTick size={11} color={tokens.colors['accent-ink']} />
      ) : status === 'missed' ? (
        <PixelCross size={10} color={tokens.colors['accent-ink']} />
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
  const colour = statusColour(bar.status);
  const isToday = bar.status === 'in_progress';
  const frac = sets ?? { done: bar.done, target: bar.target };

  return (
    <View className="mb-s2">
      <Pressable
        onPress={rest ? undefined : onOpen}
        disabled={rest}
        accessibilityRole="button"
        accessibilityState={{ disabled: rest }}
        accessibilityLabel={`${bar.workout ?? 'Rest day'}, ${STATUS_LABEL[bar.status]}`}
        testID={`weekbar-${bar.date}${bar.workout ? `-${bar.workout}` : ''}`}
        className="flex-row items-center rounded-xl border px-s3"
        style={{
          minHeight: 56,
          borderColor:
            bar.status === 'completed'
              ? `${tokens.colors.success}40`
              : bar.status === 'partial'
                ? `${tokens.colors.warn}40`
                : bar.status === 'missed'
                  ? `${tokens.colors.danger}33`
                  : isToday
                    ? `${tokens.colors.accent}59`
                    : tokens.colors.border,
          backgroundColor: rest ? 'rgba(13,21,36,0.35)' : 'rgba(13,21,36,0.65)',
          opacity: rest ? 0.6 : 1,
        }}
      >
        {showDay ? (
          <Text
            className="text-2xs font-bold"
            style={{
              width: 38,
              letterSpacing: 1,
              color: isToday ? tokens.colors.accent : tokens.colors['text-mute'],
            }}
          >
            {WEEKDAYS[bar.dow]}
          </Text>
        ) : (
          <Text className="text-2xs font-bold" style={{ width: 38, color: tokens.colors.accent }}>
            ＋
          </Text>
        )}

        <View className="mr-s3">
          <StatusCircle status={bar.status} />
        </View>

        <View className="flex-1 pr-s2">
          <Text className={`text-sm font-bold ${rest ? 'text-text-mute' : 'text-text'}`} numberOfLines={1}>
            {bar.workout ?? 'Rest'}
          </Text>
          {frac.target > 0 && !rest ? (
            <Text className="text-2xs text-text-mute">
              {frac.done}/{frac.target} sets
            </Text>
          ) : null}
        </View>

        {/* Colour is never the only cue (a11y): the label says it too. */}
        <Text className="text-2xs font-bold" style={{ color: colour, letterSpacing: 1 }}>
          {STATUS_LABEL[bar.status]}
        </Text>

        {bar.locked && onEdit ? (
          <Pressable
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel={`reopen and edit ${bar.workout}`}
            testID={`weekbar-edit-${bar.date}`}
            className="ml-s2 items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
              EDIT
            </Text>
          </Pressable>
        ) : !rest ? (
          <Text className="ml-s2 text-2xs" style={{ color: tokens.colors['text-mute'] }}>
            ›
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

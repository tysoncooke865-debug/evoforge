import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { STATUS_LABEL, type WeekBar } from '@/domain/week-status';
import tokens from '@/theme/tokens';

/**
 * TRAIN_IMPROVEMENTS — the week as a list of workouts, not a row of day chips.
 *
 * One bar per day: the workout's name, and on the right the truth about it —
 * grey IN PROGRESS, red MISSED, green COMPLETED. Tapping one drops the logging
 * UI open underneath it; finishing collapses it.
 *
 * The body is passed in and stays MOUNTED (hidden with `display`), because
 * SetRow seeds its typed state once on mount: unmounting a collapsed bar would
 * throw away half-typed numbers, which is the one thing a logging screen must
 * never do.
 */

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function statusColour(bar: WeekBar): string {
  switch (bar.status) {
    case 'completed':
      return tokens.colors.success;
    case 'missed':
      return tokens.colors.danger;
    case 'in_progress':
      return tokens.colors['text-mute'];
    default:
      return tokens.colors['text-dim'];
  }
}

export function WeekBarRow({
  bar,
  expanded,
  onToggle,
  children,
}: {
  bar: WeekBar;
  expanded: boolean;
  onToggle: () => void;
  /** The logging UI (today) or a read-only recap (past/future). */
  children?: ReactNode;
}) {
  const rest = bar.status === 'rest';
  const colour = statusColour(bar);
  const isToday = bar.status === 'in_progress';

  return (
    <View className="mb-s2">
      <Pressable
        onPress={rest ? undefined : onToggle}
        disabled={rest}
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: rest }}
        accessibilityLabel={`${bar.workout ?? 'Rest day'}, ${STATUS_LABEL[bar.status]}`}
        testID={`weekbar-${bar.date}`}
        className="flex-row items-center rounded-xl border px-s3"
        style={{
          minHeight: 56,
          borderColor: expanded
            ? `${tokens.colors.accent}66`
            : bar.status === 'completed'
              ? `${tokens.colors.success}40`
              : bar.status === 'missed'
                ? `${tokens.colors.danger}33`
                : tokens.colors.border,
          backgroundColor: rest ? 'rgba(13,21,36,0.35)' : 'rgba(13,21,36,0.65)',
          opacity: rest ? 0.6 : 1,
        }}
      >
        <Text
          className="text-2xs font-bold"
          style={{ width: 38, letterSpacing: 1, color: isToday ? tokens.colors.accent : tokens.colors['text-mute'] }}
        >
          {WEEKDAYS[bar.dow]}
        </Text>

        <View className="flex-1 pr-s2">
          <Text
            className={`text-sm font-bold ${rest ? 'text-text-mute' : 'text-text'}`}
            numberOfLines={1}
          >
            {bar.workout ?? 'Rest'}
          </Text>
        </View>

        {/* Colour is never the only cue (a11y): the label says it too. */}
        <Text className="text-2xs font-bold" style={{ color: colour, letterSpacing: 1 }}>
          {STATUS_LABEL[bar.status]}
          {bar.locked ? ' 🔒' : ''}
        </Text>

        {!rest ? (
          <Text className="ml-s2 text-2xs" style={{ color: tokens.colors['text-mute'] }}>
            {expanded ? '▾' : '▸'}
          </Text>
        ) : null}
      </Pressable>

      {/* KEEP-MOUNTED: collapsing must not discard half-typed sets. */}
      {children !== undefined ? (
        <View style={{ display: expanded ? 'flex' : 'none' }} className="mt-s2 gap-s3">
          {children}
        </View>
      ) : null}
    </View>
  );
}

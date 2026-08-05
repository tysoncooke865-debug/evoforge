/**
 * "EVO RATING · CALIBRATING" — the rating while it is still learning
 * (docs/ONBOARDING_V3_SPEC.md §5, §8).
 *
 * TWO SHAPES, ONE SOURCE. `compact` is Home's SECONDARY slot: one line that
 * says the rating is calibrating and one that says what starts it. `full` is
 * the /evo panel: all five areas and what moves each.
 *
 * The physique row is styled exactly like every other row. It is never
 * amber, never a warning, never a checklist item with a red dot — an
 * optional thing that looks overdue is not optional.
 */

import { Text, View } from 'react-native';

import type { AreaState, CalibrationSummary } from '@/domain/progression/calibration';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { GlowCard } from '@/ui/core/shell';

const PILLAR_AREA: Record<string, string> = {
  size: 'Physique',
  aesthetics: 'Physique',
  strength: 'Strength',
  cardio: 'Cardio',
};

export function CalibrationCard({
  summary,
  variant = 'full',
  testID,
}: {
  summary: CalibrationSummary;
  variant?: 'compact' | 'full';
  testID?: string;
}) {
  const colors = useThemeColors();

  if (variant === 'compact') {
    return (
      <View testID={testID}>
        <GlowCard padding={14}>
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
          >
            EVO RATING
          </Text>
          <Text
            className="mt-s1"
            allowFontScaling={false}
            style={{ fontSize: 20, letterSpacing: 0, color: colors.accent, ...pixelFont() }}
          >
            {summary.headline}
          </Text>
          <Text className="mt-s1 text-2xs text-text-mute">{summary.sub}</Text>
        </GlowCard>
      </View>
    );
  }

  return (
    <View testID={testID}>
      <GlowCard padding={16}>
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          WHAT YOUR RATING IS LEARNING
        </Text>
        {/* The sub-line is the HEADLINE card's job when there is no rating
            yet — printing it again here just says the same sentence twice. */}
        {summary.rating !== null ? (
          <Text className="mt-s1 text-sm text-text-dim">{summary.sub}</Text>
        ) : null}

        <View className="mt-s3">
          {summary.areas.map((a) => (
            <View
              key={a.key}
              className="flex-row items-start justify-between border-t py-s2"
              style={{ borderColor: 'rgba(148,163,184,0.14)' }}
            >
              <View className="flex-1 pr-s3">
                <Text
                  allowFontScaling={false}
                  style={{ fontSize: 12, color: colors.text, ...pixelFont() }}
                >
                  {a.label.toUpperCase()}
                </Text>
                <Text className="mt-[2px] text-2xs text-text-mute">{a.detail}</Text>
              </View>
              <StateDot state={a.state} />
            </View>
          ))}
        </View>

        {/* The limiting area, named — because overall confidence is the MIN of
            the four pillars, so telling everyone "add a photo" would be wrong
            for most athletes and a nudge toward the one thing we never push. */}
        {summary.limiting ? (
          <Text className="mt-s3 text-2xs text-text-mute">
            {PILLAR_AREA[summary.limiting] ?? summary.limiting} is what your rating is waiting on
            most right now.
          </Text>
        ) : null}
      </GlowCard>
    </View>
  );
}

function StateDot({ state }: { state: AreaState }) {
  const colors = useThemeColors();
  const label: Record<AreaState, string> = {
    waiting: 'WAITING',
    learning: 'LEARNING',
    calibrated: 'CALIBRATED',
    declined: 'OFF',
  };
  // `declined` is a settled choice, not a gap — it reads the same weight as
  // `waiting`, never as a warning.
  const colour: Record<AreaState, string> = {
    waiting: colors['text-mute'],
    learning: colors.accent,
    calibrated: colors.success,
    declined: colors['text-mute'],
  };
  return (
    <Text
      allowFontScaling={false}
      style={{ fontSize: 9, letterSpacing: 1, color: colour[state], ...pixelFont(false) }}
    >
      {label[state]}
    </Text>
  );
}

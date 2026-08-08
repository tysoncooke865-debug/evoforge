import { Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * WHAT REMAINS HERE IS THE STREAK.
 *
 * `StakesBlock` (the two-outcome card plus a paragraph about what a loss does
 * not touch) was retired in the 2026-08-08 duel pass. `AtRiskGrid` in
 * ui/duel/duel-hud.tsx says the same thing as five labelled rows, and keeping
 * a second copy of a reassurance about money is how the two end up disagreeing.
 */

/**
 * THE STREAK — the reason to take one more.
 *
 * Shows the run and the next milestone, and nothing else. There is no reward
 * table behind it and no random drop: the milestone is a number to reach, and
 * reaching it is entirely a function of training. Renders nothing at zero with
 * no history, because "0 WIN STREAK" is not a motivator, it is a scoreboard
 * for something that has not started.
 */
export function StreakBanner({
  current,
  best,
  nextMilestone,
  toNext,
  testID,
}: {
  current: number;
  best: number;
  nextMilestone: number | null;
  toNext: number | null;
  testID?: string;
}) {
  const colors = useThemeColors();
  if (current === 0 && best === 0) return null;

  return (
    <View
      className="flex-row items-center rounded-lg border px-s3 py-s2"
      style={{
        gap: 10,
        borderColor: current > 0 ? `${colors.legendary}4d` : colors.border,
        backgroundColor: current > 0 ? 'rgba(251,191,36,0.06)' : 'rgba(13,21,36,0.5)',
      }}
      testID={testID}
    >
      <Text allowFontScaling={false} style={{ fontSize: 16, opacity: current > 0 ? 1 : 0.35 }}>
        🔥
      </Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          allowFontScaling={false}
          style={{
            fontSize: 13,
            letterSpacing: 0,
            color: current > 0 ? colors.legendary : colors['text-dim'],
            ...pixelFont(),
          }}
        >
          {current} WIN STREAK
        </Text>
        <Text className="text-2xs text-text-mute" numberOfLines={1}>
          {nextMilestone !== null && toNext !== null
            ? `${toNext} more to reach ${nextMilestone}`
            : `Your best run: ${best}`}
        </Text>
      </View>
      {best > current ? (
        <Text className="text-2xs text-text-mute" numberOfLines={1}>
          BEST {best}
        </Text>
      ) : null}
    </View>
  );
}

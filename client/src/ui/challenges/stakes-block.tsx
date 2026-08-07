import { Text, View } from 'react-native';

import { outcomesFor } from '@/domain/challenge-progression';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';

/**
 * WHAT IS ON THE LINE — the stake as a hero element, never buried.
 *
 * Both outcomes, side by side, because the reassuring half is the honest half:
 * a challenge moves COINS and nothing else. XP, the Forge Level, the Evo
 * Rating and every evolution requirement are computed from logged training and
 * are untouched by the result. Losing a wager cannot make an athlete smaller,
 * and saying so plainly is what makes staking again feel reasonable rather
 * than reckless.
 *
 * No "potential winnings" framing, no multipliers, no odds. The numbers are
 * the two real ones: what you take, and what it costs.
 */
export function StakesBlock({ stake, testID }: { stake: number; testID?: string }) {
  const colors = useThemeColors();
  const o = outcomesFor(stake);

  return (
    <View testID={testID}>
      <View className="flex-row" style={{ gap: 8 }}>
        <Outcome
          label="IF YOU WIN"
          value={`+${o.winCoins}`}
          tint={colors.success}
          note="The whole escrow"
          testID="stakes-win"
        />
        <Outcome
          label="IF YOU LOSE"
          value={`−${o.loseCoins}`}
          tint={colors['text-dim']}
          note="Your stake only"
          testID="stakes-lose"
        />
      </View>

      {/* The reassurance, said once and precisely. */}
      <Text className="mt-s2 text-2xs text-text-mute" testID="stakes-safe">
        A draw refunds both stakes in full. Nothing else is at risk —{' '}
        {o.safe.join(', ').toLowerCase()} are all earned from your logged training and are never
        affected by the result.
      </Text>
    </View>
  );
}

function Outcome({
  label,
  value,
  tint,
  note,
  testID,
}: {
  label: string;
  value: string;
  tint: string;
  note: string;
  testID: string;
}) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-lg border p-s3"
      style={{ flex: 1, minWidth: 0, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
      testID={testID}
    >
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 8, letterSpacing: 1.4, ...pixelFont(false) }}
      >
        {label}
      </Text>
      <View className="mt-s1 flex-row items-center" style={{ gap: 5 }}>
        <CoinIcon size={15} />
        <Text allowFontScaling={false} style={{ fontSize: 20, letterSpacing: 0, color: tint, ...pixelFont() }}>
          {value}
        </Text>
      </View>
      <Text className="text-2xs text-text-mute" numberOfLines={1}>
        {note}
      </Text>
    </View>
  );
}

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

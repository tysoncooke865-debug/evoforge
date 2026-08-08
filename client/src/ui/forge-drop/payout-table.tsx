import { Text, View } from 'react-native';

import {
  effectiveRtp,
  formatMultiplier,
  laneDistribution,
  payoutRange,
  type DropTier,
} from '@/domain/forge-drop';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * THE EXACT ODDS, BEFORE ANYTHING IS COMMITTED.
 *
 * Every slot, its multiplier, what it pays at THIS stake, and how likely it is
 * from THIS lane. No rounding to "roughly", no "up to" — the numbers here are
 * the ones the server settles by, derived from the same tier row.
 *
 * A PAYOUT IS WHOLE COINS, AND THE FRACTION IS SHOWN, NOT HIDDEN. Where a slot
 * works out to 10.5 coins the row says "10 or 11" and the chance of the extra
 * one, because that is what happens. It would be easier to print the average
 * and let it be discovered — and an average is a number this athlete can never
 * actually be paid.
 */
export function PayoutTable({
  tier,
  lane,
  stake,
  testID = 'drop-payouts',
}: {
  tier: DropTier;
  lane: number;
  stake: number;
  testID?: string;
}) {
  const colors = useThemeColors();
  const distribution = laneDistribution(tier.rows, lane);
  const rtp = effectiveRtp(tier.multipliers, distribution, stake);

  // Slots are symmetric, so the table folds: one row per DISTINCT multiplier,
  // with the chances of the mirrored pair added together. Thirteen rows of
  // near-duplicates is a wall of numbers; seven is a table somebody reads.
  const folded = new Map<number, { multiplier: number; chance: number }>();
  tier.multipliers.forEach((m, i) => {
    const at = folded.get(m) ?? { multiplier: m, chance: 0 };
    at.chance += distribution[i] ?? 0;
    folded.set(m, at);
  });
  const rows = [...folded.values()].sort((a, b) => b.multiplier - a.multiplier);

  return (
    <View testID={testID} style={{ width: '100%' }}>
      <View className="flex-row items-center justify-between">
        <Text
          allowFontScaling={false}
          className="text-text-mute"
          style={{ fontSize: 8, letterSpacing: 1.4 }}
        >
          IF YOU DROP {stake} FROM {laneName(lane, tier)}
        </Text>
        <Text
          allowFontScaling={false}
          testID="drop-rtp"
          className="text-2xs font-bold"
          style={{ color: colors['text-dim'] }}
        >
          RETURNS {Math.round(rtp * 100)}% ON AVERAGE
        </Text>
      </View>

      <View
        className="mt-s1 rounded-lg border"
        style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
      >
        {rows.map((row, i) => {
          const { low, high, pHigh } = payoutRange(stake, row.multiplier);
          // "up" only when the slot can BEAT the stake — a 10-or-11 on a stake
          // of 11 is not a win, and must not be dressed as one.
          const wins = low > stake;
          const amount = high === low ? `${low}` : `${low} or ${high}`;
          const unit = high === 1 ? 'coin' : 'coins';
          return (
            <View
              key={row.multiplier}
              testID={`drop-payout-row-${row.multiplier}`}
              className="flex-row items-center justify-between px-s3 py-[3px]"
              style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}
              accessibilityRole="text"
              accessibilityLabel={
                `${formatMultiplier(row.multiplier)}, pays ${amount} coins` +
                (pHigh > 0 ? `, ${Math.round(pHigh * 100)} percent chance of the higher` : '') +
                `, ${(row.chance * 100).toFixed(1)} percent chance of this slot`
              }
            >
              <Text
                allowFontScaling={false}
                style={{ fontSize: 11, width: 52, color: wins ? colors.legendary : colors['text-dim'], ...pixelFont() }}
              >
                {formatMultiplier(row.multiplier)}
              </Text>
              <Text
                allowFontScaling={false}
                className="text-2xs font-bold"
                style={{ flex: 1, color: wins ? colors.legendary : colors['text-mute'] }}
              >
                {/* Text, not colour alone: a win says so. */}
                {amount} {unit}
                {wins ? ' · up' : low === stake && high === stake ? ' · even' : ''}
              </Text>
              <Text allowFontScaling={false} className="text-2xs text-text-mute">
                {row.chance < 0.001 ? '<0.1%' : `${(row.chance * 100).toFixed(1)}%`}
              </Text>
            </View>
          );
        })}
      </View>

      <Text className="mt-s1 text-2xs text-text-mute">
        {rows.some((r) => payoutRange(stake, r.multiplier).pHigh > 0)
          ? 'Where a payout falls between two coins you get the higher one that share of the time, so the return above is exact at any stake. '
          : ''}
        Every board returns less than it takes. Forge Coins are earned by training and cannot be
        bought, sold or cashed out.
      </Text>
    </View>
  );
}

export function laneName(lane: number, tier: DropTier): string {
  const mid = Math.floor(tier.rows / 2);
  if (lane < mid) return 'LEFT';
  if (lane > mid) return 'RIGHT';
  return 'CENTRE';
}

import { Text, View } from 'react-native';

import { usePoolSettlement } from '@/data/callout-pool';
import { ownerTone } from '@/domain/forge-pool';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * WHO ENDED UP WHERE — one line per person (Spec v5 §5).
 *
 * "Sarah +37", "Marcus −50". Deliberately NOT ingots sweeping across the screen to a
 * winner: a pool has up to eight people in it, and a sweep tells seven of them
 * nothing about their own coins. §5 asks for ledger lines and this is them.
 *
 * EVERY LINE IS THE LEDGER'S OWN NUMBER. `net` is the sum of that person's
 * `coin_events` for this call out, which is the only figure that covers the two
 * principals as well as the joiners — the entries table has no row for the athlete.
 *
 * THE COLUMN SUMS TO ZERO, and the total is shown. Not as reassurance but because it
 * is checkable: nothing was minted and nobody took a cut, and an athlete can add the
 * lines up themselves. A settlement screen that hides its own arithmetic is asking
 * to be trusted instead of being verifiable.
 *
 * The owner tint is the SAME colour the ingot carried in the pan, so the person who
 * had pink metal on the BACK pan has a pink line here. Identity that changes between
 * the pledge and the payout is not identity.
 */
export function PoolSettlement({
  calloutId,
  myId,
  testID = 'pool-settlement',
}: {
  calloutId: string;
  myId: string | null;
  testID?: string;
}) {
  const colors = useThemeColors();
  const settlement = usePoolSettlement(calloutId);
  const lines = settlement.data ?? [];

  if (lines.length === 0) return null;

  const sum = lines.reduce((n, l) => n + l.net, 0);

  return (
    <View className="mt-s3" testID={testID}>
      <Text
        allowFontScaling={false}
        className="text-2xs"
        style={{ color: colors['text-dim'], letterSpacing: 1 }}
      >
        WHERE IT LANDED
      </Text>

      {lines.map((l) => {
        const mine = l.user_id === myId;
        const up = l.net > 0;
        const level = l.net === 0;
        return (
          <View
            key={l.user_id}
            className="mt-s1 flex-row items-center"
            style={{ gap: 8 }}
            testID={`${testID}-${l.user_id}`}
          >
            {/* The same tick the ingot wore in the pan. */}
            <View
              style={{
                width: 3,
                height: 14,
                borderRadius: 1,
                backgroundColor: ownerTone(l.user_id),
              }}
            />
            <Text
              allowFontScaling={false}
              className="text-2xs"
              numberOfLines={1}
              style={{ flex: 1, minWidth: 0, color: mine ? colors.text : colors['text-dim'] }}
            >
              {mine ? 'You' : l.display_name}
              <Text style={{ color: colors['text-mute'] }}>
                {'  '}
                {l.side === 'back' ? 'backed' : 'pushed'} {l.staked}
              </Text>
            </Text>
            <Text
              allowFontScaling={false}
              style={{
                // A refund is neither a win nor a loss and must not be painted as
                // one — a draw costs nobody anything.
                color: level ? colors['text-dim'] : up ? colors.success : colors.danger,
                ...pixelFont(),
                fontSize: 12,
              }}
            >
              {level ? '±0' : `${up ? '+' : '−'}${Math.abs(l.net)}`}
            </Text>
          </View>
        );
      })}

      <Text className="mt-s2 text-2xs text-text-mute" testID={`${testID}-total`}>
        {sum === 0
          ? 'Adds up to nothing — every coin came from somebody in this pool, and none of it was taken out.'
          : `These lines total ${sum}, which should be zero — please report this.`}
      </Text>
    </View>
  );
}

import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { chipPile, formatCoins } from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { useTweenNumber } from '@/ui/core/count-up';
import { playDefeat, playVictory } from '@/ui/core/sound';
import { ForgeChipStack } from '@/ui/duel/forge-chip';

/**
 * THE PAYOFF.
 *
 * A duel that settles into a grey card teaches athletes that winning does not
 * matter. This is the one screen in the feature allowed to be theatrical: the
 * word lands, the pot physically leaves the table for the wallet, and the
 * balance counts up to a number that is already true.
 *
 * THE LOSING SIDE GETS THE SAME CARE AND NONE OF THE MOCKERY. "DEFEAT" in the
 * same typeface, both numbers stated plainly, the coins that moved, and a
 * REMATCH button that is the biggest thing on the screen. No slumped avatar,
 * no "better luck", no red. The brief's rule — a clean result screen without
 * humiliating language — is also the retention argument: the athlete who feels
 * mocked does not stake again.
 *
 * A DRAW IS NOT A LOSS. Both stakes come back and the card says so in the
 * headline, because a refund read as a defeat is the fastest way to teach
 * people to avoid evenly matched opponents.
 */
export function DuelResult({
  outcome,
  myScoreLabel,
  theirScoreLabel,
  theirName,
  pot,
  coinDelta,
  balanceAfter,
  supportNote,
  testID,
}: {
  outcome: 'won' | 'lost' | 'drew';
  myScoreLabel: string;
  theirScoreLabel: string;
  theirName: string;
  /** What was on the table in total. */
  pot: number;
  /** What this duel moved for me: +pot/2 on a win, −stake on a loss, 0 drawn. */
  coinDelta: number;
  /** The wallet as it stands now — the count-up's destination. */
  balanceAfter: number | null;
  /** A supporter's own line, when they also backed this duel. */
  supportNote?: string | null;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const [banked, setBanked] = useState(reduced || outcome !== 'won');

  const tint = outcome === 'won' ? colors.success : outcome === 'drew' ? colors.legendary : colors['text-dim'];
  const headline = outcome === 'won' ? 'VICTORY' : outcome === 'drew' ? 'A DRAW' : 'DEFEAT';

  // The banner arrives; the pot leaves the table; the wallet catches it.
  const bannerIn = useSharedValue(reduced ? 1 : 0);
  const potFly = useSharedValue(0);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(
        outcome === 'won' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
      );
    }
    if (outcome === 'won') playVictory();
    else if (outcome === 'lost') playDefeat();

    if (reduced) return;
    bannerIn.value = 0;
    bannerIn.value = withSequence(
      withTiming(1.12, { duration: 260, easing: Easing.out(Easing.cubic) }),
      withSpring(1, { damping: 9, stiffness: 200 })
    );
    if (outcome === 'won') {
      potFly.value = withDelay(520, withTiming(1, { duration: 620, easing: Easing.in(Easing.cubic) }));
      const t = setTimeout(() => setBanked(true), 1040);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, reduced]);

  const bannerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: bannerIn.value }],
    opacity: Math.min(1, bannerIn.value),
  }));
  const potStyle = useAnimatedStyle(() => ({
    opacity: 1 - potFly.value,
    transform: [
      { translateY: -70 * potFly.value },
      { translateX: 40 * potFly.value },
      { scale: 1 - 0.5 * potFly.value },
    ],
  }));

  // The wallet only starts climbing once the chips have arrived — money that
  // lands before it is thrown reads as a number changing, not a payout.
  const target = balanceAfter ?? 0;
  const shownBalance = useTweenNumber(banked ? target : Math.max(0, target - Math.max(0, coinDelta)), 900);

  return (
    <View testID={testID}>
      <Animated.View style={[{ alignItems: 'center' }, bannerStyle]}>
        <Text
          allowFontScaling={false}
          testID="duel-result-headline"
          style={{
            fontSize: 42,
            lineHeight: 48,
            color: tint,
            letterSpacing: 2,
            textShadowColor: outcome === 'won' ? 'rgba(52,211,153,0.55)' : 'transparent',
            textShadowRadius: 24,
            ...pixelFont(),
          }}
        >
          {headline}
        </Text>
      </Animated.View>

      {/* BOTH NUMBERS, side by side. The result is never a claim — it is the
          two scores, and either athlete can check them against their own log. */}
      <View className="mt-s3 flex-row" style={{ gap: 8 }}>
        <Score label="YOU" value={myScoreLabel} tint={outcome === 'won' ? colors.success : colors.text} />
        <Score label={theirName.toUpperCase()} value={theirScoreLabel} tint={outcome === 'lost' ? colors.text : colors['text-dim']} />
      </View>

      {/* THE POT LEAVING THE TABLE. */}
      {outcome === 'won' && !reduced ? (
        <Animated.View style={[{ alignItems: 'center', marginTop: 12 }, potStyle]} pointerEvents="none">
          <ForgeChipStack chips={chipPile(pot, 10)} size={24} />
        </Animated.View>
      ) : null}

      <View
        className="mt-s3 rounded-xl border p-s3"
        style={{ borderColor: `${tint}45`, backgroundColor: 'rgba(13,21,36,0.55)' }}
      >
        <View className="flex-row items-center justify-between">
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1.4, ...pixelFont(false) }}
          >
            {outcome === 'drew' ? 'PLEDGE REFUNDED' : outcome === 'won' ? 'POOL TAKEN' : 'PLEDGE LOST'}
          </Text>
          <Text allowFontScaling={false} style={{ fontSize: 18, color: tint, letterSpacing: 0, ...pixelFont() }}>
            {coinDelta > 0 ? `+${formatCoins(coinDelta)}` : coinDelta < 0 ? `−${formatCoins(-coinDelta)}` : formatCoins(pot / 2)}
          </Text>
        </View>
        <View className="mt-s2 flex-row items-center justify-between border-t pt-s2" style={{ borderColor: colors.border }}>
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1.4, ...pixelFont(false) }}
          >
            YOUR BALANCE
          </Text>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <CoinIcon size={18} />
            <Text
              allowFontScaling={false}
              testID="duel-result-balance"
              style={{ fontSize: 22, color: colors.legendary, letterSpacing: 0, ...pixelFont() }}
            >
              {balanceAfter === null ? '—' : formatCoins(shownBalance)}
            </Text>
          </View>
        </View>
        {supportNote ? (
          <Text className="mt-s2 text-2xs text-text-dim" testID="duel-result-support">{supportNote}</Text>
        ) : null}
      </View>

      <Text className="mt-s2 text-2xs text-text-mute">
        {outcome === 'drew'
          ? 'Level all the way. Both pledges came back — a draw costs nobody anything, and it keeps a run alive.'
          : outcome === 'won'
            ? 'The escrow is yours. Every coin came from the two of you; nothing was minted.'
            : `${theirName} trained harder inside the window. Your pledge went to them — the training still counted for everything else.`}
      </Text>
    </View>
  );
}

function Score({ label, value, tint }: { label: string; value: string; tint: string }) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-lg border px-s3 py-s2"
      style={{ flex: 1, minWidth: 0, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
    >
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        numberOfLines={1}
        style={{ fontSize: 8, letterSpacing: 1.2, ...pixelFont(false) }}
      >
        {label}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={{ fontSize: 22, color: tint, letterSpacing: 0, ...pixelFont() }}>
        {value}
      </Text>
    </View>
  );
}

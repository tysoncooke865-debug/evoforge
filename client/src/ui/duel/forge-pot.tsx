import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { chipPile, formatCoins } from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { useTweenNumber } from '@/ui/core/count-up';
import { playCoin } from '@/ui/core/sound';
import { ForgeChipStack } from '@/ui/duel/forge-chip';

/**
 * THE POT — the single strongest number on a live duel.
 *
 * The old card led with "25 coins each", which is the arithmetic. This leads
 * with what is on the table, because that is the thing worth opening the app
 * for, and puts the per-athlete split underneath in a whisper.
 *
 * WHEN IT GROWS IT SAYS SO. A raise from 50 to 150 counts the number upward
 * while the pile gains chips and the whole card takes a short bounce — the
 * only moment this component is allowed to be loud, and it is exactly the
 * moment worth being loud about.
 */
export function ForgePot({
  pot,
  perAthlete,
  note,
  label = 'CURRENT POT',
  testID,
}: {
  pot: number;
  /** What each athlete has in, raises included. */
  perAthlete: number;
  note?: string;
  /** "FINAL POT" once it has settled — "CURRENT" on a finished duel reads as
   *  a number that could still move. */
  label?: string;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const shown = useTweenNumber(pot, 750);
  const pop = useSharedValue(0);
  const seen = useRef(pot);

  useEffect(() => {
    if (seen.current === pot) return;
    const grew = pot > seen.current;
    seen.current = pot;
    if (!grew || reduced) return;
    playCoin();
    pop.value = withSequence(
      withTiming(1, { duration: 130 }),
      withSpring(0, { damping: 8, stiffness: 190 })
    );
  }, [pot, reduced, pop]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pop.value * 0.06 }],
  }));

  const pile = chipPile(pot, 12);

  return (
    <Animated.View
      testID={testID}
      style={[
        {
          borderRadius: 18,
          borderWidth: 1,
          borderColor: `${colors.legendary}45`,
          backgroundColor: 'rgba(251,191,36,0.05)',
          paddingVertical: 14,
          paddingHorizontal: 16,
          alignItems: 'center',
        },
        style,
      ]}
    >
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 1.8, ...pixelFont(false) }}
      >
        {label}
      </Text>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <CoinIcon size={26} />
        <Text
          allowFontScaling={false}
          testID={testID ? `${testID}-value` : undefined}
          style={{ fontSize: 42, lineHeight: 48, color: colors.legendary, letterSpacing: 0, ...pixelFont() }}
        >
          {formatCoins(shown)}
        </Text>
      </View>
      {pile.length > 0 ? (
        <View className="mt-s1 items-center" pointerEvents="none">
          <ForgeChipStack chips={pile} size={22} />
        </View>
      ) : null}
      <Text className="mt-s2 text-2xs text-text-mute" numberOfLines={1}>
        {note ?? `${formatCoins(perAthlete)} from each of you`}
      </Text>
    </Animated.View>
  );
}

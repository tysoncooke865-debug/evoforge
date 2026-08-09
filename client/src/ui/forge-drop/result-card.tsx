import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { formatCoin, formatMultiplier, type DropTier } from '@/domain/forge-drop';
import { celebrationFor, outcomeTier, type OutcomeTier } from '@/domain/forge-drop-feel';
import type { SessionDrop } from '@/domain/forge-drop-session';
import { useSettingsStore } from '@/state/settings-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useTweenNumber } from '@/ui/core/count-up';

/**
 * THE RESULT — what happened, in the order somebody actually asks it.
 *
 *   1. What multiplier did I hit?
 *   2. How many coins came back?
 *   3. Off what stake, on what board?
 *   4. What is my balance now?
 *   5. Can I go again?
 *
 * That order is the layout, top to bottom, at decreasing type size. The old
 * card led with a row of equal-weight numbers and made the athlete work out
 * which one was the answer.
 *
 * THE CARD IS GRADED BY THE LEDGER, NOT BY MOOD. Border, tone and headline all
 * come from `outcomeTier`, which reads the stake and the payout the server
 * paid. A card cannot be more excited than the money — and because the tier
 * vocabulary has no near-miss in it, this cannot dress a loss as an almost.
 *
 * A LOSS IS LEGIBLE AND QUIET. Cool border, plain wording, same size type. It
 * is not hidden, not apologised for and not made to feel like a punishment.
 */
export function DropResultCard({
  drop,
  tier,
  balance,
  onAgain,
  canAgain,
  testID = 'drop-result',
}: {
  drop: SessionDrop;
  tier: DropTier;
  balance: number;
  onAgain: () => void;
  canAgain: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reducedPref = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const reduced = reducedPref || perfMode;

  const payout = drop.payout ?? 0;
  const net = drop.net ?? 0;
  const multiplier = drop.multiplier ?? 1;
  const grade = outcomeTier(drop.stake, payout, multiplier, tier);
  const celebration = celebrationFor(grade);

  const tone = colors[celebration.tone as keyof typeof colors] ?? colors.accent;
  const won = net > 0;

  // The two numbers that matter count up rather than snapping, so the eye is
  // led to them. `useTweenNumber` is the app's existing helper — no second
  // counting mechanism.
  const shownPayout = useTweenNumber(payout, reduced ? 0 : 520);
  const shownBalance = useTweenNumber(balance, reduced ? 0 : 700);

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = 0;
    enter.value = withTiming(1, { duration: reduced ? 90 : 300, easing: Easing.out(Easing.cubic) });
  }, [drop.key, enter, reduced]);

  const pop = useSharedValue(0);
  useEffect(() => {
    if (reduced || !won) return;
    pop.value = withSequence(
      withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) })
    );
  }, [drop.key, pop, reduced, won]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 10 }],
  }));
  const headlineStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pop.value * 0.12 }],
  }));

  return (
    <Animated.View
      testID={testID}
      style={[
        {
          borderRadius: 14,
          borderWidth: 1,
          // Gold for anything profitable, cyan for standard, cool for a loss.
          borderColor: won ? `${colors.legendary}99` : grade === 'even' ? `${colors.accent}66` : colors.border,
          backgroundColor: won ? 'rgba(251,191,36,0.06)' : 'rgba(13,21,36,0.6)',
          padding: 12,
        },
        cardStyle,
      ]}
    >
      {/* 1 — THE MULTIPLIER. The answer, at the size of an answer. */}
      <View className="flex-row items-end justify-between">
        <Animated.View style={headlineStyle}>
          <Text
            allowFontScaling={false}
            testID="drop-result-headline"
            style={{ fontSize: 30, lineHeight: 34, color: tone, ...pixelFont() }}
          >
            {formatMultiplier(multiplier)}
          </Text>
        </Animated.View>
        <Text
          allowFontScaling={false}
          testID="drop-result-callout"
          style={{ fontSize: 9, letterSpacing: 1.6, color: tone }}
        >
          {celebration.callout}
        </Text>
      </View>

      {/* 2 — THE COINS BACK. */}
      <View className="mt-s1 flex-row items-baseline" style={{ gap: 8 }}>
        <Text
          allowFontScaling={false}
          testID="drop-result-payout"
          style={{ fontSize: 20, color: won ? colors.legendary : colors['text-dim'], ...pixelFont() }}
        >
          {formatCoin(shownPayout)} BACK
        </Text>
        <Text
          allowFontScaling={false}
          testID="drop-result-net"
          style={{ fontSize: 13, color: won ? colors.legendary : net < 0 ? colors['text-mute'] : colors['text-dim'], ...pixelFont() }}
        >
          {net > 0 ? `+${formatCoin(net)}` : formatCoin(net)}
        </Text>
      </View>

      {/* 3 — WHAT IT CAME OFF. */}
      <Text className="mt-s1 text-2xs text-text-mute" testID="drop-result-context">
        Staked {drop.stake} · {tier.label}
      </Text>

      {/* 4 — FORGE XP. Every completed drop earns some, which is the whole
             point: a x0.7 still moved you forward, and saying so is not the
             same as pretending it made a profit. Secondary to the coins by
             size and position, deliberately. */}
      {drop.xp ? (
        <View className="mt-s1 flex-row items-center" style={{ gap: 6 }} testID="drop-result-xp">
          <Text allowFontScaling={false} style={{ fontSize: 12, color: colors.accent, ...pixelFont() }}>
            +{drop.xp} XP
          </Text>
          {drop.milestone ? (
            <Text
              allowFontScaling={false}
              testID="drop-result-milestone"
              style={{ fontSize: 9, letterSpacing: 1, color: colors.legendary }}
            >
              {drop.milestone} DROPS · +{drop.milestoneXp} BONUS
            </Text>
          ) : drop.dropsTotal ? (
            <Text allowFontScaling={false} className="text-2xs text-text-mute">
              {nextMilestoneCopy(drop.dropsTotal)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* 5 — THE BALANCE, counting to its new value. */}
      <Text className="text-2xs" style={{ color: colors['text-dim'] }} testID="drop-result-balance">
        Balance {formatCoin(shownBalance)}
      </Text>

      {/* 6 — GO AGAIN. Inside the card, under the thumb, no scrolling. */}
      <View className="mt-s2">
        <AgainButton onPress={onAgain} enabled={canAgain} tone={won ? colors.legendary : colors.accent} />
      </View>
    </Animated.View>
  );
}

function AgainButton({ onPress, enabled, tone }: { onPress: () => void; enabled: boolean; tone: string }) {
  const colors = useThemeColors();
  return (
    <View
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityLabel={enabled ? 'Drop again with the same chip and lane' : 'Cannot drop again yet'}
      testID="drop-again"
      onTouchEnd={enabled ? onPress : undefined}
      // @ts-expect-error react-native-web forwards onClick for pointer devices.
      onClick={enabled ? onPress : undefined}
      style={{
        minHeight: 46,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: enabled ? tone : colors.border,
        backgroundColor: enabled ? `${tone}1f` : 'transparent',
      }}
    >
      <Text
        allowFontScaling={false}
        style={{ fontSize: 13, color: enabled ? tone : colors['text-mute'], ...pixelFont() }}
      >
        DROP AGAIN
      </Text>
    </View>
  );
}

/**
 * THE CEILING MOMENT.
 *
 * Only `jackpot` reaches this — the board's own largest multiplier, which on
 * CYBER FOUNDRY is one slot in roughly a thousand drops. It dims everything
 * except the board for a beat, shows the multiplier at a size nothing else in
 * the app uses, and gets out of the way on its own.
 *
 * IT IS RESTRAINED ON PURPOSE. No confetti, no sustained fanfare, no
 * "JACKPOT!!!" — one number, one line, one breath. Rarity is what makes it
 * feel like an event; volume would only make it feel like a slot machine.
 *
 * `pointerEvents="none"` throughout: it can never intercept a tap, so the next
 * chip can be thrown straight through it.
 */
export function JackpotMoment({
  multiplier,
  payout,
  onDone,
}: {
  multiplier: number;
  payout: number;
  onDone: () => void;
}) {
  const colors = useThemeColors();
  const reducedPref = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const reduced = reducedPref || perfMode;
  const life = useSharedValue(0);

  useEffect(() => {
    const hold = celebrationFor('jackpot').holdMs;
    life.value = withSequence(
      withTiming(1, { duration: reduced ? 100 : 220, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: hold }),
      withTiming(0, { duration: reduced ? 100 : 320, easing: Easing.in(Easing.quad) })
    );
    const id = setTimeout(onDone, hold + (reduced ? 220 : 560));
    return () => clearTimeout(id);
  }, [life, onDone, reduced]);

  const veil = useAnimatedStyle(() => ({ opacity: life.value * 0.82 }));
  const type = useAnimatedStyle(() => ({
    opacity: life.value,
    transform: [{ scale: 0.92 + life.value * 0.08 }],
  }));

  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', inset: 0, backgroundColor: '#04070e' }, veil]}
      />
      <Animated.View pointerEvents="none" style={[{ alignItems: 'center' }, type]}>
        <Text allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 3, color: colors.legendary }}>
          MAX MULTIPLIER
        </Text>
        <Text
          allowFontScaling={false}
          testID="drop-jackpot"
          style={{ fontSize: 64, lineHeight: 70, color: colors.legendary, ...pixelFont() }}
        >
          {formatMultiplier(multiplier)}
        </Text>
        <Text allowFontScaling={false} style={{ fontSize: 16, color: colors.accent, ...pixelFont() }}>
          {payout} BACK
        </Text>
      </Animated.View>
    </View>
  );
}

/** How far to the next milestone. Progress, never pressure — it states a
 *  fact and stops, with no countdown, no urgency and nothing to lose. */
function nextMilestoneCopy(total: number): string {
  const next = [10, 25, 50, 100].find((m) => m > total);
  if (!next) return `${total} drops`;
  return `${next - total} to ${next}`;
}

export type { OutcomeTier };

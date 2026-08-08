/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated from gesture callbacks and effects by design; the compiler lint
   cannot see that .value writes are UI-thread animation state. */
import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { calloutOutcomeCoins, calloutResultLine, potChips, type CalloutRow } from '@/domain/callouts';
import { FORGE_CHIPS } from '@/domain/forge-duel';
import { useSettingsStore } from '@/state/settings-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { playPotLock, primeChipAudio } from '@/ui/duel/physics/chip-audio';
import { potLockHaptic } from '@/ui/duel/physics/chip-haptics';
import { ChipSurface } from '@/ui/duel/physics/chip-surface';
import { useChipTable } from '@/ui/duel/physics/use-chip-table';

/** ~900ms, then gone. Long enough to land, short enough that an athlete
 *  mid-workout is never waiting for an animation to give the screen back. */
const HOLD_MS = 900;

/**
 * THE PAYOUT, PHYSICALLY.
 *
 * No result screen, no CLAIM, no CONTINUE — the athlete is already in their
 * workout and the only correct exit is for this to disappear. Real bodies, a
 * real collision, gravity swept toward the winner's side, and then nothing.
 *
 * TWO SAFETY RULES, both learned the hard way in this codebase:
 *
 *  - `pointerEvents="none"` on EVERY layer. A full-screen element that
 *    intercepts touches, over an app that is already interactive, removed by a
 *    TIMER rather than by the user's own gesture, is the exact shape of the
 *    forge-intro bug that made sign-in untypeable on Safari and the installed
 *    PWA — and which no automation could reproduce. A decoration that was never
 *    required to be interactive must not be ABLE to stand between an athlete
 *    and their screen.
 *  - The resting value lives in the STATIC style. A Reanimated style applies on
 *    the worklet's first evaluation, not on the first paint, so anything whose
 *    opacity exists only in an animated style paints at 1 on a slow first frame.
 */
export function CalloutSettleOverlay({
  callout,
  onDone,
}: {
  callout: CalloutRow;
  onDone: () => void;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const calm = reduced || perfMode;

  const coins = calloutOutcomeCoins(callout);
  const won = coins > 0;
  const table = useChipTable({
    amount: 0,
    onAmountChange: () => undefined,
    denominations: FORGE_CHIPS,
    ownerId: 'settle',
    calm,
    maxBodies: 10,
    locked: true,
  });

  // Static resting state, animated to visible — never the other way round.
  const fade = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ opacity: fade.value }));

  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    primeChipAudio();
    for (const value of potChips(callout.pot, 8)) {
      table.commit({ value, source: 'quick', vy: 380 });
    }
    table.jolt(1);
    playPotLock();
    potLockHaptic();
    // THE POT MOVES TOWARD WHOEVER TOOK IT. Gravity, not a translate: the chips
    // slide off the winner's edge because they are objects being pulled, which
    // is the whole reason this is a physics scene and not a fade.
    const t = setTimeout(() => table.setGravity(won ? 2.2 : -2.2, 0.8), 260);

    fade.value = withSequence(
      withTiming(1, { duration: 160 }),
      withDelay(HOLD_MS, withTiming(0, { duration: 220 }))
    );
    const done = setTimeout(onDone, HOLD_MS + 420);
    return () => {
      clearTimeout(t);
      clearTimeout(done);
    };
    // Fires exactly once per settled call out; `table` is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const line = calloutResultLine(callout);

  return (
    <Animated.View
      pointerEvents="none"
      testID="callout-settle"
      style={[
        {
          // The resting value, in the STATIC style.
          opacity: 0,
          width: '100%',
          paddingHorizontal: 12,
        },
        style,
      ]}
    >
      <View
        pointerEvents="none"
        className="rounded-xl border p-s3"
        style={{
          borderColor: won ? `${colors.legendary}66` : colors.border,
          // Opaque, for the same reason as the incoming card: this is the one
          // moment the athlete gets, and it must not compete with the set rows
          // underneath it for legibility.
          backgroundColor: colors['bg-deep'],
        }}
      >
        <View className="flex-row items-center justify-between">
          <Text
            allowFontScaling={false}
            testID="callout-settle-headline"
            style={{ fontSize: 18, color: won ? colors.legendary : colors['text-dim'], ...pixelFont() }}
          >
            {callout.result === 'hit' ? 'CALL HIT' : 'CALL MISSED'}
          </Text>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <CoinIcon size={14} />
            <Text
              allowFontScaling={false}
              testID="callout-settle-coins"
              style={{ fontSize: 18, color: won ? colors.legendary : colors.danger, ...pixelFont() }}
            >
              {coins > 0 ? `+${coins}` : `${coins}`}
            </Text>
          </View>
        </View>
        {line ? (
          <Text className="mt-s1 text-2xs text-text-mute" numberOfLines={1}>
            {line}
          </Text>
        ) : null}
        <View className="mt-s2" pointerEvents="none">
          <ChipSurface table={table} height={74} locked testID="callout-settle-pot" />
        </View>
      </View>
    </Animated.View>
  );
}

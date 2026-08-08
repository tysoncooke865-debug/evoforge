/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated from gesture callbacks and effects by design; the compiler lint
   cannot see that .value writes are UI-thread animation state. */
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  FORGE_CHIPS,
  chipPile,
  formatCoins,
  type ForgeChipValue,
} from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { useTweenNumber } from '@/ui/core/count-up';
import { playCoin, playSelect } from '@/ui/core/sound';
import { ForgeChip, ForgeChipStack } from '@/ui/duel/forge-chip';

/**
 * THE WAGER TABLE — committing coins should feel like pushing chips forward,
 * not like filling in a form field.
 *
 * FOUR WAYS IN, ON PURPOSE. Tap a chip; hold it to pour; flick it up at the
 * pot; or use the quick buttons. They exist together because they are answers
 * to different intents — "add 25", "add a lot", "throw it in", "everything I
 * can" — and a wager screen that only supports one of them makes the other
 * three feel like fighting the UI.
 *
 * THE NUMBER IS ALWAYS THE TRUTH. Every animation here is decoration over a
 * value that is already correct: with motion disabled, or mid-flight, or on a
 * device that dropped every frame, the stake and the pot read exactly right.
 * That is the same rule the PWA boot lesson wrote — visibility never depends on
 * an animation firing — applied to money.
 *
 * NOTHING HERE DECIDES ANYTHING. The stake this table produces is a REQUEST.
 * The server clamps it against the live ledger and the configured limits, and
 * the caller passes `max` already computed from both, so the table cannot even
 * offer an amount that would be refused.
 */

const MAX_FLIGHTS = 6;
const HOLD_REPEAT_MS = 110;

interface Flight {
  key: number;
  value: ForgeChipValue;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export function ChipWagerTable({
  value,
  onChange,
  balance,
  min,
  max,
  potLabel = 'POT IF ACCEPTED',
  potOf = (v: number) => v * 2,
  allInLabel,
  onAllIn,
  disabled = false,
  testID,
}: {
  value: number;
  onChange: (next: number) => void;
  /** Coins the athlete actually has, straight from the ledger. */
  balance: number;
  min: number;
  /** The largest LEGAL stake — already clamped for wallet, config and
   *  opponent by the caller, so this table can never offer a refusal. */
  max: number;
  potLabel?: string;
  potOf?: (stake: number) => number;
  /** When present, an ALL IN affordance appears beside the quick buttons. */
  allInLabel?: string;
  onAllIn?: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const [flights, setFlights] = useState<Flight[]>([]);
  const flightKey = useRef(0);
  // Positions inside THIS container, filled by onLayout. A flight needs both
  // ends, and measuring on demand would race the animation it is starting.
  const chipXY = useRef<Partial<Record<ForgeChipValue, { x: number; y: number }>>>({});
  const potXY = useRef<{ x: number; y: number } | null>(null);
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  // The hold-to-pour interval fires outside React's render cycle and needs the
  // CURRENT stake, not the one captured when the hold began. Synced in an
  // effect, never written during render.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const shown = useTweenNumber(value, 420);
  const pot = potOf(value);
  const shownPot = useTweenNumber(pot, 520);
  const potPop = useSharedValue(0);
  const potStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + potPop.value * 0.09 }] }));

  const remaining = Math.max(0, balance - value);
  const canAdd = (amount: number) => !disabled && value + amount <= max;

  /**
   * The pot's landing bounce.
   *
   * withSEQUENCE, not a completion callback that assigns the same shared value.
   * The callback form recursed — `set value` → callback → `set value` — and
   * filled the console with "Maximum call stack size exceeded" on every chip
   * tap. It was invisible on screen (the animation still looked right), which
   * is exactly why only a browser found it.
   */
  const bump = useCallback(() => {
    potPop.value = withSequence(
      withTiming(1, { duration: 90 }),
      withSpring(0, { damping: 9, stiffness: 220 })
    );
  }, [potPop]);

  const land = useCallback((k: number) => {
    setFlights((f) => f.filter((x) => x.key !== k));
    bump();
    playCoin();
  }, [bump]);

  /** Commit `amount` and, when motion is on, throw a chip at the pot. */
  const add = useCallback(
    (chip: ForgeChipValue) => {
      if (!canAdd(chip)) {
        // A refusal must still answer. A dead tap reads as a broken button.
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      onChange(valueRef.current + chip);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const from = chipXY.current[chip];
      const to = potXY.current;
      if (reduced || !from || !to) {
        bump();
        playCoin();
        return;
      }
      flightKey.current += 1;
      const k = flightKey.current;
      setFlights((f) => [
        ...f.slice(-(MAX_FLIGHTS - 1)),
        { key: k, value: chip, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y },
      ]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChange, reduced, bump, max, disabled, value]
  );

  const startRepeat = useCallback((chip: ForgeChipValue) => {
    if (repeat.current) clearInterval(repeat.current);
    repeat.current = setInterval(() => add(chip), HOLD_REPEAT_MS);
  }, [add]);
  const stopRepeat = useCallback(() => {
    if (repeat.current) clearInterval(repeat.current);
    repeat.current = null;
  }, []);
  useEffect(() => stopRepeat, [stopRepeat]);

  const quick = (delta: number) => {
    const next = Math.min(max, Math.max(0, value + delta));
    if (next === value) return;
    onChange(next);
    playSelect();
    bump();
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  };

  const setTo = (n: number) => {
    const next = Math.min(max, Math.max(0, n));
    if (next === value) return;
    onChange(next);
    playSelect();
    bump();
  };

  // THE PILE COUNTS THE NUMBER ABOVE IT. It sits inside the POT box, so it
  // draws the pot — drawing the stake there put 125 worth of chips under a
  // "250" and made the two disagree on the same card.
  const pile = chipPile(pot, 12);

  return (
    <View testID={testID} style={{ position: 'relative' }}>
      {/* ── THE POT. The largest thing on the table, because it is the thing
          the whole screen is about. ── */}
      <View
        onLayout={(e: LayoutChangeEvent) => {
          const { x, y, width, height } = e.nativeEvent.layout;
          potXY.current = { x: x + width / 2, y: y + height / 2 };
        }}
        className="items-center rounded-xl border py-s3"
        style={{
          borderColor: `${colors.legendary}3d`,
          backgroundColor: 'rgba(251,191,36,0.05)',
        }}
      >
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1.6, ...pixelFont(false) }}
        >
          {potLabel}
        </Text>
        <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, potStyle]}>
          <CoinIcon size={24} />
          <Text
            allowFontScaling={false}
            testID="wager-pot"
            style={{ fontSize: 40, lineHeight: 46, color: colors.legendary, letterSpacing: 0, ...pixelFont() }}
          >
            {formatCoins(shownPot)}
          </Text>
        </Animated.View>
        {pile.length > 0 ? (
          <View className="mt-s2 items-center" pointerEvents="none">
            <ForgeChipStack chips={pile} size={24} testID="wager-pile" />
          </View>
        ) : (
          <Text className="mt-s1 text-2xs text-text-mute">Push chips in to build the pot.</Text>
        )}
      </View>

      {/* ── THE THREE NUMBERS, always legible, animation or not. ── */}
      <View className="mt-s3 flex-row" style={{ gap: 8 }}>
        <Figure label="YOUR STAKE" value={formatCoins(shown)} tint={colors.accent} testID="wager-stake" />
        <Figure label="AVAILABLE" value={formatCoins(remaining)} tint={colors.text} testID="wager-available" />
        <Figure
          label="MAX HERE"
          value={formatCoins(max)}
          tint={colors['text-dim']}
          testID="wager-max"
        />
      </View>

      {/* ── QUICK MOVES ── */}
      <View className="mt-s3 flex-row flex-wrap" style={{ gap: 6 }}>
        <Quick label="MIN" onPress={() => setTo(min)} disabled={disabled || max < min} testID="wager-min" />
        <Quick label="+25" onPress={() => quick(25)} disabled={!canAdd(25)} testID="wager-plus-25" />
        <Quick label="+100" onPress={() => quick(100)} disabled={!canAdd(100)} testID="wager-plus-100" />
        <Quick label="MAX" onPress={() => setTo(max)} disabled={disabled || value >= max} testID="wager-max-btn" />
        <Quick label="CLEAR" onPress={() => setTo(0)} disabled={disabled || value === 0} testID="wager-clear" />
        {onAllIn ? (
          <Quick label={allInLabel ?? 'ALL IN'} tone="danger" onPress={onAllIn} disabled={disabled} testID="wager-all-in" />
        ) : null}
      </View>

      {/* ── THE TRAY. Tap, hold to pour, or flick a chip at the pot. ── */}
      <Text className="mt-s3 text-2xs text-text-mute" testID="wager-hint">
        Tap a chip · hold to pour · flick it at the pot
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingVertical: 8, paddingRight: 8 }}
      >
        {FORGE_CHIPS.map((chip) => (
          <TrayChip
            key={chip}
            value={chip}
            affordable={canAdd(chip)}
            onCommit={() => add(chip)}
            onHoldStart={() => startRepeat(chip)}
            onHoldEnd={stopRepeat}
            onMeasure={(x, y) => {
              chipXY.current[chip] = { x, y };
            }}
          />
        ))}
      </ScrollView>

      {value > 0 ? (
        <Pressable
          onPress={() => setTo(0)}
          accessibilityRole="button"
          accessibilityLabel="Take back every chip"
          testID="wager-take-back"
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text className="text-2xs" style={{ color: colors['text-dim'] }}>
            Take the chips back ›
          </Text>
        </Pressable>
      ) : null}

      {/* The chips in the air. Pointer-events off: a flying chip must never
          intercept the tap that follows it. */}
      <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
        {flights.map((f) => (
          <FlightChip key={f.key} flight={f} onDone={() => land(f.key)} />
        ))}
      </View>
    </View>
  );
}

/**
 * ONE CHIP IN THE TRAY.
 *
 * Three gestures raced: a tap commits one, a long press pours, and a pan lets
 * the chip be dragged and flicked. The pan needs a real offset before it
 * activates (12px) so a tap is never swallowed by it, and it releases the
 * chip back to the tray unless the flick went far enough upward — the pot is
 * up there, so "up" is the direction that means commit.
 */
function TrayChip({
  value,
  affordable,
  onCommit,
  onHoldStart,
  onHoldEnd,
  onMeasure,
}: {
  value: ForgeChipValue;
  affordable: boolean;
  onCommit: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onMeasure: (x: number, y: number) => void;
}) {
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const press = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx.value },
      { translateY: dy.value },
      { scale: 1 - press.value * 0.08 },
    ],
  }));

  // onHoldEnd is IDEMPOTENT (it clears an interval that may not exist), which
  // is what lets every gesture end call it unconditionally. The alternative —
  // a `held` ref consulted from a gesture callback — is a ref read from a
  // function the compiler cannot prove runs outside render.
  const pan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .activeOffsetX([-14, 14])
    .onUpdate((e) => {
      dx.value = e.translationX;
      dy.value = e.translationY;
    })
    .onEnd((e) => {
      // FLICKED AT THE POT. Either thrown far enough up, or thrown fast enough
      // up — a quick flick barely moves before the finger leaves.
      const committed = e.translationY < -34 || e.velocityY < -700;
      if (committed) runOnJS(onCommit)();
      dx.value = withSpring(0, { damping: 15, stiffness: 240 });
      dy.value = withSpring(0, { damping: 15, stiffness: 240 });
    })
    .onFinalize(() => {
      runOnJS(onHoldEnd)();
    });

  const hold = Gesture.LongPress()
    .minDuration(300)
    .onStart(() => {
      runOnJS(onHoldStart)();
    })
    .onFinalize(() => {
      runOnJS(onHoldEnd)();
    });

  const tap = Gesture.Tap().onEnd((_e, success) => {
    if (success) runOnJS(onCommit)();
  });

  const composed = Gesture.Race(pan, hold, tap);

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        onLayout={(e: LayoutChangeEvent) => {
          const { x, y, width, height } = e.nativeEvent.layout;
          // The tray scrolls, so x is relative to the scroll content. It is
          // close enough for a throw and never wrong by more than the scroll
          // offset — a flight that starts slightly off still reads as a throw.
          onMeasure(x + width / 2, y + height / 2 + 210);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Add a ${value} coin chip to your stake`}
        accessibilityState={{ disabled: !affordable }}
        testID={`wager-chip-${value}`}
        onTouchStart={() => {
          press.value = withTiming(1, { duration: 80 });
          playSelect();
        }}
        onTouchEnd={() => {
          press.value = withTiming(0, { duration: 140 });
        }}
        onTouchCancel={() => {
          press.value = withTiming(0, { duration: 140 });
        }}
        style={[{ minWidth: 46, minHeight: 46 }, style]}
      >
        <ForgeChip value={value} size={46} dimmed={!affordable} />
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * A CHIP IN THE AIR. Straight line plus a parabolic lift, a rotation, and a
 * pop as it lands — the cheapest description of a thrown object that still
 * reads as one. No physics engine: one interpolated value, composited.
 */
function FlightChip({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => {
    const p = t.value;
    const x = flight.fromX + (flight.toX - flight.fromX) * p;
    const y = flight.fromY + (flight.toY - flight.fromY) * p - Math.sin(Math.PI * p) * 54;
    return {
      transform: [
        { translateX: x - 14 },
        { translateY: y - 14 },
        { rotate: `${p * 260}deg` },
        { scale: 1 + Math.sin(Math.PI * p) * 0.2 },
      ],
      opacity: p > 0.94 ? 0 : 1,
    };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, style]}>
      <ForgeChip value={flight.value} size={28} />
    </Animated.View>
  );
}

function Figure({ label, value, tint, testID }: { label: string; value: string; tint: string; testID: string }) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-lg border px-s3 py-s2"
      style={{ flex: 1, minWidth: 0, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
      testID={testID}
    >
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        numberOfLines={1}
        style={{ fontSize: 8, letterSpacing: 1.2, ...pixelFont(false) }}
      >
        {label}
      </Text>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{ fontSize: 20, color: tint, letterSpacing: 0, ...pixelFont() }}
      >
        {value}
      </Text>
    </View>
  );
}

function Quick({
  label,
  onPress,
  disabled,
  tone = 'accent',
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'accent' | 'danger';
  testID: string;
}) {
  const colors = useThemeColors();
  const c = tone === 'danger' ? colors.danger : colors.accent;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      testID={testID}
      className="rounded-lg border px-s3"
      style={{
        minHeight: 44,
        justifyContent: 'center',
        opacity: disabled ? 0.35 : 1,
        borderColor: `${c}66`,
        backgroundColor: tone === 'danger' ? 'rgba(251,113,133,0.08)' : 'rgba(34,211,238,0.07)',
      }}
    >
      <Text allowFontScaling={false} style={{ fontSize: 12, color: c, letterSpacing: 0.6, ...pixelFont() }}>
        {label}
      </Text>
    </Pressable>
  );
}

/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated from gesture callbacks and effects by design; the compiler lint
   cannot see that .value writes are UI-thread animation state. */
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { FORGE_CHIPS, formatCoins, type ForgeChipValue } from '@/domain/forge-duel';
import { useSettingsStore } from '@/state/settings-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { useTweenNumber } from '@/ui/core/count-up';
import { playSelect } from '@/ui/core/sound';
import { ForgeChip } from '@/ui/duel/forge-chip';
import { ChipSurface } from '@/ui/duel/physics/chip-surface';
import { playAllInSlam, playPotLock, primeChipAudio } from '@/ui/duel/physics/chip-audio';
import { potLockHaptic } from '@/ui/duel/physics/chip-haptics';
import { MAX_STACK } from '@/ui/duel/physics/chip-world';
import { useChipTable } from '@/ui/duel/physics/use-chip-table';

/**
 * THE WAGER TABLE — a real chip table, not a number field with decoration.
 *
 * FOUR WAYS IN, ON PURPOSE. Tap a chip; hold it to pour; flick it at the pot;
 * or use the quick buttons. They are answers to different intents — "add 25",
 * "add a lot", "throw it in", "everything I can" — and a wager screen that
 * only supports one of them makes the other three feel like fighting the UI.
 *
 * THE NUMBER IS ALWAYS THE TRUTH. Every chip in the pot is a rigid body with
 * its own position, spin and collisions, and NONE of that decides anything.
 * The stake is React state; a chip is committed the instant it leaves the
 * tray, while it is still in the air. If the simulation glitches, escapes,
 * goes NaN or is destroyed by a rotation, the money is unchanged — the table
 * is a picture of the number, never its source.
 *
 * NOTHING HERE CAN OFFER A REFUSAL. `max` arrives already clamped against the
 * wallet, the configured ceiling and the opponent, so every affordance on this
 * table produces a stake the server will accept.
 */

/**
 * STACK CADENCE. The first chip lands immediately (a hold that does nothing
 * for 200ms reads as a dropped input); the rest arrive every 190ms, which is
 * slow enough to watch a column grow and fast enough that eight is under two
 * seconds.
 */
const HOLD_REPEAT_MS = 190;
/** The table's share of the card. The brief's 65–70%, and it is the reason
 *  the pot number moved up and shrank a little: the toy needs room. */
const TABLE_HEIGHT = 236;

export function ChipWagerTable({
  value,
  onChange,
  balance,
  min,
  max,
  potLabel = 'POOL IF ACCEPTED',
  potOf = (v: number) => v * 2,
  allInLabel,
  onAllIn,
  disabled = false,
  locked = false,
  ownerId = 'me',
  tableHeight = TABLE_HEIGHT,
  chipSize = 46,
  denominations = FORGE_CHIPS,
  compact = false,
  testID,
}: {
  value: number;
  onChange: (next: number) => void;
  /** Coins the athlete actually has, straight from the ledger. */
  balance: number;
  min: number;
  /** The largest LEGAL stake — already clamped for wallet, config and
   *  opponent by the caller. */
  max: number;
  potLabel?: string;
  potOf?: (stake: number) => number;
  /** When present, an ALL IN affordance appears beside the quick buttons. */
  allInLabel?: string;
  onAllIn?: () => void;
  disabled?: boolean;
  /** The pot has been accepted: the table clatters once and stops being a toy. */
  locked?: boolean;
  ownerId?: string;
  /**
   * ── THE SAME TABLE, SMALLER (2026-08-08, Live Workout Call Outs) ──
   *
   * A call out's tray rises over a workout the athlete is in the middle of, so
   * it gets roughly a third of the screen rather than a duel sheet's two
   * thirds. Everything below is a SIZE, not a second component: same
   * `useChipTable`, same `ChipSurface`, same bodies, same collision audio, same
   * tilt. A parallel "small chip table" would be a second physics identity to
   * keep in sync, and the first bug would be the two of them disagreeing.
   */
  tableHeight?: number;
  chipSize?: number;
  /** The rail. A gym decision is 25 / 50 / 100 / 250; seven buttons is a menu.
   *  The TABLE still represents any amount — this only bounds what a thumb can
   *  throw without aiming. */
  denominations?: readonly ForgeChipValue[];
  /** Drop the three-figure row, the quick ladder and the instructional copy.
   *  In a tray the athlete is mid-workout and already knows what a chip does. */
  compact?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const [trayWidth, setTrayWidth] = useState(0);
  const { width: screenWidth } = useWindowDimensions();

  /**
   * CALM, NOT ABSENT.
   *
   * The first version switched the whole table off under reduced motion and
   * Tyson — who has the setting on — got the old static pile back: "section 4
   * looks the same, just with sound now". Deleting the feature is not an
   * accommodation. Calm mode keeps every chip real and drops the parts that
   * could genuinely unsettle somebody: spin, bounce and screen shake.
   *
   * perfMode joins it because that flag is about CPU, and a smaller table is
   * the honest answer there — not a missing one.
   */
  const perfMode = useSettingsStore((s) => s.perfMode);
  const calm = reduced || perfMode;
  const table = useChipTable({
    amount: value,
    onAmountChange: onChange,
    denominations,
    ownerId,
    calm,
    // A shorter table has less room, so fewer bodies is the honest budget as
    // well as the cheap one. perfMode still trims further.
    maxBodies: perfMode ? 26 : compact ? 34 : undefined,
    locked,
  });

  const shown = useTweenNumber(value, 420);
  const pot = potOf(value);
  const shownPot = useTweenNumber(pot, 520);
  const potPop = useSharedValue(0);
  const potStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + potPop.value * 0.11 }] }));
  const potGlow = useAnimatedStyle(() => ({ opacity: 0.25 + potPop.value * 0.75 }));

  const remaining = Math.max(0, balance - value);
  const canAdd = (amount: number) => !disabled && !locked && value + amount <= max;

  /**
   * The pot's reaction. Fires on COMMIT, not on landing: the number is already
   * correct the instant the chip leaves the tray, and making the athlete wait
   * for a body to settle before their balance updates would be the physics
   * deciding the money.
   */
  const pop = useCallback(() => {
    if (reduced) return;
    potPop.value = withSequence(
      withTiming(1, { duration: 90 }),
      withSpring(0, { damping: 9, stiffness: 200 })
    );
  }, [potPop, reduced]);

  const add = useCallback(
    (
      chip: ForgeChipValue,
      gesture?: { x?: number; vx?: number; vy?: number; spin?: number; stackId?: string },
      source: 'tap' | 'flick' | 'pour' | 'stack' = 'tap'
    ) => {
      if (!canAdd(chip)) {
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      primeChipAudio();
      table.commit({ value: chip, source, ...gesture });
      pop();
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, pop, max, value, disabled, locked]
  );

  /**
   * HOLD BUILDS A STACK, not a scatter.
   *
   * A pour of loose chips was the first version and it was the wrong reading
   * of "hold to pour": what an athlete does with a handful of chips is build a
   * column. Each tick bonds one more chip to the top of the same stack, and the
   * counter beside the tray says what it is worth as it grows.
   */
  const stackRef = useRef<{ id: string; value: ForgeChipValue } | null>(null);
  const [building, setBuilding] = useState<{ value: ForgeChipValue; count: number } | null>(null);

  const startRepeat = useCallback(
    (chip: ForgeChipValue) => {
      if (repeat.current) clearInterval(repeat.current);
      const id = table.beginStack();
      stackRef.current = { id, value: chip };
      // The chip already dropped by the TAP that preceded the hold is loose;
      // the stack starts from the next one, so the column is coherent.
      let count = 0;
      const tick = () => {
        const live = stackRef.current;
        if (!live) return;
        if (count >= MAX_STACK || !canAdd(live.value)) {
          if (repeat.current) clearInterval(repeat.current);
          repeat.current = null;
          return;
        }
        add(live.value, { stackId: live.id }, 'stack');
        count += 1;
        setBuilding({ value: live.value, count });
      };
      tick();
      repeat.current = setInterval(tick, HOLD_REPEAT_MS);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [add, table, max, value]
  );

  const stopRepeat = useCallback(() => {
    if (repeat.current) clearInterval(repeat.current);
    repeat.current = null;
    stackRef.current = null;
    setBuilding(null);
  }, []);
  useEffect(() => stopRepeat, [stopRepeat]);

  /** MIN / MAX / CLEAR and the +N buttons set the stake outright; the table
   *  rebuilds itself to represent the new number exactly. */
  const setTo = useCallback(
    (n: number) => {
      const next = Math.min(max, Math.max(0, n));
      if (next === value || disabled || locked) return;
      onChange(next);
      table.reconcile(next);
      playSelect();
      pop();
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
    },
    [max, value, disabled, locked, onChange, table, pop]
  );

  /** +25 / +100 spawn a REAL chip of that denomination rather than rebuilding
   *  the pile, so a quick button feels like putting a chip down. */
  const quickAdd = useCallback(
    (delta: ForgeChipValue) => {
      if (!canAdd(delta)) return;
      add(delta, { vy: 300 }, 'tap');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [add, max, value]
  );

  // THE LOCK MOMENT. The pile takes a real knock, the number pulses, and the
  // table stops accepting input — the accept is felt, not announced.
  const wasLocked = useRef(locked);
  useEffect(() => {
    if (locked === wasLocked.current) return;
    wasLocked.current = locked;
    if (!locked) return;
    table.jolt(1.2);
    pop();
    playPotLock();
    potLockHaptic();
  }, [locked, table, pop]);

  return (
    <View testID={testID}>
      {/* ── THE POT. Moved up and stepped down a size so the table below it
          gets the room the interaction needs, and still the loudest number
          on the card.
          COMPACT DROPS IT ENTIRELY: in the call out tray the number already
          lives on the SEND button ("PLEDGE 50 ON THIS SET"), and a tray that
          prints the same figure twice pushes the chip rail below the fold —
          which breaks the two-tap path this whole feature is built around. ── */}
      <View className="items-center" style={compact ? { display: 'none' } : undefined}>
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1.6, ...pixelFont(false) }}
        >
          {locked ? 'POT LOCKED' : potLabel}
        </Text>
        <View style={{ position: 'relative' }}>
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                left: -14,
                right: -14,
                top: 2,
                bottom: 2,
                borderRadius: 20,
                backgroundColor: `${colors.legendary}1a`,
              },
              potGlow,
            ]}
          />
          <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, potStyle]}>
            <CoinIcon size={20} />
            <Text
              allowFontScaling={false}
              testID="wager-pot"
              style={{ fontSize: 32, lineHeight: 38, color: colors.legendary, letterSpacing: 0, ...pixelFont() }}
            >
              {formatCoins(shownPot)}
            </Text>
          </Animated.View>
        </View>
      </View>

      {/* ── THE TABLE ── */}
      <View className="mt-s2">
        <ChipSurface
          table={table}
          height={tableHeight}
          locked={locked}
          testID="wager-table"
        />
      </View>

      {/* ── THE THREE NUMBERS, always legible, simulation or not. ── */}
      {compact ? null : (
        <View className="mt-s3 flex-row" style={{ gap: 8 }}>
          <Figure label="YOUR PLEDGE" value={formatCoins(shown)} tint={colors.accent} testID="wager-stake" />
          <Figure label="AVAILABLE" value={formatCoins(remaining)} tint={colors.text} testID="wager-available" />
          <Figure label="MAX HERE" value={formatCoins(max)} tint={colors['text-dim']} testID="wager-max" />
        </View>
      )}

      {/* ── QUICK MOVES. The ladder is absent in compact — the rail IS the
          input there, and a chip dragged out through the bottom of the table
          still goes back to the wallet, which is the only escape hatch a tray
          needs. ENABLE TILT is NOT absent: see below. ── */}
      <View className="mt-s3 flex-row flex-wrap" style={{ gap: 6 }}>
        {compact ? null : (
          <>
            <Quick label="MIN" onPress={() => setTo(min)} disabled={disabled || locked || max < min} testID="wager-min" />
            <Quick label="+25" onPress={() => quickAdd(25)} disabled={!canAdd(25)} testID="wager-plus-25" />
            <Quick label="+100" onPress={() => quickAdd(100)} disabled={!canAdd(100)} testID="wager-plus-100" />
            <Quick label="MAX" onPress={() => setTo(max)} disabled={disabled || locked || value >= max} testID="wager-max-btn" />
            <Quick label="CLEAR" onPress={() => setTo(0)} disabled={disabled || locked || value === 0} testID="wager-clear" />
          </>
        )}
        {table.motion === 'prompt' && !locked ? (
          /**
           * iOS gates device motion behind a real gesture, so the ask lives on
           * a chip the athlete taps — never a popup on load, and only when the
           * platform actually wants permission.
           *
           * IT SURVIVES COMPACT MODE, and that is the point. The first build
           * hid this whole row in the call out tray, which meant that on an
           * installed iPhone PWA — the platform EvoForge actually ships as —
           * there was no way to grant motion, so tilt could never run in the
           * one place it was newly wanted. A permission you cannot ask for is a
           * feature you do not have.
           */
          <Quick label="ENABLE TILT" onPress={table.requestMotion} testID="wager-enable-motion" />
        ) : null}
        {onAllIn ? (
          <Quick
            label={allInLabel ?? 'MAX PLEDGE'}
            tone="danger"
            onPress={() => {
              playAllInSlam();
              onAllIn();
            }}
            disabled={disabled || locked}
            testID="wager-all-in"
          />
        ) : null}
      </View>

      {/* ── THE TRAY ── */}
      <Text
        className={`${compact ? 'mt-s2' : 'mt-s3'} text-2xs text-text-mute`}
        testID="wager-hint"
        numberOfLines={compact ? 1 : undefined}
      >
        {locked
          ? 'The pot is locked. Nothing else goes in.'
          : compact
            ? 'Tap a chip · or flick it at the table'
            : 'Tap a chip · hold to build a stack · flick it at the table · drag a chip out to take it back'}
      </Text>
      {/* WHAT THE SENSOR IS ACTUALLY DOING, in one line. Not decoration: tilt
          has four ways to be unavailable (no sensor, permission not asked,
          permission refused, switched off) and they are indistinguishable from
          "broken" unless the screen says which. It cost a round trip to find
          that out the first time. */}
      {/* In compact, stay silent when tilt is simply working: a tray is not the
          place for a status line nobody needs. Speak up when it is off, blocked
          or missing, because those four states are indistinguishable from
          "broken" unless the screen says which. */}
      {!locked && (!compact || table.motion !== 'on') ? (
        <Text className="text-2xs text-text-mute" testID="wager-motion-state">
          {table.motion === 'on'
            ? calm
              ? 'TILT ON · gentle, because your device asks for reduced motion'
              : 'TILT ON · lean the phone and the chips slide'
            : table.motion === 'prompt'
              ? 'TILT NEEDS PERMISSION · tap ENABLE TILT'
              : table.motion === 'denied'
                ? 'TILT BLOCKED · allow Motion & Orientation for this site'
                : table.motion === 'unsupported'
                  ? 'NO MOTION SENSOR on this device'
                  : 'TILT OFF · turn on Motion physics in Profile'}
        </Text>
      ) : null}
      {building ? (
        // A lightweight counter, not a modal — it must never interrupt the
        // hold that is producing it.
        <View
          pointerEvents="none"
          className="mt-s1 flex-row items-center self-start rounded-pill border px-s3 py-s1"
          style={{ gap: 8, borderColor: `${colors.legendary}59`, backgroundColor: 'rgba(251,191,36,0.1)' }}
          testID="wager-stack-counter"
        >
          <Text allowFontScaling={false} style={{ fontSize: 12, color: colors['text-dim'], ...pixelFont() }}>
            {building.value} × {building.count}
          </Text>
          <Text allowFontScaling={false} style={{ fontSize: 15, color: colors.legendary, ...pixelFont() }}>
            {formatCoins(building.value * building.count)}
          </Text>
        </View>
      ) : null}
      <View onLayout={(e: LayoutChangeEvent) => setTrayWidth(e.nativeEvent.layout.width)}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingVertical: 8, paddingRight: 8 }}
        >
          {denominations.map((chip) => (
            <TrayChip
              key={chip}
              value={chip}
              size={chipSize}
              affordable={canAdd(chip)}
              screenWidth={screenWidth}
              tableWidth={table.size.width || trayWidth}
              onCommit={(g) => add(chip, g, g ? 'flick' : 'tap')}
              onHoldStart={() => startRepeat(chip)}
              onHoldEnd={stopRepeat}
            />
          ))}
        </ScrollView>
      </View>

      {value > 0 && !locked ? (
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
    </View>
  );
}

/**
 * ONE CHIP IN THE TRAY.
 *
 * Three gestures raced: a tap drops one in, a long press pours, and a pan
 * lets the chip be dragged and FLUNG. The pan reports the finger's real
 * velocity at release, and that velocity is what the body is given — which is
 * the whole difference between a gentle nudge that slides and a hard flick
 * that scatters a pile. It is clamped in the world, not here, so the clamp
 * lives next to the integrator it protects.
 */
function TrayChip({
  value,
  affordable,
  screenWidth,
  tableWidth,
  onCommit,
  onHoldStart,
  onHoldEnd,
  size = 46,
}: {
  value: ForgeChipValue;
  affordable: boolean;
  /** The chip's own diameter. The BOX never goes below 46 whatever this says —
   *  hitSlop does nothing on react-native-web, so the pressable itself is the
   *  only thing that can clear the 44pt touch floor. */
  size?: number;
  /** The gesture reports a PAGE x; the table wants a TABLE-LOCAL one. */
  screenWidth: number;
  tableWidth: number;
  /** Undefined for a plain tap; a real gesture for a flick. */
  onCommit: (gesture?: { x?: number; vx?: number; vy?: number; spin?: number }) => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}) {
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const press = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx.value },
      { translateY: dy.value },
      { scale: 1 - press.value * 0.08 },
      { rotate: `${dx.value * 0.004}rad` },
    ],
  }));

  const fling = useCallback(
    (absX: number, vx: number, vy: number) => {
      onCommit({
        // WHERE THE FINGER LET GO, mapped into the TABLE's own coordinates.
        // The gesture reports a page x; the table's left edge is inset by the
        // card's padding, so using the page value directly threw every chip
        // ~30px to the right of where it was aimed — enough that a flick from
        // the right of the tray missed a pile in the middle entirely. The
        // fraction of screen width is a good approximation here because the
        // tray and the table share the same horizontal insets, and it needs no
        // measurement pass.
        x:
          screenWidth > 0 && tableWidth > 0
            ? Math.max(0, Math.min(tableWidth, (absX / screenWidth) * tableWidth))
            : undefined,
        vx,
        // Upward on screen is negative; the chip is entering a table ABOVE the
        // tray, so an upward flick becomes downward travel into the table's own
        // space. THE MAGNITUDE IS THE ATHLETE'S. The floor is low and the
        // scaling generous on purpose: a lazy release should drop in and stop,
        // a real flick should cross the table and scatter what it hits, and
        // the gap between them has to be obvious. The upper clamp lives in the
        // world, next to the integrator it protects.
        vy: Math.max(90, Math.abs(vy) * 0.7),
        // A flung disc spins the way it was thrown.
        spin: vx * 0.0018,
      });
    },
    [onCommit, screenWidth, tableWidth]
  );

  const pan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .activeOffsetX([-14, 14])
    .onUpdate((e) => {
      dx.value = e.translationX;
      dy.value = e.translationY;
    })
    .onEnd((e) => {
      // FLICKED AT THE TABLE: thrown far enough up, or fast enough up. A quick
      // flick barely moves before the finger leaves, which is why velocity
      // matters as much as distance.
      const committed = e.translationY < -30 || e.velocityY < -650;
      if (committed) runOnJS(fling)(e.absoluteX, e.velocityX, e.velocityY);
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
    if (success) runOnJS(onCommit)(undefined);
  });

  const composed = Gesture.Race(pan, hold, tap);

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel={`Add a ${value} coin ingot to your pledge`}
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
        style={[
          { minWidth: Math.max(46, size), minHeight: Math.max(46, size), alignItems: 'center', justifyContent: 'center' },
          style,
        ]}
      >
        <ForgeChip value={value} size={size} dimmed={!affordable} />
      </Animated.View>
    </GestureDetector>
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

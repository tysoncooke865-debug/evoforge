/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated from gesture callbacks by design; the compiler lint cannot see that
   .value writes are UI-thread animation state. */
import { useCallback, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  DROP_CHIPS,
  DROP_CHIP_TONE,
  flickLane,
  previewLane,
  type ChipOffer,
  type DropChipValue,
  type LaneChoice,
} from '@/domain/forge-drop-session';
import { useSettingsStore } from '@/state/settings-store';
import { useThemeColors } from '@/theme/use-theme';
import { playChipReady } from './drop-audio';
import { ForgeChip } from '@/ui/duel/forge-chip';
import { chipImpactHaptic } from '@/ui/duel/physics/chip-haptics';

/**
 * THE CHIP RACK — pick a chip up, throw it at the board.
 *
 * Replaces the stake buttons everywhere coins are wagered: Forge Drop, the
 * rest timer panel, and the call-out tray. One rack, so a chip means the same
 * thing and behaves the same way wherever an athlete meets one.
 *
 * TWO WAYS IN, BOTH FIRST-CLASS.
 *
 *   Throw it — press a chip, drag up, flick left / centre / right. The
 *   horizontal component picks the lane, so aiming and committing are the same
 *   motion. Dragging slowly PREVIEWS the lane and stakes nothing; only a real
 *   throw launches.
 *
 *   Or tap it — a tap selects, and the board's own lane buttons and DROP
 *   button do the rest. This is not a fallback bolted on for compliance: a
 *   gesture cannot be reached by a keyboard, cannot be described to a screen
 *   reader, and cannot be performed one-handed on a bus. Every chip is a real
 *   `Pressable` with a real accessibility label, and the tap path can do
 *   everything the throw path can.
 *
 * NOTHING HERE DECIDES WHAT ANYTHING COSTS. The rack renders offers it is
 * handed and reports what the athlete did. Affordability, the board's ceiling
 * and the capacity limit are computed in `domain/forge-drop-session.ts` and
 * enforced again by the server. A chip that should not be playable arrives
 * already disabled, with the reason attached.
 */

const CHIP_SIZE = 40;

export function ChipRack({
  offers,
  selected,
  onSelect,
  onThrow,
  onPreview,
  blocker,
  laneLabel,
  compact = false,
  testID = 'chip-rack',
}: {
  offers: ChipOffer[];
  selected: number | null;
  onSelect: (value: number) => void;
  /** A real throw. The lane comes from the gesture; the caller decides what a
   *  drop costs and whether it happens. */
  onThrow: (value: number, lane: LaneChoice) => void;
  /** The lane a slow drag is currently over, or null when nothing is held.
   *  Purely so the board can light up — it never commits anything. */
  onPreview?: (lane: LaneChoice | null) => void;
  /** The single honest reason nothing can be played, when nothing can. */
  blocker?: string | null;
  /** Names the lane a tap-then-drop would use, so the tap path is as explicit
   *  as the throw path about where the chip is going. */
  laneLabel?: string;
  compact?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const size = compact ? 34 : CHIP_SIZE;

  return (
    <View testID={testID} style={{ width: '100%' }}>
      <View className="flex-row items-center justify-between">
        <Text
          allowFontScaling={false}
          className="text-text-mute"
          style={{ fontSize: 8, letterSpacing: 1.4 }}
        >
          {blocker ? 'CHIPS' : 'PICK A CHIP · FLICK IT'}
        </Text>
        {laneLabel ? (
          <Text allowFontScaling={false} className="text-2xs font-bold" style={{ color: colors.accent }}>
            {laneLabel}
          </Text>
        ) : null}
      </View>

      {/* Wraps rather than scrolls: a horizontally scrolling rack hides
          denominations on a narrow phone, and a chip nobody can see is a chip
          nobody knows they can play. */}
      {/* ONE ROW. Six chips wrapped onto two rows pushed the drop button
          under the fold on a 390px phone, and a rack you have to scroll to
          finish reading is a rack that slows the loop down. */}
      <View className="mt-s1 flex-row items-center justify-between" style={{ gap: 2 }}>
        {offers.map((offer) => (
          <RackChip
            key={offer.value}
            offer={offer}
            size={size}
            selected={selected === offer.value}
            onSelect={onSelect}
            onThrow={onThrow}
            onPreview={onPreview}
          />
        ))}
      </View>

      {blocker ? (
        <Text
          testID="chip-rack-blocker"
          accessibilityRole="alert"
          className="mt-s1 text-2xs"
          style={{ color: colors['text-dim'] }}
        >
          {blocker}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * ONE CHIP. A button that can also be thrown.
 *
 * The gesture and the press coexist deliberately: `Gesture.Pan` only claims the
 * touch once it has travelled, so a clean tap still reaches the `Pressable`
 * underneath and selects. That is what lets the same pixel serve a thumb that
 * throws and a thumb that taps, without a mode switch.
 */
function RackChip({
  offer,
  size,
  selected,
  onSelect,
  onThrow,
  onPreview,
}: {
  offer: ChipOffer;
  size: number;
  selected: boolean;
  onSelect: (value: number) => void;
  onThrow: (value: number, lane: LaneChoice) => void;
  onPreview?: (lane: LaneChoice | null) => void;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const calm = reduced || perfMode;

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lifted = useSharedValue(0);
  // Held while a chip is off the rack, so the label under it can say so.
  const [dragging, setDragging] = useState(false);

  const enabled = offer.enabled;
  const tone = DROP_CHIP_TONE[offer.value as DropChipValue] ?? 'accent';

  // No de-duplication ref here on purpose. React already bails out of a
  // re-render when the state it is handed is identical, so a ref to remember
  // the last lane bought nothing — and a ref READ during render is the one
  // thing the compiler cannot allow in a gesture chain built during render.
  const preview = useCallback(
    (lane: LaneChoice | null) => onPreview?.(lane),
    [onPreview]
  );

  const launch = useCallback(
    (lane: LaneChoice) => {
      preview(null);
      setDragging(false);
      onThrow(offer.value, lane);
      // A throw is a firm, deliberate action — the duel's own scale, at the
      // weight a launch deserves rather than the tap of a chip settling.
      if (!calm) chipImpactHaptic(0.8);
    },
    [calm, offer.value, onThrow, preview]
  );

  const cancel = useCallback(() => {
    preview(null);
    setDragging(false);
  }, [preview]);

  // Every shared-value write lives in a useCallback, and the gesture runs on
  // the JS thread — the same shape as `chip-surface.tsx`. Writing them inside
  // closures built during render is what the compiler objects to, and it is
  // right to: those closures capture a render's worth of state and outlive it.
  const onBegin = useCallback(() => {
    lifted.value = withTiming(1, { duration: 90 });
    setDragging(true);
    // Shared values are deliberately absent from every dependency array in
    // this file. They are stable for the component's life, and NAMING one in a
    // dep array reads it during render — which is exactly what the compiler
    // forbids, and the reason this looked unfixable for three passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMove = useCallback(
    (dx: number, dy: number) => {
      tx.value = dx;
      ty.value = dy;
      // Preview only while genuinely lifted, or every sideways twitch would
      // strobe the board's lane highlight.
      preview(dy < -size * 0.35 ? previewLane(dx, size) : null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview, size]
  );

  const settle = useCallback(() => {
    // The chip ALWAYS returns to the rack. It is a control, not the puck — the
    // puck is drawn on the board from the server's own path, and a chip that
    // flew away would be a second, competing account of where it went.
    tx.value = withSpring(0, { damping: 18, stiffness: 220 });
    ty.value = withSpring(0, { damping: 18, stiffness: 220 });
    lifted.value = withTiming(0, { duration: 120 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRelease = useCallback(
    (dx: number, dy: number, vx: number, vy: number) => {
      const lane = flickLane({ dx, dy, vx, vy }, size);
      settle();
      if (lane) launch(lane);
      else cancel();
    },
    [cancel, launch, settle, size]
  );

  const pan = Gesture.Pan()
    .enabled(enabled)
    // The world, the haptics and the state all live on the JS thread, so
    // hopping to the UI thread and back would buy nothing and cost a frame.
    .runOnJS(true)
    // Only claim the touch after real travel, so a tap still selects and a
    // vertical page scroll is not stolen by a chip.
    .activeOffsetY([-14, 14])
    .activeOffsetX([-18, 18])
    .onStart(onBegin)
    .onUpdate((e) => onMove(e.translationX, e.translationY))
    .onEnd((e) => onRelease(e.translationX, e.translationY, e.velocityX, e.velocityY))
    .onFinalize(() => { settle(); cancel(); });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      // Armed chips sit slightly proud of the rack even before they are
      // touched, so "which one am I about to throw" is answered at a glance
      // rather than by reading a ring.
      { scale: (selected ? 1.1 : 1) + lifted.value * 0.12 },
    ],
    zIndex: lifted.value > 0 ? 40 : selected ? 20 : 1,
  }));

  const label = enabled
    ? `Stake ${offer.value} Forge Coins${selected ? ', selected' : ''}`
    : `${offer.value} coin chip unavailable: ${offer.reason ?? 'not playable'}`;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>
        <Pressable
          testID={`chip-${offer.value}`}
          onPress={() => {
            if (!enabled) return;
            onSelect(offer.value);
            playChipReady();
          }}
          disabled={!enabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: !enabled, selected }}
          accessibilityLabel={label}
          accessibilityHint={enabled ? 'Flick upward to drop, or tap to select' : undefined}
          style={({ pressed }) => ({
            alignItems: 'center',
            padding: 3,
            borderRadius: 12,
            borderWidth: 1,
            // Selection is a ring AND a tick below — never colour alone.
            borderColor: selected ? colors.accent : 'transparent',
            backgroundColor: selected ? 'rgba(34,211,238,0.12)' : 'transparent',
            shadowColor: colors.accent,
            shadowOpacity: selected ? 0.55 : 0,
            shadowRadius: selected ? 10 : 0,
            opacity: pressed && enabled ? 0.85 : 1,
          })}
        >
          <ForgeChip
            value={offer.value}
            size={size}
            tone={tone}
            dimmed={!enabled}
          />
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={{
              marginTop: 1,
              fontSize: selected ? 6 : 7,
              letterSpacing: selected ? 0.2 : 0.6,
              color: selected ? colors.accent : colors['text-mute'],
            }}
          >
            {dragging ? 'AIM' : selected ? 'FLICK' : ' '}
          </Text>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

/** The rack's default denominations, re-exported so callers do not reach past
 *  this module into the domain layer for a list the rack owns the look of. */
export { DROP_CHIPS };

/** Web keyboards get the lane keys as well as the buttons: 1/2/3 pick a lane,
 *  Enter drops. Registered by the screen, not here, because the rack does not
 *  own the board — but the mapping lives beside the gesture it mirrors so the
 *  two cannot drift apart. */
export const LANE_KEYS: Readonly<Record<string, LaneChoice>> = {
  '1': 'left',
  '2': 'centre',
  '3': 'right',
  ArrowLeft: 'left',
  ArrowDown: 'centre',
  ArrowRight: 'right',
};

export const isWeb = Platform.OS === 'web';

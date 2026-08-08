import { useEffect, useRef, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { formatMultiplier, type DropTheme, type DropTier } from '@/domain/forge-drop';
import { buildTrajectory, pegPositions, puckAt } from '@/domain/forge-drop-physics';
import { useSettingsStore } from '@/state/settings-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * THE BOARD.
 *
 * Thirteen slots and twelve peg rows, drawn from the tier's own numbers so a
 * rebalance in SQL redraws it with no code change.
 *
 * THE FALL IS A REPLAY, NOT A SIMULATION. The server already decided where this
 * puck lands; `buildTrajectory` derives believable motion along the route it
 * actually took. A physics engine let loose here would land somewhere else, and
 * nudging one until it agreed would be a rigged simulation pretending to be an
 * honest one.
 *
 * REDUCED MOTION SKIPS THE FALL, NOT THE RESULT. There is no version of this
 * where somebody waits longer or learns less because they asked for less
 * movement: the puck simply appears in its slot and the result is announced.
 */

/** Themes are the tier's identity, resolved to real tokens rather than invented
 *  colours — the palette stays the app's. */
function themeTint(theme: DropTheme, colors: Record<string, string>): string {
  switch (theme) {
    case 'rust': return colors['text-dim'];
    case 'iron': return colors.rare ?? colors.accent;
    case 'cyber': return colors.accent;
    case 'reactor': return colors.legendary;
    case 'celestial': return colors.mythic ?? colors.epic;
    default: return colors.accent;
  }
}

export function DropBoard({
  tier,
  lane,
  /** The settled drop's column path, or null when nothing is falling. */
  columns,
  onSettled,
  slotHighlight,
  testID = 'drop-board',
}: {
  tier: DropTier;
  lane: number;
  columns: number[] | null;
  /** Fires when the puck has landed — the ONLY moment the result is shown. */
  onSettled: () => void;
  /** The slot the server paid, highlighted once resolved. */
  slotHighlight: number | null;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const calm = reduced || perfMode;
  const tint = themeTint(tier.theme, colors as unknown as Record<string, string>);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const slots = tier.rows + 1;
  // The board is measured, never assumed: a fixed pixel size would overflow a
  // 320px phone and float on a desktop.
  const cell = size.width > 0 ? size.width / slots : 0;
  const boardHeight = cell * (tier.rows + 1.6);

  const px = useSharedValue(0);
  const py = useSharedValue(0);
  const opacity = useSharedValue(0);
  const raf = useRef<number | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!columns || cell <= 0) {
      opacity.value = 0;
      return;
    }
    done.current = false;
    const traj = buildTrajectory(columns);

    // REDUCED MOTION: the puck is placed where it landed, at once. Same result,
    // same announcement, no fall.
    if (calm) {
      px.value = (traj.slot + 0.5) * cell;
      py.value = boardHeight - cell * 0.75;
      opacity.value = withTiming(1, { duration: 120 });
      const t = setTimeout(() => {
        done.current = true;
        onSettled();
      }, 160);
      return () => clearTimeout(t);
    }

    opacity.value = 1;
    const started = Date.now();
    const tick = () => {
      const t = (Date.now() - started) / 1000;
      const p = puckAt(traj, t);
      px.value = (p.x + 0.5) * cell;
      py.value = (p.y / (tier.rows + 1.6)) * boardHeight;
      if (t >= traj.duration) {
        if (!done.current) {
          done.current = true;
          onSettled();
        }
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, cell, boardHeight, calm]);

  const puckStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: px.value - cell * 0.3 }, { translateY: py.value - cell * 0.3 }],
  }));

  const pegs = cell > 0 ? pegPositions(tier.rows) : [];

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => {
        const { width } = e.nativeEvent.layout;
        setSize((prev) => (Math.abs(prev.width - width) < 1 ? prev : { width, height: prev.height }));
      }}
      testID={testID}
      // The board is a picture of the odds; the odds themselves are read out by
      // the payout table below, which is a real list a screen reader can walk.
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${tier.label} board, ${tier.rows} rows of pegs and ${slots} payout slots`}
      style={{ width: '100%' }}
    >
      <View
        style={{
          height: boardHeight,
          borderRadius: 14,
          overflow: 'hidden',
          backgroundColor: 'rgba(4,7,14,0.6)',
          borderWidth: 1,
          borderColor: `${tint}33`,
        }}
      >
        {/* The lane the puck will enter from — shown before the drop so the
            choice is visible, not implied. */}
        {cell > 0 ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: (lane + 0.5) * cell - 1,
              top: 0,
              width: 2,
              height: boardHeight,
              backgroundColor: `${tint}22`,
            }}
          />
        ) : null}

        {pegs.map((peg, i) => (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: (peg.x + 0.5) * cell - 2,
              top: (peg.y / (tier.rows + 1.6)) * boardHeight - 2,
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: `${tint}77`,
            }}
          />
        ))}

        <Animated.View
          pointerEvents="none"
          testID="drop-puck"
          style={[
            {
              position: 'absolute',
              width: cell * 0.6,
              height: cell * 0.6,
              borderRadius: cell * 0.3,
              backgroundColor: colors.legendary,
              // The resting value lives in the STATIC style: a Reanimated style
              // applies on the worklet's first evaluation, not the first paint.
              opacity: 0,
            },
            puckStyle,
          ]}
        />
      </View>

      {/* THE SLOTS. Real text, not a legend — the multiplier is readable at
          every width, and the landed one is marked by a border AND a caret,
          never by colour alone. */}
      <View className="mt-s1 flex-row" style={{ width: '100%' }}>
        {tier.multipliers.map((m, i) => {
          const hit = slotHighlight === i;
          return (
            <View
              key={i}
              testID={`drop-slot-${i}`}
              style={{
                flex: 1,
                minWidth: 0,
                alignItems: 'center',
                paddingVertical: 3,
                borderRadius: 4,
                borderWidth: hit ? 1 : 0,
                borderColor: hit ? colors.legendary : 'transparent',
                backgroundColor: hit ? 'rgba(251,191,36,0.14)' : 'transparent',
              }}
            >
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{
                  fontSize: 8,
                  color: hit ? colors.legendary : m >= 1 ? colors['text-dim'] : colors['text-mute'],
                  ...pixelFont(false),
                }}
              >
                {formatMultiplier(m)}
              </Text>
              {/* Not colour alone: the landed slot carries a mark. */}
              <Text allowFontScaling={false} style={{ fontSize: 7, color: colors.legendary, height: 9 }}>
                {hit ? '▲' : ' '}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

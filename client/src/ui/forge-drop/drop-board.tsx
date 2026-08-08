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
 * THE BOARD, WITH SEVERAL CHIPS IN THE AIR.
 *
 * Thirteen slots and twelve peg rows, drawn from the tier's own numbers so a
 * rebalance in SQL redraws it with no code change.
 *
 * EVERY FALL IS A REPLAY, NOT A SIMULATION. The server already decided where
 * each puck lands; `buildTrajectory` derives believable motion along the route
 * it actually took. A physics engine let loose here would land somewhere else,
 * and nudging one until it agreed would be a rigged simulation pretending to be
 * an honest one. That matters more with several chips falling, not less: two
 * pucks that collided would have to change each other's outcome, and their
 * outcomes were settled before either of them moved. So they pass through one
 * another, because the alternative is a lie about what the board did.
 *
 * EACH PUCK OWNS ITS OWN ANIMATION. One component, one rAF loop, one set of
 * shared values per chip — mounted when the server answers and unmounted when
 * the athlete has been told. Results therefore land in whatever order they
 * finish, which is the same order the server settled them in only by
 * coincidence, and nothing anywhere depends on it being so.
 *
 * REDUCED MOTION SKIPS THE FALL, NOT THE RESULT. There is no version of this
 * where somebody waits longer or learns less because they asked for less
 * movement: the puck appears in its slot and the result is announced.
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

export interface BoardPuck {
  /** The drop's idempotency key — stable, unique, and never reused. */
  key: string;
  /** The settled column path from the server. */
  columns: number[];
  /** Drawn on the puck, so three chips in the air stay tellable apart. */
  stake: number;
}

export function DropBoard({
  tier,
  lane,
  previewLane,
  pucks,
  onSettled,
  highlights,
  testID = 'drop-board',
}: {
  tier: DropTier;
  /** The lane a drop would use right now. */
  lane: number;
  /** The lane a chip is being dragged over, if any — shown differently from
   *  the committed one, because previewing must not look like choosing. */
  previewLane?: number | null;
  pucks: BoardPuck[];
  /** Fires when a puck has landed — the ONLY moment its result is shown. */
  onSettled: (key: string) => void;
  /** Slots to mark, one per recently landed drop. */
  highlights: number[];
  testID?: string;
}) {
  const colors = useThemeColors();
  const tint = themeTint(tier.theme, colors as unknown as Record<string, string>);

  const [width, setWidth] = useState(0);
  const slots = tier.rows + 1;
  // The board is measured, never assumed: a fixed pixel size would overflow a
  // 320px phone and float on a desktop.
  const cell = width > 0 ? width / slots : 0;
  const boardHeight = cell * (tier.rows + 1.6);

  const pegs = cell > 0 ? pegPositions(tier.rows) : [];

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        setWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w));
      }}
      testID={testID}
      // The board is a picture of the odds; the odds themselves are read out by
      // the payout table below, which is a real list a screen reader can walk.
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        `${tier.label} board, ${tier.rows} rows of pegs and ${slots} payout slots` +
        (pucks.length ? `, ${pucks.length} ${pucks.length === 1 ? 'chip' : 'chips'} falling` : '')
      }
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
        {/* The lane a drop would enter from — shown before the throw so the
            choice is visible, not implied. A dragged chip previews in a
            brighter line, so "where it would go" never reads as "where it is
            going". */}
        {cell > 0 ? (
          <LaneMark lane={lane} cell={cell} height={boardHeight} colour={`${tint}22`} testID="lane-mark" />
        ) : null}
        {cell > 0 && previewLane != null && previewLane !== lane ? (
          <LaneMark lane={previewLane} cell={cell} height={boardHeight} colour={`${colors.accent}66`} testID="lane-preview" />
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

        {cell > 0
          ? pucks.map((p) => (
              <Puck
                key={p.key}
                puck={p}
                cell={cell}
                rows={tier.rows}
                boardHeight={boardHeight}
                onSettled={onSettled}
              />
            ))
          : null}
      </View>

      {/* THE SLOTS. Real text, not a legend — the multiplier is readable at
          every width, and a landed one is marked by a border AND a caret,
          never by colour alone. */}
      <View className="mt-s1 flex-row" style={{ width: '100%' }}>
        {tier.multipliers.map((m, i) => {
          const hits = highlights.filter((h) => h === i).length;
          const hit = hits > 0;
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
              {/* Not colour alone: a landed slot carries a mark, and two chips
                  in the same slot say so rather than looking like one. */}
              <Text allowFontScaling={false} style={{ fontSize: 7, color: colors.legendary, height: 9 }}>
                {hits > 1 ? `▲${hits}` : hit ? '▲' : ' '}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function LaneMark({
  lane, cell, height, colour, testID,
}: { lane: number; cell: number; height: number; colour: string; testID: string }) {
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (lane + 0.5) * cell - 1,
        top: 0,
        width: 2,
        height,
        backgroundColor: colour,
      }}
    />
  );
}

/**
 * ONE FALLING CHIP.
 *
 * Its own component so its own rAF loop and shared values mount and unmount
 * with it. Five of these run independently; none of them knows the others
 * exist, which is exactly why a result arriving out of order changes nothing.
 */
function Puck({
  puck,
  cell,
  rows,
  boardHeight,
  onSettled,
}: {
  puck: BoardPuck;
  cell: number;
  rows: number;
  boardHeight: number;
  onSettled: (key: string) => void;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const calm = reduced || perfMode;

  const px = useSharedValue(0);
  const py = useSharedValue(0);
  const opacity = useSharedValue(0);
  const raf = useRef<number | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (cell <= 0) return;
    done.current = false;
    const traj = buildTrajectory(puck.columns);

    const finish = () => {
      if (done.current) return;
      done.current = true;
      onSettled(puck.key);
    };

    // REDUCED MOTION: the puck is placed where it landed, at once. Same result,
    // same announcement, no fall.
    if (calm) {
      px.value = (traj.slot + 0.5) * cell;
      py.value = boardHeight - cell * 0.75;
      opacity.value = withTiming(1, { duration: 120 });
      const t = setTimeout(finish, 160);
      return () => clearTimeout(t);
    }

    opacity.value = 1;
    const started = Date.now();
    const tick = () => {
      const t = (Date.now() - started) / 1000;
      const p = puckAt(traj, t);
      px.value = (p.x + 0.5) * cell;
      py.value = (p.y / (rows + 1.6)) * boardHeight;
      if (t >= traj.duration) {
        finish();
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
  }, [puck.key, cell, boardHeight, calm]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: px.value - cell * 0.3 }, { translateY: py.value - cell * 0.3 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      testID={`drop-puck-${puck.key}`}
      style={[
        {
          position: 'absolute',
          width: cell * 0.6,
          height: cell * 0.6,
          borderRadius: cell * 0.3,
          backgroundColor: colors.legendary,
          alignItems: 'center',
          justifyContent: 'center',
          // The resting value lives in the STATIC style: a Reanimated style
          // applies on the worklet's first evaluation, not the first paint.
          opacity: 0,
        },
        style,
      ]}
    >
      {/* Its stake, so three chips in the air are three distinguishable chips
          rather than three identical dots. */}
      <Text
        allowFontScaling={false}
        style={{ fontSize: Math.max(6, cell * 0.26), color: '#04070e', ...pixelFont() }}
      >
        {puck.stake}
      </Text>
    </Animated.View>
  );
}

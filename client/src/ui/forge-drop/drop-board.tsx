/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated from the animation loop by design; the compiler lint cannot see that
   .value writes are animation state rather than render state. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { formatMultiplier, type DropTheme, type DropTier } from '@/domain/forge-drop';
import { DROP_CHIP_TONE, type DropChipValue } from '@/domain/forge-drop-session';
import {
  landingStagger,
  strikeIntensity,
  tension,
  timeScale,
} from '@/domain/forge-drop-feel';
import { buildTrajectory, pegPositions, puckAt, type DropTrajectory } from '@/domain/forge-drop-physics';
import { useSettingsStore } from '@/state/settings-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { chipImpactHaptic } from '@/ui/duel/physics/chip-haptics';

import { BoardFx, type BoardFxHandle } from './board-fx';
import { playDropLand, playDropStrike } from './drop-audio';

/**
 * THE BOARD — a machine that is always running, and a fall that is always a
 * replay.
 *
 * EVERY FALL IS A REPLAY, NOT A SIMULATION. The server already decided where
 * each puck lands; `buildTrajectory` derives believable motion along the route
 * it actually took. That matters more with several chips falling, not less:
 * two pucks that collided would have to change each other's outcome, and their
 * outcomes were settled before either of them moved. So they pass through one
 * another, because the alternative is a lie about what the board did.
 *
 * ONE LOOP FOR EVERYTHING. There used to be a `requestAnimationFrame` per
 * puck. Five chips meant five loops, five sets of timers to clean up, and five
 * independent clocks that could drift apart mid-cascade. Now a single loop
 * advances every puck, detects every peg strike and fires every effect — so
 * the cost of a fifth chip is one more entry in an array rather than one more
 * scheduler.
 *
 * THE LOOP OWNS NO REACT STATE. It writes shared values and calls into the
 * effect layer's ref. A chip crossing twelve pegs therefore causes zero
 * renders anywhere in the tree; the only render in a whole fall is the one
 * that reveals the result.
 *
 * SLOW MOTION CHANGES WHEN, NEVER WHAT. Time is scaled down over the last
 * stretch of the fall so the landing has a held breath before it. The
 * trajectory is already fixed and the slot is already paid — this delays the
 * reveal by a beat and cannot alter it.
 *
 * REDUCED MOTION SKIPS THE FALL, NOT THE RESULT. The puck appears in its slot
 * and the result is announced identically. There is no version of this where
 * somebody waits longer or learns less because they asked for less movement.
 */

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
  key: string;
  columns: number[];
  stake: number;
}

/** Everything the loop needs for one chip, and nothing React needs. */
interface Runner {
  key: string;
  stake: number;
  traj: DropTrajectory;
  startedAt: number;
  /** Scaled clock — advanced by dt * timeScale, so slow motion is local. */
  clock: number;
  lastPeg: number | null;
  landed: boolean;
  stagger: number;
  intensity: number;
  gold: boolean;
}

export function DropBoard({
  tier,
  lane,
  previewLane,
  pucks,
  onSettled,
  highlights,
  charged = false,
  testID = 'drop-board',
}: {
  tier: DropTier;
  lane: number;
  previewLane?: number | null;
  pucks: BoardPuck[];
  onSettled: (key: string) => void;
  highlights: number[];
  /** A chip is selected — the machine spools up before anything is thrown. */
  charged?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const reducedPref = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const reduced = reducedPref || perfMode;
  const tint = themeTint(tier.theme, colors as unknown as Record<string, string>);
  const gold = colors.legendary;

  const [width, setWidth] = useState(0);
  const slots = tier.rows + 1;
  const cell = width > 0 ? width / slots : 0;
  const boardHeight = cell * (tier.rows + 1.6);

  const fx = useRef<BoardFxHandle | null>(null);
  const pegs = useMemo(() => (cell > 0 ? pegPositions(tier.rows) : []), [cell, tier.rows]);

  // ── the pucks, as animation state ────────────────────────────────────────
  //
  // Positions live in ONE pair of shared-value arrays rather than per-component
  // state, so the loop can write them without touching React at all.
  const px = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const py = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const pOpacity = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const pGlow = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const pSquash = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  // Velocity in board units per second — the trail's direction and length.
  const pVx = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const pVy = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const MAX_PUCKS = px.length;

  /** Board recoil, shared by every impact. One value, so five landings shake
   *  the board once rather than fighting over it. */
  const recoil = useSharedValue(0);

  // Which runner occupies which slot index. Stable for a puck's whole life so
  // its shared values never jump to another chip mid-fall.
  const runners = useRef<(Runner | null)[]>(Array(MAX_PUCKS).fill(null));
  // The stake drawn on each puck slot. React state rather than a ref read
  // during render — it changes once per drop, never per frame.
  const [slotStakes, setSlotStakes] = useState<number[]>(() => Array(MAX_PUCKS).fill(0));
  // One tone per slot, taken from the chip's own denomination — three chips
  // in the air are three different colours, so none of them is 'the other one'.
  const [slotTones, setSlotTones] = useState<string[]>(() => Array(MAX_PUCKS).fill(''));
  const raf = useRef<number | null>(null);
  /** Starts the loop if it is asleep. Set by the loop effect, called by the
   *  adopt effect — so a chip leaving the rack wakes the board. */
  const pump = useRef<() => void>(() => undefined);
  const settleQueue = useRef<string[]>([]);
  const [, forceSettle] = useState(0);

  // Adopt new pucks / release finished ones. This is the ONLY place React and
  // the loop meet, and it runs once per drop rather than once per frame.
  useEffect(() => {
    const live = new Set(pucks.map((p) => p.key));
    for (let i = 0; i < MAX_PUCKS; i += 1) {
      const r = runners.current[i];
      if (r && !live.has(r.key)) {
        runners.current[i] = null;
        pOpacity[i].value = 0;
        pVx[i].value = 0;
        pVy[i].value = 0;
      }
    }
    let queued = 0;
    let changed = false;
    for (const p of pucks) {
      if (runners.current.some((r) => r?.key === p.key)) continue;
      const free = runners.current.findIndex((r) => r === null);
      if (free < 0) break; // at capacity: the session model already caps this
      runners.current[free] = {
        key: p.key,
        stake: p.stake,
        traj: buildTrajectory(p.columns),
        startedAt: Date.now(),
        clock: 0,
        lastPeg: null,
        landed: false,
        stagger: landingStagger(queued++),
        intensity: strikeIntensity(p.stake, tier),
        gold: p.stake >= tier.max_stake * 0.6,
      };
      pOpacity[free].value = 1;
      pGlow[free].value = 0;
      changed = true;
    }
    if (changed) {
      setSlotStakes(runners.current.map((r) => r?.stake ?? 0));
      setSlotTones(runners.current.map((r) => {
        if (!r) return gold;
        const token = DROP_CHIP_TONE[r.stake as DropChipValue];
        // A PUCK IS NEVER DIM. The rack can render a 1-coin chip in a muted
        // tone — it is one of six sitting still on a lit panel. On the board it
        // is a 25px object that has to be the brightest thing there, and the
        // screenshot showed the 1 chip almost invisible against the dark
        // playfield. The quiet tokens are promoted for the puck only; the rack
        // keeps its own palette.
        const bright = token === 'text-dim' || token === 'text-mute' ? 'rare' : token;
        return (colors[bright as keyof typeof colors] as string) ?? gold;
      }));
      pump.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pucks, tier]);

  // ── THE LOOP ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (cell <= 0) return;
    let last = Date.now();
    let alive = true;

    /**
     * THE LOOP SLEEPS WHEN THE BOARD IS IDLE.
     *
     * It used to run for as long as the screen was mounted, which is a frame
     * callback every 16ms to animate nothing — a real battery cost on a phone
     * sitting open in a gym, and enough continuous work that Playwright judged
     * the page never "stable" and timed out clicking the header.
     *
     * Now it runs only while a chip is in the air. The ambient layer is
     * declarative Reanimated and keeps breathing without it, so an idle board
     * still looks alive while costing nothing.
     */
    const tick = () => {
      if (!alive) return;
      let live = false;
      try {
        live = step();
      } catch {
        // A decoration must never strand a chip. If anything in a frame
        // throws, the loop keeps running and the fall keeps going — the
        // result is already settled on the server either way.
        live = true;
      }
      if (!live) { raf.current = null; return; }
      raf.current = requestAnimationFrame(tick);
    };

    pump.current = () => {
      if (raf.current !== null) return;
      last = Date.now(); // no phantom dt from however long it slept
      raf.current = requestAnimationFrame(tick);
    };

    const step = (): boolean => {
      const now = Date.now();
      const dt = Math.min(0.05, (now - last) / 1000); // clamp: a backgrounded
      last = now;                                     // tab must not teleport

      let anyLive = false;
      for (let i = 0; i < MAX_PUCKS; i += 1) {
        const r = runners.current[i];
        if (!r || r.landed) continue;
        anyLive = true;

        const total = r.traj.duration + r.stagger;
        const progress = total <= 0 ? 1 : r.clock / total;
        r.clock += dt * timeScale(progress, reduced);

        if (reduced) {
          // No fall: place it in the slot and settle on the next tick.
          px[i].value = r.traj.slot + 0.5;
          py[i].value = tier.rows + 0.85;
          pVx[i].value = 0;
          pVy[i].value = 0;
          r.landed = true;
          settleQueue.current.push(r.key);
          fx.current?.land(r.traj.slot + 0.5, tier.rows + 0.85, 0.3, r.gold);
          continue;
        }

        const t = Math.max(0, r.clock - r.stagger);
        const p = puckAt(r.traj, t);
        const nx = p.x + 0.5;
        if (dt > 0) {
          pVx[i].value = (nx - px[i].value) / dt;
          pVy[i].value = (p.y - py[i].value) / dt;
        }
        px[i].value = nx;
        py[i].value = p.y;

        // Suspense: the puck brightens and its trail thickens as it falls.
        pGlow[i].value = tension(p.y, tier.rows);
        pSquash[i].value = p.bounce;

        // A peg strike is a CHANGE of peg index, not a bounce threshold — the
        // frames already carry which peg was struck, so this cannot double-fire
        // on a slow frame or miss one on a fast machine.
        if (p.peg !== null && p.peg !== r.lastPeg) {
          r.lastPeg = p.peg;
          fx.current?.strike(p.x + 0.5, p.y, r.intensity, r.gold);
          playDropStrike(r.intensity);
          if (r.intensity > 0.8) chipImpactHaptic(0.25);
        }

        if (t >= r.traj.duration) {
          r.landed = true;
          settleQueue.current.push(r.key);
          const power = Math.min(1, r.intensity);
          fx.current?.land(r.traj.slot + 0.5, tier.rows + 0.85, power, r.gold);
          playDropLand(power);
          chipImpactHaptic(0.6);
          // ONE SEQUENCE, NOT A NESTED CALLBACK. A `withTiming` completion
          // callback runs on the UI thread, so assigning another animation
          // from inside it throws — and the throw happened INSIDE the rAF
          // loop, which killed the loop outright. The first chip landed and
          // the next two hung in the air forever.
          recoil.value = withSequence(
            withTiming(1, { duration: 90 }),
            withTiming(0, { duration: 260 })
          );
        }
      }

      if (settleQueue.current.length > 0) forceSettle((n) => n + 1);
      return anyLive;
    };

    pump.current();
    return () => {
      alive = false;
      pump.current = () => undefined;
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell, reduced, tier.rows]);

  // Drain the settle queue in an effect — the loop must never call back into
  // React from inside a frame.
  useEffect(() => {
    if (settleQueue.current.length === 0) return;
    const keys = settleQueue.current;
    settleQueue.current = [];
    for (const k of keys) onSettled(k);
  });

  const boardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: recoil.value * 3 },
      { scale: 1 - recoil.value * 0.004 },
    ],
  }));

  const liveCount = pucks.length;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        setWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w));
      }}
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        `${tier.label} board, ${tier.rows} rows of pegs and ${slots} payout slots` +
        (liveCount ? `, ${liveCount} ${liveCount === 1 ? 'chip' : 'chips'} falling` : '')
      }
      style={{ width: '100%' }}
    >
      <Animated.View
        style={[
          {
            height: boardHeight,
            borderRadius: 14,
            overflow: 'hidden',
            backgroundColor: 'rgba(4,7,14,0.72)',
            borderWidth: 1,
            borderColor: `${tint}55`,
          },
          boardStyle,
        ]}
      >
        <BoardFx
          handleRef={fx}
          cell={cell}
          rows={tier.rows}
          tint={tint}
          gold={gold}
          charged={charged}
          live={liveCount}
          reduced={reduced}
        />

        {/* The lane a drop would enter from, and — brighter — the one a
            dragged chip is currently over. Previewing must never read as
            choosing. */}
        {cell > 0 ? (
          <LaneMark lane={lane} cell={cell} height={boardHeight} colour={`${tint}33`} testID="lane-mark" charged={charged} />
        ) : null}
        {cell > 0 && previewLane != null && previewLane !== lane ? (
          <LaneMark lane={previewLane} cell={cell} height={boardHeight} colour={`${colors.accent}88`} testID="lane-preview" charged />
        ) : null}

        {pegs.map((peg, i) => (
          <Peg
            key={i}
            left={(peg.x + 0.5) * cell}
            top={(peg.y / (tier.rows + 1.6)) * boardHeight}
            tint={tint}
            index={i}
            reduced={reduced}
          />
        ))}

        {cell > 0
          ? Array.from({ length: MAX_PUCKS }, (_, i) => (
              <Puck
                key={i}
                x={px[i]}
                y={py[i]}
                opacity={pOpacity[i]}
                glow={pGlow[i]}
                squash={pSquash[i]}
                vx={pVx[i]}
                vy={pVy[i]}
                cell={cell}
                rows={tier.rows}
                boardHeight={boardHeight}
                gold={gold}
                tint={tint}
                stake={slotStakes[i] ?? 0}
                tone={slotTones[i] ?? gold}
              />
            ))
          : null}
      </Animated.View>

      <View className="mt-s1 flex-row" style={{ width: '100%' }}>
        {tier.multipliers.map((m, i) => {
          const hits = highlights.filter((h) => h === i).length;
          const hit = hits > 0;
          const big = m >= 2;
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
                borderWidth: hit ? 1 : big ? 1 : 0,
                borderColor: hit ? colors.legendary : big ? `${colors.legendary}44` : 'transparent',
                backgroundColor: hit ? 'rgba(251,191,36,0.16)' : 'transparent',
              }}
            >
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{
                  fontSize: 8,
                  color: hit ? colors.legendary : big ? colors.legendary : m >= 1 ? colors['text-dim'] : colors['text-mute'],
                  ...pixelFont(false),
                }}
              >
                {formatMultiplier(m)}
              </Text>
              {/* Never colour alone: a landed slot carries a mark, and two
                  chips in the same slot say so rather than looking like one. */}
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

/** A peg, with a slow idle pulse offset by its own index so the board breathes
 *  rather than blinks. */
function Peg({ left, top, tint, index, reduced }: {
  left: number; top: number; tint: string; index: number; reduced: boolean;
}) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    const id = setTimeout(() => {
      // ONE REPEATING SEQUENCE, NOT A CALLBACK THAT RE-ARMS ITSELF.
      // Assigning a new animation from inside a `withTiming` completion
      // callback runs on the UI thread and recurses — with 78 pegs each doing
      // it, that is "Maximum call stack size exceeded" the moment the board
      // mounts. It is the same mistake the board recoil made; a completion
      // callback is not a place to start another animation.
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1600 }),
          withTiming(0, { duration: 1600 })
        ),
        -1,
        false
      );
    }, (index * 137) % 2600);
    return () => clearTimeout(id);
  }, [index, pulse, reduced]);

  const style = useAnimatedStyle(() => ({ opacity: 0.55 + pulse.value * 0.35 }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: left - 2,
          top: top - 2,
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: tint,
        },
        style,
      ]}
    />
  );
}

function LaneMark({
  lane, cell, height, colour, testID, charged,
}: { lane: number; cell: number; height: number; colour: string; testID: string; charged: boolean }) {
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (lane + 0.5) * cell - (charged ? 1.5 : 1),
        top: 0,
        width: charged ? 3 : 2,
        height,
        backgroundColor: colour,
      }}
    />
  );
}

/**
 * ONE PUCK SLOT. It renders whatever runner currently owns its index, driven
 * entirely by shared values — so it never re-renders during a fall.
 */
function Puck({
  x, y, opacity, glow, squash, vx, vy, cell, rows, boardHeight, gold, tint, stake, tone,
}: {
  x: ReturnType<typeof useSharedValue<number>>;
  y: ReturnType<typeof useSharedValue<number>>;
  opacity: ReturnType<typeof useSharedValue<number>>;
  glow: ReturnType<typeof useSharedValue<number>>;
  squash: ReturnType<typeof useSharedValue<number>>;
  vx: ReturnType<typeof useSharedValue<number>>;
  vy: ReturnType<typeof useSharedValue<number>>;
  cell: number; rows: number; boardHeight: number; gold: string; tint: string; stake: number; tone: string;
}) {
  const size = cell * 0.6;
  const px = (v: number) => v * cell - size / 2;
  const py = (v: number) => (v / (rows + 1.6)) * boardHeight - size / 2;

  /**
   * THE TRAIL IS A STREAK, NOT A SHAPE.
   *
   * The first version drew a fixed gold rectangle 1.6x the puck's height
   * underneath it, at up to 52% opacity. With three chips falling that is
   * three large opaque blocks sliding down the board — the single biggest
   * thing obscuring the peg field.
   *
   * Now it is a thin bar the width of the puck, ROTATED to the chip's actual
   * direction of travel and stretched by its speed. It is only visible while
   * the chip is moving, it points where the chip is going, and it disappears
   * the moment it lands.
   */
  const trail = useAnimatedStyle(() => {
    const speed = Math.min(1, Math.hypot(vx.value, vy.value) / 9);
    const angle = Math.atan2(vy.value, vx.value) * (180 / Math.PI) - 90;
    return {
      opacity: opacity.value * speed * 0.5,
      transform: [
        { translateX: px(x.value) },
        { translateY: py(y.value) },
        { rotate: `${angle}deg` },
        { scaleY: 0.5 + speed * 2.2 },
      ],
    };
  });

  /** A COMPACT HALO. Tight to the chip, brightening as it nears the slot —
   *  never a glow field spreading across the board. */
  const halo = useAnimatedStyle(() => ({
    opacity: opacity.value * (0.18 + glow.value * 0.3),
    transform: [
      { translateX: px(x.value) - size * 0.3 },
      { translateY: py(y.value) - size * 0.3 },
      { scale: 1 + glow.value * 0.18 },
    ],
  }));

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: px(x.value) },
      { translateY: py(y.value) },
      { scaleX: 1 + squash.value * 0.18 },
      { scaleY: 1 - squash.value * 0.18 },
    ],
  }));

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', left: 0, top: 0, width: size * 0.5, height: size, marginLeft: size * 0.25, borderRadius: size, backgroundColor: tone, opacity: 0 },
          trail,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', left: 0, top: 0, width: size * 1.6, height: size * 1.6, borderRadius: size, borderWidth: 1, borderColor: tone, opacity: 0 },
          halo,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        testID="drop-puck"
        style={[
          {
            position: 'absolute',
            left: 0,
            top: 0,
            width: size,
            height: size,
            borderRadius: size / 2,
            // The chip is the brightest object on the board, always.
            backgroundColor: tone,
            borderWidth: 1.5,
            borderColor: '#ffffff',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0,
          },
          style,
        ]}
      >
        <Text allowFontScaling={false} style={{ fontSize: Math.max(6, cell * 0.26), color: '#04070e', ...pixelFont() }}>
          {stake}
        </Text>
      </Animated.View>
    </>
  );
}

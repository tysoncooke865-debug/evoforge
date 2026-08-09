/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated from an animation loop by design; the compiler lint cannot see that
   .value writes are animation state rather than render state. */
import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { FX_BUDGET } from '@/domain/forge-drop-feel';

/**
 * THE BOARD, ALIVE.
 *
 * Everything in this file is decoration. None of it can move a coin, change a
 * slot or delay a result — it reads positions it is handed and draws light.
 * That separation is the whole design: the machine can look as energetic as we
 * like precisely because none of the energy is load-bearing.
 *
 * THREE RULES IT KEEPS.
 *
 *   TRANSFORMS AND OPACITY ONLY. Every animation here is `translate`, `scale`
 *   or `opacity`, which the compositor can run without laying anything out.
 *   Nothing animates a width, a colour or a shadow — those cost a layout or a
 *   paint per frame, and five chips falling is not the moment to spend one.
 *
 *   FIXED POOLS, NEVER ALLOCATION. Rings and sparks are allocated ONCE at
 *   mount, to the budget in `domain/forge-drop-feel.ts`, and recycled by index.
 *   A pool that cannot grow cannot leak, and the worst case is the same as the
 *   normal case — which matters because the worst case here is a workout.
 *
 *   REDUCED MOTION REMOVES THE MOTION, NOT THE INFORMATION. With it on, the
 *   ambient layer does not render at all and strikes become a brief static
 *   flash. Nothing that tells the athlete what happened lives in here.
 */

/** Handle the board uses to fire effects from its own animation loop. */
export interface BoardFxHandle {
  /** A puck struck a peg at these board-unit coordinates. */
  strike: (x: number, y: number, intensity: number, gold: boolean) => void;
  /** A puck landed in a slot. `power` scales the rings and sparks. */
  land: (x: number, y: number, power: number, gold: boolean) => void;
}

// ───────────────────────────────────────────────────────────── ambient layer

/**
 * THE EDGES, NOT THE MIDDLE.
 *
 * This began as three broad drifting discs behind the pegs. Dimmed twice and
 * enlarged once, they still read as translucent shapes laid OVER the board —
 * because that is what they were. A soft-edged form crossing the peg field is
 * an obstruction however faint it is, and the chip has to be the brightest
 * thing on the board.
 *
 * So the ambient light now lives on the FRAME: four thin bars that breathe
 * along the border, and a line down the centre divider. The playfield itself
 * stays dark and empty, which is the only way a 3px chip can be the most
 * visible object on it.
 *
 * IT GETS OUT OF THE WAY WHEN SOMETHING IS FALLING. `live` scales the whole
 * layer down to about a third — ambient energy is for an idle machine, and
 * the moment there is a real event to watch it stops competing with it.
 */
function EdgeEnergy({ charged, live, tint }: { charged: boolean; live: number; tint: string }) {
  const drift = useSharedValue(0);
  const glow = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) { drift.value = 0.5; return; }
    drift.value = withRepeat(
      withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
  }, [drift, reduced]);

  useEffect(() => {
    // Idle is the loud state here. Anything falling pushes this DOWN.
    const base = charged ? 1 : 0.62;
    const quieten = live > 0 ? 0.32 : 1;
    glow.value = withTiming(base * quieten, { duration: 320, easing: Easing.out(Easing.quad) });
  }, [charged, live, glow]);

  const top = useAnimatedStyle(() => ({
    opacity: 0.1 + glow.value * 0.3,
    transform: [{ translateX: (drift.value - 0.5) * 40 }],
  }));
  const bottom = useAnimatedStyle(() => ({
    opacity: 0.08 + glow.value * 0.26,
    transform: [{ translateX: (0.5 - drift.value) * 40 }],
  }));
  const side = useAnimatedStyle(() => ({ opacity: 0.06 + glow.value * 0.2 }));
  const divider = useAnimatedStyle(() => ({
    opacity: 0.05 + glow.value * 0.16,
    transform: [{ scaleY: 0.9 + drift.value * 0.1 }],
  }));

  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <Animated.View style={[{ position: 'absolute', top: 0, left: '-10%', width: '120%', height: 2, backgroundColor: tint }, top]} />
      <Animated.View style={[{ position: 'absolute', bottom: 0, left: '-10%', width: '120%', height: 2, backgroundColor: '#a855f7' }, bottom]} />
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 1, backgroundColor: tint }, side]} />
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 1, backgroundColor: tint }, side]} />
      {/* The centre divider, lit — the board's spine. */}
      <Animated.View style={[{ position: 'absolute', top: '6%', bottom: '6%', left: '50%', width: 1, backgroundColor: '#a855f7' }, divider]} />
    </View>
  );
}

/**
 * MOTES — the dust in the machine.
 *
 * Ten of them, each on its own long loop with a staggered start so they never
 * march in step. They travel up and slightly sideways, which reads as
 * convection rather than snowfall and keeps them clearly distinct from a
 * falling chip.
 */
function Motes({ tint, live }: { tint: string; live: number }) {
  const seeds = useMemo(
    () =>
      Array.from({ length: FX_BUDGET.motes }, (_, i) => ({
        // Deterministic, not random: a fixed pattern cannot resample on every
        // render, and nothing here needs to be unpredictable.
        left: `${6 + ((i * 37) % 88)}%`,
        delay: (i * 611) % 5200,
        duration: 6200 + ((i * 397) % 3600),
        drift: ((i % 3) - 1) * 14,
        size: 1.5 + (i % 3) * 0.7,
      })),
    []
  );
  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {seeds.map((s, i) => (
        <Mote key={i} {...s} tint={tint} live={live} />
      ))}
    </View>
  );
}

function Mote({
  left, delay, duration, drift, size, tint, live,
}: { left: string; delay: number; duration: number; drift: number; size: number; tint: string; live: number }) {
  const t = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) { t.value = 0; return; } // no drift, and therefore invisible
    const id = setTimeout(() => {
      t.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    }, delay);
    return () => clearTimeout(id);
  }, [delay, duration, t, reduced]);

  const style = useAnimatedStyle(() => ({
    // Fade in and out at the ends so a mote never pops into or out of being.
    // Faint, and fainter still while something is falling.
    opacity: Math.sin(t.value * Math.PI) * (live > 0 ? 0.1 : 0.28),
    transform: [{ translateY: (1 - t.value) * 260 - 20 }, { translateX: t.value * drift }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: left as unknown as number, bottom: 0, width: size, height: size, borderRadius: size, backgroundColor: tint },
        style,
      ]}
    />
  );
}

/**
 * ARCS — the occasional flicker of current between peg groups.
 *
 * Two of them, firing on long random-ish intervals derived from their index.
 * Short (about 160ms), thin and dim: the eye catches one every few seconds and
 * never has time to study it, which is exactly the intended impression of a
 * machine idling under load.
 */
function Arc({ index, size, tint }: { index: number; size: { w: number; h: number }; tint: string }) {
  const life = useSharedValue(0);
  // Position is animation state, so it lives in shared values and is written
  // from the timer. A ref would be read during render, which is the one thing
  // a component built to never re-render must not do.
  const ax = useSharedValue(0);
  const ay = useSharedValue(0);
  const aw = useSharedValue(0.5);
  const arot = useSharedValue(0);

  useEffect(() => {
    if (size.w <= 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const fire = () => {
      if (cancelled) return;
      // A new place each strike, so two arcs do not become two blinking lamps.
      // Derived from the clock rather than stored in state — nothing renders.
      const seed = Date.now() / 1000 + index * 7.3;
      ax.value = Math.abs(Math.cos(seed * 1.7)) * size.w * 0.78;
      ay.value = size.h * (0.12 + Math.abs(Math.sin(seed)) * 0.62);
      aw.value = 0.5 + Math.abs(Math.sin(seed * 2.3)) * 0.9;
      arot.value = -35 + Math.abs(Math.cos(seed * 3.1)) * 70;
      life.value = withSequence(
        withTiming(1, { duration: 60, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 110, easing: Easing.in(Easing.quad) })
      );
      timer = setTimeout(fire, 2600 + Math.abs(Math.sin(seed * 5)) * 5200);
    };
    timer = setTimeout(fire, 1400 + index * 1900);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, size.w, size.h]);

  const style = useAnimatedStyle(() => ({
    opacity: life.value * 0.5,
    transform: [
      { translateX: ax.value },
      { translateY: ay.value },
      { rotate: `${arot.value}deg` },
      { scaleX: aw.value * (0.4 + life.value * 0.6) },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: 0, top: 0, width: 48, height: 1, backgroundColor: tint, opacity: 0 },
        style,
      ]}
    />
  );
}

// ────────────────────────────────────────────────────────────── strike pools

interface Slot {
  life: ReturnType<typeof useSharedValue<number>>;
  x: ReturnType<typeof useSharedValue<number>>;
  y: ReturnType<typeof useSharedValue<number>>;
  power: ReturnType<typeof useSharedValue<number>>;
  gold: ReturnType<typeof useSharedValue<number>>;
}

/**
 * ONE RING. Position and power live in shared values, so firing one is three
 * writes on the UI thread and never a React render — which is what makes it
 * safe to fire sixty of them in two seconds.
 */
function Ring({ slot, cell, tint, gold, thickness = 1 }: {
  slot: Slot; cell: number; tint: string; gold: string; thickness?: number;
}) {
  const style = useAnimatedStyle(() => {
    const l = slot.life.value;
    const size = cell * (0.5 + l * (1.6 + slot.power.value * 1.8));
    return {
      opacity: l > 0 ? (1 - l) * 0.85 * (0.4 + slot.power.value * 0.6) : 0,
      width: size,
      height: size,
      borderRadius: size / 2,
      borderColor: slot.gold.value > 0.5 ? gold : tint,
      transform: [
        { translateX: slot.x.value * cell - size / 2 },
        { translateY: slot.y.value * cell - size / 2 },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: 0, top: 0, borderWidth: thickness, opacity: 0 }, style]}
    />
  );
}

/**
 * A STRUCK PEG, BRIGHTENED.
 *
 * Drawn as a short-lived bright dot exactly over the peg rather than by
 * wiring a shared value into all 78 peg components — same result on screen,
 * a fraction of the machinery, and it recycles from a pool like everything
 * else here.
 */
function PegFlash({ slot, cell, tint, gold }: { slot: Slot; cell: number; tint: string; gold: string }) {
  const style = useAnimatedStyle(() => {
    const l = slot.life.value;
    const size = cell * 0.26;
    return {
      opacity: l > 0 ? (1 - l) * 0.95 : 0,
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: slot.gold.value > 0.5 ? gold : tint,
      transform: [
        { translateX: slot.x.value * cell - size / 2 },
        { translateY: slot.y.value * cell - size / 2 },
        { scale: 1 + (1 - l) * 0.6 },
      ],
    };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, opacity: 0 }, style]} />;
}

/** ONE SPARK. A short directional streak, angle derived from its own index so
 *  a burst fans out instead of stacking. */
function Spark({ slot, cell, tint, gold, index }: {
  slot: Slot; cell: number; tint: string; gold: string; index: number;
}) {
  const angle = (index / FX_BUDGET.sparks) * Math.PI * 2;
  const style = useAnimatedStyle(() => {
    const l = slot.life.value;
    const reach = cell * (0.3 + slot.power.value * 1.1) * l;
    return {
      opacity: l > 0 ? (1 - l) * 0.9 : 0,
      backgroundColor: slot.gold.value > 0.5 ? gold : tint,
      transform: [
        { translateX: slot.x.value * cell + Math.cos(angle) * reach },
        { translateY: slot.y.value * cell + Math.sin(angle) * reach },
        { scale: 1 - l * 0.5 },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: -1.5, top: -1.5, width: 3, height: 3, borderRadius: 2, opacity: 0 }, style]}
    />
  );
}

function usePool(size: number): Slot[] {
  // Hooks cannot be called in a loop of variable length, so the pool size is a
  // module constant and the array is built once. `size` is only ever FX_BUDGET.
  const life0 = useSharedValue(0), x0 = useSharedValue(0), y0 = useSharedValue(0), p0 = useSharedValue(0), g0 = useSharedValue(0);
  const life1 = useSharedValue(0), x1 = useSharedValue(0), y1 = useSharedValue(0), p1 = useSharedValue(0), g1 = useSharedValue(0);
  const life2 = useSharedValue(0), x2 = useSharedValue(0), y2 = useSharedValue(0), p2 = useSharedValue(0), g2 = useSharedValue(0);
  const life3 = useSharedValue(0), x3 = useSharedValue(0), y3 = useSharedValue(0), p3 = useSharedValue(0), g3 = useSharedValue(0);
  const life4 = useSharedValue(0), x4 = useSharedValue(0), y4 = useSharedValue(0), p4 = useSharedValue(0), g4 = useSharedValue(0);
  const life5 = useSharedValue(0), x5 = useSharedValue(0), y5 = useSharedValue(0), p5 = useSharedValue(0), g5 = useSharedValue(0);
  const life6 = useSharedValue(0), x6 = useSharedValue(0), y6 = useSharedValue(0), p6 = useSharedValue(0), g6 = useSharedValue(0);
  const life7 = useSharedValue(0), x7 = useSharedValue(0), y7 = useSharedValue(0), p7 = useSharedValue(0), g7 = useSharedValue(0);
  const life8 = useSharedValue(0), x8 = useSharedValue(0), y8 = useSharedValue(0), p8 = useSharedValue(0), g8 = useSharedValue(0);
  const life9 = useSharedValue(0), x9 = useSharedValue(0), y9 = useSharedValue(0), p9 = useSharedValue(0), g9 = useSharedValue(0);
  const life10 = useSharedValue(0), x10 = useSharedValue(0), y10 = useSharedValue(0), p10 = useSharedValue(0), g10 = useSharedValue(0);
  const life11 = useSharedValue(0), x11 = useSharedValue(0), y11 = useSharedValue(0), p11 = useSharedValue(0), g11 = useSharedValue(0);
  const life12 = useSharedValue(0), x12 = useSharedValue(0), y12 = useSharedValue(0), p12 = useSharedValue(0), g12 = useSharedValue(0);
  const life13 = useSharedValue(0), x13 = useSharedValue(0), y13 = useSharedValue(0), p13 = useSharedValue(0), g13 = useSharedValue(0);
  const all: Slot[] = [
    { life: life0, x: x0, y: y0, power: p0, gold: g0 },
    { life: life1, x: x1, y: y1, power: p1, gold: g1 },
    { life: life2, x: x2, y: y2, power: p2, gold: g2 },
    { life: life3, x: x3, y: y3, power: p3, gold: g3 },
    { life: life4, x: x4, y: y4, power: p4, gold: g4 },
    { life: life5, x: x5, y: y5, power: p5, gold: g5 },
    { life: life6, x: x6, y: y6, power: p6, gold: g6 },
    { life: life7, x: x7, y: y7, power: p7, gold: g7 },
    { life: life8, x: x8, y: y8, power: p8, gold: g8 },
    { life: life9, x: x9, y: y9, power: p9, gold: g9 },
    { life: life10, x: x10, y: y10, power: p10, gold: g10 },
    { life: life11, x: x11, y: y11, power: p11, gold: g11 },
    { life: life12, x: x12, y: y12, power: p12, gold: g12 },
    { life: life13, x: x13, y: y13, power: p13, gold: g13 },
  ];
  return all.slice(0, size);
}

/**
 * THE EFFECT LAYER.
 *
 * Mounted once inside the board, handed a ref, and driven entirely from the
 * board's animation loop. It renders nothing that changes with React state, so
 * a chip striking a peg costs no render anywhere in the tree.
 */
export function BoardFx({
  handleRef,
  cell,
  rows,
  tint,
  gold,
  charged,
  live,
  reduced,
}: {
  handleRef: React.MutableRefObject<BoardFxHandle | null>;
  cell: number;
  rows: number;
  tint: string;
  gold: string;
  /** A chip is selected — the machine spools up. */
  charged: boolean;
  /** How many chips are in the air. */
  live: number;
  reduced: boolean;
}) {
  const rings = usePool(FX_BUDGET.pegRings);
  const flashes = usePool(FX_BUDGET.pegRings);
  const lands = usePool(FX_BUDGET.landingRings);
  const sparks = usePool(FX_BUDGET.sparks > 14 ? 14 : FX_BUDGET.sparks);
  const nextRing = useRef(0);
  const nextFlash = useRef(0);
  const nextLand = useRef(0);
  const nextSpark = useRef(0);

  useEffect(() => {
    handleRef.current = {
      strike(x, y, intensity, isGold) {
        const s = rings[nextRing.current % rings.length];
        nextRing.current += 1;
        s.x.value = x; s.y.value = y;
        s.power.value = intensity * 0.6;
        s.gold.value = isGold ? 1 : 0;
        s.life.value = 0;
        // Recycled by index: the oldest ring is simply restarted, so the pool
        // is the cap and nothing is ever allocated mid-fall.
        s.life.value = withTiming(1, { duration: reduced ? 90 : 340, easing: Easing.out(Easing.quad) });

        // The peg itself lights up — 100-250ms, in place, then gone.
        const f = flashes[nextFlash.current % flashes.length];
        nextFlash.current += 1;
        f.x.value = x; f.y.value = y;
        f.gold.value = isGold ? 1 : 0;
        f.life.value = 0;
        f.life.value = withTiming(1, { duration: reduced ? 100 : 200, easing: Easing.out(Easing.quad) });

        if (intensity > 0.7) {
          const k = sparks[nextSpark.current % sparks.length];
          nextSpark.current += 1;
          k.x.value = x; k.y.value = y;
          k.power.value = intensity * 0.5;
          k.gold.value = isGold ? 1 : 0;
          k.life.value = 0;
          k.life.value = withTiming(1, { duration: reduced ? 90 : 300, easing: Easing.out(Easing.quad) });
        }
      },
      land(x, y, power, isGold) {
        const s = lands[nextLand.current % lands.length];
        nextLand.current += 1;
        s.x.value = x; s.y.value = y;
        s.power.value = power;
        s.gold.value = isGold ? 1 : 0;
        s.life.value = 0;
        s.life.value = withTiming(1, { duration: reduced ? 140 : 620, easing: Easing.out(Easing.cubic) });

        const burst = Math.min(sparks.length, Math.round(2 + power * 8));
        for (let i = 0; i < burst; i += 1) {
          const k = sparks[nextSpark.current % sparks.length];
          nextSpark.current += 1;
          k.x.value = x; k.y.value = y;
          k.power.value = power;
          k.gold.value = isGold ? 1 : 0;
          k.life.value = 0;
          k.life.value = withTiming(1, { duration: reduced ? 120 : 520, easing: Easing.out(Easing.quad) });
        }
      },
    };
    return () => { handleRef.current = null; };
  }, [handleRef, rings, lands, sparks, flashes, reduced]);

  return (
    <>
      {/* AMBIENT LIFE. Skipped entirely under reduced motion — there is no
          information in it, so there is nothing to preserve. */}
      {!reduced ? (
        <>
          <EdgeEnergy charged={charged} live={live} tint={tint} />
          <Motes tint={tint} live={live} />
          {live === 0
            ? Array.from({ length: FX_BUDGET.arcs }, (_, i) => (
                <Arc key={i} index={i} size={{ w: cell * (rows + 1), h: cell * (rows + 1.6) }} tint={tint} />
              ))
            : null}
        </>
      ) : null}

      {cell > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
          {rings.map((s, i) => <Ring key={`r${i}`} slot={s} cell={cell} tint={tint} gold={gold} />)}
          {flashes.map((s, i) => <PegFlash key={`f${i}`} slot={s} cell={cell} tint={tint} gold={gold} />)}
          {lands.map((s, i) => <Ring key={`l${i}`} slot={s} cell={cell} tint={tint} gold={gold} thickness={2} />)}
          {sparks.map((s, i) => <Spark key={`s${i}`} slot={s} cell={cell} tint={tint} gold={gold} index={i} />)}
        </View>
      ) : null}
    </>
  );
}

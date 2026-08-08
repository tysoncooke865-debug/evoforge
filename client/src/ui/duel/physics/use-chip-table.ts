/* eslint-disable react-hooks/immutability -- the pose buffer is a Reanimated
   shared value written from the physics loop by design; the compiler lint
   cannot see that these writes are UI-thread animation state, not render
   state. Same documented exception as ui/core/neon-button.tsx. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import { MAX_TABLE_BODIES, decompose, type ForgeChipValue } from '@/domain/forge-duel';

import { playChipImpact, primeChipAudio, resetChipAudio } from './chip-audio';
import { chipImpactHaptic } from './chip-haptics';
import { ChipWorld, baseGravityFor, chipRadius, type ChipImpact } from './chip-world';
import { useTiltGravity, type MotionState } from './use-tilt-gravity';

/**
 * THE BINDING between a wager and a table of chips.
 *
 * TWO RULES GOVERN THIS FILE.
 *
 * 1. **The physics never decides the money.** `committed` — the canonical list
 *    of chip instances, each with an id, a value, an owner and a side — is the
 *    only thing that adds up to a stake, and it is ordinary React state. The
 *    world is told about chips; it is never asked what the stake is. Every
 *    failure mode in the simulation (an escaped body, a NaN, a resize, a
 *    navigation, a whole world destroyed) changes what is drawn and nothing
 *    else.
 *
 * 2. **React does not re-render at 60fps.** The loop writes one Reanimated
 *    shared value — a flat pose buffer — and the chip views read their slice
 *    of it inside a worklet. React re-renders only when the COMMITTED LIST
 *    changes, which happens when an athlete commits or takes back a chip.
 *    A chip moving from x=100.3 to x=100.7 is invisible to React.
 */

export interface CommittedChip {
  /** Stable identity. The physics body references this and never the reverse. */
  chipId: string;
  value: ForgeChipValue;
  /** Who put it in. Everything downstream (raises, backing, spectators) needs
   *  this, so it is recorded from the first chip rather than retrofitted. */
  ownerId: string;
  /** Which athlete this chip is staked BEHIND. */
  side: 'mine' | 'theirs';
  /** How it arrived — a flick, a quick button, a pour. Useful for analytics
   *  and for deciding how dramatically to spawn it. */
  source: 'tap' | 'flick' | 'pour' | 'quick' | 'stack';
  /** Which physical stack it was built into, if any. Presentation only — a
   *  stack is a GROUPING of chips, never a value of its own. */
  stackId: string | null;
  createdAt: number;
}

export interface ChipTableApi {
  /** The canonical list. Its values sum to the staked amount, always. */
  committed: readonly CommittedChip[];
  /** Flat [x, y, angle, …] in `committed` order, written by the loop. */
  pose: SharedValue<number[]>;
  /** Table size, set by the surface's onLayout. */
  setSize: (w: number, h: number) => void;
  size: { width: number; height: number };
  /** Put a chip on the table. `vx`/`vy` are px/second from a real gesture. */
  commit: (spec: {
    value: ForgeChipValue;
    x?: number;
    vx?: number;
    vy?: number;
    spin?: number;
    source?: CommittedChip['source'];
    /** Bond it to the top of this stack instead of dropping it loose. */
    stackId?: string;
  }) => void;
  /** Take one back — by id, or the most recent of a value. */
  takeBack: (chipId: string) => void;
  /** Take back every chip still bonded to this one. Dragging a stack out
   *  returns the whole stack; dragging a loose chip returns just it. */
  takeBackStack: (chipId: string) => number;
  /** Begin a new physical stack; returns its id. */
  beginStack: () => string;
  /** How many chips are currently bonded into that stack. */
  stackSize: (stackId: string) => number;
  /** Rebuild the table to represent `amount` exactly, in as few chips as
   *  possible. Used by MIN / MAX / CLEAR and by any external stake change. */
  reconcile: (amount: number) => void;
  /** Pointer handling for the surface. Coordinates are table-local. */
  grabAt: (x: number, y: number) => string | null;
  moveGrab: (x: number, y: number) => void;
  releaseGrab: (vx: number, vy: number) => void;
  isGrabbing: () => boolean;
  /** Which chip the finger currently holds. Asked of the world so the surface
   *  needs no ref of its own. */
  grabbedChipId: () => string | null;
  /** Knock the whole table — the accept moment. */
  jolt: (strength?: number) => void;
  /**
   * Point gravity somewhere else. The call out's payout uses it to pull the pot
   * toward whoever took it: the chips slide off one edge because they are
   * objects being pulled, which is the only reason to have a physics scene for
   * a payout at all.
   *
   * PRESENTATION ONLY, like every other member of this API. Gravity cannot
   * change `committed`, and `committed` is the only thing that adds up to money.
   * A locked table ignores the phone's tilt but still honours this, because this
   * is the app moving the world deliberately rather than a sensor doing it.
   */
  setGravity: (x: number, y: number) => void;
  /** 0..1, the energy of the last frame's biggest impact. Drives the shake. */
  shake: SharedValue<number>;
  /** Reduced motion / perf mode: real chips, no spin, bounce or shake. */
  calm: boolean;
  /** Device-tilt gravity: whether it is running, and how to ask for it. */
  motion: MotionState;
  requestMotion: () => void;
}

/**
 * HOW MANY BODIES ARE WORTH SIMULATING lives in domain/forge-duel.ts beside
 * `decompose`, the only thing that reads it. 60 discs with 10 position
 * iterations holds a 16.7ms frame with headroom, and a pot needing more than
 * that is better expressed in bigger chips anyway.
 */
let seq = 0;
const nextId = () => `chip_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export function useChipTable(opts: {
  /** The canonical stake this table must represent. */
  amount: number;
  /** Called when the table's own interactions change the stake. */
  onAmountChange: (next: number) => void;
  /** Chip denominations available. */
  denominations: readonly ForgeChipValue[];
  ownerId: string;
  side?: 'mine' | 'theirs';
  /**
   * Reduced motion or perf mode. The table STILL RUNS — see CALM in
   * chip-world.ts for why removing it was the wrong accommodation — it just
   * stops spinning, bouncing and shaking, and settles almost at once.
   */
  calm?: boolean;
  /** Perf mode also trims how many bodies are worth simulating. */
  maxBodies?: number;
  /** A locked pot is a picture: the phone stops steering it. */
  locked?: boolean;
}): ChipTableApi {
  const {
    amount,
    onAmountChange,
    denominations,
    ownerId,
    side = 'mine',
    calm = false,
    maxBodies = MAX_TABLE_BODIES,
    locked = false,
  } = opts;

  const [committed, setCommitted] = useState<CommittedChip[]>([]);
  const [size, setSizeState] = useState({ width: 0, height: 0 });
  const pose = useSharedValue<number[]>([]);
  const shake = useSharedValue(0);

  const world = useRef<ChipWorld | null>(null);
  const raf = useRef<number | null>(null);
  const lastFrame = useRef(0);
  const idleFrames = useRef(0);
  /** Mirrors of state for the callbacks that must not be rebuilt on every
   *  commit. Written from EFFECTS, never during render — a ref assigned in a
   *  render body is a render-time ref access, and the compiler lint is right
   *  to refuse it. */
  const sizeRef = useRef(size);
  const committedRef = useRef(committed);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  useEffect(() => {
    committedRef.current = committed;
  }, [committed]);
  /** The amount the TABLE last produced, so an external change can be told
   *  apart from our own and not trigger a rebuild of chips already flying. */
  const ownAmount = useRef(amount);

  // ── the world ───────────────────────────────────────────────────────────

  const onImpact = useCallback((impact: ChipImpact) => {
    // A key per impact location is enough to scope the cooldown without
    // threading body identity out of the world.
    playChipImpact(impact, `${Math.round(impact.x * 20)}`);
    chipImpactHaptic(impact.intensity);
    if (impact.intensity > 0.55) {
      // The table itself flinches. The scatter is REAL — this only amplifies it.
      shake.value = Math.max(shake.value, Math.min(1, impact.intensity));
    }
  }, [shake]);

  useEffect(() => {
    if (size.width < 40 || size.height < 40) return;
    const w = new ChipWorld({ width: size.width, height: size.height, onImpact, calm });
    world.current = w;
    primeChipAudio();
    // Re-seat whatever is already committed — a resize or a remount must not
    // empty a pot that React still says is full.
    for (const c of committedRef.current) {
      w.spawn({
        chipId: c.chipId,
        value: c.value,
        x: size.width * (0.25 + Math.random() * 0.5),
        y: size.height * 0.3 + Math.random() * 30,
        vy: 60,
      });
    }
    pose.value = [...w.poses()];
    return () => {
      w.destroy();
      if (world.current === w) world.current = null;
    };
    // `committed` is deliberately absent: the world is rebuilt on RESIZE, not
    // on every commit. Commits are pushed into the live world below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calm, size.width, size.height, onImpact]);

  useEffect(() => () => resetChipAudio(), []);

  // ── the loop ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!world.current) return;
    let active = true;
    let appActive = true;

    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      appActive = s === 'active';
      lastFrame.current = 0;
    });

    const tick = (t: number) => {
      if (!active) return;
      raf.current = requestAnimationFrame(tick);
      const w = world.current;
      if (!w || !appActive) return;
      const dt = lastFrame.current === 0 ? 16.7 : t - lastFrame.current;
      lastFrame.current = t;

      // SLEEP THE LOOP TOO, not just the bodies. Once a pile has settled the
      // engine has nothing to do, and stepping it anyway is a wasted frame
      // every 16ms for as long as the screen is open.
      if (!w.awake()) {
        idleFrames.current += 1;
        if (idleFrames.current > 6) {
          if (shake.value > 0.001) shake.value = shake.value * 0.82;
          return;
        }
      } else {
        idleFrames.current = 0;
      }

      w.step(dt);
      const p = w.poses();
      // ONE write per frame. Reanimated diffs the array on the UI thread and
      // every chip's worklet reads its own slice.
      pose.value = p.slice();
      if (shake.value > 0.001) shake.value = shake.value * 0.86;
    };

    raf.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      lastFrame.current = 0;
      sub.remove();
    };
  }, [size.width, size.height, pose, shake]);

  // ── commits ─────────────────────────────────────────────────────────────

  const commit = useCallback(
    (spec: {
      value: ForgeChipValue;
      x?: number;
      vx?: number;
      vy?: number;
      spin?: number;
      source?: CommittedChip['source'];
      stackId?: string;
    }) => {
      const chip: CommittedChip = {
        chipId: nextId(),
        value: spec.value,
        ownerId,
        side,
        source: spec.source ?? 'tap',
        stackId: spec.stackId ?? null,
        createdAt: Date.now(),
      };
      // THE MONEY MOVES FIRST, and immediately. The chip is still in the air
      // when the pot has already changed — physics is feedback, never the
      // source of the number.
      const next = ownAmount.current + spec.value;
      ownAmount.current = next;
      setCommitted((prev) => [...prev, chip]);
      onAmountChange(next);

      const w = world.current;
      const { width } = sizeRef.current;
      if (!w || width < 40) return;
      const r = chipRadius(spec.value);
      // A little scatter so a pour never lays down a perfect column. It is
      // purely visual: the VALUE was already decided above.
      const jitter = (n: number) => (Math.random() - 0.5) * n;
      if (spec.stackId) {
        // Onto the column, aligned and still — a stack is the one place the
        // jitter would be wrong, because a stack is precisely the absence of
        // scatter.
        w.stackChip({
          chipId: chip.chipId,
          value: spec.value,
          x: Math.min(width - r, Math.max(r, spec.x ?? width / 2)),
          y: -r,
          vy: 200,
          stackId: spec.stackId,
        });
      } else {
        w.spawn({
          chipId: chip.chipId,
          value: spec.value,
          x: Math.min(width - r, Math.max(r, (spec.x ?? width / 2) + jitter(26))),
          y: -r - Math.random() * 20,
          vx: (spec.vx ?? 0) + jitter(90),
          vy: spec.vy ?? 240 + Math.random() * 160,
          spin: (spec.spin ?? 0) + jitter(0.5),
        });
      }
      if (w.count() > maxBodies) {
        // Cap reached. Drop the OLDEST body — never the chip — so the pile
        // stops growing while the stake keeps every coin it was given.
        const oldest = w.ids()[0];
        if (oldest) w.remove(oldest);
      }
    },
    [onAmountChange, ownerId, side, maxBodies]
  );

  const takeBack = useCallback(
    (chipId: string) => {
      const chip = committedRef.current.find((c) => c.chipId === chipId);
      if (!chip) return;
      const next = Math.max(0, ownAmount.current - chip.value);
      ownAmount.current = next;
      setCommitted((prev) => prev.filter((c) => c.chipId !== chipId));
      onAmountChange(next);
      world.current?.remove(chipId);
    },
    [onAmountChange]
  );

  /**
   * RETURN A WHOLE STACK. Dragging one chip of a bonded column into the return
   * zone gives back every chip still attached to it — the athlete grabbed a
   * stack, so they get the stack's worth. A column that has already broken
   * returns only the chip they actually held, which is the honest answer.
   */
  const takeBackStack = useCallback(
    (chipId: string): number => {
      const ids = world.current?.stackMembers(chipId) ?? [chipId];
      const chips = committedRef.current.filter((c) => ids.includes(c.chipId));
      if (chips.length === 0) return 0;
      const total = chips.reduce((s, c) => s + c.value, 0);
      const next = Math.max(0, ownAmount.current - total);
      ownAmount.current = next;
      setCommitted((prev) => prev.filter((c) => !ids.includes(c.chipId)));
      onAmountChange(next);
      for (const id of ids) world.current?.remove(id);
      return total;
    },
    [onAmountChange]
  );

  const beginStack = useCallback(() => `stack_${Date.now().toString(36)}_${(seq++).toString(36)}`, []);
  const stackSize = useCallback((stackId: string) => world.current?.stackSize(stackId) ?? 0, []);

  /**
   * REPRESENT `amount` EXACTLY, from scratch.
   *
   * Used when the stake changes from outside the table (MIN, MAX, CLEAR, a
   * clamp, a restored draft). It rebuilds the pile rather than reconciling
   * chip by chip, because the pile is a PICTURE of the number and the number
   * is what has to survive.
   */
  const reconcile = useCallback(
    (next: number) => {
      ownAmount.current = next;
      const values = decompose(next, denominations);
      const chips: CommittedChip[] = values.map((v) => ({
        chipId: nextId(),
        value: v,
        ownerId,
        side,
        source: 'quick',
        stackId: null,
        createdAt: Date.now(),
      }));
      setCommitted(chips);
      const w = world.current;
      const { width } = sizeRef.current;
      if (!w || width < 40) return;
      w.clear();
      chips.forEach((c, i) => {
        const r = chipRadius(c.value);
        w.spawn({
          chipId: c.chipId,
          value: c.value,
          x: Math.min(width - r, Math.max(r, width * (0.28 + Math.random() * 0.44))),
          // Staggered above the table so they rain in rather than appearing
          // interpenetrating, which the solver would answer with an explosion.
          y: -r - i * (r * 1.9) - Math.random() * 12,
          vy: 120,
          spin: (Math.random() - 0.5) * 0.4,
        });
      });
    },
    [denominations, ownerId, side]
  );

  // An amount changed from OUTSIDE (a clamp, a parent reset) rebuilds the
  // table. Our own commits already moved `ownAmount`, so they no-op here.
  useEffect(() => {
    if (amount === ownAmount.current) return;
    reconcile(amount);
  }, [amount, reconcile]);

  // ── the phone is the table ──────────────────────────────────────────────

  /**
   * TILT STAYS ON UNDER REDUCED MOTION, just gentler.
   *
   * The first version switched it off there, reasoning that a sliding pile is
   * involuntary motion. That was the SAME mistake as hiding the whole table:
   * Tyson has reduced motion on, so tilt never ran for him at all — "tilts not
   * working". Deliberately tipping your own phone is about as user-initiated
   * as an input gets. Reduced motion now widens the dead zone and softens the
   * slope; MOTION PHYSICS in Settings is the real off switch.
   *
   * It IS off once the pot is locked: a settled result should not be stirred
   * by picking the phone up.
   */
  const onGravity = useCallback((g: { x: number; y: number }, wake: boolean) => {
    world.current?.setGravity(g.x, g.y, wake);
  }, []);
  const { state: motion, request: requestMotion } = useTiltGravity({
    baseGravity: baseGravityFor(calm),
    onGravity,
    enabled: !locked,
    gentle: calm,
  });

  // ── pointer ─────────────────────────────────────────────────────────────

  const grabAt = useCallback((x: number, y: number) => world.current?.grabAt(x, y) ?? null, []);
  const moveGrab = useCallback((x: number, y: number) => world.current?.moveGrab(x, y), []);
  const releaseGrab = useCallback((vx: number, vy: number) => world.current?.release(vx, vy), []);
  const isGrabbing = useCallback(() => world.current?.isGrabbing() ?? false, []);
  const grabbedChipId = useCallback(() => world.current?.grabbedChipId() ?? null, []);
  const jolt = useCallback((strength = 1) => {
    world.current?.jolt(strength);
    // The screen shake is the one thing calm mode drops entirely: the chips
    // moving is the athlete's own doing, the VIEWPORT moving is not.
    if (!calm) shake.value = Math.min(1, 0.5 * strength);
  }, [shake, calm]);

  const setGravity = useCallback((x: number, y: number) => {
    world.current?.setGravity(x, y, true);
  }, []);

  const setSize = useCallback((w: number, h: number) => {
    setSizeState((prev) =>
      Math.abs(prev.width - w) < 1 && Math.abs(prev.height - h) < 1 ? prev : { width: w, height: h }
    );
  }, []);

  return {
    committed,
    pose,
    setSize,
    size,
    commit,
    takeBack,
    takeBackStack,
    beginStack,
    stackSize,
    reconcile,
    grabAt,
    moveGrab,
    releaseGrab,
    isGrabbing,
    grabbedChipId,
    jolt,
    setGravity,
    shake,
    calm,
    motion,
    requestMotion,
  };
}

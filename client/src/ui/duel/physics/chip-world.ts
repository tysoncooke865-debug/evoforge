import {
  Bodies,
  Body,
  Composite,
  Constraint,
  Engine,
  Events,
  Query,
  Vector,
  type IEventCollision,
} from 'matter-js';

import type { ForgeChipValue } from '@/domain/forge-duel';

/**
 * THE CHIP TABLE — a real rigid-body world, and nothing else.
 *
 * NO REACT IN THIS FILE. It owns matter-js bodies, a step loop and a pose
 * buffer; it knows nothing about wagers, coins or components. That separation
 * is the load-bearing one in this feature: **the physics engine must never
 * decide what anything is worth**. A body can escape, go NaN, be destroyed by
 * a resize or vanish on a navigation, and the stake is unaffected, because the
 * stake lives in React state and this world only ever holds a `chipId` that
 * points back at it.
 *
 * WHY matter-js. It is pure JavaScript, so ONE code path runs in the Expo web
 * bundle (the shipping PWA) and in Hermes on a native build — no WASM to load,
 * no config plugin, no per-platform fallback. rapier is faster but is WASM
 * (awkward on native RN); planck is a Box2D port with much more ceremony for
 * what is, physically, a tray of discs; p2 is effectively unmaintained. Matter
 * also ships the two things this interaction actually needs and would be
 * painful to write: sleeping, and a spring constraint good enough to drag one
 * chip through a pile and have the pile answer.
 *
 * GRAVITY IS ON, and the table is read side-on. The brief asks for piles that
 * form, collapse and can be smashed — that is a gravity behaviour. A top-down
 * table (gravity 0, friction-only) gives lovely sliding and no piles at all.
 */

// ── the feel ──────────────────────────────────────────────────────────────
//
// These are tuned values, not defaults, and most of them were changed away
// from matter's defaults deliberately. A poker chip is a heavy, grippy,
// almost-dead disc: it lands with a clack and STAYS there. Matter out of the
// box gives you a bouncy marble.
export const CHIP_PHYSICS = {
  /** 0.9 = matter's default look. Chips are heavier than that reads. */
  gravityY: 1.35,
  /** Ceramic on felt barely rebounds. Above ~0.35 chips read as rubber. */
  restitution: 0.18,
  /** Chip-on-chip grip. This is what lets a pile hold its shape. */
  friction: 0.55,
  frictionStatic: 0.85,
  /** Stands in for air + table drag. Also damps spin, so a flicked chip
   *  stops spinning as it settles instead of whirling forever. */
  frictionAir: 0.028,
  /** Walls are grippier still — a chip should not skate along the rim. */
  wallFriction: 0.7,
  wallRestitution: 0.12,
  /** Solver: stacking discs needs position iterations more than velocity. */
  positionIterations: 10,
  velocityIterations: 8,
  constraintIterations: 4,
  /** Frames of near-stillness before a body sleeps. Low enough that a big
   *  pile goes quiet quickly; high enough that a slow roll is not frozen. */
  sleepThreshold: 26,
  /** Nothing may move faster than this per step. A hard flick on a fast
   *  screen can otherwise tunnel a chip through a wall. */
  maxSpeed: 34,
  maxSpin: 0.85,
  /** The grab spring. Soft enough that the held chip lags the finger (which
   *  is what makes it feel like an object rather than a cursor), stiff enough
   *  to shove a pile aside. */
  grabStiffness: 0.09,
  grabDamping: 0.16,
} as const;

/** Radius in px. Deliberately a narrow range — the brief's rule is that a 250
 *  feels more substantial, not that it is a different object. */
const RADIUS: Readonly<Record<ForgeChipValue, number>> = {
  5: 15, 10: 15.5, 25: 16, 50: 16.5, 100: 17, 250: 17.5, 500: 18,
};

/** Density, and therefore mass and therefore impact energy. A 500 hits about
 *  twice as hard as a 5 at the same speed — noticeable, never unfair. */
const DENSITY: Readonly<Record<ForgeChipValue, number>> = {
  5: 0.0016, 10: 0.0018, 25: 0.0021, 50: 0.0024, 100: 0.0027, 250: 0.0031, 500: 0.0035,
};

export const chipRadius = (v: ForgeChipValue): number => RADIUS[v] ?? 16;

export interface ChipImpact {
  /** 0..1, normalised collision energy. Drives audio AND haptics. */
  intensity: number;
  /** Table x of the impact, for stereo placement. */
  x: number;
  /** The heavier of the two bodies involved, for timbre. */
  value: ForgeChipValue;
  /** A rim hit sounds different from a chip hit. */
  againstWall: boolean;
}

export interface ChipSpawn {
  chipId: string;
  value: ForgeChipValue;
  x: number;
  y: number;
  /** px per second — the gesture's own units. Converted internally. */
  vx?: number;
  vy?: number;
  spin?: number;
}

interface ChipEntry {
  chipId: string;
  value: ForgeChipValue;
  body: Body;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const finite = (n: number) => Number.isFinite(n);
/** Gesture velocity arrives in px/second; matter integrates in px/step. */
const toStep = (pxPerSec: number) => clamp(pxPerSec / 60, -CHIP_PHYSICS.maxSpeed, CHIP_PHYSICS.maxSpeed);

export class ChipWorld {
  private engine: Engine;
  private walls: Body[] = [];
  private chips: ChipEntry[] = [];
  private grab: Constraint | null = null;
  private grabbed: Body | null = null;
  private width: number;
  private height: number;
  private onImpact: (impact: ChipImpact) => void;
  /** Poses, flat: [x, y, angle, x, y, angle, …] in `chips` order. Written in
   *  place every step so the render layer reads one buffer, never N objects. */
  private pose: number[] = [];
  private disposed = false;

  constructor(opts: {
    width: number;
    height: number;
    onImpact: (impact: ChipImpact) => void;
  }) {
    this.width = opts.width;
    this.height = opts.height;
    this.onImpact = opts.onImpact;

    this.engine = Engine.create({
      enableSleeping: true,
      positionIterations: CHIP_PHYSICS.positionIterations,
      velocityIterations: CHIP_PHYSICS.velocityIterations,
      constraintIterations: CHIP_PHYSICS.constraintIterations,
    });
    this.engine.gravity.y = CHIP_PHYSICS.gravityY;
    // matter reads this off the prototype; setting it per-body does nothing.
    (this.engine as unknown as { sleepThreshold?: number }).sleepThreshold =
      CHIP_PHYSICS.sleepThreshold;

    this.buildWalls();

    Events.on(this.engine, 'collisionStart', (e: IEventCollision<Engine>) => {
      this.reportImpacts(e);
    });
  }

  // ── the room ────────────────────────────────────────────────────────────

  /**
   * Four static walls matching the visible pot. The ceiling sits well ABOVE
   * the box: a hard flick should be able to arc out of sight and drop back in,
   * which reads as a throw. It just must not escape the simulation.
   */
  private buildWalls() {
    const t = 60;
    const w = this.width;
    const h = this.height;
    const opts = {
      isStatic: true,
      friction: CHIP_PHYSICS.wallFriction,
      restitution: CHIP_PHYSICS.wallRestitution,
      label: 'wall',
    };
    this.walls = [
      Bodies.rectangle(w / 2, h + t / 2, w + t * 2, t, opts),      // floor
      Bodies.rectangle(-t / 2, h / 2, t, h * 3, opts),             // left
      Bodies.rectangle(w + t / 2, h / 2, t, h * 3, opts),          // right
      Bodies.rectangle(w / 2, -h - t / 2, w + t * 2, t, opts),     // far ceiling
    ];
    Composite.add(this.engine.world, this.walls);
  }

  resize(width: number, height: number) {
    if (this.disposed) return;
    if (Math.abs(width - this.width) < 1 && Math.abs(height - this.height) < 1) return;
    this.width = width;
    this.height = height;
    Composite.remove(this.engine.world, this.walls);
    this.buildWalls();
    // Anything now outside the new room is put back rather than deleted — a
    // rotation must never cost somebody a chip.
    for (const c of this.chips) this.containBody(c.body);
  }

  // ── chips ───────────────────────────────────────────────────────────────

  spawn(spec: ChipSpawn) {
    if (this.disposed) return;
    const r = chipRadius(spec.value);
    const body = Bodies.circle(clamp(spec.x, r, this.width - r), spec.y, r, {
      restitution: CHIP_PHYSICS.restitution,
      friction: CHIP_PHYSICS.friction,
      frictionStatic: CHIP_PHYSICS.frictionStatic,
      frictionAir: CHIP_PHYSICS.frictionAir,
      density: DENSITY[spec.value] ?? 0.002,
      label: 'chip',
      // A circle is a circle: the collision shape IS the artwork, so there is
      // no invisible rectangular hitbox to feel through.
      slop: 0.02,
    });
    Body.setVelocity(body, { x: toStep(spec.vx ?? 0), y: toStep(spec.vy ?? 0) });
    Body.setAngularVelocity(body, clamp(spec.spin ?? 0, -CHIP_PHYSICS.maxSpin, CHIP_PHYSICS.maxSpin));
    Composite.add(this.engine.world, body);
    this.chips.push({ chipId: spec.chipId, value: spec.value, body });
    this.pose.push(body.position.x, body.position.y, body.angle);
  }

  remove(chipId: string) {
    const i = this.chips.findIndex((c) => c.chipId === chipId);
    if (i < 0) return;
    if (this.grabbed === this.chips[i].body) this.release(0, 0);
    Composite.remove(this.engine.world, this.chips[i].body);
    this.chips.splice(i, 1);
    this.pose.splice(i * 3, 3);
  }

  clear() {
    this.release(0, 0);
    for (const c of this.chips) Composite.remove(this.engine.world, c.body);
    this.chips = [];
    this.pose = [];
  }

  /** The ids currently simulated, in pose order. */
  ids(): string[] {
    return this.chips.map((c) => c.chipId);
  }

  count(): number {
    return this.chips.length;
  }

  // ── holding one ─────────────────────────────────────────────────────────

  /**
   * Grab whatever is under the point. A CONSTRAINT, not a position write:
   * teleporting a body every frame gives it no momentum, so it passes through
   * a pile instead of shoving it, and it flies off on release with whatever
   * velocity the last two frames happened to imply.
   */
  grabAt(x: number, y: number): string | null {
    if (this.disposed) return null;
    const hits = Query.point(this.chips.map((c) => c.body), { x, y });
    if (hits.length === 0) return null;
    // Topmost = most recently added among the overlaps, which is what a finger
    // expects when chips are piled on each other.
    const body = hits[hits.length - 1];
    const entry = this.chips.find((c) => c.body === body);
    if (!entry) return null;
    this.grabbed = body;
    Body.setStatic(body, false);
    Body.set(body, 'isSleeping', false);
    this.grab = Constraint.create({
      pointA: { x, y },
      bodyB: body,
      pointB: Vector.sub({ x, y }, body.position),
      stiffness: CHIP_PHYSICS.grabStiffness,
      damping: CHIP_PHYSICS.grabDamping,
      length: 0,
    });
    Composite.add(this.engine.world, this.grab);
    return entry.chipId;
  }

  moveGrab(x: number, y: number) {
    if (!this.grab) return;
    this.grab.pointA = { x: clamp(x, -40, this.width + 40), y: clamp(y, -this.height, this.height + 40) };
  }

  /** Let go, handing the body the finger's own velocity. */
  release(vx: number, vy: number) {
    if (this.grab) {
      Composite.remove(this.engine.world, this.grab);
      this.grab = null;
    }
    if (this.grabbed) {
      const b = this.grabbed;
      const v = { x: toStep(vx), y: toStep(vy) };
      if (Math.abs(v.x) + Math.abs(v.y) > 0.4) {
        Body.setVelocity(b, v);
        // A thrown disc spins in the direction it was flung.
        Body.setAngularVelocity(b, clamp(v.x * 0.04, -CHIP_PHYSICS.maxSpin, CHIP_PHYSICS.maxSpin));
      }
      this.grabbed = null;
    }
  }

  isGrabbing(): boolean {
    return this.grab !== null;
  }

  /** Which chip the finger is holding. The WORLD owns this, so the surface
   *  needs no ref of its own — a ref read while building a gesture handler is
   *  a ref read during render. */
  grabbedChipId(): string | null {
    if (!this.grabbed) return null;
    return this.chips.find((c) => c.body === this.grabbed)?.chipId ?? null;
  }

  /** The whole table takes a knock — the accept moment, and the amplifier on a
   *  hard smash. Real bodies, real impulse; the shake is only the echo. */
  jolt(strength = 1) {
    for (const c of this.chips) {
      Body.set(c.body, 'isSleeping', false);
      Body.setVelocity(c.body, {
        x: c.body.velocity.x + (Math.random() - 0.5) * 3.2 * strength,
        y: c.body.velocity.y - Math.random() * 3.6 * strength,
      });
      Body.setAngularVelocity(c.body, c.body.angularVelocity + (Math.random() - 0.5) * 0.3 * strength);
    }
  }

  // ── the loop ────────────────────────────────────────────────────────────

  /**
   * One step. `dtMs` is clamped hard: a backgrounded tab hands back a delta of
   * several seconds, and matter integrating that in one go explodes the world.
   */
  step(dtMs: number) {
    if (this.disposed) return;
    Engine.update(this.engine, clamp(dtMs, 8, 32));
    for (let i = 0; i < this.chips.length; i++) {
      const b = this.chips[i].body;
      if (!finite(b.position.x) || !finite(b.position.y) || !finite(b.angle)) {
        this.rebuild(i);
        continue;
      }
      this.containBody(b);
      const p = i * 3;
      this.pose[p] = b.position.x;
      this.pose[p + 1] = b.position.y;
      this.pose[p + 2] = b.angle;
    }
  }

  poses(): readonly number[] {
    return this.pose;
  }

  /** True while anything is still moving — lets the caller idle the loop. */
  awake(): boolean {
    if (this.grab) return true;
    for (const c of this.chips) if (!c.body.isSleeping) return true;
    return false;
  }

  wake() {
    for (const c of this.chips) Body.set(c.body, 'isSleeping', false);
  }

  // ── keeping it honest ───────────────────────────────────────────────────

  /**
   * FAIL-SAFE. A chip that has left the room, or whose position has gone NaN,
   * is put back — never deleted, because deleting it would make the visible
   * pile disagree with the stake. The wager value is untouched by everything
   * in this method.
   */
  private containBody(b: Body) {
    const r = b.circleRadius ?? 16;
    const x = b.position.x;
    const y = b.position.y;
    const out =
      x < -r * 3 || x > this.width + r * 3 || y > this.height + r * 6 || y < -this.height * 4;
    if (!out) return;
    Body.setPosition(b, { x: clamp(x, r, this.width - r), y: clamp(y, r, this.height - r) });
    Body.setVelocity(b, { x: 0, y: 0 });
    Body.setAngularVelocity(b, 0);
  }

  private rebuild(index: number) {
    const entry = this.chips[index];
    if (!entry) return;
    Composite.remove(this.engine.world, entry.body);
    const r = chipRadius(entry.value);
    const body = Bodies.circle(this.width / 2, this.height - r * 2, r, {
      restitution: CHIP_PHYSICS.restitution,
      friction: CHIP_PHYSICS.friction,
      frictionStatic: CHIP_PHYSICS.frictionStatic,
      frictionAir: CHIP_PHYSICS.frictionAir,
      density: DENSITY[entry.value] ?? 0.002,
      label: 'chip',
    });
    Composite.add(this.engine.world, body);
    entry.body = body;
    if (__DEV__) {
      console.warn(`[chip-world] rebuilt an unstable body for ${entry.chipId}; wager value untouched.`);
    }
  }

  // ── impacts ─────────────────────────────────────────────────────────────

  /**
   * Turn matter's collision pairs into a small number of ENERGY readings.
   *
   * Not one event per pair: a settling pile reports dozens of near-zero
   * contacts per frame, and forwarding those is how you get a machine-gun.
   * Intensity is relative normal speed × the lighter mass, normalised — the
   * physically meaningful quantity, and the one that makes a 500 smashing a
   * stack sound different from a 5 nudging one.
   */
  private reportImpacts(e: IEventCollision<Engine>) {
    for (const pair of e.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const aChip = a.label === 'chip';
      const bChip = b.label === 'chip';
      if (!aChip && !bChip) continue;

      const rel = Vector.sub(a.velocity, b.velocity);
      const normal = pair.collision?.normal ?? { x: 0, y: 1 };
      const speed = Math.abs(rel.x * normal.x + rel.y * normal.y);
      if (!finite(speed) || speed < 0.55) continue;

      const chipBody = aChip ? a : b;
      const other = aChip ? b : a;
      const againstWall = !(aChip && bChip);
      const mass = againstWall ? chipBody.mass : Math.min(chipBody.mass, other.mass);
      // 3.4 is the reference energy of a firm flick landing on a bare floor;
      // it puts an ordinary throw around 0.5 and a real smash at 1.
      const intensity = clamp((speed * mass) / 3.4, 0, 1);
      if (intensity < 0.045) continue;

      const heavier = this.valueOf(againstWall ? chipBody : (a.mass >= b.mass ? a : b));
      this.onImpact({
        intensity,
        x: clamp(chipBody.position.x / Math.max(1, this.width), 0, 1),
        value: heavier,
        againstWall,
      });
    }
  }

  private valueOf(body: Body): ForgeChipValue {
    return this.chips.find((c) => c.body === body)?.value ?? 25;
  }

  destroy() {
    this.disposed = true;
    Events.off(this.engine, 'collisionStart');
    this.clear();
    Composite.clear(this.engine.world, false, true);
    Engine.clear(this.engine);
  }
}

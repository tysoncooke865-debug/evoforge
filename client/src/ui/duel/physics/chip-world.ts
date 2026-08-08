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
  /** Stack bonds. Stiff enough to hold a column upright through a gentle
   *  placement, soft enough that it leans before it breaks. */
  bondStiffness: 0.42,
  bondDamping: 0.22,
  /** How far two bonded chips may drift apart, as a multiple of their resting
   *  separation, before the bond gives up. 1.5 lets a stack visibly lean and
   *  buckle first — snapping at 1.05 reads as a stack that teleports apart. */
  bondBreak: 1.5,
  /**
   * A hard enough impact breaks a bond outright, however aligned it still
   * looks — this is what makes a thrown chip SHATTER a stack rather than
   * nudging a rubbery column.
   *
   * 7.5 was far too low and the browser showed why: a stack LANDING has the
   * lower chip stop dead while the upper one is still moving, so every bond
   * snapped on contact with the floor and a "stack" was five chips scattered
   * in a line. A landing is not a smash. 18 is comfortably above any drop and
   * still below a thrown 250.
   */
  bondBreakSpeed: 18,
  /**
   * Centre-to-centre spacing in a stack, as a multiple of the mean radius.
   *
   * 0.55 means stack members OVERLAP — each chip sits about a third of a chip
   * above the last, which is what a stack of poker chips looks like from the
   * front and is the only geometry that can actually stand up.
   *
   * The long way round to this number is worth recording. First 1.86 —
   * "slightly closer than touching" — which for two circles is
   * INTERPENETRATING, so the solver flung them apart and snapped the bond that
   * had just been made. Then 2.05, resting them exactly in contact, which
   * built a beautiful column that then toppled every single time within about
   * two seconds. That is not a bug: a stack of discs balanced edge-to-edge is
   * an inverted pendulum on a POINT contact, and no amount of bond stiffness
   * makes one stand (0.42 through 1.0 were all measured; all fell). Stiffening
   * the links only turns five wobbling chips into one rigid falling rod.
   *
   * Overlapping fixes it because it changes the shape of the problem: eight
   * chips are then 70px tall rather than 260px, and a squat pile stands where
   * a tower cannot. It needs the collision group below to work.
   */
  bondGap: 0.55,
} as const;

/** A physical stack, not a spreadsheet. Beyond this a column is a novelty
 *  that falls over before it is finished. */
export const MAX_STACK = 8;

/**
 * HOW STRONGLY THE BOTTOM CHIP RESISTS ROLLING.
 *
 * A real poker chip lies FLAT on the table: it has a face on the surface and
 * will not roll. A 2D circle has a point contact and always rolls, which is
 * why every earlier attempt at a standing stack fell over — nothing resisted
 * rotation about the base. Multiplying the base chip's inertia models the flat
 * chip. FINITE, not infinite: with rotation locked outright the stack stood
 * perfectly and then slid across the table as one rigid brick under tilt,
 * never toppling. A large but beatable number stands still under its own
 * weight and gives way to a real shove.
 */
export const STACK_BASE_INERTIA = 60;

/** How hard a stack's base chip grips the table. See the note in spawn(). */
export const STACK_BASE_GRIP = 2.2;

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

/**
 * CALM MODE — reduced motion, WITHOUT deleting the feature.
 *
 * The first version disabled the simulation entirely when the OS asked for
 * less motion, and Tyson (who has the setting on) got the old static pile:
 * "section 4 looks the same, just with sound now". That was the wrong
 * accommodation, and this codebase already says so — settings-store's own
 * doctrine is that the motion flags "disable AMBIENT LOOPS ONLY", because
 * skipping user-initiated animation is how toasts became invisible.
 *
 * `prefers-reduced-motion` is a request about VESTIBULAR SAFETY: large, fast,
 * involuntary motion the person did not ask for. A chip an athlete threw, into
 * a box they are looking at, is none of those things. So calm mode keeps every
 * chip real and takes away the parts that could actually make somebody queasy:
 * no spin, no bounce, no table shake, weaker gravity, and enough drag that
 * everything is at rest almost immediately.
 */
const CALM = {
  gravityY: 0.7,
  restitution: 0.02,
  frictionAir: 0.09,
  maxSpin: 0,
} as const;

/** The downward gravity a table rests at when the phone is at its neutral
 *  angle. The tilt layer needs it to build a vector around. */
export const baseGravityFor = (calm: boolean): number =>
  calm ? CALM.gravityY : CHIP_PHYSICS.gravityY;

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
  /** Bond this chip to the top of an existing stack. */
  stackId?: string | null;
  /** Negative matter collision group: stack members pass through each other. */
  group?: number;
  /** The chip resting ON THE TABLE cannot roll — see the note in spawn(). */
  lockRotation?: boolean;
}

interface ChipEntry {
  chipId: string;
  value: ForgeChipValue;
  body: Body;
  /** Which stack this chip belongs to, while it still belongs to one. */
  stackId: string | null;
  /** True while this chip is the pinned base of a standing stack. */
  pinned: boolean;
  /** Rotational inertia as matter computed it, kept so a chip freed from a
   *  stack can tumble again. */
  inertia: number;
}

/**
 * A BOND between two chips in a stack.
 *
 * TWO constraints, not one. A single point-to-point link between two circles
 * is a hinge: the upper chip swings off the lower one the moment anything
 * touches it. A PAIR of links, offset to either side, resists relative
 * rotation as well as separation, which is what turns two discs into a
 * column that can lean as a unit before it goes.
 *
 * And they BREAK. A stack that cannot come apart is a tall sprite pretending
 * to be physics — the whole point is that a tilt, a shove or a thrown 250
 * turns it back into loose chips.
 */
interface StackBond {
  stackId: string;
  a: Body;
  b: Body;
  left: Constraint;
  right: Constraint;
  rest: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const finite = (n: number) => Number.isFinite(n);
/** Gesture velocity arrives in px/second; matter integrates in px/step. */
const toStep = (pxPerSec: number) => clamp(pxPerSec / 60, -CHIP_PHYSICS.maxSpeed, CHIP_PHYSICS.maxSpeed);

export class ChipWorld {
  private engine: Engine;
  private walls: Body[] = [];
  private chips: ChipEntry[] = [];
  private bonds: StackBond[] = [];
  /** stackId → matter collision group. Negative groups never self-collide. */
  private groups = new Map<string, number>();
  private nextGroup = 0;
  private grab: Constraint | null = null;
  private grabbed: Body | null = null;
  private width: number;
  private height: number;
  private onImpact: (impact: ChipImpact) => void;
  private calm: boolean;
  private baseInertia: number;
  private baseGrip: number;
  private bondStiffness: number;
  /** Poses, flat: [x, y, angle, x, y, angle, …] in `chips` order. Written in
   *  place every step so the render layer reads one buffer, never N objects. */
  private pose: number[] = [];
  private disposed = false;

  constructor(opts: {
    width: number;
    height: number;
    onImpact: (impact: ChipImpact) => void;
    /** Reduced motion or perf mode: real chips, none of the whipping about. */
    calm?: boolean;
    /** Roll resistance of a stack's base chip. An option so the headless
     *  physics test can sweep it. */
    baseInertia?: number;
    /** Grip of a stack's base chip on the table. Same reason. */
    baseGrip?: number;
    /** Stack bond stiffness. Swept by the headless physics test. */
    bondStiffness?: number;
  }) {
    this.width = opts.width;
    this.height = opts.height;
    this.onImpact = opts.onImpact;
    this.calm = opts.calm ?? false;
    this.baseInertia = opts.baseInertia ?? STACK_BASE_INERTIA;
    this.baseGrip = opts.baseGrip ?? STACK_BASE_GRIP;
    this.bondStiffness = opts.bondStiffness ?? CHIP_PHYSICS.bondStiffness;

    this.engine = Engine.create({
      enableSleeping: true,
      positionIterations: CHIP_PHYSICS.positionIterations,
      velocityIterations: CHIP_PHYSICS.velocityIterations,
      constraintIterations: CHIP_PHYSICS.constraintIterations,
    });
    this.engine.gravity.y = this.calm ? CALM.gravityY : CHIP_PHYSICS.gravityY;
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

  /**
   * THE PHONE TILTED. Hand the engine a different gravity vector and let it
   * do the work — no sprite is moved, no impulse is faked, the pile simply
   * finds itself on a slope.
   *
   * `wake` is separate from the value because a settled pile must not be
   * woken by sensor noise: the caller only sets it when the vector has really
   * moved, and a sleeping chip that is genuinely downhill is woken by its
   * neighbour's contact anyway.
   */
  setGravity(x: number, y: number, wake: boolean) {
    if (this.disposed) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.engine.gravity.x = x;
    this.engine.gravity.y = y;
    /**
     * TILT THE TABLE FAR ENOUGH AND A FLAT CHIP STOPS HOLDING.
     *
     * The base of a standing stack is pinned against rolling, which is what
     * lets a stack stand at all. Keep that pin under a real lean and the stack
     * becomes immovable — it slid across the table as one brick and never came
     * apart, at every bond stiffness and every grip value measured. Releasing
     * the pin past a threshold is the model's way of saying the chip has lost
     * its purchase, and it is what turns a tilt into an avalanche instead of a
     * conveyor belt. Once released it stays released: a toppled stack does not
     * get to stand back up on its own.
     */
    if (Math.abs(x) > 0.55) this.unpinStacks();
    if (wake) this.wake();
  }

  private unpinStacks() {
    for (const c of this.chips) {
      if (!c.pinned) continue;
      c.pinned = false;
      Body.setInertia(c.body, c.inertia);
      c.body.friction = CHIP_PHYSICS.friction;
      c.body.frictionStatic = CHIP_PHYSICS.frictionStatic;
      Body.set(c.body, 'isSleeping', false);
    }
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
      restitution: this.calm ? CALM.restitution : CHIP_PHYSICS.restitution,
      friction: CHIP_PHYSICS.friction,
      frictionStatic: CHIP_PHYSICS.frictionStatic,
      frictionAir: this.calm ? CALM.frictionAir : CHIP_PHYSICS.frictionAir,
      density: DENSITY[spec.value] ?? 0.002,
      label: 'chip',
      // A circle is a circle: the collision shape IS the artwork, so there is
      // no invisible rectangular hitbox to feel through.
      slop: 0.02,
      // THE KEY IS OMITTED, not set to undefined. matter merges these options
      // over its defaults, and an explicit `collisionFilter: undefined`
      // replaces the default filter with nothing — then the broadphase reads
      // `.group` off it and every chip in the world throws. Spreading a
      // conditional object leaves the default alone.
      ...(spec.group ? { collisionFilter: { group: spec.group, category: 1, mask: 0xffffffff } } : {}),
    });
    Body.setVelocity(body, { x: toStep(spec.vx ?? 0), y: toStep(spec.vy ?? 0) });
    const spinCap = this.calm ? CALM.maxSpin : CHIP_PHYSICS.maxSpin;
    Body.setAngularVelocity(body, clamp(spec.spin ?? 0, -spinCap, spinCap));
    Composite.add(this.engine.world, body);
    this.chips.push({
      chipId: spec.chipId,
      value: spec.value,
      body,
      stackId: spec.stackId ?? null,
      pinned: Boolean(spec.stackId && spec.lockRotation),
      inertia: body.inertia,
    });
    /**
     * A CHIP IN A STACK DOES NOT ROLL, and that is not a cheat.
     *
     * A real poker chip on a table lies FLAT: it has a face resting on the
     * surface and will not roll away. A 2D circle has a point contact and
     * always rolls, which is why every attempt at a standing stack fell over —
     * there was nothing to resist rotation about the base. Locking rotation
     * while a chip is stacked models the flat chip, and it is released the
     * moment the bond breaks, so a scattered stack tumbles like anything else.
     */
    if (spec.stackId && spec.lockRotation) {
      Body.setInertia(body, body.inertia * this.baseInertia);
      /**
       * AND IT GRIPS. A chip lying flat on felt does not slide easily, while a
       * chip balanced on its edge does — so the base holds while the chips
       * above it are pushed sideways by a tilt. That difference is the entire
       * source of shear: without it the stack simply slid across the table as
       * one brick and never came apart, whatever the bonds were set to.
       */
      body.friction = this.baseGrip;
      body.frictionStatic = this.baseGrip * 1.4;
    }
    this.pose.push(body.position.x, body.position.y, body.angle);
  }

  // ── stacks ──────────────────────────────────────────────────────────────

  /**
   * ADD A CHIP TO THE TOP OF A STACK, and bond it there.
   *
   * The new chip is placed just above whatever is currently highest in that
   * stack and linked to it, so a held tray chip builds a column one tick at a
   * time. The FIRST chip of a stack is an ordinary spawn — a stack of one is
   * a chip.
   */
  stackChip(spec: ChipSpawn & { stackId: string }): void {
    if (this.disposed) return;
    const members = this.chips.filter((c) => c.stackId === spec.stackId);
    if (members.length >= MAX_STACK) {
      // The column is as tall as it is going to get. Further chips land loose
      // beside it rather than becoming an improbable tower.
      this.spawn({ ...spec, stackId: null });
      return;
    }
    // MEMBERS OF ONE STACK DO NOT COLLIDE WITH EACH OTHER. A negative
    // collision group is matter's own way of saying "these overlap freely",
    // and it is what lets a stack be drawn the way a stack of chips actually
    // looks — each chip a third of a chip above the last — instead of a tower
    // of touching discs that cannot stand. They still collide with every other
    // chip, every wall and every other stack.
    const group = this.groupFor(spec.stackId);
    if (members.length === 0) {
      // THE BASE IS LAID ON THE FLOOR, not dropped from the ceiling. Building
      // downward-falling columns meant chips two and three spawned while the
      // base was still in mid-air, and the whole stack arrived as a collision
      // rather than a stack. A person building a pile of chips starts with one
      // on the table.
      const r = chipRadius(spec.value);
      this.spawn({
        ...spec,
        x: clamp(spec.x, r + 2, this.width - r - 2),
        y: this.height - r - 2,
        vx: 0,
        vy: 0,
        spin: 0,
        stackId: spec.stackId,
        group,
        // Only the BASE is pinned against rolling. Locking every member made a
        // stack that stood beautifully and then slid across the table as one
        // rigid brick under tilt, never toppling. The chips above need their
        // rotation so the column can shear, lean and come apart.
        lockRotation: true,
      });
      return;
    }
    // Highest = smallest y.
    const top = members.reduce((best, c) => (c.body.position.y < best.body.position.y ? c : best));
    const r = chipRadius(spec.value);
    const topR = top.body.circleRadius ?? r;
    const gap = (r + topR) * (CHIP_PHYSICS.bondGap / 2);
    this.spawn({
      ...spec,
      x: top.body.position.x,
      y: top.body.position.y - gap,
      vx: 0,
      vy: 0,
      spin: 0,
      stackId: spec.stackId,
      group,
    });
    const added = this.chips[this.chips.length - 1];
    if (added) this.bond(spec.stackId, top.body, added.body, gap);
  }

  /** A stable negative group per stack id. Negative groups never collide with
   *  themselves, which is exactly the licence a stack needs to overlap. */
  private groupFor(stackId: string): number {
    let g = this.groups.get(stackId);
    if (g === undefined) {
      this.nextGroup -= 1;
      g = this.nextGroup;
      this.groups.set(stackId, g);
    }
    return g;
  }

  /** Two offset links, so the pair resists rotation as well as separation. */
  private bond(stackId: string, a: Body, b: Body, rest: number) {
    const off = (a.circleRadius ?? 16) * 0.62;
    const make = (dx: number) =>
      Constraint.create({
        bodyA: a,
        pointA: { x: dx, y: -rest / 2 },
        bodyB: b,
        pointB: { x: dx, y: rest / 2 },
        stiffness: this.bondStiffness,
        damping: CHIP_PHYSICS.bondDamping,
        length: 0,
      });
    const left = make(-off);
    const right = make(off);
    Composite.add(this.engine.world, [left, right]);
    this.bonds.push({ stackId, a, b, left, right, rest });
  }

  /** Every chip still bonded to this one, itself included. Used to return a
   *  whole stack when one of its chips is dragged out. */
  stackMembers(chipId: string): string[] {
    const entry = this.chips.find((c) => c.chipId === chipId);
    if (!entry) return [];
    if (!entry.stackId) return [chipId];
    return this.chips.filter((c) => c.stackId === entry.stackId).map((c) => c.chipId);
  }

  stackSize(stackId: string): number {
    return this.chips.filter((c) => c.stackId === stackId).length;
  }

  /**
   * BONDS GIVE WAY. Checked every step: a bond whose ends have drifted too far
   * apart, or that just took a hard hit, is removed and its chips become
   * ordinary loose bodies. Nothing about this is animated — the column leans
   * because the constraints stretch, and it collapses because they stop
   * existing.
   */
  private updateBonds() {
    if (this.bonds.length === 0) return;
    const survivors: StackBond[] = [];
    for (const bond of this.bonds) {
      const d = Vector.magnitude(Vector.sub(bond.a.position, bond.b.position));
      const rel = Vector.magnitude(Vector.sub(bond.a.velocity, bond.b.velocity));
      const broken = !finite(d) || d > bond.rest * CHIP_PHYSICS.bondBreak || rel > CHIP_PHYSICS.bondBreakSpeed;
      if (broken) {
        Composite.remove(this.engine.world, bond.left);
        Composite.remove(this.engine.world, bond.right);
        // Both ends leave the stack. A half-bonded chip that still counts as a
        // stack member would be returned with a stack it is no longer part of.
        for (const c of this.chips) {
          if (c.body === bond.a || c.body === bond.b) {
            c.stackId = null;
            // BACK TO BEING AN ORDINARY CHIP: it collides with its former
            // neighbours again (or a broken stack would ghost through itself
            // forever) and it can roll again.
            c.body.collisionFilter.group = 0;
            c.pinned = false;
            Body.setInertia(c.body, c.inertia);
            c.body.friction = CHIP_PHYSICS.friction;
            c.body.frictionStatic = CHIP_PHYSICS.frictionStatic;
          }
        }
        continue;
      }
      survivors.push(bond);
    }
    this.bonds = survivors;
  }

  /** Free a chip and its immediate neighbours from their stack — the impact
   *  path, as opposed to the geometric one in updateBonds. */
  private shatter(body: Body) {
    const touched: Body[] = [];
    for (const b of this.bonds) {
      if (b.a === body || b.b === body) {
        touched.push(b.a, b.b);
      }
    }
    if (touched.length === 0) return;
    this.dropBondsFor(body);
    for (const c of this.chips) {
      if (!touched.includes(c.body)) continue;
      c.stackId = null;
      c.pinned = false;
      c.body.collisionFilter.group = 0;
      Body.setInertia(c.body, c.inertia);
      c.body.friction = CHIP_PHYSICS.friction;
      c.body.frictionStatic = CHIP_PHYSICS.frictionStatic;
      Body.set(c.body, 'isSleeping', false);
    }
  }

  private dropBondsFor(body: Body) {
    const keep: StackBond[] = [];
    for (const b of this.bonds) {
      if (b.a === body || b.b === body) {
        Composite.remove(this.engine.world, b.left);
        Composite.remove(this.engine.world, b.right);
      } else keep.push(b);
    }
    this.bonds = keep;
  }

  remove(chipId: string) {
    const i = this.chips.findIndex((c) => c.chipId === chipId);
    if (i < 0) return;
    if (this.grabbed === this.chips[i].body) this.release(0, 0);
    this.dropBondsFor(this.chips[i].body);
    Composite.remove(this.engine.world, this.chips[i].body);
    this.chips.splice(i, 1);
    this.pose.splice(i * 3, 3);
  }

  clear() {
    this.release(0, 0);
    for (const b of this.bonds) {
      Composite.remove(this.engine.world, b.left);
      Composite.remove(this.engine.world, b.right);
    }
    this.bonds = [];
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
        // A thrown disc spins in the direction it was flung — except in calm
        // mode, where spin is the one thing most likely to be unwelcome.
        const spinCap = this.calm ? CALM.maxSpin : CHIP_PHYSICS.maxSpin;
        Body.setAngularVelocity(b, clamp(v.x * 0.04, -spinCap, spinCap));
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
    // Calm mode still gets a knock — the pot locking should be FELT — but a
    // quarter of one, and without adding spin.
    const s = this.calm ? strength * 0.25 : strength;
    for (const c of this.chips) {
      Body.set(c.body, 'isSleeping', false);
      Body.setVelocity(c.body, {
        x: c.body.velocity.x + (Math.random() - 0.5) * 3.2 * s,
        y: c.body.velocity.y - Math.random() * 3.6 * s,
      });
      if (!this.calm) {
        Body.setAngularVelocity(c.body, c.body.angularVelocity + (Math.random() - 0.5) * 0.3 * s);
      }
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
    this.updateBonds();
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
    // A body being reconstructed cannot stay bonded — its constraints point at
    // an object that is about to stop existing.
    this.dropBondsFor(entry.body);
    entry.stackId = null;
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
    // `typeof` guarded: this file is deliberately React-free so it can be
    // driven headlessly by its own test, where __DEV__ does not exist.
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
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
      // THE REFERENCE ENERGY, calibrated rather than guessed. It was 3.4,
      // which a chip drifting at 2px/step already saturated — every impact
      // came out at 1.0, so the audio engine could not tell a nudge from a
      // smash and the whole intensity model was decorative. A 25 chip massing
      // ~1.7 at a hard 20px/step is ~34, so 26 puts an ordinary landing near
      // 0.2, a firm throw near 0.6 and a real smash at the ceiling.
      const intensity = clamp((speed * mass) / 26, 0, 1);
      if (intensity < 0.045) continue;

      // A HARD HIT BREAKS A STACK. Relying on the bond stretching was not
      // enough: the base of a stack is pinned and grips the table, so a chip
      // thrown into it barely moved the pair apart and the column shrugged off
      // a 500 at full speed. The energy model already knows what a smash is,
      // so it is the thing that decides.
      if (intensity > 0.5) {
        this.shatter(chipBody);
        if (!againstWall) this.shatter(other);
      }

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

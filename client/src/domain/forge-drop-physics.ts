/**
 * THE FALL — believable, and a replay rather than a simulation.
 *
 * The server already decided where this puck lands (155). A physics engine let
 * loose on a peg board would land it somewhere else, and nudging one until it
 * agreed would be a rigged simulation pretending to be an honest one. So the
 * motion is DERIVED from the server's path: real arcs, real bounce timing, real
 * acceleration — following the route that was already taken.
 *
 * That is the honest version of "the animation reproduces the server result",
 * and it has a property a physics engine cannot offer: it is a pure function,
 * so the whole fall is unit-testable without a canvas, a frame or a hand.
 *
 * Units are BOARD UNITS, not pixels: x in columns (0 … rows), y in rows
 * (0 … rows + 1). The view scales them, so the same trajectory is correct on a
 * 320px phone and a 900px desktop.
 */

export interface DropKeyframe {
  /** Seconds from the start of the fall. */
  t: number;
  /** Column, in board units. Fractional between pegs. */
  x: number;
  /** Row, in board units. Increases downward, like the screen. */
  y: number;
  /** 0 at the peg, rising to 1 at the top of the hop after it — the view uses
   *  it to squash the puck on impact and to spark the peg it just hit. */
  bounce: number;
  /** The peg index this keyframe struck, or null between pegs. */
  peg: number | null;
  /** Degrees of rotation. A token that falls without turning reads as a
   *  sprite being moved; one that turns reads as an object. */
  spin: number;
}

export interface DropTrajectory {
  frames: DropKeyframe[];
  /** Total seconds. The result is announced when this elapses — never before,
   *  and never on a timer that could outrun the server. */
  duration: number;
  /** Where it ends up. Always the server's slot. */
  slot: number;
}

/**
 * THE ROWS ARE NOT EQUAL LENGTHS OF TIME.
 *
 * A constant 0.22s per row made a twelve-row board a 2.9 second animation in
 * which every row felt the same — too long to repeat in a gym, and with all
 * its tension spread evenly across a fall that has none until the end.
 *
 * So the puck ACCELERATES like a falling object through the upper board and is
 * then deliberately held back over the last few rows, where the outcome is
 * nearly decided and the athlete is actually watching. Total is about 1.8s.
 */
const ROW_FAST = 0.105;
/** The last rows stretch out. Index from the BOTTOM: [last, last-1, last-2]. */
const ROW_SLOW_TAIL = [0.235, 0.185, 0.145];
/** A held breath after the final peg, before it commits to a slot. */
const ANTICIPATION_SECONDS = 0.085;
/** A short settle in the slot at the end, so the puck lands rather than stops. */
const SETTLE_SECONDS = 0.22;
/** Sub-steps per row. Enough that the arc reads as an arc. */
const STEPS_PER_ROW = 7;

/** How far the puck may stray sideways between two pegs, in columns. It always
 *  returns to the exact peg column, so this is texture and never a route. */
const WOBBLE = 0.16;

/** Seconds this row takes. */
function rowSeconds(row: number, rows: number): number {
  const fromEnd = rows - 1 - row;
  return fromEnd < ROW_SLOW_TAIL.length ? ROW_SLOW_TAIL[fromEnd] : ROW_FAST;
}

/**
 * DETERMINISTIC "RANDOMNESS", from the path itself.
 *
 * Two drops down the same route must animate identically — a replay that
 * differed run to run would not be a replay. So the variation that makes each
 * fall feel unrepeatable is derived by hashing the route, never sampled from
 * `Math.random()`. Unpredictable to a person, fixed to a test.
 */
function seedOf(columns: readonly number[]): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < columns.length; i += 1) {
    h ^= (columns[i] + 1) * (i + 7);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A signed value in about [-1, 1] for this seed and step. */
function jitter(seed: number, n: number): number {
  const x = Math.sin((seed % 1000) * 12.9898 + n * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * BUILD THE FALL.
 *
 * `columns` is the puck's column at each peg row — `columnsFor` in
 * domain/forge-drop.ts derives it from the server's path, and refuses when the
 * path and the paid slot disagree.
 *
 * Between two pegs the puck follows a parabola: it is deflected sideways at the
 * peg and accelerates downward under gravity, so it moves fastest just before
 * the next peg. That is what makes it read as a falling object rather than an
 * interpolation, and it is the only "physics" this needs.
 */
export function buildTrajectory(columns: readonly number[]): DropTrajectory {
  if (columns.length === 0) return { frames: [], duration: 0, slot: 0 };
  const frames: DropKeyframe[] = [];
  const rows = columns.length - 1;
  const seed = seedOf(columns);
  const maxColumn = rows;

  let t = 0;
  let spin = 0;

  for (let row = 0; row < rows; row += 1) {
    const from = columns[row];
    const to = columns[row + 1];
    const dir = Math.sign(to - from) || 1;
    const secs = rowSeconds(row, rows);

    // FRICTION. The sideways liveliness bleeds out as the puck descends, so
    // the top of the board is skittish and the bottom is committed.
    const damping = 1 - (row / Math.max(1, rows)) * 0.72;
    const wobble = WOBBLE * damping * (0.55 + 0.45 * Math.abs(jitter(seed, row)));

    // A slightly different bounce angle off every peg: some deflections kick
    // hard and settle, others drift across. Bounded so no route is unreadable.
    const kick = 0.55 + 0.45 * ((jitter(seed, row * 3 + 1) + 1) / 2);

    for (let sIdx = 0; sIdx < STEPS_PER_ROW; sIdx += 1) {
      const u = sIdx / STEPS_PER_ROW;

      // Sideways: eased out of the peg, because the deflection happens AT the
      // peg and bleeds away as it falls, plus a small arc that is exactly zero
      // at both ends — so the puck strays but always meets the next peg where
      // the ledger says it did.
      const base = from + (to - from) * easeOutKick(u, kick);
      const stray = wobble * Math.sin(Math.PI * u) * dir;
      const x = clamp(base + stray, 0, maxColumn);

      // Downward: u², gravity. Fastest just before the next peg.
      const y = row + u * u;

      // Rotation follows the deflection and slows with the same friction, so a
      // puck that kicks left spins left.
      // SUBTLE. The first tuning accumulated 5-10 degrees per sub-step, which
      // over twelve rows is several full revolutions — the token read as
      // spinning rather than tumbling, and the stake printed on it became
      // unreadable. Tracking which chip is which matters more than the flourish,
      // so this is about a third of that: a slow turn, and a number you can
      // still read while it falls.
      spin += dir * (1.7 + 1.4 * Math.abs(to - from)) * damping;

      frames.push({
        t: t + u * secs,
        x,
        y,
        bounce: sIdx === 0 ? 1 : Math.max(0, 1 - u * 2),
        peg: sIdx === 0 ? row : null,
        spin,
      });
    }
    t += secs;
  }

  const last = columns[columns.length - 1];

  // THE FINAL PEG, then a held breath. The pause is short and it is the only
  // place the puck is allowed to nearly stop — it is what turns a fall into a
  // result about to be announced.
  frames.push({ t, x: last, y: rows, bounce: 1, peg: rows - 1, spin });
  t += ANTICIPATION_SECONDS;
  frames.push({ t, x: last, y: rows + 0.06, bounce: 0.15, peg: null, spin: spin + 2 });

  // Into the slot, and a small settle so it arrives rather than stops dead.
  frames.push({ t: t + SETTLE_SECONDS * 0.45, x: last, y: rows + 0.72, bounce: 0.35, peg: null, spin: spin + 6 });
  frames.push({ t: t + SETTLE_SECONDS, x: last, y: rows + 0.55, bounce: 0, peg: null, spin: spin + 8 });

  return { frames, duration: t + SETTLE_SECONDS, slot: last };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The deflection curve off a peg. `kick` leans it between a hard early throw
 * and a lazier drift, which is what stops twelve collisions in a row from
 * looking like twelve copies of the same collision.
 */
function easeOutKick(u: number, kick: number): number {
  const c = clamp(u, 0, 1);
  const soft = Math.sin((c * Math.PI) / 2);
  const hard = 1 - (1 - c) * (1 - c);
  return soft * (1 - kick) + hard * kick;
}

function easeOutSine(u: number): number {
  return Math.sin((Math.min(1, Math.max(0, u)) * Math.PI) / 2);
}

/**
 * WHERE THE PUCK IS AT TIME `t`.
 *
 * Linear between keyframes: the keyframes already carry the curve, so this only
 * has to walk them. Past the end it holds the final frame — a late frame must
 * never send the puck somewhere the ledger did not put it.
 */
export function puckAt(trajectory: DropTrajectory, t: number): DropKeyframe {
  const { frames } = trajectory;
  if (frames.length === 0) return { t: 0, x: 0, y: 0, bounce: 0, peg: null, spin: 0 };
  if (t <= frames[0].t) return frames[0];
  const end = frames[frames.length - 1];
  if (t >= end.t) return end;
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const span = b.t - a.t;
  const u = span <= 0 ? 0 : (t - a.t) / span;
  return {
    t,
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    bounce: a.bounce + (b.bounce - a.bounce) * u,
    peg: u < 0.5 ? a.peg : b.peg,
    spin: a.spin + (b.spin - a.spin) * u,
  };
}

/**
 * THE PEG GRID.
 *
 * Row `r` has `r + 1`… no: this board is a lattice, not a triangle — every row
 * has the same pegs, offset by half a column on odd rows, which is what makes a
 * left/right decision at each one. Returned in board units for the view.
 */
export function pegPositions(rows: number): { x: number; y: number; row: number }[] {
  const out: { x: number; y: number; row: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    const offset = row % 2 === 0 ? 0 : 0.5;
    for (let col = 0; col <= rows; col += 1) {
      const x = col + offset;
      if (x > rows) continue;
      out.push({ x, y: row + 0.5, row });
    }
  }
  return out;
}

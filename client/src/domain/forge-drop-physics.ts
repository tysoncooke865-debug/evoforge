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
}

export interface DropTrajectory {
  frames: DropKeyframe[];
  /** Total seconds. The result is announced when this elapses — never before,
   *  and never on a timer that could outrun the server. */
  duration: number;
  /** Where it ends up. Always the server's slot. */
  slot: number;
}

/** One peg row takes this long to fall through. Eight rows ≈ 1.8s, which is
 *  long enough to watch and short enough that nobody is waiting on it. */
const ROW_SECONDS = 0.22;
/** A short settle in the slot at the end, so the puck lands rather than stops. */
const SETTLE_SECONDS = 0.28;
/** Sub-steps per row. Enough that the arc reads as an arc. */
const STEPS_PER_ROW = 6;

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

  for (let row = 0; row < rows; row += 1) {
    const from = columns[row];
    const to = columns[row + 1];
    for (let s = 0; s < STEPS_PER_ROW; s += 1) {
      const u = s / STEPS_PER_ROW;
      frames.push({
        t: (row + u) * ROW_SECONDS,
        // Sideways: eased out of the peg, because the deflection happens AT the
        // peg and bleeds away as it falls.
        x: from + (to - from) * easeOutSine(u),
        // Downward: u², gravity. Fastest just before the next peg.
        y: row + u * u,
        bounce: s === 0 ? 1 : Math.max(0, 1 - u * 2),
        peg: s === 0 ? row : null,
      });
    }
  }

  // Into the slot, and a small settle so it arrives rather than stops dead.
  const last = columns[columns.length - 1];
  const landAt = rows * ROW_SECONDS;
  frames.push({ t: landAt, x: last, y: rows, bounce: 1, peg: rows - 1 });
  frames.push({ t: landAt + SETTLE_SECONDS * 0.45, x: last, y: rows + 0.72, bounce: 0.35, peg: null });
  frames.push({ t: landAt + SETTLE_SECONDS, x: last, y: rows + 0.55, bounce: 0, peg: null });

  return { frames, duration: landAt + SETTLE_SECONDS, slot: last };
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
  if (frames.length === 0) return { t: 0, x: 0, y: 0, bounce: 0, peg: null };
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

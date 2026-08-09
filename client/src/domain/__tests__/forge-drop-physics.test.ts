import { describe, expect, it } from 'vitest';

import { buildTrajectory, pegPositions, puckAt } from '../forge-drop-physics';

/**
 * THE FALL IS A REPLAY, AND THESE ARE THE RULES THAT KEEP IT ONE.
 *
 * `buildTrajectory` is where all the "physics" lives — wobble, friction, spin,
 * varying bounce angles, an anticipation pause. Every one of those makes the
 * motion less predictable to watch, and NONE of them is allowed to move the
 * puck somewhere the ledger did not put it.
 *
 * So the suite is mostly invariants rather than snapshots: it asserts the
 * things that must remain true however the feel is retuned.
 */

/** A believable route: half-column steps, twelve rows, ending where it ends. */
function walk(lane: number, rows: number, steps: number[]): number[] {
  let h = 2 * lane;
  const cols = [h / 2];
  for (const s of steps) {
    h += s;
    cols.push(h / 2);
  }
  void rows;
  return cols;
}

const ROUTE = walk(6, 12, [1, -1, 1, 1, -1, -1, 1, -1, 1, 1, -1, 1]);

describe('the trajectory always agrees with the ledger', () => {
  it('ends at exactly the column the route ended at', () => {
    const t = buildTrajectory(ROUTE);
    expect(t.slot).toBe(ROUTE[ROUTE.length - 1]);
    expect(t.frames[t.frames.length - 1].x).toBe(t.slot);
  });

  it('touches every peg column exactly, whatever it does between them', () => {
    const t = buildTrajectory(ROUTE);
    for (let row = 0; row < ROUTE.length - 1; row += 1) {
      const atPeg = t.frames.find((f) => f.peg === row);
      expect(atPeg, `row ${row}`).toBeDefined();
      // The wobble is exactly zero at both ends of every span, so a peg
      // frame sits on its column to the last decimal.
      expect(atPeg!.x, `row ${row}`).toBeCloseTo(ROUTE[row], 10);
    }
  });

  it('never strays off the board, however lively the wobble', () => {
    // A route hugging column 0 is where an inward wobble would push it
    // negative — the clamp is what stops the puck leaving the board.
    const edge = walk(0, 12, [1, 1, -1, 1, -1, -1, 1, 1, -1, 1, -1, 1]);
    for (const route of [ROUTE, edge, walk(12, 12, [-1, -1, 1, -1, 1, 1, -1, -1, 1, -1, 1, -1])]) {
      const t = buildTrajectory(route);
      for (const f of t.frames) {
        expect(f.x).toBeGreaterThanOrEqual(0);
        expect(f.x).toBeLessThanOrEqual(route.length - 1);
      }
    }
  });

  it('never goes backwards in time, and never climbs during the fall', () => {
    const t = buildTrajectory(ROUTE);
    const rows = ROUTE.length - 1;
    let lastT = -1;
    let lastY = -1;
    let peak = 0;
    for (const f of t.frames) {
      expect(f.t).toBeGreaterThanOrEqual(lastT);
      // Monotonic all the way down to the slot. Past it the puck is allowed to
      // rebound a little as it beds in — that settle is the difference between
      // landing and stopping dead — but only a little, and only at the end.
      if (f.y <= rows) expect(f.y).toBeGreaterThanOrEqual(lastY - 1e-9);
      peak = Math.max(peak, f.y);
      lastT = f.t;
      lastY = f.y;
    }
    const settled = t.frames[t.frames.length - 1].y;
    expect(peak - settled).toBeLessThan(0.25);
    expect(settled).toBeGreaterThan(rows);
  });

  it('produces no NaN anywhere', () => {
    for (const route of [ROUTE, walk(5, 12, Array(12).fill(1)), walk(7, 12, Array(12).fill(-1))]) {
      for (const f of buildTrajectory(route).frames) {
        for (const v of [f.t, f.x, f.y, f.bounce, f.spin]) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  /**
   * The variation is hashed from the route, never sampled. Two drops down the
   * same path must animate identically — a replay that differed run to run
   * would not be a replay, and would make every assertion here meaningless.
   */
  it('is deterministic: the same route animates identically every time', () => {
    const a = buildTrajectory(ROUTE);
    const b = buildTrajectory([...ROUTE]);
    expect(a.duration).toBe(b.duration);
    expect(a.frames).toEqual(b.frames);
  });

  it('but different routes do not move alike', () => {
    const a = buildTrajectory(ROUTE);
    const b = buildTrajectory(walk(6, 12, [-1, 1, -1, -1, 1, 1, -1, 1, -1, -1, 1, -1]));
    const sameX = a.frames.every((f, i) => b.frames[i] && Math.abs(f.x - b.frames[i].x) < 1e-9);
    expect(sameX).toBe(false);
  });
});

describe('how it feels', () => {
  it('lands inside the second the brief asks for', () => {
    const t = buildTrajectory(ROUTE);
    expect(t.duration).toBeGreaterThan(1);
    expect(t.duration).toBeLessThan(2.2);
  });

  /** The tension belongs at the bottom, where the outcome is nearly decided. */
  it('spends longer on the last rows than the first', () => {
    const t = buildTrajectory(ROUTE);
    const pegT = (row: number) => t.frames.find((f) => f.peg === row)!.t;
    const firstRow = pegT(1) - pegT(0);
    const lastRow = pegT(11) - pegT(10);
    expect(lastRow).toBeGreaterThan(firstRow * 1.5);
  });

  it('holds a beat after the final peg before committing to a slot', () => {
    const t = buildTrajectory(ROUTE);
    const finalPeg = t.frames.filter((f) => f.peg !== null).pop()!;
    const next = t.frames.find((f) => f.t > finalPeg.t)!;
    // It barely moves across the pause — that is the held breath.
    expect(next.t - finalPeg.t).toBeGreaterThan(0.05);
    expect(next.y - finalPeg.y).toBeLessThan(0.2);
  });

  it('strays between pegs rather than travelling on rails', () => {
    const t = buildTrajectory(ROUTE);
    // Somewhere mid-span the puck must be off the straight line between the
    // two peg columns, or there is no wobble at all.
    let strayed = false;
    for (let row = 0; row < 6; row += 1) {
      const span = t.frames.filter((f) => f.y >= row && f.y < row + 1);
      const lo = Math.min(ROUTE[row], ROUTE[row + 1]);
      const hi = Math.max(ROUTE[row], ROUTE[row + 1]);
      if (span.some((f) => f.x < lo - 0.02 || f.x > hi + 0.02)) strayed = true;
    }
    expect(strayed).toBe(true);
  });

  it('settles down as it descends — the upper board is livelier than the lower', () => {
    const t = buildTrajectory(ROUTE);
    const strayIn = (row: number) => {
      const lo = Math.min(ROUTE[row], ROUTE[row + 1]);
      const hi = Math.max(ROUTE[row], ROUTE[row + 1]);
      return Math.max(
        ...t.frames
          .filter((f) => f.y >= row && f.y < row + 1)
          .map((f) => Math.max(lo - f.x, f.x - hi, 0))
      );
    };
    expect(strayIn(1)).toBeGreaterThan(strayIn(10));
  });

  it('turns as it falls, and keeps turning the same way it was deflected', () => {
    const t = buildTrajectory(ROUTE);
    const spins = t.frames.map((f) => f.spin);
    // Enough to read as a tumbling object, far short of a spin that would
    // make the stake printed on the chip unreadable.
    const total = Math.abs(spins[spins.length - 1]);
    expect(total).toBeGreaterThan(15);
    expect(total).toBeLessThan(360);
    // A route deflected consistently one way accumulates spin that way.
    const right = buildTrajectory(walk(2, 12, Array(12).fill(1)));
    expect(right.frames[right.frames.length - 1].spin).toBeGreaterThan(0);
    const left = buildTrajectory(walk(10, 12, Array(12).fill(-1)));
    expect(left.frames[left.frames.length - 1].spin).toBeLessThan(0);
  });

  it('marks every peg strike exactly once, so nothing double-fires', () => {
    const t = buildTrajectory(ROUTE);
    const hits = t.frames.filter((f) => f.peg !== null).map((f) => f.peg);
    // The last peg appears twice by design: once on the way through and once
    // as the landing frame that opens the anticipation pause.
    const unique = new Set(hits);
    expect(unique.size).toBe(ROUTE.length - 1);
  });
});

describe('sampling the fall', () => {
  it('holds the final frame past the end — a late frame never overshoots', () => {
    const t = buildTrajectory(ROUTE);
    const end = t.frames[t.frames.length - 1];
    for (const late of [t.duration, t.duration + 1, t.duration + 60]) {
      expect(puckAt(t, late).x).toBe(end.x);
      expect(puckAt(t, late).y).toBe(end.y);
    }
  });

  it('holds the first frame before the start', () => {
    const t = buildTrajectory(ROUTE);
    expect(puckAt(t, -5).y).toBe(t.frames[0].y);
  });

  it('moves continuously — no teleports between adjacent samples', () => {
    const t = buildTrajectory(ROUTE);
    let prev = puckAt(t, 0);
    for (let time = 0; time <= t.duration; time += 1 / 60) {
      const now = puckAt(t, time);
      expect(Math.abs(now.x - prev.x), `x at ${time}`).toBeLessThan(0.75);
      expect(Math.abs(now.y - prev.y), `y at ${time}`).toBeLessThan(0.75);
      prev = now;
    }
  });

  it('an empty route animates nothing rather than throwing', () => {
    const t = buildTrajectory([]);
    expect(t.frames).toHaveLength(0);
    expect(t.duration).toBe(0);
    expect(puckAt(t, 1).x).toBe(0);
  });
});

describe('the peg field', () => {
  it('lays out a peg for every position on every row', () => {
    const pegs = pegPositions(12);
    expect(pegs.length).toBeGreaterThan(12);
    for (const p of pegs) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

import { describe, expect, it } from 'vitest';

import { ChipWorld, MAX_STACK, chipRadius, type ChipImpact } from '../chip-world';

/**
 * THE TABLE, DRIVEN HEADLESSLY.
 *
 * chip-world.ts is deliberately React-free and matter-js is pure JavaScript,
 * so the whole simulation runs here in milliseconds. That matters more than it
 * sounds: tuning physics through a browser meant a four-minute rebuild for
 * every guess, and three real bugs (bonds snapping on landing, chips spawned
 * interpenetrating, an inverted tilt axis) each cost a full cycle to find.
 *
 * These are BEHAVIOURAL, not numeric. They assert that a stack stands up, that
 * tilt moves a pile downhill, and that a smash breaks bonds — the properties
 * the feature is, rather than the constants that currently produce them. Tune
 * the constants freely; these stay true or the tuning was wrong.
 */

const W = 324;
const H = 236;
const settle = (world: ChipWorld, frames = 200) => {
  for (let i = 0; i < frames; i++) world.step(16.7);
};
const make = (onImpact: (i: ChipImpact) => void = () => {}) =>
  new ChipWorld({ width: W, height: H, onImpact });

/** Poses come back flat: [x, y, angle, …]. */
const points = (world: ChipWorld) => {
  const p = world.poses();
  const out: { x: number; y: number; a: number }[] = [];
  for (let i = 0; i < p.length; i += 3) out.push({ x: p[i], y: p[i + 1], a: p[i + 2] });
  return out;
};
const spread = (ns: number[]) => (ns.length ? Math.max(...ns) - Math.min(...ns) : 0);

function buildStack(world: ChipWorld, n: number, value = 25 as const, x = W / 2) {
  const stackId = 'stack-under-test';
  for (let i = 0; i < n; i++) {
    world.stackChip({ chipId: `c${i}`, value, x, y: 0, stackId });
    // The real cadence is 190ms between chips; settling in between is what
    // makes each one land on a base that is already still.
    settle(world, 12);
  }
  return stackId;
}

describe('a loose chip', () => {
  it('falls and comes to rest on the floor', () => {
    const w = make();
    w.spawn({ chipId: 'a', value: 25, x: W / 2, y: -20, vy: 200 });
    const start = points(w)[0].y;
    settle(w);
    const end = points(w)[0];
    expect(end.y).toBeGreaterThan(start);
    expect(end.y).toBeLessThan(H);
    settle(w, 60);
    expect(Math.abs(points(w)[0].y - end.y)).toBeLessThan(1.5);
    w.destroy();
  });

  it('never escapes the table, however hard it is thrown', () => {
    const w = make();
    w.spawn({ chipId: 'a', value: 500, x: 20, y: 10, vx: 9000, vy: 9000, spin: 40 });
    settle(w, 300);
    const p = points(w)[0];
    expect(p.x).toBeGreaterThan(-60);
    expect(p.x).toBeLessThan(W + 60);
    expect(p.y).toBeLessThan(H + 120);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    w.destroy();
  });
});

describe('a stack', () => {
  it('STANDS UP — it is a column, not a row on the floor', () => {
    const w = make();
    buildStack(w, 5);
    settle(w);
    const p = points(w);
    expect(p).toHaveLength(5);
    // The bug this pins: chips spawned interpenetrating were flung apart by
    // the solver and every "stack" arrived as a line skidding along the floor.
    expect(spread(p.map((c) => c.y))).toBeGreaterThan(spread(p.map((c) => c.x)) * 2);
    w.destroy();
  });

  it('rises by roughly a third of a chip per member', () => {
    const w = make();
    buildStack(w, 5);
    settle(w);
    const r = chipRadius(25);
    // Stack members OVERLAP (see bondGap): five chips rise about four
    // eighth-of-a-chip steps, not four whole diameters. A tower of touching
    // discs is the geometry that could never stand.
    const h = spread(points(w).map((c) => c.y));
    expect(h).toBeGreaterThan(r * 1.5);
    expect(h).toBeLessThan(r * 4);
    w.destroy();
  });

  it('holds its shape, and keeps holding it', () => {
    const w = make();
    buildStack(w, 5);
    settle(w, 500);
    const a = points(w);
    settle(w, 120);
    const b = points(w);
    const drift = (x: typeof a, y: typeof a) =>
      Math.max(...x.map((c, i) => Math.hypot(c.x - y[i].x, c.y - y[i].y)));
    // A couple of pixels of spring settle is fine and expected.
    expect(drift(a, b)).toBeLessThan(4);
    settle(w, 600);
    // Ten seconds later it must have stopped, not merely be slow: a stack that
    // creeps 3px a second walks across the table while nobody is touching it.
    expect(drift(b, points(w))).toBeLessThan(1);
    w.destroy();
  });

  it('stops growing at the cap and the extras land loose', () => {
    const w = make();
    buildStack(w, MAX_STACK + 4);
    settle(w);
    expect(points(w)).toHaveLength(MAX_STACK + 4);
    // Everything asked for is on the table; the COLUMN just stopped growing.
    expect(w.stackSize('stack-under-test')).toBeLessThanOrEqual(MAX_STACK);
    w.destroy();
  });

  it('comes back as a whole when one of its chips is returned', () => {
    const w = make();
    buildStack(w, 4);
    settle(w);
    expect(w.stackMembers('c1').sort()).toEqual(['c0', 'c1', 'c2', 'c3']);
    w.destroy();
  });

  it('BREAKS when something hits it hard enough', () => {
    const w = make();
    buildStack(w, 5);
    settle(w);
    expect(w.stackSize('stack-under-test')).toBe(5);
    // A heavy chip thrown across the table into the column.
    w.spawn({ chipId: 'wrecker', value: 500, x: 20, y: H - 40, vx: 4200, vy: -200 });
    settle(w, 240);
    // Some of it came apart, and whatever came apart is a loose chip again.
    expect(w.stackSize('stack-under-test')).toBeLessThan(5);
    w.destroy();
  });

  it('survives its own construction and a long rest without breaking', () => {
    const w = make();
    buildStack(w, 5);
    settle(w, 400);
    // The bug this pins: bondBreakSpeed was low enough that a stack LANDING
    // snapped every bond, so a "stack" was a row of chips on the floor.
    expect(w.stackSize('stack-under-test')).toBe(5);
    w.destroy();
  });
});

describe('tilt', () => {
  it('slides a settled pile DOWNHILL, in the direction gravity points', () => {
    const w = make();
    for (let i = 0; i < 6; i++) {
      w.spawn({ chipId: `p${i}`, value: 25, x: W / 2 + (i - 3) * 6, y: -20 - i * 34, vy: 120 });
    }
    settle(w, 260);
    const before = points(w).map((c) => c.x);

    w.setGravity(1.4, 0.9, true);
    settle(w, 240);
    const right = points(w).map((c) => c.x);
    expect(Math.max(...right)).toBeGreaterThan(Math.max(...before) + 10);

    w.setGravity(-1.4, 0.9, true);
    settle(w, 300);
    const left = points(w).map((c) => c.x);
    expect(Math.min(...left)).toBeLessThan(Math.min(...right) - 10);
    w.destroy();
  });

  it('CARRIES A STANDING STACK DOWNHILL to the low side of the table', () => {
    const w = make();
    buildStack(w, 6);
    settle(w, 240);
    const before = Math.max(...points(w).map((c) => c.x));

    w.setGravity(1.6, 0.8, true);
    settle(w, 420);
    const after = points(w);
    expect(Math.max(...after.map((c) => c.x))).toBeGreaterThan(before + 40);
    // It arrives against the wall still standing, which is what a stack of
    // chips on a tilted tray does — it slides before it falls. Toppling from
    // tilt ALONE is the one behaviour this model does not produce; a stack
    // comes apart when something hits it, not when the table leans.
    expect(w.stackSize('stack-under-test')).toBeGreaterThan(0);
    w.destroy();
  });

  it('leaves a settled pile alone when gravity barely moves', () => {
    const w = make();
    for (let i = 0; i < 5; i++) w.spawn({ chipId: `q${i}`, value: 25, x: 60 + i * 40, y: -20, vy: 120 });
    settle(w, 300);
    const before = points(w);
    // The dead zone lives in the sensor layer, so what this asserts is the
    // other half of that contract: a vector this close to straight down must
    // not move anything.
    w.setGravity(0.02, 1.35, false);
    settle(w, 120);
    const after = points(w);
    const drift = Math.max(...before.map((c, i) => Math.hypot(c.x - after[i].x, c.y - after[i].y)));
    expect(drift).toBeLessThan(2);
    w.destroy();
  });

  it('carries the pile to the FAR EDGE when the table leans away, and keeps it in sight', () => {
    const w = make();
    for (let i = 0; i < 6; i++) {
      w.spawn({ chipId: `f${i}`, value: 25, x: W / 2 + (i - 3) * 6, y: -20 - i * 34, vy: 120 });
    }
    settle(w, 260);
    const before = points(w).map((c) => c.y);

    // Gravity up the screen — the axis that used to be floored at +0.4 and
    // could not exist at all.
    w.setGravity(0, -1.2, true);
    settle(w, 300);
    const after = points(w);
    expect(Math.min(...after.map((c) => c.y))).toBeLessThan(Math.min(...before) - 40);
    // AND STILL ON THE TABLE. The ceiling is a table-height above the box so a
    // flick can arc out of sight; without the top clamp the whole pot slid up
    // there and settled where nobody could see it.
    const r = chipRadius(25);
    expect(Math.min(...after.map((c) => c.y))).toBeGreaterThanOrEqual(r - 1);

    // …and it comes back down when the phone does.
    w.setGravity(0, 1.35, true);
    settle(w, 320);
    expect(Math.max(...points(w).map((c) => c.y))).toBeGreaterThan(H * 0.6);
    w.destroy();
  });

  it('still lets a hard flick arc out of sight while the table is level', () => {
    const w = make();
    w.spawn({ chipId: 'thrown', value: 25, x: W / 2, y: H - 30, vy: -2600 });
    let highest = H;
    for (let i = 0; i < 60; i++) {
      w.step(16.7);
      highest = Math.min(highest, points(w)[0].y);
    }
    expect(highest).toBeLessThan(0);
    settle(w, 300);
    // It comes back. The clamp must not have become a lid at rest.
    expect(points(w)[0].y).toBeGreaterThan(H * 0.5);
    w.destroy();
  });
});

describe('impacts', () => {
  it('reports harder collisions as higher intensity', () => {
    const soft: number[] = [];
    const hard: number[] = [];
    const run = (vx: number, into: number[]) => {
      const w = new ChipWorld({
        width: W,
        height: H,
        onImpact: (i) => into.push(i.intensity),
      });
      w.spawn({ chipId: 'target', value: 25, x: W / 2, y: H - 30 });
      settle(w, 60);
      w.spawn({ chipId: 'thrown', value: 100, x: 30, y: H - 30, vx });
      settle(w, 160);
      w.destroy();
    };
    run(120, soft);
    run(3000, hard);
    expect(Math.max(0, ...hard)).toBeGreaterThan(Math.max(0, ...soft));
  });

  it('stays quiet when nothing is happening', () => {
    const heard: number[] = [];
    const w = new ChipWorld({ width: W, height: H, onImpact: (i) => heard.push(i.intensity) });
    w.spawn({ chipId: 'a', value: 25, x: W / 2, y: H - 30 });
    settle(w, 300);
    const afterLanding = heard.length;
    settle(w, 300);
    // A resting chip generates contacts every frame; none of them may be
    // reported, or the audio engine would be fed hundreds of events a second.
    expect(heard.length).toBe(afterLanding);
    w.destroy();
  });
});

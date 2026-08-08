import { describe, expect, it } from 'vitest';

import {
  TILT,
  accelerationGravity,
  orientationGravity,
  orientationLeanDeg,
  tiltGravity,
  toScreenAxes,
} from '../tilt-math';

/**
 * WHICH WAY IS DOWNHILL — as arithmetic, not as a phone in a hand.
 *
 * Two defects live here, and both were invisible to every other kind of test.
 * The tilt arrived REVERSED on the device Tyson actually uses (WebKit reports
 * the gravity vector where the spec reports proper acceleration — the exact
 * negative), and the VERTICAL axis did nothing at all, because gravity was
 * floored at +0.4 down and could never point up the screen.
 *
 * So every assertion below is a direction someone can check against a real
 * phone: lean it right, the chips go right; drop the far edge, they slide away
 * from you. matter's convention throughout: +x is screen-right, +y is
 * screen-DOWN.
 */

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

describe('orientation → screen gravity', () => {
  it('reads upright portrait as gravity straight down the screen', () => {
    const g = orientationGravity(90, 0);
    expect(near(g.x, 0)).toBe(true);
    expect(near(g.y, 1)).toBe(true);
  });

  it('reads a phone lying flat as no slope at all', () => {
    const g = orientationGravity(0, 0);
    expect(near(g.x, 0)).toBe(true);
    expect(near(g.y, 0)).toBe(true);
  });

  it('sends the pile RIGHT when the right edge goes down, and left when it does not', () => {
    expect(orientationGravity(0, 45).x).toBeGreaterThan(0.5);
    expect(orientationGravity(0, -45).x).toBeLessThan(-0.5);
  });

  it('gives back the far edge: dropping it lowers the down-screen pull', () => {
    // A hand holding the phone at 45 degrees, then laying it flatter.
    expect(orientationGravity(20, 0).y).toBeLessThan(orientationGravity(45, 0).y);
    // …and past flat the pull is UP the screen, which is what a tray does.
    expect(orientationGravity(-20, 0).y).toBeLessThan(0);
  });

  it('follows the SCREEN when the document is drawn rotated', () => {
    // Landscape-primary (angle 90) with the phone held upright in the world:
    // device axes say gravity runs along −x, the athlete sees it running down.
    const g = orientationGravity(0, -90, 90);
    expect(near(g.x, 0)).toBe(true);
    expect(near(g.y, 1)).toBe(true);
  });

  it('rotates by the screen angle and nothing else', () => {
    const g = toScreenAxes(1, 0, 180);
    expect(near(g.x, -1)).toBe(true);
    expect(near(g.y, 0)).toBe(true);
    expect(toScreenAxes(0.3, -0.7, 0)).toEqual({ x: 0.3, y: -0.7 });
  });
});

describe('accelerometer → screen gravity (the fallback, and the sign that broke it)', () => {
  it('agrees with the angles when the platform reports proper acceleration', () => {
    // Spec/Android: an upright phone reads +9.81 UP the device's y axis.
    const g = accelerationGravity(0, 9.81, 0, false);
    expect(near(g.y, 1, 1e-3)).toBe(true);
  });

  it('agrees with the angles when the platform reports gravity itself', () => {
    // WebKit/CoreMotion: the same upright phone reads −9.81.
    const g = accelerationGravity(0, -9.81, 0, true);
    expect(near(g.y, 1, 1e-3)).toBe(true);
  });

  it('THE BUG: one convention read as the other is the exact opposite vector', () => {
    const spec = accelerationGravity(3, -7, 0, false);
    const webkit = accelerationGravity(3, -7, 0, true);
    expect(near(spec.x, -webkit.x)).toBe(true);
    expect(near(spec.y, -webkit.y)).toBe(true);
  });
});

describe('tilt → world gravity', () => {
  const base = 1.35;
  const flat = { x: 0, y: 0.7 }; // a hand holding the phone at ~45 degrees

  it('does nothing inside the dead zone', () => {
    const g = tiltGravity({ x: flat.x + 0.1, y: flat.y - 0.05 }, flat, { base });
    expect(g).toEqual({ x: 0, y: base });
  });

  it('leans the world the way the phone leaned', () => {
    expect(tiltGravity({ x: 0.6, y: flat.y }, flat, { base }).x).toBeGreaterThan(0.5);
    expect(tiltGravity({ x: -0.6, y: flat.y }, flat, { base }).x).toBeLessThan(-0.5);
  });

  it('LETS GRAVITY POINT UP THE SCREEN when the far edge drops', () => {
    // The whole of "it only works horizontally": this used to be floored at
    // +0.4 and the pile could never travel to the far edge.
    const g = tiltGravity({ x: 0, y: flat.y - 0.7 }, flat, { base });
    expect(g.y).toBeLessThan(0);
    expect(Math.hypot(g.x, g.y)).toBeLessThanOrEqual(TILT.maxG + 1e-9);
  });

  it('still pulls harder DOWN when the near edge drops', () => {
    const g = tiltGravity({ x: 0, y: flat.y + 0.6 }, flat, { base });
    expect(g.y).toBeGreaterThan(base);
  });

  it('answers a vertical lean about as strongly as the same lean sideways', () => {
    const sideways = tiltGravity({ x: flat.x + 0.6, y: flat.y }, flat, { base });
    const vertical = tiltGravity({ x: flat.x, y: flat.y - 0.6 }, flat, { base });
    const lateral = Math.abs(sideways.x);
    const upward = Math.abs(vertical.y - base);
    expect(upward).toBeGreaterThan(lateral * 0.8);
  });

  it('BEATS STATIC FRICTION at a lean a hand actually makes', () => {
    /**
     * The measured defect behind "the tilt does nothing": chips are ceramic on
     * felt, frictionStatic 0.85, so a settled pile does not move until the
     * slope — lateral over downward — passes roughly that. The old gain turned
     * a 35-degree lean into 0.53 and the table just sat there.
     */
    const lean = (deg: number) => {
      // In-plane gravity moves by ~cos(45°)·sin(deg) for a roll from a
      // 45-degree hold, which is what the phone actually reports.
      const d = Math.cos(45 * (Math.PI / 180)) * Math.sin(deg * (Math.PI / 180));
      const g = tiltGravity({ x: flat.x + d, y: flat.y }, flat, { base });
      return Math.abs(g.x) / Math.max(0.01, Math.abs(g.y));
    };
    expect(lean(15)).toBeLessThan(0.85); // a wobble must not empty the table
    expect(lean(30)).toBeGreaterThan(0.85); // a deliberate lean must move it
    expect(lean(45)).toBeGreaterThan(2);
  });

  it('caps how hard the table can ever pull, without bending the direction', () => {
    for (const r of [
      { x: 9, y: 9 },
      { x: -9, y: -9 },
      { x: 0, y: -12 },
      { x: 4, y: -4 },
    ]) {
      const g = tiltGravity(r, flat, { base });
      expect(Math.hypot(g.x, g.y)).toBeLessThanOrEqual(TILT.maxG + 1e-9);
    }
    // Downhill is the same way whether or not the cap bit. Both components
    // scale with `base`, so the same lean under a base too small to clamp is
    // the un-clamped vector's direction — and they must agree.
    const hard = { x: 4, y: -4 };
    const capped = tiltGravity(hard, flat, { base });
    const raw = tiltGravity(hard, flat, { base: 0.02 });
    expect(Math.hypot(capped.x, capped.y)).toBeCloseTo(TILT.maxG, 5);
    expect(capped.x / capped.y).toBeCloseTo(raw.x / raw.y, 5);
  });

  it('needs a bigger lean, and bites less, under reduced motion', () => {
    const lean = { x: flat.x + 0.28, y: flat.y };
    expect(tiltGravity(lean, flat, { base, gentle: true })).toEqual({ x: 0, y: base });
    const hard = { x: flat.x + 0.9, y: flat.y };
    const slope = (g: { x: number; y: number }) => Math.abs(g.x / g.y);
    expect(slope(tiltGravity(hard, flat, { base, gentle: true }))).toBeLessThan(
      slope(tiltGravity(hard, flat, { base }))
    );
  });

  it('is neutral-relative: the same hold produces the same table however it is held', () => {
    const upright = { x: 0, y: 0.98 };
    const laidBack = { x: 0, y: 0.42 };
    const a = tiltGravity({ x: upright.x + 0.5, y: upright.y }, upright, { base });
    const b = tiltGravity({ x: laidBack.x + 0.5, y: laidBack.y }, laidBack, { base });
    expect(near(a.x, b.x)).toBe(true);
    expect(near(a.y, b.y)).toBe(true);
  });
});


/**
 * THE VERTICAL AXIS, which shipped broken (Tyson: "the vertical tilt is
 * broken"). `orientationGravity`'s vertical term is `sin β`, and a phone is
 * held at β ≈ 90° where sin is at its maximum: the derivative is ZERO, so
 * small pitches moved nothing, and β = 70° and β = 110° produced the SAME
 * value — leaning the top toward you and away from you were indistinguishable.
 *
 * These are the two properties that were missing, asserted in angle space.
 */
describe('the vertical lean answers a hand', () => {
  const base = 1;
  const held = orientationLeanDeg(90, 0); // upright, the natural way to hold it

  it('the OLD component model is flat and ambiguous at upright — the bug', () => {
    // Both directions read the same, which is why neither could be felt.
    expect(orientationGravity(70, 0).y).toBeCloseTo(orientationGravity(110, 0).y, 5);
  });

  it('the angle lean tells the two directions apart', () => {
    const toward = orientationLeanDeg(70, 0).y - held.y;
    const away = orientationLeanDeg(110, 0).y - held.y;
    // Still the point of the lean model: sin(70°) === sin(110°), so the old
    // component model could not distinguish these at all.
    expect(Math.sign(toward)).toBe(-Math.sign(away));
    expect(Math.abs(toward)).toBeGreaterThan(15);
  });

  /**
   * THE DIRECTION, AND THE REGRESSION.
   *
   * β = 0 is flat on a table and β = 90 is upright, so a RISING β is a board
   * being stood up — and a board being stood up drops its chips faster. These
   * two shipped inverted, with the mistake spelled out in a comment that read
   * "β rising tips the top edge away". It does not; it lifts the board.
   * A hand caught it, three test cases agreed with the bug, and nothing in the
   * suite disagreed because every one of them was written from the same wrong
   * premise.
   */
  it('standing the board up presses chips DOWN the glass', () => {
    const g = tiltGravity(orientationLeanDeg(115, 0), held, { base, degrees: true });
    expect(g.y).toBeGreaterThan(base);
    expect(Math.abs(g.x)).toBeLessThan(0.05);
  });

  it('laying it flatter lets them drift back up', () => {
    const g = tiltGravity(orientationLeanDeg(65, 0), held, { base, degrees: true });
    expect(g.y).toBeLessThan(base);
    expect(Math.abs(g.x)).toBeLessThan(0.05);
  });

  /**
   * THE GUARD THAT WOULD HAVE CAUGHT IT.
   *
   * `orientationGravity` is the physically derived model — `y = sin β`, which
   * climbs from flat to upright and cannot be argued with. The lean model is
   * allowed to be more sensitive than it, and is allowed to keep working past
   * the angles where sine goes flat, but it is NEVER allowed to point the other
   * way. Asserting the two agree in sign is a property no amount of confident
   * reasoning about "top edges" can talk its way past.
   */
  it('agrees in SIGN with the physical model on both axes, everywhere usable', () => {
    // BELOW THE SINE PEAK ONLY. `sin β` turns over at 90°, so past vertical the
    // physical model folds back on itself and stops being an oracle — that
    // fold IS the ambiguity the lean model exists to escape, and asking it to
    // agree there would be asking it to reproduce the bug it replaced. Between
    // 30° and 80° sine is strictly monotonic, and that is also where a phone
    // held up to look at actually lives.
    for (const neutral of [40, 50, 55, 60] ) {
      const n = orientationLeanDeg(neutral, 0);
      for (const delta of [-25, -15, 15, 20]) {
        const lean = tiltGravity(orientationLeanDeg(neutral + delta, 0), n, { base, degrees: true });
        // What the physics says happens to downward pull over the same move.
        const physical =
          orientationGravity(neutral + delta, 0).y - orientationGravity(neutral, 0).y;
        if (Math.abs(physical) < 1e-3) continue; // sine is flat here; nothing to compare
        // Inside the dead zone the table deliberately does nothing, so there is
        // no direction to disagree about. Skipping it is not weakening the
        // guard — every delta here is well outside it, and the assertion below
        // still runs on all of them.
        if (lean.y === base && lean.x === 0) continue;
        expect(
          Math.sign(lean.y - base),
          `neutral ${neutral}, delta ${delta}`
        ).toBe(Math.sign(physical));
      }
    }
  });

  it('and the horizontal axis agrees with it too', () => {
    const flat = orientationLeanDeg(90, 0);
    const right = tiltGravity(orientationLeanDeg(90, 25), flat, { base, degrees: true });
    const left = tiltGravity(orientationLeanDeg(90, -25), flat, { base, degrees: true });
    // +gamma rolls the right edge down, so chips run right (+x).
    expect(right.x).toBeGreaterThan(0);
    expect(left.x).toBeLessThan(0);
    expect(Math.sign(right.x)).toBe(Math.sign(orientationGravity(90, 25).x));
  });

  it('a small pitch does something — the old model did nothing at all', () => {
    const g = tiltGravity(orientationLeanDeg(105, 0), held, { base, degrees: true });
    expect(Math.abs(g.y - base)).toBeGreaterThan(0.1);
  });

  it('a hand-steady hold still sits perfectly still', () => {
    const g = tiltGravity(orientationLeanDeg(95, 0), held, { base, degrees: true });
    expect(g).toEqual({ x: 0, y: base });
  });

  it('and it behaves the same from ANY neutral, which is the whole point', () => {
    for (const start of [40, 60, 90, 120]) {
      const n = orientationLeanDeg(start, 0);
      const stoodUp = tiltGravity(orientationLeanDeg(start + 25, 0), n, { base, degrees: true });
      const laidFlat = tiltGravity(orientationLeanDeg(start - 25, 0), n, { base, degrees: true });
      expect(stoodUp.y, `stood up from ${start}`).toBeGreaterThan(base);
      expect(laidFlat.y, `laid flat from ${start}`).toBeLessThan(base);
    }
  });

  it('rolling still runs them sideways, both ways', () => {
    expect(tiltGravity(orientationLeanDeg(90, 30), held, { base, degrees: true }).x).toBeGreaterThan(0.3);
    expect(tiltGravity(orientationLeanDeg(90, -30), held, { base, degrees: true }).x).toBeLessThan(-0.3);
  });

  it('the wrap does not read 179 -> -179 as a full turn', () => {
    const a = orientationLeanDeg(90, 179);
    const b = orientationLeanDeg(90, -179);
    expect(Math.abs(tiltGravity(b, a, { base, degrees: true }).x)).toBeLessThan(0.2);
  });
});

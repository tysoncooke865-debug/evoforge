/**
 * WHICH WAY IS DOWNHILL — the whole of it, as arithmetic.
 *
 * Kept apart from use-tilt-gravity.ts for the same reason chip-world.ts is
 * React-free: a direction is a property you can assert in a millisecond, and
 * the two defects that shipped here (an axis reversed on WebKit, a vertical
 * axis clamped into silence) were both invisible to every test that needed a
 * hook, a sensor, or a hand holding a phone. Nothing in this file imports
 * anything.
 *
 * matter's convention throughout: +x is screen-right, +y is screen-DOWN.
 */

export interface TiltGravity {
  x: number;
  y: number;
}

export const TILT = {
  /**
   * How far from the calibrated neutral before anything moves, as a fraction
   * of 1g. 0.2 is about 11.5 degrees — inside the brief's 10-15 band, and
   * comfortably outside ordinary handheld wobble.
   */
  deadZone: 0.2,
  /**
   * How far the lean is amplified past the dead zone — a SLOPE multiplier now,
   * not an amount of gravity. 8 was measured, not guessed: a settled pile does
   * not move until lateral gravity beats the chips' static friction (0.85), so
   * at the old 3.5 a 35-degree lean produced a slope of 0.53 and the table sat
   * there. 8 puts the threshold at about 25 degrees of lean and makes 35
   * degrees an avalanche.
   */
  gain: 8,
  /** However hard the phone is thrown about, the table never pulls harder than
   *  this. Direction is preserved when it clamps — only the speed is capped. */
  maxG: 2.2,
  /** Exponential smoothing per sample. ~0.18 at 50Hz lands the response
   *  around 150ms: responsive and heavy, not jittery and not laggy. */
  smoothing: 0.18,
  /** Only wake sleeping chips when the vector really moved. Sensor noise must
   *  not keep a settled pile awake. */
  wakeDelta: 0.14,
  sampleMs: 20,
} as const;

const DEG = Math.PI / 180;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * DEVICE AXES ARE BOLTED TO THE GLASS; the screen's are not. Rotate into
 * whatever orientation the document is actually being drawn at, so a table
 * viewed in landscape tilts the way the athlete sees it and not the way the
 * phone was born. `screen.orientation.angle` is that rotation.
 */
export function toScreenAxes(x: number, y: number, screenAngleDeg = 0): TiltGravity {
  if (!screenAngleDeg) return { x, y };
  const a = screenAngleDeg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c + y * s, y: -x * s + y * c };
}

/**
 * Screen-space gravity from `deviceorientation`'s beta/gamma — THE source,
 * because their definition is the same in every engine.
 *
 *   gravity, device frame = ( cosβ·sinγ , −sinβ , −cosβ·cosγ )
 *
 * Check it: flat on a table β=γ=0 gives (0,0,−1), out the back of the glass;
 * upright portrait β=90 gives (0,−1,0), toward the bottom edge; right edge
 * down γ=+90 gives (1,0,0). Device +y is UP the screen and matter's +y is
 * down, so that −sinβ flips back to +sinβ below.
 *
 * The result is unit-length in 3D, so the in-plane magnitude falls off as the
 * phone approaches flat — which is the truth: a flat table has no slope.
 */
export function orientationGravity(betaDeg: number, gammaDeg: number, screenAngleDeg = 0): TiltGravity {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  return toScreenAxes(Math.cos(b) * Math.sin(g), Math.sin(b), screenAngleDeg);
}

/**
 * Screen-space gravity from an accelerometer reading, in m/s².
 *
 * `reportsGravityDirectly` is the portability problem, named: WebKit and
 * Apple's CoreMotion hand back the gravity vector, everyone else hands back
 * the PROPER ACCELERATION, which is its exact negative. Reading one as the
 * other reverses every axis of the tilt — it is what put the chips uphill on
 * Tyson's iPhone. Never guess it; pass what the platform documents.
 */
export function accelerationGravity(
  ax: number,
  ay: number,
  screenAngleDeg = 0,
  reportsGravityDirectly = false
): TiltGravity {
  const k = (reportsGravityDirectly ? 1 : -1) / 9.81;
  return toScreenAxes(clamp(ax * k, -1.5, 1.5), clamp(-ay * k, -1.5, 1.5), screenAngleDeg);
}

/**
 * The reading, minus wherever they were holding it, TURNED INTO A SLOPE.
 *
 * NEUTRAL-RELATIVE ON BOTH AXES, and that is the tray metaphor rather than a
 * spirit level: from however you are holding the phone, dropping an edge sends
 * the chips toward it. Absolute angles would mean a pile that sits wrong for
 * everybody who does not hold their phone at the one angle the code prefers.
 *
 * THE TILT ROTATES GRAVITY; IT DOES NOT ADD TO IT. The first model kept the
 * table's own downward pull and bolted a sideways component onto it, which is
 * why it could produce a slope of 0.53 out of a 35-degree lean and leave the
 * pile exactly where it was: chips do not slide until lateral beats static
 * friction, and a component that never rises much above the base can never do
 * that without also making the chips absurdly heavy. Building the vector as
 * `base × (lean, 1 + lean)` instead means the RATIO grows with the lean — the
 * only quantity friction actually answers to — and the vertical axis falls out
 * of the same arithmetic: lean far enough past level and the y term goes
 * negative all by itself, and the pile runs to the far edge.
 */
export function tiltGravity(
  reading: TiltGravity,
  neutral: TiltGravity,
  opts: { base: number; gentle?: boolean }
): TiltGravity {
  const dx = reading.x - neutral.x;
  const dy = reading.y - neutral.y;
  const mag = Math.hypot(dx, dy);
  const deadZone = opts.gentle ? TILT.deadZone * 1.5 : TILT.deadZone;
  if (!(mag > deadZone)) return { x: 0, y: opts.base };
  // Reduced motion needs a bigger lean (above) and answers it more softly.
  const over = (mag - deadZone) * (opts.gentle ? TILT.gain * 0.6 : TILT.gain);
  const ux = dx / mag;
  const uy = dy / mag;
  const x = opts.base * over * ux;
  const y = opts.base * (1 + over * uy);
  const m = Math.hypot(x, y);
  // Clamp the SPEED, never the shape: a scaled vector still points downhill.
  const k = m > TILT.maxG ? TILT.maxG / m : 1;
  return { x: x * k, y: y * k };
}

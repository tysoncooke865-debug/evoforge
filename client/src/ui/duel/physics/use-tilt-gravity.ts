import { DeviceMotion } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { useSettingsStore } from '@/state/settings-store';

/**
 * THE PHONE IS THE TABLE.
 *
 * Tilting the device moves the GRAVITY VECTOR inside the chip world, so a pile
 * slides, a stack leans and eventually topples, and everything collects
 * against whichever wall is now downhill. Nothing here moves a sprite: it hands
 * the physics engine a different `gravity` and the engine does the rest.
 *
 * WHY `accelerationIncludingGravity` AND NOT THE EULER ANGLES. The device's
 * accelerometer already reports gravity IN DEVICE AXES: +x right, +y up the
 * screen, +z out of the glass. The in-plane part of that vector IS screen-space
 * gravity — exactly, at every orientation, with no trigonometry and no
 * gimbal cases. Reconstructing it from alpha/beta/gamma means picking an
 * orientation convention and getting it wrong on one platform. The cost is
 * that the reading also contains the athlete's own hand movement, and the
 * standard answer to that is the low-pass filter this file already needs.
 *
 * IT IS AN ENHANCEMENT, NEVER A DEPENDENCY. Unsupported sensor, denied
 * permission, setting off, screen unfocused, app backgrounded — every one of
 * those paths returns plain downward gravity and a table that works.
 */

/** Screen-space gravity, y positive downward — matter's own convention. */
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
  /** Past the dead zone, how hard the slope bites. At 45 degrees this puts
   *  lateral gravity above vertical, which is what makes an avalanche. */
  gain: 3.5,
  /** Pitch is damped relative to roll: rocking a phone toward and away from
   *  you is far more common than rolling it, and should disturb less. */
  pitchGain: 0.55,
  maxLateral: 1.7,
  /** Down never disappears. A table with no floor has nowhere to settle. */
  minDown: 0.4,
  maxDown: 2.4,
  /** Exponential smoothing per sample. ~0.18 at 50Hz lands the response
   *  around 150ms: responsive and heavy, not jittery and not laggy. */
  smoothing: 0.18,
  /** Only wake sleeping chips when the vector really moved. Sensor noise must
   *  not keep a settled pile awake. */
  wakeDelta: 0.14,
  sampleMs: 20,
} as const;

export type MotionState = 'off' | 'unsupported' | 'prompt' | 'on' | 'denied';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function useTiltGravity(opts: {
  /** Base downward gravity when the phone is at its neutral angle. */
  baseGravity: number;
  /** Called when the smoothed vector has moved enough to matter. */
  onGravity: (g: TiltGravity, changedALot: boolean) => void;
  /** Calm mode / a locked pot / an unfocused screen: hold it still. */
  enabled: boolean;
}): {
  state: MotionState;
  /** iOS web needs a real gesture; this is what the ENABLE MOTION chip calls. */
  request: () => void;
  /** Re-take the neutral reading — orientation change, long background. */
  recalibrate: () => void;
} {
  const { baseGravity, onGravity, enabled } = opts;
  const motionPhysics = useSettingsStore((s) => s.motionPhysics);
  /**
   * The SENSOR's own status. The public `state` is derived from it below —
   * writing 'off' into state from inside the effect that turns it off is a
   * synchronous setState in an effect, and a cascading render for something
   * that is already knowable from the props.
   */
  const [sensor, setSensor] = useState<MotionState>('prompt');
  /** Bumped when a permission request succeeds, so the subscribe effect
   *  re-runs exactly once rather than being keyed on its own output. */
  const [attempt, setAttempt] = useState(0);
  const state: MotionState = !enabled || !motionPhysics ? 'off' : sensor;

  const smoothed = useRef<{ x: number; y: number } | null>(null);
  const neutral = useRef<{ x: number; y: number } | null>(null);
  const lastSent = useRef<TiltGravity>({ x: 0, y: baseGravity });
  const onGravityRef = useRef(onGravity);
  const baseRef = useRef(baseGravity);
  useEffect(() => {
    onGravityRef.current = onGravity;
  }, [onGravity]);
  useEffect(() => {
    baseRef.current = baseGravity;
  }, [baseGravity]);

  const recalibrate = useCallback(() => {
    neutral.current = null;
  }, []);

  /**
   * One sample. Everything that makes this feel like a heavy table rather than
   * a spirit level happens here, in order: normalise, smooth, calibrate,
   * dead-zone, gain, clamp.
   */
  const sample = useCallback((ax: number, ay: number) => {
    /**
     * ACCELERATION IS THE OPPOSITE OF GRAVITY, and both axes flip.
     *
     * `accelerationIncludingGravity` reports the device's PROPER acceleration:
     * a phone held still reads roughly +1g pointing AWAY from the ground,
     * because the hand is accelerating it upward against gravity. Upright
     * portrait is therefore (0, +9.81), not (0, −9.81).
     *
     * So screen-space gravity is (−ax, +ay): device +y is up the screen and
     * matter's +y is down, which flips y, and the acceleration-vs-gravity
     * inversion flips it back — while x flips exactly once. Getting this
     * half-right is worse than getting it wrong: the first version negated
     * both and the pile slid the wrong way on every tilt.
     */
    const raw = { x: clamp(-ax / 9.81, -1.5, 1.5), y: clamp(ay / 9.81, -1.5, 1.5) };

    const prev = smoothed.current;
    const s = prev
      ? {
          x: prev.x + (raw.x - prev.x) * TILT.smoothing,
          y: prev.y + (raw.y - prev.y) * TILT.smoothing,
        }
      : raw;
    smoothed.current = s;

    // NEUTRAL IS WHEREVER THEY WERE HOLDING IT. Nobody holds a phone at a
    // perfect right angle, and treating upright-portrait as the origin makes
    // the pile permanently drift for everyone who leans it back.
    if (!neutral.current) {
      neutral.current = { ...s };
      return;
    }
    const d = { x: s.x - neutral.current.x, y: s.y - neutral.current.y };
    const mag = Math.hypot(d.x, d.y);

    let gx = 0;
    let gy = baseRef.current;
    if (mag > TILT.deadZone) {
      const over = (mag - TILT.deadZone) * TILT.gain;
      const ux = d.x / mag;
      const uy = d.y / mag;
      gx = clamp(ux * over, -TILT.maxLateral, TILT.maxLateral);
      gy = clamp(baseRef.current + uy * over * TILT.pitchGain, TILT.minDown, TILT.maxDown);
    }

    const moved = Math.hypot(gx - lastSent.current.x, gy - lastSent.current.y);
    // Always publish (the world interpolates cheaply); only flag a WAKE when
    // the change is big enough to be worth disturbing a sleeping pile for.
    lastSent.current = { x: gx, y: gy };
    onGravityRef.current({ x: gx, y: gy }, moved > TILT.wakeDelta);
  }, []);

  /**
   * Try to attach. Returns a RESULT rather than setting state itself: a
   * function that both awaits and calls setState reads to the compiler as a
   * synchronous setState in whichever effect invokes it, and the honest shape
   * is "here is what I found, you decide what to render".
   */
  const subscribe = useCallback(async (): Promise<{
    status: MotionState;
    sub: { remove: () => void } | null;
  }> => {
    try {
      if (!(await DeviceMotion.isAvailableAsync())) return { status: 'unsupported', sub: null };
      // iOS 13+ (native AND Safari/PWA) gates this behind a user gesture. On
      // every other platform the call resolves immediately.
      const perm = await DeviceMotion.getPermissionsAsync();
      if (!perm.granted) {
        return { status: perm.canAskAgain ? 'prompt' : 'denied', sub: null };
      }
      DeviceMotion.setUpdateInterval(TILT.sampleMs);
      const sub = DeviceMotion.addListener((data) => {
        const a = data.accelerationIncludingGravity;
        if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return;
        sample(a.x, a.y);
      });
      return { status: 'on', sub };
    } catch {
      return { status: 'unsupported', sub: null };
    }
  }, [sample]);

  /** The ENABLE TILT affordance. A gesture-scoped permission ask, never a
   *  popup on load. */
  const request = useCallback(() => {
    void (async () => {
      try {
        const perm = await DeviceMotion.requestPermissionsAsync();
        if (!perm.granted) {
          setSensor(perm.canAskAgain ? 'prompt' : 'denied');
          return;
        }
        neutral.current = null;
        setSensor('on');
        setAttempt((n) => n + 1);
      } catch {
        setSensor('unsupported');
      }
    })();
  }, []);

  // ── lifecycle ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled || !motionPhysics) {
      // Hand the world its plain gravity back, so switching off is immediate.
      // No setState here: `state` derives 'off' from these same two flags.
      onGravityRef.current({ x: 0, y: baseRef.current }, true);
      return;
    }
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    // setSensor here is a PROMISE CALLBACK, not a synchronous effect body
    // write — which is both what the rule allows and what is actually true:
    // the answer arrives from the platform whenever it arrives.
    void subscribe().then((r) => {
      if (cancelled) {
        r.sub?.remove();
        return;
      }
      sub = r.sub;
      setSensor(r.status);
    });
    return () => {
      cancelled = true;
      // `sub.remove()` and NOTHING ELSE. The extra `DeviceMotion
      // .removeAllListeners()` that used to sit here does not exist on the web
      // implementation, so the cleanup threw and took the entire wager screen
      // into the error boundary — a "belt and braces" call that was neither.
      // Removing the subscription already stops the underlying listener.
      sub?.remove();
      smoothed.current = null;
      neutral.current = null;
    };
  }, [enabled, motionPhysics, subscribe, attempt]);

  /**
   * THE LATE SENSOR.
   *
   * expo-sensors' web `isAvailableAsync` decides by RACE: it waits 250ms for a
   * real `devicemotion` event and reports unavailable if none arrives. On a
   * phone lying still, freshly picked up, or throttled in a background tab,
   * that is a coin flip — and losing it turned tilt off for the whole session
   * with no way back.
   *
   * So a "no sensor" answer on web is treated as PROVISIONAL: a passive
   * listener stays attached, and the first event that ever arrives re-runs the
   * subscription. Costs one idle listener; buys a feature that stops being
   * randomly absent.
   */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (sensor !== 'unsupported' || !enabled || !motionPhysics) return;
    const onLate = () => {
      window.removeEventListener('devicemotion', onLate);
      setSensor('prompt');
      setAttempt((n) => n + 1);
    };
    window.addEventListener('devicemotion', onLate);
    return () => window.removeEventListener('devicemotion', onLate);
  }, [sensor, enabled, motionPhysics]);

  // A long background, or a rotation, and the phone is very likely being held
  // differently. Re-take neutral rather than fighting a stale baseline.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') recalibrate();
    });
    return () => sub.remove();
  }, [recalibrate]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onRotate = () => recalibrate();
    window.addEventListener('orientationchange', onRotate);
    return () => window.removeEventListener('orientationchange', onRotate);
  }, [recalibrate]);

  return { state, request, recalibrate };
}

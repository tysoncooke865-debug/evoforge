import { DeviceMotion } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { useSettingsStore } from '@/state/settings-store';

import {
  TILT,
  accelerationGravity,
  orientationGravity,
  tiltGravity,
  type TiltGravity,
} from './tilt-math';

export { TILT, type TiltGravity } from './tilt-math';

/**
 * THE PHONE IS THE TABLE.
 *
 * Tilting the device moves the GRAVITY VECTOR inside the chip world, so a pile
 * slides, a stack leans and eventually topples, and everything collects
 * against whichever edge is now downhill. Nothing here moves a sprite: it hands
 * the physics engine a different `gravity` and the engine does the rest.
 *
 * WHY THE EULER ANGLES AND NOT `accelerationIncludingGravity` — the correction
 * that fixes "the tilt is back to front".
 *
 * The first version read the accelerometer, on the reasoning that its in-plane
 * part IS screen-space gravity with no trigonometry. The trigonometry was
 * never the problem. THE SIGN IS NOT PORTABLE: the spec (and Chrome/Android)
 * report PROPER acceleration, so a phone held upright reads +9.81 UP the
 * screen, while WebKit on iOS reports the gravity vector itself — the exact
 * negative. EvoForge ships as an installed PWA on an iPhone, so every axis of
 * the tilt arrived reversed, and because the pitch axis was also clamped (see
 * below) the only thing Tyson could feel was a sideways slide going the wrong
 * way.
 *
 * `deviceorientation`'s beta/gamma have ONE definition and both engines follow
 * it, so the vector is DERIVED rather than guessed — the derivation, and every
 * direction it produces, lives in `tilt-math.ts` where a test can hold it to
 * account without a hook or a hand.
 *
 * The accelerometer stays as the FALLBACK for devices that fire `devicemotion`
 * and never `deviceorientation`, and there the platform convention is named
 * explicitly instead of assumed.
 *
 * IT IS AN ENHANCEMENT, NEVER A DEPENDENCY. Unsupported sensor, denied
 * permission, setting off, screen unfocused, app backgrounded — every one of
 * those paths returns plain downward gravity and a table that works.
 */

export type MotionState = 'off' | 'unsupported' | 'prompt' | 'on' | 'denied';

/** 0 unless the document is being drawn rotated. Read per sample: a rotation
 *  is not an event we are guaranteed to have seen first. */
function screenAngle(): number {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 0;
  const so = (window.screen as Screen & { orientation?: { angle?: number } })?.orientation;
  const legacy = (window as Window & { orientation?: number }).orientation;
  return so?.angle ?? (typeof legacy === 'number' ? legacy : 0);
}

export function useTiltGravity(opts: {
  /** Base downward gravity when the phone is at its neutral angle. */
  baseGravity: number;
  /** Called when the smoothed vector has moved enough to matter. */
  onGravity: (g: TiltGravity, changedALot: boolean) => void;
  /** A locked pot or an unfocused screen: hold it still. */
  enabled: boolean;
  /**
   * Reduced motion. Tilt stays ON — deliberately tipping your own phone is
   * about as user-initiated as an input gets, and switching it off for
   * everyone with the OS setting was the same mistake that hid the whole chip
   * table from Tyson. It just bites more gently and needs a bigger lean.
   */
  gentle?: boolean;
}): {
  state: MotionState;
  /** iOS web needs a real gesture; this is what the ENABLE MOTION chip calls. */
  request: () => void;
  /** Re-take the neutral reading — orientation change, long background. */
  recalibrate: () => void;
} {
  const { baseGravity, onGravity, enabled, gentle = false } = opts;
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

  const smoothed = useRef<TiltGravity | null>(null);
  const neutral = useRef<TiltGravity | null>(null);
  const lastSent = useRef<TiltGravity>({ x: 0, y: baseGravity });
  const onGravityRef = useRef(onGravity);
  const baseRef = useRef(baseGravity);
  const gentleRef = useRef(gentle);
  useEffect(() => {
    gentleRef.current = gentle;
  }, [gentle]);
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
   * One sample, already in screen axes. Everything that makes this feel like a
   * heavy table rather than a spirit level happens here, in order: smooth,
   * calibrate, dead-zone, gain, clamp.
   */
  const sample = useCallback((raw: TiltGravity) => {
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return;
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

    const g = tiltGravity(s, neutral.current, { base: baseRef.current, gentle: gentleRef.current });
    const moved = Math.hypot(g.x - lastSent.current.x, g.y - lastSent.current.y);
    // Always publish (the world interpolates cheaply); only flag a WAKE when
    // the change is big enough to be worth disturbing a sleeping pile for.
    lastSent.current = g;
    onGravityRef.current(g, moved > TILT.wakeDelta);
  }, []);

  /**
   * WHY THE WEB PATH DOES NOT USE expo-sensors.
   *
   * `DeviceSensor.addListener` calls `this._nativeModule.addListener(...)`, and
   * expo-sensors' web module (`ExponentDeviceMotion.web.js`) is a plain object
   * with `startObserving`/`stopObserving` and NO `addListener` at all. So on
   * web every subscribe threw a TypeError, landed in the catch, and reported
   * "no motion sensor" — on a device holding one. EvoForge ships as an
   * installed PWA, so web IS the phone, and this was the whole of Tyson's
   * "tilts not working".
   *
   * `window.addEventListener` is what that shim would have called anyway.
   * Native keeps expo-sensors, where it works.
   */
  const liveRef = useRef(false);
  /** True once `deviceorientation` has produced a usable angle. The
   *  accelerometer is a fallback and must not fight the source that has no
   *  sign ambiguity, so it stands down the moment orientation speaks. */
  const anglesRef = useRef(false);

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
      if (Platform.OS === 'web') {
        if (typeof window === 'undefined') return { status: 'unsupported', sub: null };
        const w = window as unknown as {
          DeviceMotionEvent?: { requestPermission?: () => Promise<string> };
          DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
        };
        const DME = w.DeviceMotionEvent;
        const DOE = w.DeviceOrientationEvent;
        if (!DME && !DOE) return { status: 'unsupported', sub: null };

        // A READING IS THE ONLY PROOF. iOS gives no way to query whether
        // motion is already permitted, so 'prompt' is a guess that the first
        // real sample corrects. Ref-guarded: these run 50 times a second.
        const live = () => {
          if (liveRef.current) return;
          liveRef.current = true;
          setSensor('on');
        };

        const onOrient = (e: Event) => {
          const { beta, gamma } = e as DeviceOrientationEvent;
          if (typeof beta !== 'number' || typeof gamma !== 'number') return;
          if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return;
          anglesRef.current = true;
          live();
          sample(orientationGravity(beta, gamma, screenAngle()));
        };
        const onMotion = (e: Event) => {
          if (anglesRef.current) return;
          const a = (e as DeviceMotionEvent).accelerationIncludingGravity;
          if (!a || !Number.isFinite(a.x ?? NaN) || !Number.isFinite(a.y ?? NaN)) return;
          live();
          /**
           * FALLBACK ONLY, and deliberately assuming the SPEC convention.
           * Anything that fires `devicemotion` without ever firing
           * `deviceorientation` is not WebKit — WebKit fires both, under one
           * permission — so proper acceleration is the right reading here.
           */
          sample(accelerationGravity(a.x as number, a.y as number, screenAngle(), false));
        };

        window.addEventListener('deviceorientation', onOrient);
        window.addEventListener('devicemotion', onMotion);
        const sub = {
          remove: () => {
            liveRef.current = false;
            anglesRef.current = false;
            window.removeEventListener('deviceorientation', onOrient);
            window.removeEventListener('devicemotion', onMotion);
          },
        };
        // iOS needs a gesture-scoped grant; everywhere else the events simply
        // flow, and a device with no accelerometer just never sends one.
        const needsGesture =
          typeof DME?.requestPermission === 'function' || typeof DOE?.requestPermission === 'function';
        return { status: needsGesture && !liveRef.current ? 'prompt' : 'on', sub };
      }

      const perm = await DeviceMotion.getPermissionsAsync();
      if (!perm.granted) {
        return { status: perm.canAskAgain ? 'prompt' : 'denied', sub: null };
      }
      DeviceMotion.setUpdateInterval(TILT.sampleMs);
      const sub = DeviceMotion.addListener((data) => {
        const a = data.accelerationIncludingGravity;
        if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return;
        // NAMED, NOT SNIFFED-BY-ACCIDENT: expo-sensors passes CoreMotion
        // through on iOS, and CoreMotion reports the gravity vector itself.
        // Android's SensorManager reports proper acceleration, like the spec.
        sample(accelerationGravity(a.x, a.y, 0, Platform.OS === 'ios'));
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
        if (Platform.OS === 'web') {
          const w = window as unknown as {
            DeviceMotionEvent?: { requestPermission?: () => Promise<string> };
            DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
          };
          // BOTH, from inside the touch handler's own task — which is why this
          // is a button and not something done on mount. iOS gates the angles
          // and the accelerometer behind separate calls even though one user
          // toggle answers them, and asking for only one leaves the source
          // this file actually steers by silent.
          const asks = [w.DeviceOrientationEvent?.requestPermission, w.DeviceMotionEvent?.requestPermission]
            .filter((f): f is () => Promise<string> => typeof f === 'function');
          const results = await Promise.all(asks.map((ask) => ask().catch(() => 'denied')));
          if (results.length > 0 && !results.includes('granted')) {
            setSensor(results.includes('denied') ? 'denied' : 'prompt');
            return;
          }
        } else {
          const perm = await DeviceMotion.requestPermissionsAsync();
          if (!perm.granted) {
            setSensor(perm.canAskAgain ? 'prompt' : 'denied');
            return;
          }
        }
        neutral.current = null;
        setSensor('on');
        setAttempt((n) => n + 1);
      } catch {
        setSensor('unsupported');
      }
    })();
  }, []);

  // ── lifecycle ────────────────────────────────────────────────────

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
      sub?.remove();
      smoothed.current = null;
      neutral.current = null;
    };
  }, [enabled, motionPhysics, subscribe, attempt]);

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

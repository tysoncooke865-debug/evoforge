import { DeviceMotion } from 'expo-sensors';

import { hasMotionGrant, loadMotionGrant, rememberMotionGrant } from './motion-permission';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { useSettingsStore } from '@/state/settings-store';

import {
  TILT,
  accelerationGravity,
  orientationLeanDeg,
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

  /**
   * FORGET THE HOLD ENTIRELY — all three pieces of it.
   *
   * Clearing `neutral` alone is what broke the table on every return to the
   * app. The smoothing buffer survived, so the very next sample was 82% of the
   * angle the phone was at BEFORE the athlete switched away, and that stale
   * average became the new neutral. Come back holding the phone differently —
   * which is what returning to an app IS — and the table had a permanent
   * phantom lean baked into its origin, big enough after the gain to pin the
   * whole pot against a wall and hold it there.
   *
   * And the world is handed plain gravity NOW rather than at the next sample.
   * The first sample after a recalibration only records the new neutral and
   * publishes nothing, so anything that stops the stream (a return that never
   * re-arms the sensor, a backgrounded tab) would otherwise leave the last
   * leaned vector standing forever.
   */
  const recalibrate = useCallback(() => {
    neutral.current = null;
    smoothed.current = null;
    lastSent.current = { x: 0, y: baseRef.current };
    onGravityRef.current({ x: 0, y: baseRef.current }, true);
  }, []);

  /**
   * One sample, already in screen axes. Everything that makes this feel like a
   * heavy table rather than a spirit level happens here, in order: smooth,
   * calibrate, dead-zone, gain, clamp.
   */
  const sample = useCallback((raw: TiltGravity, degrees = false) => {
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

    const g = tiltGravity(s, neutral.current, { base: baseRef.current, gentle: gentleRef.current, degrees });
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
  /** Whether this hook has EVER had a reading. Unlike `liveRef` a re-arm does
   *  not clear it, which is how a resumed subscription tells "the sensor has
   *  not spoken yet" apart from "the sensor has stopped speaking". */
  const everLive = useRef(false);
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
          everLive.current = true;
          setSensor('on');
        };

        const onOrient = (e: Event) => {
          const { beta, gamma } = e as DeviceOrientationEvent;
          if (typeof beta !== 'number' || typeof gamma !== 'number') return;
          if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return;
          anglesRef.current = true;
          live();
          sample(orientationLeanDeg(beta, gamma, screenAngle()), true);
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

        /**
         * A REMEMBERED GRANT IS A HOPE, AND HOPE NEEDS A DEADLINE.
         *
         * Remembering the grant stopped the tray asking on every open — and
         * then iOS dropped the permission across an app relaunch, so nothing
         * arrived AND no button appeared to fix it. Optimism with no way back
         * is worse than the question it replaced.
         *
         * So: assume the grant holds, attach, and arm a short probe. If no
         * reading has landed by then on a platform that gates motion, the
         * grant is gone — forget it and put ENABLE TILT back. Same shape as
         * the boot-overlay rule: decide only when the thing STILL has not
         * happened, never on the first symptom.
         */
        let probe: ReturnType<typeof setTimeout> | null = null;
        const sub = {
          remove: () => {
            if (probe) clearTimeout(probe);
            probe = null;
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
        // A GRANT ALREADY GIVEN IS NOT A QUESTION. Once this device has said
        // yes — from Settings or from a wager table — stop showing the ask on
        // every mount; the athlete answered. The flag only suppresses the
        // PROMPT: a reading is still the only thing that reports 'on' for real,
        // so a revoked grant degrades to plain gravity exactly as before.
        await loadMotionGrant();
        const answered = hasMotionGrant();
        if (needsGesture && !liveRef.current && answered) {
          probe = setTimeout(() => {
            if (liveRef.current) return;
            rememberMotionGrant(false);
            setSensor('prompt');
          }, 1500);
        }
        return { status: needsGesture && !liveRef.current && !answered ? 'prompt' : 'on', sub };
      }

      const perm = await DeviceMotion.getPermissionsAsync();
      if (!perm.granted) {
        return { status: perm.canAskAgain ? 'prompt' : 'denied', sub: null };
      }
      DeviceMotion.setUpdateInterval(TILT.sampleMs);
      const sub = DeviceMotion.addListener((data) => {
        const a = data.accelerationIncludingGravity;
        if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return;
        liveRef.current = true;
        everLive.current = true;
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
        // The tap that grants permission is also a new hold: the phone has
        // just been touched, and whatever it was resting at is no longer where
        // it is. `recalibrate` forgets the smoothing buffer too, which
        // `neutral.current = null` on its own did not.
        rememberMotionGrant(true);
        recalibrate();
        setSensor('on');
        setAttempt((n) => n + 1);
      } catch {
        setSensor('unsupported');
      }
    })();
  }, [recalibrate]);

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
    let grace: ReturnType<typeof setTimeout> | null = null;
    // setSensor here is a PROMISE CALLBACK, not a synchronous effect body
    // write — which is both what the rule allows and what is actually true:
    // the answer arrives from the platform whenever it arrives.
    void subscribe().then((r) => {
      if (cancelled) {
        r.sub?.remove();
        return;
      }
      sub = r.sub;
      // A READING BEATS A GUESS, WHICHEVER ARRIVES FIRST. `subscribe` decides
      // its status before the platform has had a chance to speak, and on a
      // re-arm samples start flowing immediately — so this resolution can
      // land AFTER `live()` has already proved the sensor works.
      if (liveRef.current) {
        setSensor('on');
        return;
      }
      if (everLive.current && r.status === 'prompt') {
        /**
         * A SENSOR THAT WORKED A MOMENT AGO GETS A MOMENT TO COME BACK.
         *
         * Re-arming clears the "we have seen a reading" flag, so on iOS —
         * where the mere existence of `requestPermission` means the status
         * guesses 'prompt' — every return from the app switcher would flash
         * ENABLE TILT over a table that was about to work perfectly. If the
         * stream really is dead the athlete still gets told, 1.5s later, and
         * that message is then the truth rather than a flicker.
         */
        grace = setTimeout(() => {
          if (!liveRef.current) setSensor('prompt');
        }, 1500);
        return;
      }
      setSensor(r.status);
    });
    return () => {
      cancelled = true;
      if (grace) clearTimeout(grace);
      // `sub.remove()` and NOTHING ELSE. The extra `DeviceMotion
      // .removeAllListeners()` that used to sit here does not exist on the web
      // implementation, so the cleanup threw and took the entire wager screen
      // into the error boundary — a "belt and braces" call that was neither.
      sub?.remove();
      smoothed.current = null;
      neutral.current = null;
    };
  }, [enabled, motionPhysics, subscribe, attempt]);

  /**
   * COMING BACK TO THE APP IS A NEW HOLD, AND A NEW SUBSCRIPTION.
   *
   * Two separate things break across a background, and only one of them is
   * calibration. The listeners themselves go quiet: iOS stops delivering
   * motion to a page it has suspended, and a stream that stopped is not
   * guaranteed to start again just because the page is visible — the athlete
   * comes back to a dead table with a chip hint that says TILT ON. So the
   * sensor is RE-ARMED (a bumped `attempt` re-runs the subscribe effect, which
   * removes and re-adds the listeners) as well as recalibrated.
   *
   * `resume` is idempotent and cheap, which is why it is safe to wire it to
   * every signal that could mean "we are back": AppState covers native and
   * react-native-web's mapping of `visibilitychange`, and the web listeners
   * below cover the paths that mapping does not — a PWA restored from the app
   * switcher fires `pageshow`, and a tab regaining focus fires `focus`
   * without necessarily changing visibility at all.
   */
  const resume = useCallback(() => {
    recalibrate();
    setAttempt((n) => n + 1);
  }, [recalibrate]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') resume();
    });
    return () => sub.remove();
  }, [resume]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') resume();
    };
    // A rotation is a new hold too — the phone is in a different hand shape,
    // and the screen axes it is measured against have just moved.
    const onRotate = () => recalibrate();
    window.addEventListener('orientationchange', onRotate);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('orientationchange', onRotate);
      window.removeEventListener('pageshow', onVisible);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [recalibrate, resume]);

  return { state, request, recalibrate };
}

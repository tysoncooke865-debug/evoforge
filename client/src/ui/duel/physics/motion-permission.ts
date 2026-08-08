import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { DeviceMotion } from 'expo-sensors';

/**
 * ASK FOR MOTION ONCE, IN SETTINGS — not every time a wager opens.
 *
 * iOS only hands out the accelerometer from inside a real user gesture, which
 * is why the chip table grew an ENABLE TILT chip. But a permission chip that
 * reappears on every tray is a question the athlete has already answered, and
 * being asked again reads as the app forgetting.
 *
 * So the grant lives HERE: a device-local flag plus a standalone ask that any
 * gesture can drive — the Motion physics switch in Profile is the natural one.
 * A tray then only asks if nothing has ever granted it.
 *
 * THE FLAG IS A HINT, NEVER AN AUTHORITY. It suppresses the *asking*; it does
 * not pretend the sensor is live. `useTiltGravity` still proves motion by
 * receiving a reading — a browser that silently revokes the grant falls back to
 * plain downward gravity exactly as before, and the athlete can re-ask from
 * Settings. Storage is device-local by design: a permission is a property of
 * this browser on this phone, not of the account.
 */

const KEY = 'evoforge-motion-granted-v1';

/** Mirrored in memory so a render can ask without awaiting storage. */
let granted = false;
let loaded = false;

/** Warm the mirror. Safe to call repeatedly; never throws. */
export async function loadMotionGrant(): Promise<boolean> {
  if (loaded) return granted;
  try {
    granted = (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    granted = false;
  }
  loaded = true;
  return granted;
}

/** Has this device already granted motion at some point? */
export function hasMotionGrant(): boolean {
  return granted;
}

export function rememberMotionGrant(on: boolean): void {
  granted = on;
  loaded = true;
  void AsyncStorage.setItem(KEY, on ? '1' : '0').catch(() => undefined);
}

export type MotionAsk = 'granted' | 'denied' | 'unsupported';

/**
 * THE ASK ITSELF, callable from any gesture.
 *
 * Both permissions on web: iOS gates the orientation angles and the
 * accelerometer separately even though one toggle answers them, and asking for
 * only one leaves the source the tilt maths actually steers by silent.
 */
export async function askForMotion(): Promise<MotionAsk> {
  try {
    if (Platform.OS === 'web') {
      const w = window as unknown as {
        DeviceMotionEvent?: { requestPermission?: () => Promise<string> };
        DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
      };
      const asks = [w.DeviceOrientationEvent?.requestPermission, w.DeviceMotionEvent?.requestPermission]
        .filter((f): f is () => Promise<string> => typeof f === 'function');
      // No gate at all: this browser simply delivers motion events, so there is
      // nothing to grant and nothing to remember asking for.
      if (asks.length === 0) {
        const supported = typeof w.DeviceMotionEvent !== 'undefined';
        if (supported) rememberMotionGrant(true);
        return supported ? 'granted' : 'unsupported';
      }
      const results = await Promise.all(asks.map((ask) => ask().catch(() => 'denied')));
      const ok = results.includes('granted');
      rememberMotionGrant(ok);
      return ok ? 'granted' : 'denied';
    }
    const perm = await DeviceMotion.requestPermissionsAsync();
    rememberMotionGrant(perm.granted);
    return perm.granted ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

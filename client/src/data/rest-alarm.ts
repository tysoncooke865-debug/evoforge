import { Platform } from 'react-native';

/**
 * THE REST ALARM — one seam, and the only place that knows how a phone gets
 * told a rest has ended (§14/§15/§17, 2026-08-10).
 *
 * ---- THE INTERFACE IS THE POINT ----
 *
 * Two functions. Everything about HOW the alarm is delivered lives behind
 * them, which is what §17 asks for when it says to "isolate a clean Live
 * Activity interface for future implementation": a Live Activity, a native
 * local notification and this web implementation are three answers to the
 * same two questions, and the rest of the app never learns which one it got.
 *
 * ---- WHAT SHIPS TODAY, AND WHY ----
 *
 * EvoForge ships as an Expo WEB export served as an installed PWA. There is
 * no `ios/`, no `android/`, no `eas.json` and no native build in CI. So an
 * iOS Live Activity — which needs a widget extension, an App Group and a
 * native target — is not a thing this architecture can express, and §17's own
 * escape clause applies: ship reliable background timing, a local
 * notification and haptics first, and leave a clean seam behind. This file is
 * that seam. There is deliberately NO fake lock-screen widget drawn in the
 * web UI.
 *
 * ---- WHY THE SERVICE WORKER AND NOT setTimeout ----
 *
 * A page's timers stop when the tab is frozen, which is precisely when the
 * athlete needs telling. The service worker is a separate context that
 * outlives the page, already registered (data/version-guard.ts) and already
 * shows notifications (public/sw.js handles web push), so the alarm is handed
 * to it and it fires `showNotification` on its own clock.
 *
 * HONEST LIMIT, and it is a real one: iOS may terminate a service worker
 * while the PWA is backgrounded, and when it does the scheduled notification
 * does not fire. That is a platform limit, not a bug this code can fix — the
 * only delivery iOS guarantees to a suspended PWA is a REMOTE push, which
 * §14 explicitly rules out ("do not require remote push infrastructure just
 * to notify a user their rest period has ended"). So the alarm is
 * best-effort, and the catch-up in ui/train/rest-timer.tsx is what makes the
 * athlete's experience correct regardless: reopening the app to an expired
 * rest buzzes and says so immediately.
 */

/** Message names — shared with public/sw.js, which is plain JS and cannot
 *  import them. Changing one means changing both; the sw test pins it. */
export const REST_ALARM_SCHEDULE = 'evoforge-rest-schedule';
export const REST_ALARM_CANCEL = 'evoforge-rest-cancel';
/** ONE tag for every rest notification, so the browser itself collapses a
 *  duplicate onto the existing one — belt to the explicit cancel's braces. */
export const REST_ALARM_TAG = 'evoforge-rest';

function worker(): ServiceWorker | null {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return null;
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.controller ?? null;
}

/** Whether an alarm can be delivered at all — drives the contextual ask. */
export function restAlarmSupported(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    'Notification' in window &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator
  );
}

export type RestAlarmPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function restAlarmPermission(): RestAlarmPermission {
  if (!restAlarmSupported()) return 'unsupported';
  const p = Notification.permission;
  return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default';
}

/**
 * Ask for permission — ONLY ever from a real tap on ENABLE ALERTS (§18).
 * Never called on mount, never during onboarding, and never twice on its own.
 */
export async function requestRestAlarmPermission(): Promise<RestAlarmPermission> {
  if (!restAlarmSupported()) return 'unsupported';
  try {
    const p = await Notification.requestPermission();
    return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default';
  } catch {
    return 'default';
  }
}

/**
 * Arm the alarm for an absolute instant, replacing any pending one.
 *
 * IDEMPOTENT AND SELF-CANCELLING: the worker keeps at most one rest timeout,
 * so scheduling always replaces. That single rule is what satisfies all of
 * §14's cancellation cases at once — restart, duration change, a second timer
 * — without each caller having to remember to cancel first.
 */
export async function scheduleRestAlarm(endAt: number, body: string): Promise<void> {
  if (restAlarmPermission() !== 'granted') return;
  const sw = worker();
  if (!sw) return;
  try {
    sw.postMessage({ type: REST_ALARM_SCHEDULE, at: endAt, body, tag: REST_ALARM_TAG });
  } catch {
    /* best effort — the in-app timer is the source of truth either way */
  }
}

/** Disarm. Safe to call when nothing is armed. */
export async function cancelRestAlarm(): Promise<void> {
  const sw = worker();
  if (!sw) return;
  try {
    sw.postMessage({ type: REST_ALARM_CANCEL, tag: REST_ALARM_TAG });
  } catch {
    /* best effort */
  }
}

/**
 * The completion buzz, for when the app IS in the foreground (§15).
 *
 * One pulse, not a pattern that repeats until dismissed — "the user should
 * simply notice that their rest has finished". `navigator.vibrate` is a no-op
 * on iOS Safari, which is why the chime and the on-screen REST OVER state
 * carry the message there.
 */
export function restCompleteVibration(): void {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return;
  try {
    navigator.vibrate?.([180, 90, 180]);
  } catch {
    /* unsupported; the chime and the UI still land */
  }
}

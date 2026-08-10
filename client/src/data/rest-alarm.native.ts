/**
 * THE REST ALARM — native side (2026-08-10).
 *
 * ---- WHY THIS IS A STUB, AND WHY THAT IS THE HONEST ANSWER ----
 *
 * EvoForge has no native build. There is no `ios/`, no `android/`, no
 * `eas.json`, and CI runs `expo export -p web` and nothing else — the product
 * ships as an installed PWA. So this file is currently reached by no running
 * code at all.
 *
 * It exists anyway, for one reason: it is where the native implementation
 * goes, and having the seam already drawn is the difference between "add a
 * dependency and fill in two functions" and "work out where this belongs".
 * That is exactly what §17 asks for.
 *
 * WHAT IT DOES NOT DO IS PRETEND. This repo's rule is that a system without a
 * backend is HIDDEN, never mocked, and the same applies to a platform without
 * a build: shipping `expo-notifications` wiring that has never once been run
 * against a device would be an untested claim in a file nobody can falsify.
 * When a native build exists, the work is:
 *
 *   1. `npx expo install expo-notifications`
 *   2. set a notification handler at app start
 *   3. scheduleRestAlarm ->
 *        await Notifications.cancelAllScheduledNotificationsAsync()
 *        await Notifications.scheduleNotificationAsync({
 *          content: { title: 'EvoForge', body, sound: true },
 *          trigger: { type: 'date', date: new Date(endAt) },
 *        })
 *   4. cancelRestAlarm -> cancelAllScheduledNotificationsAsync()
 *   5. requestRestAlarmPermission -> Notifications.requestPermissionsAsync()
 *
 * and a Live Activity, if it is ever wanted, is a third implementation of
 * these same two functions rather than a change anywhere else in the app.
 *
 * The IN-APP timer is fully functional here regardless: it derives from
 * absolute timestamps (state/rest-timer.ts) and expo-haptics already fires
 * the completion buzz. What is missing on native is only the notification
 * while the app is closed.
 */

export const REST_ALARM_SCHEDULE = 'evoforge-rest-schedule';
export const REST_ALARM_CANCEL = 'evoforge-rest-cancel';
export const REST_ALARM_TAG = 'evoforge-rest';

export type RestAlarmPermission = 'unsupported' | 'default' | 'granted' | 'denied';

/** No native notification module is installed, so there is nothing to offer.
 *  Returning false keeps the contextual ENABLE ALERTS prompt hidden rather
 *  than offering a switch that does nothing. */
export function restAlarmSupported(): boolean {
  return false;
}

export function restAlarmPermission(): RestAlarmPermission {
  return 'unsupported';
}

export async function requestRestAlarmPermission(): Promise<RestAlarmPermission> {
  return 'unsupported';
}

export async function scheduleRestAlarm(_endAt: number, _body: string): Promise<void> {
  /* see the header: the seam, not a pretence */
}

export async function cancelRestAlarm(): Promise<void> {
  /* see the header */
}

/** Native haptics are handled by expo-haptics at the call site (it is a real,
 *  working API here); there is no separate vibration to fire. */
export function restCompleteVibration(): void {
  /* expo-haptics covers native — see ui/train/rest-timer.tsx */
}

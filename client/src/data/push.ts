import { Platform } from 'react-native';

import { supabase } from './supabase';

/**
 * WEB PUSH client (migration 053). The installed PWA subscribes through the
 * service worker (public/sw.js), stores the subscription, and the send-push
 * edge function delivers VAPID-signed notifications to it — real phone push on
 * iOS 16.4+ home-screen apps and every push-capable browser. All web-only and
 * best-effort: a browser without the Push API simply never enables it.
 */

// The VAPID PUBLIC key is public by design (safe to ship). The private key is
// an edge-function secret. Regenerate the pair together if ever rotated.
export const VAPID_PUBLIC =
  'BIQO4vyb3qQfYOr8AMH2KsEbOlsnr8oORkb3cxyHcxAnX1Jq5WMnKI1TF2m0Piz_keJvoE3zAVV9zw4KTkASE0k';

export type PushState = 'unsupported' | 'default' | 'granted' | 'denied';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushSupported(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Current permission, without prompting. */
export function pushPermission(): PushState {
  if (!pushSupported()) return 'unsupported';
  const p = Notification.permission;
  return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default';
}

/** Prompt (if needed), subscribe, and store the subscription. Idempotent. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'default';
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
      }));
    const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return 'granted';
    await supabase.from('push_subscriptions').upsert(
      { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent },
      { onConflict: 'endpoint' }
    );
    return 'granted';
  } catch {
    return 'granted';
  }
}

/** Drop this device's subscription (both the browser's and the row). */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => undefined);
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    }
  } catch {
    /* best effort */
  }
}

/**
 * Ask the server to push a notification to the affected user. Fire-and-forget:
 * the in-app notification (DB trigger) is the source of truth; a failed push
 * never blocks the action. `type` picks the recipient server-side (a post's
 * author, or the friend-request target).
 */
export function pushNotify(input: {
  type: 'reaction' | 'comment' | 'friend_request' | 'mention' | 'pr_beaten';
  postId?: string;
  toUser?: string;
  /** pr_beaten (072): the lift name, for the push copy. */
  exercise?: string;
}): void {
  if (Platform.OS !== 'web') return;
  void supabase.functions
    .invoke('send-push', {
      body: { type: input.type, post_id: input.postId ?? null, to_user: input.toUser ?? null, exercise: input.exercise ?? null },
    })
    .catch(() => undefined);
}

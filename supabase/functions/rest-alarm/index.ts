/**
 * rest-alarm (2026-08-11) — deliver the "rest is over" push for alarms that
 * have come due. Driven by pg_cron every ten seconds (migration 196).
 *
 * ---- WHY THIS EXISTS AT ALL ----
 *
 * The rest timer's primary notification comes from the service worker, which
 * holds a timeout and calls showNotification. That is instant and precise —
 * whenever the worker is alive. On iOS a backgrounded PWA's worker can be
 * terminated, and a terminated worker has no timers, so the buzz that is the
 * entire point of a rest timer never arrives. The only delivery iOS
 * guarantees to a suspended PWA is a remote push. So this is the BACKSTOP,
 * not the mechanism.
 *
 * ---- WHY A DUPLICATE IS STRUCTURALLY IMPOSSIBLE ----
 *
 * Three independent guards, because a scheduler retrying is not an edge case:
 *
 *  1. `rest_alarms` has ONE ROW PER ATHLETE (user_id is the primary key), so
 *     there is no state in which two alarms are pending for one person.
 *  2. `rest_alarms_due()` marks rows sent in the SAME statement that returns
 *     them, so two overlapping ten-second ticks cannot both claim one alarm.
 *  3. Every notification carries the tag `evoforge-rest`, the same tag the
 *     service worker uses. If the worker DID fire and this push lands too,
 *     the browser collapses them onto one notification rather than stacking.
 *
 * And the client deletes its row the moment the timer completes in the
 * foreground, so an athlete watching the countdown is never pushed at all.
 *
 * ---- WHAT IT REFUSES ----
 *
 * The cron secret, exactly like command-notify and training-reminder. This
 * endpoint sends notifications to arbitrary users by design; it is not
 * something a signed-in athlete may invoke.
 */

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { CORS_HEADERS, json } from '../_shared/ai.ts';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:tysoncooke865@gmail.com',
  Deno.env.get('VAPID_PUBLIC') ?? '',
  Deno.env.get('VAPID_PRIVATE') ?? ''
);

/** The tag the service worker also uses — see the header's guard 3. */
const REST_TAG = 'evoforge-rest';

interface DueRow {
  user_id: string;
  body: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const expected = Deno.env.get('CRON_SECRET') ?? '';
  if (expected === '' || req.headers.get('x-cron-secret') !== expected) {
    return json({ error: 'forbidden' }, 403);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data, error } = await admin.rpc('rest_alarms_due');
  if (error) return json({ error: error.message }, 500);
  const rows = (data ?? []) as DueRow[];
  if (rows.length === 0) return json({ ok: true, sent: 0 });

  let sent = 0;
  for (const r of rows) {
    const payload = JSON.stringify({
      title: 'EvoForge',
      body: r.body,
      url: '/workout',
      tag: REST_TAG,
    });
    try {
      await webpush.sendNotification(
        { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth_key } },
        payload
      );
      sent++;
    } catch (e) {
      // A dead subscription is swept, exactly as send-push does — otherwise
      // every tick retries an endpoint the browser threw away months ago.
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 410 || code === 404) {
        await admin.from('push_subscriptions').delete().eq('endpoint', r.endpoint);
      }
    }
  }
  return json({ ok: true, sent, due: rows.length });
});

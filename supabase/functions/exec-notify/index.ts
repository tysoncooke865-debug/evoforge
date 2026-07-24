/**
 * exec-notify (2026-07-25) — the last leg of the alerting spine: turn open,
 * un-notified `exec_alerts` rows into a real push on an admin's phone.
 *
 * The detection itself runs in the database (migration 083,
 * `exec_watchdog_scan()`, scheduled by pg_cron every 5 minutes). This function
 * exists only because Postgres cannot VAPID-sign a Web Push payload. It is
 * deliberately dumb: read, send, stamp.
 *
 * CALLER AUTH: a shared secret in `x-cron-secret`, compared in constant time.
 * There is no JWT path — the only legitimate caller is the scheduler. Without a
 * configured secret the function refuses to run rather than defaulting open.
 *
 * WHY THIS EXISTS AT ALL: on 2026-07-21 an athlete's client spun at ~40 writes
 * a second for half an hour, then they left. Nothing told anyone for two days.
 */
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { CORS_HEADERS, json } from '../_shared/ai.ts';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:tysoncooke865@gmail.com',
  Deno.env.get('VAPID_PUBLIC') ?? '',
  Deno.env.get('VAPID_PRIVATE') ?? ''
);

/** Length-safe, branch-free compare — a shared secret deserves it. */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const expected = Deno.env.get('CRON_SECRET') ?? '';
  if (!expected) return json({ error: 'CRON_SECRET not configured' }, 503);
  if (!secretsMatch(req.headers.get('x-cron-secret') ?? '', expected)) {
    return json({ error: 'forbidden' }, 403);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: alerts, error } = await admin
    .from('exec_alerts')
    .select('id,kind,severity,title,detail,opened_at')
    .is('resolved_at', null)
    .is('notified_at', null)
    .order('opened_at', { ascending: true })
    .limit(20);
  if (error) return json({ error: error.message }, 500);
  if (!alerts || alerts.length === 0) return json({ ok: true, sent: 0, alerts: 0 });

  // One push per RUN, not per alert: five alerts opening together is one
  // incident to a human, and five buzzes is how a person learns to swipe
  // notifications away without reading them.
  alerts.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
  const lead = alerts[0];
  const more = alerts.length - 1;
  const body = more > 0 ? `${lead.title} (+${more} more)` : lead.title;
  const worst = lead.severity === 'critical' ? 'CRITICAL' : 'HEADS UP';

  const { data: admins } = await admin.from('app_admins').select('user_id');
  const adminIds = (admins ?? []).map((a: { user_id: string }) => a.user_id);
  if (adminIds.length === 0) return json({ ok: true, sent: 0, reason: 'no admins' });

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint,p256dh,auth')
    .in('user_id', adminIds);

  const payload = JSON.stringify({
    title: `EVOFORGE — ${worst}`,
    body,
    url: '/insights',
    tag: 'exec-alert',
  });

  let sent = 0;
  const dead: string[] = [];
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) dead.push(s.endpoint);
    }
  }
  if (dead.length > 0) await admin.from('push_subscriptions').delete().in('endpoint', dead);

  // Stamp regardless of whether a push landed. An alert nobody could be pushed
  // to (no admin subscribed yet) must not re-queue forever and then arrive as a
  // burst of stale notifications the day someone finally subscribes — it stays
  // visible as an OPEN alert either way, which is the durable channel.
  await admin
    .from('exec_alerts')
    .update({ notified_at: new Date().toISOString() })
    .in('id', alerts.map((a) => a.id));

  return json({ ok: true, sent, alerts: alerts.length, pruned: dead.length });
});

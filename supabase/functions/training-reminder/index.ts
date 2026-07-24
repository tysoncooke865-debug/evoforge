/**
 * training-reminder (2026-07-25) — the reason to come back tomorrow.
 *
 * The push rail has worked since 053 and had ONE subscriber, because nothing
 * ever sent a training message: send-push fires only for social events, and
 * social has 17 posts in its lifetime. This sends the message that justifies
 * being subscribed at all.
 *
 * WHO gets one is decided in SQL (`training_reminder_due`, migration 085) so the
 * rule is falsifiable without a deploy: only athletes who have actually trained
 * before, only on a day their own schedule says is a training day, never twice,
 * never on a day they already trained, never after three weeks of silence.
 *
 * The message NAMES their session. "PUSH 1 — CHEST FOCUS is waiting" is a
 * reminder; "time to train!" is spam, and the difference is whether the athlete
 * believes the app knows anything about them.
 */
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { CORS_HEADERS, json } from '../_shared/ai.ts';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:tysoncooke865@gmail.com',
  Deno.env.get('VAPID_PUBLIC') ?? '',
  Deno.env.get('VAPID_PRIVATE') ?? ''
);

function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Due {
  user_id: string;
  workout: string;
  streak_days: number;
}

function bodyFor(d: Due): string {
  const named = d.workout && d.workout !== 'your next session';
  if (named) return `${d.workout.toUpperCase()} is waiting.`;
  return 'Your next session is waiting.';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const expected = Deno.env.get('CRON_SECRET') ?? '';
  if (!expected) return json({ error: 'CRON_SECRET not configured' }, 503);
  if (!secretsMatch(req.headers.get('x-cron-secret') ?? '', expected)) {
    return json({ error: 'forbidden' }, 403);
  }

  // `dry` lets the selection be inspected in production without sending
  // anything — the only safe way to check who WOULD be pushed.
  const body = await req.json().catch(() => ({}));
  const dry = body?.dry === true;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: due, error } = await admin.rpc('training_reminder_due');
  if (error) return json({ error: error.message }, 500);
  const list = (due ?? []) as Due[];
  if (dry) return json({ ok: true, dry: true, due: list.length, sample: list.slice(0, 5) });
  if (list.length === 0) return json({ ok: true, sent: 0, due: 0 });

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint,p256dh,auth,user_id')
    .in('user_id', list.map((d) => d.user_id));

  const byUser = new Map<string, typeof subs>();
  for (const s of subs ?? []) {
    const arr = byUser.get(s.user_id) ?? [];
    arr.push(s);
    byUser.set(s.user_id, arr as typeof subs);
  }

  let sent = 0;
  let logged = 0;
  const dead: string[] = [];

  for (const d of list) {
    const mine = byUser.get(d.user_id) ?? [];
    if (mine.length === 0) continue;

    // Claim the day FIRST. If the send half-fails and the scheduler retries,
    // the primary key has already made a second notification impossible — the
    // failure mode of a reminder system must be silence, never a double buzz.
    const { error: claimErr } = await admin
      .from('push_reminder_log')
      .insert({ user_id: d.user_id, day: new Date().toISOString().slice(0, 10), kind: 'training' });
    if (claimErr) continue; // already claimed today — someone beat us to it
    logged++;

    const payload = JSON.stringify({
      title: 'EVOFORGE',
      body: bodyFor(d),
      url: '/today',
      tag: 'training-reminder',
    });

    let deliveredToAnyDevice = false;
    for (const s of mine) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        deliveredToAnyDevice = true;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
      }
    }
    if (deliveredToAnyDevice) sent++;
  }

  if (dead.length > 0) await admin.from('push_subscriptions').delete().in('endpoint', dead);

  return json({ ok: true, due: list.length, sent, claimed: logged, pruned: dead.length });
});

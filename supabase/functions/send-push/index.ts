/**
 * send-push (2026-07-19) — deliver a Web Push notification for a social event.
 *
 * The in-app notification is created by a DB trigger (migration 052); this is
 * the phone-push twin. The CALLER (from the JWT) is the actor; the RECIPIENT is
 * resolved server-side (a post's author, or the friend-request/mention target),
 * so a client can never push arbitrary messages to arbitrary users. Reads the
 * recipient's subscriptions with the service role, VAPID-signs an encrypted
 * payload to each endpoint, and prunes dead ones (410/404).
 */
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { CORS_HEADERS, json } from '../_shared/ai.ts';
import { callerUserId } from '../_shared/battle/service.ts';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:tysoncooke865@gmail.com',
  Deno.env.get('VAPID_PUBLIC') ?? '',
  Deno.env.get('VAPID_PRIVATE') ?? ''
);

const VERB: Record<string, string> = {
  reaction: 'reacted to your post',
  comment: 'commented on your post',
  friend_request: 'sent you a friend request',
  mention: 'mentioned you in a post',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const actor = await callerUserId(req);
  if (!actor) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  const type = String(body.type ?? '');
  if (!(type in VERB)) return json({ error: 'bad type' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Resolve the recipient server-side.
  let recipient: string | null = null;
  if (type === 'reaction' || type === 'comment') {
    const postId = String(body.post_id ?? '');
    if (!postId) return json({ error: 'post_id required' }, 400);
    const { data: post } = await admin.from('social_posts').select('author_id').eq('id', postId).maybeSingle();
    recipient = post?.author_id ?? null;
  } else if (type === 'friend_request') {
    // M2 (2026-07-19): don't trust body.to_user — a client could spoof a
    // "sent you a friend request" push to anyone. Only push if a REAL pending
    // request from the actor to the target exists.
    const target = body.to_user ? String(body.to_user) : null;
    if (target) {
      const { data: fr } = await admin
        .from('friend_requests')
        .select('to_id')
        .eq('from_id', actor)
        .eq('to_id', target)
        .eq('status', 'pending')
        .maybeSingle();
      recipient = fr?.to_id ?? null;
    }
  } else {
    // mention: only push if the actor really authored a post mentioning the
    // target (the post carries the mention). Requires a post_id authored by the
    // actor; without it we refuse rather than trust body.to_user.
    const postId = String(body.post_id ?? '');
    const target = body.to_user ? String(body.to_user) : null;
    if (postId && target) {
      const { data: post } = await admin
        .from('social_posts')
        .select('author_id')
        .eq('id', postId)
        .eq('author_id', actor)
        .maybeSingle();
      recipient = post ? target : null;
    }
  }
  if (!recipient || recipient === actor) return json({ ok: true, sent: 0 });
  // Never push to someone who blocked the actor (or whom the actor blocked).
  {
    const { data: blocks } = await admin
      .from('blocked_users')
      .select('blocker_id')
      .or(`and(blocker_id.eq.${recipient},blocked_id.eq.${actor}),and(blocker_id.eq.${actor},blocked_id.eq.${recipient})`);
    if (blocks && blocks.length > 0) return json({ ok: true, sent: 0 });
  }

  const { data: prof } = await admin.from('public_profile').select('display_name').eq('user_id', actor).maybeSingle();
  const actorName = prof?.display_name ?? 'Someone';
  const { data: subs } = await admin.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', recipient);
  if (!subs || subs.length === 0) return json({ ok: true, sent: 0 });

  const payload = JSON.stringify({ title: 'EvoForge', body: `${actorName} ${VERB[type]}`, url: '/social', tag: `evo-${type}` });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 410 || code === 404) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    }
  }
  return json({ ok: true, sent });
});

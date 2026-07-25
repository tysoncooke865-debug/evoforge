/**
 * command-notify (2026-07-25) — phone push for EvoForge Command.
 *
 * Cron calls this once a minute. It claims from command_outbox, VAPID-signs a
 * payload to every Command subscription belonging to that founder, prunes dead
 * endpoints, and marks the rows sent.
 *
 * THREE LESSONS FROM EARLIER FUNCTIONS ARE BAKED IN.
 *
 * 1. THE GATEWAY 401 (migration 086). Supabase's edge gateway verifies a JWT
 *    BEFORE this body runs, so a cron job sending only `x-cron-secret` gets
 *    401 UNAUTHORIZED_NO_AUTH_HEADER and the function never executes. The cron
 *    job therefore sends the publishable key as the Authorization bearer purely
 *    to pass the gateway; `x-cron-secret` remains the real authorisation, and
 *    is checked here. A GREEN CRON RUN PROVES NOTHING — read net._http_response.
 *
 * 2. CLAIM BEFORE SENDING (migration 085). command_claim_outbox stamps
 *    claimed_at inside the same statement that selects the rows, so a crash
 *    mid-send loses a notification rather than sending it twice. The failure
 *    mode must be silence, never three phones buzzing twice at 3am.
 *
 * 3. ONE RUN, MANY ALERTS, NOT ONE PUSH EACH. Same rule as exec-notify: an
 *    alerting system that empties a queue as fifty separate buzzes teaches
 *    people to turn it off.
 */
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:tysoncooke865@gmail.com',
  Deno.env.get('VAPID_PUBLIC') ?? '',
  Deno.env.get('VAPID_PRIVATE') ?? '',
)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Constant-time compare so a wrong secret cannot be found by timing. */
function secretsMatch(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const expected = Deno.env.get('CRON_SECRET') ?? ''
  const given = req.headers.get('x-cron-secret') ?? ''
  // A function whose secret is unset must refuse, not fall open.
  if (!expected || !secretsMatch(expected, given)) return json({ error: 'forbidden' }, 403)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: batch, error } = await admin.rpc('command_claim_outbox', { p_limit: 30 })
  if (error) return json({ error: error.message }, 500)

  const items = (batch ?? []) as {
    id: number
    title: string
    body: string
    url: string
    subs: { endpoint: string; p256dh: string; auth: string }[]
  }[]
  if (!items.length) return json({ ok: true, sent: 0, claimed: 0 })

  const sentIds: number[] = []
  const dead: string[] = []
  let delivered = 0

  for (const item of items) {
    // No subscription is not a failure — mark it sent so a founder who has not
    // installed the PWA does not accumulate an unsendable backlog forever.
    if (!item.subs?.length) {
      sentIds.push(item.id)
      continue
    }

    const payload = JSON.stringify({
      title: item.title,
      body: item.body,
      url: item.url,
      // Tag by URL so a second notification about the same proposal replaces
      // the first on the lock screen instead of stacking.
      tag: item.url,
    })

    let anyDelivered = false
    for (const sub of item.subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
        anyDelivered = true
        delivered++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        // 410 Gone / 404 — the subscription is dead. Prune it; keep everything
        // else, because a transient 5xx must not cost a founder their alerts.
        if (status === 410 || status === 404) dead.push(sub.endpoint)
      }
    }
    // Only mark sent if something got through, so a total failure retries on
    // the next run rather than vanishing.
    if (anyDelivered) sentIds.push(item.id)
  }

  if (sentIds.length || dead.length) {
    await admin.rpc('command_mark_sent', { p_ids: sentIds, p_dead: dead })
  }

  return json({ ok: true, claimed: items.length, sent: delivered, pruned: dead.length })
})

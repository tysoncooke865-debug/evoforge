/**
 * sentry-watch (WO-005, founder vote) — turn a NEW Sentry issue that is hurting
 * MORE THAN ONE ATHLETE into a founder alert on the existing spine.
 *
 * WHY IT POLLS INSTEAD OF RECEIVING A WEBHOOK. Supabase's edge gateway verifies
 * a JWT *before* a function body runs — the 086 lesson that cost this studio
 * three green cron runs and an alerting system that could not alert. Sentry's
 * webhooks cannot be given an Authorization header, so an inbound hook would
 * 401 forever and look healthy from both ends. Outbound polling has no gateway
 * in front of it, which is why 084's watchdog works.
 *
 * WHY IT WRITES `exec_alerts` INSTEAD OF EMAILING. The founders already carry
 * one alerting channel — `exec_alerts` → `exec-notify` → a push on their phone,
 * every five minutes, deduped to one buzz per run. A second channel with
 * different rules is how people learn to ignore both. This adds a row; the
 * existing spine does the rest, unchanged.
 *
 * NO SCHEMA CHANGE. `exec_alerts.kind` is free text, and its partial-unique
 * index is on `(kind, subject)` where unresolved — so `sentry_issue:<shortId>`
 * gives each distinct Sentry issue its own alert and makes a double-open
 * impossible by construction. `subject_id` stays NULL: it means "the athlete
 * this is about", and an issue is about several.
 *
 * REFUSES RATHER THAN PRETENDS. Without SENTRY_AUTH_TOKEN / SENTRY_ORG /
 * SENTRY_PROJECT it returns 503 and reports zero — it never returns a cheerful
 * `{ok:true, opened:0}` that reads exactly like a quiet day.
 *
 * SECRETS ARE NOT IN THE REPO (it is public). Set as edge-function secrets:
 *   CRON_SECRET         — the shared caller secret (already exists, see 084/086)
 *   SENTRY_AUTH_TOKEN   — a Sentry token with `event:read` ONLY. This one CAN
 *                         read, so it lives here and never in the client.
 *   SENTRY_ORG          — the Sentry org slug
 *   SENTRY_PROJECT      — the Sentry project slug
 *   SENTRY_API_HOST     — optional, e.g. https://us.sentry.io (default sentry.io)
 *
 * SCHEDULING IT IS PART OF THE RELEASE, NOT OF THIS CHANGE. The cron SQL,
 * the secrets and the Sentry-side setup are in docs/ERROR_MONITORING.md.
 * Nothing here runs until a founder release authorises the deploy.
 */
import { CORS_HEADERS, json } from '../_shared/ai.ts';
import { serveMonitored } from '../_shared/monitoring.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

/** Length-safe, branch-free compare — the same one exec-notify and
 *  training-reminder use. Duplicated deliberately: these functions deploy
 *  independently and a shared helper is one more thing to get out of sync. */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** THE APPROVED CONDITION: "any new issue affecting more than one athlete."
 *  One athlete hitting something odd is a bug report; two is a pattern, and
 *  the 2026-07-21 athlete was one person nobody counted for 48 hours. */
const MIN_ATHLETES = 2;

/** Above this many athletes it stops being a bug and starts being an outage —
 *  `critical` is what makes exec-notify title the push CRITICAL rather than
 *  HEADS UP. One threshold, one line, tune it in the open. */
const CRITICAL_ATHLETES = 5;

/** How far back "new" reaches. Long enough that an issue which crosses the
 *  two-athlete line hours after it first appeared is still caught; short
 *  enough that switching monitoring on does not dump a backlog of old issues
 *  onto three phones as if they had all just started. */
const LOOKBACK_HOURS = 24;

interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit?: string;
  level?: string;
  permalink?: string;
  count?: string | number;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  firstRelease?: { version?: string };
}

serveMonitored('sentry-watch', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const expected = Deno.env.get('CRON_SECRET') ?? '';
  if (!expected) return json({ error: 'CRON_SECRET not configured' }, 503);
  if (!secretsMatch(req.headers.get('x-cron-secret') ?? '', expected)) {
    return json({ error: 'forbidden' }, 403);
  }

  const token = Deno.env.get('SENTRY_AUTH_TOKEN') ?? '';
  const org = Deno.env.get('SENTRY_ORG') ?? '';
  const project = Deno.env.get('SENTRY_PROJECT') ?? '';
  if (!token || !org || !project) {
    // Not `{ok:true, opened:0}`. A monitor that cannot see must say so.
    return json({ error: 'sentry not configured', configured: false }, 503);
  }
  const host = (Deno.env.get('SENTRY_API_HOST') ?? 'https://sentry.io').replace(/\/+$/, '');

  const url =
    `${host}/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/` +
    `?query=${encodeURIComponent('is:unresolved')}&statsPeriod=${LOOKBACK_HOURS}h&sort=new&limit=25`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    return json({ error: `sentry ${res.status}`, detail: (await res.text()).slice(0, 300) }, 502);
  }
  const payload = await res.json();
  const issues: SentryIssue[] = Array.isArray(payload) ? payload : [];

  // `statsPeriod` filters on LAST seen, so the list also contains long-standing
  // issues that merely recurred today. "New" has to be checked explicitly, or
  // the first run after enabling this alerts on the entire backlog.
  const newest = Date.now() - LOOKBACK_HOURS * 3600_000;
  const qualifying = issues.filter((i) => {
    if ((i.userCount ?? 0) < MIN_ATHLETES) return false;
    const firstSeen = i.firstSeen ? Date.parse(i.firstSeen) : NaN;
    // An unparseable firstSeen is treated as new: a missed alert is the one
    // failure this system is not allowed to have.
    return Number.isNaN(firstSeen) || firstSeen >= newest;
  });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const opened: string[] = [];
  for (const issue of qualifying) {
    const athletes = issue.userCount ?? 0;
    const kind = `sentry_issue:${issue.shortId || issue.id}`;

    // ONCE PER ISSUE, EVER — resolved rows count. Filtering on "still open"
    // would re-raise every issue a founder had already read and closed, and an
    // alert that comes back after you dismiss it is an alert people mute.
    const { data: existing, error: readError } = await admin
      .from('exec_alerts')
      .select('id')
      .eq('kind', kind)
      .limit(1);
    if (readError) return json({ error: readError.message }, 500);
    if (existing && existing.length > 0) continue;

    const { error: writeError } = await admin.from('exec_alerts').insert({
      kind,
      severity: athletes >= CRITICAL_ATHLETES ? 'critical' : 'warning',
      title: `${athletes} athletes: ${issue.title}`.slice(0, 200),
      detail: {
        // No athlete identity: the COUNT is the founder-facing fact, and this
        // repository is public (HANDOVER §3). Sentry holds the ids.
        athletes,
        events: issue.count ?? null,
        culprit: issue.culprit ?? null,
        level: issue.level ?? null,
        // ACCEPTANCE CRITERION 3, delivered to the phone: which deploy.
        first_release: issue.firstRelease?.version ?? null,
        first_seen: issue.firstSeen ?? null,
        permalink: issue.permalink ?? null,
      },
    });
    // 23505 means a concurrent run won the race against the partial-unique
    // index — that is the index doing its job, not a failure.
    if (writeError && writeError.code !== '23505') {
      return json({ error: writeError.message }, 500);
    }
    if (!writeError) opened.push(kind);
  }

  // exec-notify (cron, every 5 min) turns these into ONE push. Nothing here
  // sends a notification itself — two alerting paths is how you get two buzzes.
  return json({ ok: true, scanned: issues.length, qualifying: qualifying.length, opened });
});

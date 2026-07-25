# ERROR MONITORING — Sentry on the client and the edge functions

> **WO-005, approved by founder vote 2026-07-25.** Implemented; **not enabled.**
> Nothing in this document is live. Turning it on is a deploy, and a deploy
> needs its own founder authorisation.

---

## 1. Why this exists

On 2026-07-21 an athlete hit a hard failure and their client spun: **2,412 rows
in a single minute**, 60% of 20,862 events inside the first 32 minutes. They
left and did not come back. **Time to detection was about 48 hours**, and only
because a person went looking.

The alerting spine that shipped afterwards (migrations 083/084) watches six
rules **in SQL** — error burst, write flood, onboarding stall, activation stall,
activation drop, zero training. It is very good at the failures we predicted and
**structurally blind to an exception nobody told it about**. It counts rows; it
cannot show you a stack.

This is the other half:

| Acceptance criterion | What delivers it |
|---|---|
| Detection in minutes for unpredicted failures | `sentry-watch` on the 5-minute cron → `exec_alerts` → the existing `exec-notify` push |
| Stack traces instead of inferring behaviour from event counts | The exception itself, with parsed frames, from both the client and every edge function |
| Release tagging tells us which deploy caused it | `release`/`dist` = the hashed entry bundle on web (`domain/build-id.ts`), `SENTRY_RELEASE` on the edge |

---

## 2. What was built

**The client** — `client/src/data/monitoring.ts` + the pure
`client/src/domain/error-report.ts` (28 cases, plus 7 parity cases against the
edge copy — **35 new tests that have never been executed**, see §4).
- `initMonitoring()` runs first in `app/_layout.tsx`'s init effect. Installs
  `window.onerror`, `unhandledrejection`, and RN's `ErrorUtils` global handler
  (chained, never replaced — dropping the previous one silences the dev red box).
- `ui/core/route-error-boundary.tsx` reports every route crash. That is the
  highest-value capture point in the app: reaching it means an athlete is
  looking at SOMETHING BROKE instead of their workout.
- `data/auth-context.tsx` sets the athlete's **user id and nothing else** on
  sign-in and **clears it on sign-out** (the every-cache-layer doctrine — a
  misattributed crash corrupts the exact count the founder alert fires on).

**The edge** — `supabase/functions/_shared/monitoring.ts` + the pure
`_shared/sentry-envelope.ts`.
- All **21** functions now run through `serveMonitored('<name>', handler)`.
  It reports the throw and **rethrows**, so every status code, body and CORS
  header is byte-for-byte what it was. Monitoring that alters what it monitors
  is not monitoring.

**The founder alert** — `supabase/functions/sentry-watch/`.
- Polls Sentry for unresolved issues first seen in the last 24h, keeps the ones
  affecting **≥ 2 athletes**, and opens an `exec_alerts` row per issue. The
  existing `exec-notify` cron turns those into **one push per run** on the
  founders' phones. **No schema change** — `exec_alerts.kind` is free text and
  its partial-unique index gives `sentry_issue:<shortId>` its own alert.
- It **polls rather than receives a webhook** because Supabase's edge gateway
  verifies a JWT *before* a function body runs (the 086 lesson). Sentry cannot
  attach an Authorization header to a webhook, so an inbound hook would 401
  forever and look healthy from both ends.

### Things that are deliberately NOT here
- **No new dependency.** The Sentry SDK could not be installed or built in the
  environment this was implemented in, and shipping an unbuilt package into a
  bundle already flagged as the app's main problem (HANDOVER §7) is not a
  trade worth making unverified. This speaks Sentry's documented envelope
  protocol directly — real DSN, real project, real grouping, real releases,
  real user counts — in ~250 lines that are unit-tested. **The cost is source
  maps: web frames arrive minified** unless a `sentry-cli sourcemaps upload`
  step is added to CI, which is deploy-pipeline work and out of scope here.
- **No migration file.** The cron schedule below is not applied, and every file
  in `migrations/` is. It lives here, in the release checklist, instead.
- **No CI change**, no deploy, no secrets in the repo (it is public).

---

## 3. Turning it on (the release checklist)

**1. Create the Sentry project.** One project is enough; the `surface` tag
separates `client` from `edge`.

**2. Edge-function secrets** (Supabase dashboard → Edge Functions → Secrets):

| Secret | Value | Notes |
|---|---|---|
| `SENTRY_DSN` | the project DSN | public, write-only |
| `SENTRY_RELEASE` | the deployed commit sha | set per deploy, or issues read `unknown` |
| `SENTRY_ENVIRONMENT` | `production` | optional, defaults to `production` |
| `SENTRY_AUTH_TOKEN` | a token with **`event:read` only** | **`sentry-watch` only.** This one can READ. |
| `SENTRY_ORG` / `SENTRY_PROJECT` | the slugs | |
| `SENTRY_API_HOST` | e.g. `https://us.sentry.io` | optional, defaults to `sentry.io` |

`CRON_SECRET` already exists (084/086) and is reused unchanged.

**3. Client env.** Set `EXPO_PUBLIC_SENTRY_DSN` in the deploy environment.
Metro **inlines** `EXPO_PUBLIC_` values and does not invalidate its transform
cache on an env change — the build after this must pass `--clear` or it ships
the old (empty) value and monitoring is silently off (HANDOVER §6).

**4. Deploy** the 21 wrapped functions and the new `sentry-watch`.

**5. Schedule the poller.** Same shape as 086 — the publishable key as the
bearer purely to pass the gateway, `x-cron-secret` as the real authorisation:

```sql
select cron.schedule('sentry-watch', '*/5 * * * *', $job$
  select net.http_post(
    url     := 'https://rysbpwpvnqbngqncrfaa.supabase.co/functions/v1/sentry-watch',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                 where name = 'edge_gateway_key' limit 1),
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'cron_secret' limit 1)),
    body    := '{}'::jsonb
  )
$job$);
```

**6. READ `net._http_response`. A green cron run proves nothing** — that is the
whole 086 lesson, and it cost this studio three green runs and an alerting
system that could not alert:

```sql
select status_code, content from net._http_response order by created desc limit 3;
```

`200 {"ok":true,"scanned":…}` is success. `401` is the gateway again.
`503 {"configured":false}` means the Sentry secrets are missing — the function
says so on purpose rather than returning a cheerful `opened: 0` that reads
exactly like a quiet day.

**7. Sentry-side alerting is optional and secondary.** The founders' channel is
the push they already have. If you also want Sentry's own email, the rule is
*new issue → seen by more than 1 user* — the same condition, stated twice.

---

## 4. Falsifying it (do this before trusting it — none of it has been run)

A guard that cannot fail is not a guard. Each of these must be *seen*, not
reasoned about:

**Four links were checked statically and hold. They are recorded here because a
silent break in any of them reproduces the 086 shape exactly — an alerting
system that cannot alert, with nothing failing at either end:**

- **`serveMonitored` has something to catch.** No edge function wraps its
  handler in a top-level `try/catch`. All 12 `catch` blocks under
  `supabase/functions/` are narrow — a per-subscription web-push failure, a
  `req.json()` fallback, an AI non-JSON parse — so an unexpected throw still
  reaches the wrapper instead of being turned into a tidy 500 nobody sees.
- **`exec-notify` is kind-agnostic.** It selects on `resolved_at is null` and
  `notified_at is null` only, with **no `kind` filter**, so a
  `sentry_issue:<shortId>` row rides the existing spine to a founder's phone
  with no change to it. Had it filtered on the six watchdog kinds,
  `sentry-watch` would have written correct alerts forever and told nobody.
- **The watchdog cannot auto-resolve a Sentry alert out from under the push
  (2026-07-26).** `exec_watchdog_scan()`'s auto-resolve (083 §4) is gated on
  `a.subject_id is not null`. `sentry-watch` leaves `subject_id` NULL — a
  decision made for a different reason (an issue is about several athletes, not
  one) that turns out to be load-bearing here. Both jobs run every 5 minutes; if
  that gate were ever widened, a Sentry alert could be opened and resolved
  inside one window and `exec-notify` — which filters `resolved_at is null` —
  would skip it forever. **Widening that `where` clause is a change to this
  system, whatever else it is doing.**
- **`/exec` renders an alert kind it has never seen (2026-07-26).** The
  dashboard prints `{a.severity.toUpperCase()} · {a.kind}` raw with no label
  map, and neither `exec_overview()`'s `alerts_open`/`alerts_critical` counts
  nor the open-alert list filter on `kind`. So a `sentry_issue:<shortId>` row
  appears on the founder dashboard, counts, and its RESOLVE button works
  through the generic `exec_resolve_alert(id)` — no client change needed.

**The 35 new test cases were hand-traced on 2026-07-26** (every assertion in
`error-report.test.ts` and `sentry-envelope-parity.test.ts` evaluated on paper
against the implementation, including both frame grammars, the greedy-optional
V8 capture group, all four gate cases and the redaction ordering). All 35 agree
with the implementation. **This is not a substitute for running them** — a hand
trace cannot catch a bad import path, a vitest resolution failure or a tsc
error, which are the three most likely ways this file set actually goes red.

The rest of this list still needs a run.

0. **`cd client && npm ci` before anything else, and confirm it finished.**
   Not a formality — it is the step whose absence failed this work order once.
   `node_modules` is gitignored, so a `git worktree` checkout of this branch has
   none, and `npx tsc --noEmit` / `npm test` / `npx expo lint` then fail with
   *"use npm install typescript"*, *"'vitest' is not recognized"* and a bare
   `Module.require` stack respectively — three messages that read like a broken
   diff and mean nothing but "no dependencies here". Attempt 2 reported exactly
   those three and they were not about this code (see HANDOVER §5). Only once
   `npm ci` is green do the failures below mean anything:
   `npx tsc --noEmit` · `npm test` (the 35 new cases in `error-report.test.ts`
   and `sentry-envelope-parity.test.ts` have still never been executed) ·
   `npx expo lint` · `npx expo export -p web --clear`.

1. **The client reports.** First confirm the DSN actually reached the bundle —
   `grep -o 'ingest\.sentry\.io' dist/_expo/static/js/web/entry-*.js` — because
   Metro inlines `EXPO_PUBLIC_` values and does not invalidate its transform
   cache (§3.3), and a miss there reads exactly like a working monitor that
   found nothing. Then, in a browser console on the deployed build:
   `setTimeout(() => { throw new Error('EVOFORGE monitoring probe'); })`.
   Expect one issue in Sentry within seconds, with a stack, `surface: client`,
   `release` equal to the `entry-<hash>.js` the page is running, and `user.id`
   equal to the signed-in smoke account. **Delete the issue afterwards.**
   If the DSN *is* in the bundle and the POST still does not produce an issue,
   suspect the request's content type before anything else: `send()` posts a
   bare string on purpose, so the browser labels it `text/plain` to keep the
   report a SIMPLE request (no CORS preflight on a device already in trouble).
   Check the network tab for the ingest response — that is the one part of the
   wire format no unit test can pin, because it is set by the browser and
   judged by Sentry.
2. **The gate holds.** Throw the same error 50 times in a loop. Expect **one**
   event, not 50 — and no more than 5 distinct defects inside any minute.
   Break `createReportGate` to return `true`, watch the count explode, restore.
3. **The redaction holds.** `throw new Error('x athlete@example.com')` — the
   issue must read `x [email]`.
4. **An edge function reports.** Call any function with a body that makes it
   throw. Expect `surface: edge`, `fn: <name>`, **and the same HTTP status and
   body the client saw before this change** — verify the second half, it is the
   property `serveMonitored` exists to preserve.
5. **The founder alert fires.** With two smoke accounts hitting probe #1, run
   `sentry-watch` by hand and confirm an `exec_alerts` row appears with
   `kind = 'sentry_issue:…'`, then that `exec-notify` pushes it. Delete the row.
6. **It alerts only once per issue.** Run `sentry-watch` twice: the second run
   must return `opened: []`. Resolve the alert, run again — still `[]`.
7. **Off means off.** Unset `EXPO_PUBLIC_SENTRY_DSN`, rebuild `--clear`, and
   confirm the bundle no longer contains the DSN (the grep from #1, zero hits).
   Then **force the probe throw from #1 and expect zero network requests to
   `*.ingest.sentry.io`** — the absence of traffic only means something if you
   made the app throw first. Check it that way round: `monitoringStatus()` is a
   module export and not a global, so nothing can call it from a production
   console.
8. **A crash on the FIRST render still reports.** Every other probe here throws
   at a moment when the app is already running, which is the one case that was
   never in doubt. Make a route throw during its *initial* render instead — the
   honest way is the real shape: restore a stale persisted query cache under a
   new bundle (the 2026-07-20 lockout), or temporarily throw at the top of a
   route component's body and hard-refresh onto it. Expect an issue with
   `mechanism: route-error-boundary`. **This is the probe that would have failed
   before 2026-07-26**: `initMonitoring()` runs in RootLayout's effect, the
   boundary reports from an effect DEEPER in the tree, and React flushes passive
   effects child-first — so the report ran before the DSN was parsed and died on
   the `!dsn` early-out. `captureException` now self-starts. Break that
   (`if (!started)` → `if (false)`), watch this probe go silent while probe #1
   keeps working, restore.

---

## 5. What this still does not catch

Stated rather than papered over:

- **A throw before React mounts** (a 404'd bundle, a module-scope error) never
  reaches `initMonitoring`, because it has not run yet. That failure already has
  an owner — the `+html.tsx` boot overlay — and closing the gap properly means a
  snippet in the HTML shell, which is a separate change.
- **Minified web frames** until source maps are uploaded per release (see §2).
- **Errors the app swallows on purpose** — `track()`, the beacons, the offline
  queues. They are silent by design; making them loud is a different decision.
- **Native builds** have no entry hash, so their release is whatever
  `EXPO_PUBLIC_SENTRY_RELEASE` says, or `unknown`.

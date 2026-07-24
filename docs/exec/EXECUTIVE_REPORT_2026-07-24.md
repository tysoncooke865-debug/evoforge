# TODAY'S EXECUTIVE REPORT — 2026-07-24

*Every number below was queried live from the production database today. Nothing
here is estimated unless it says so.*

---

## The headline

**EvoForge is an exceptionally well-built application with a broken funnel.**

The engineering is genuinely strong: 1,633 tests green, CI green on the last five
runs, a cross-language golden contract that has kept the maths correct through a
full platform rewrite, and a battle engine with replay-digest determinism most
studios never bother with.

And in fourteen days of real users:

> **27 real people signed up. 10 ever logged a single set. 2 have used the app on
> four or more days. One of those two is Tyson.**

The company has been building *depth* (Arena 2.0 shipped six phases today) on top
of a funnel that loses **63% of everyone who walks in the door before they log one
rep**. Fitness comes before gaming — and right now the fitness loop is not being
reached.

---

## Overall Product Health — **43 / 100**

| Dimension | Weight | Actual | Target | Score |
|---|---:|---|---|---:|
| Activation — signup → first set | 20% | **37%** (10/27) | 60% | 62 |
| Time-to-first-set ≤ 5 min *(constitution)* | 10% | **7%** (2/27) | 50% | 14 |
| Retention — trained on 2+ days | 25% | **22%** (6/27) | 45% | 49 |
| Depth — trained on 4+ days | 15% | **7%** (2/27) | 30% | 25 |
| Reliability & observability | 15% | no alerting; one 46 h user-blocking outage undetected | — | 30 |
| Engineering quality | 10% | 1,633 tests green, CI green, guards falsified | — | 90 |
| Revenue | 5% | **$0**, no billing rail exists | — | 0 |

**Weighted total: 43.3 → 43/100.** The score is deliberately reproducible: same
query, same formula, every morning.

**Development Progress** · Version 1.0.0 (`app.json`), branch `expo-rewrite`,
86 migrations applied (→082), 620 TypeScript files, 35 screens, 19 edge functions.
Seven commits today, six of them Arena 2.0.

**Launch Readiness — 55%.** The *product* is built well past what a launch needs.
The *launch machinery* is not:

| Gate | State |
|---|---|
| Error / crash monitoring | ❌ **none** — no Sentry, no alerting, nothing watches production |
| Transactional email (SMTP) | ❌ `smtp_host: null`, **2 emails/hour** shared sender; password reset is unusable at any scale |
| Legal package | ⚠️ shipped, but operator entity, contact email and jurisdiction are still placeholders; no lawyer review |
| Push notifications | ❌ needs a native build — a habit app with no habit instrument |
| Web first-load (LCP ~6 s) | ⚠️ the first thing every new user experiences |
| Payment rail | ❌ does not exist (no Stripe, no RevenueCat, no IAP) |
| Auth, RLS, security posture | ✅ solid — owner-only RLS, definer RPCs, TOTP 2FA, storage reveal gate |
| CI/CD | ✅ 4-job pipeline, auto-deploys client + all edge functions |

---

## Current Biggest Risk

**Nobody is watching production, and it has already cost a real user.**

On 2026-07-21 one real athlete signed up and hit a hard failure in Origin
binding. Over the next **46 hours** their client emitted:

- **20,051 `session_start` events** (≈ 7.3 per minute, sustained)
- **146 `origin_binding_failed`** — a 100% failure rate across 142 attempts
- **29 `origin_selected`** — they chose an origin twenty-nine times
- **13 `onboarding_resumed`** — they came back and tried again, repeatedly
- **0 sets logged. 0 minutes of real product use.**

The cause: `profile` has always permitted duplicate rows ("latest wins"), and
`assign_origin_path` used `RETURNING INTO`, which raises P0003 when it sees two
rows. The client collapsed the 400 into "network", so retrying forever changed
nothing. Migration **082 fixed it and is confirmed live in production today.**

Three things about this incident matter more than the bug:

1. **The system never noticed.** 20,000 error-shaped events produced no alert.
2. **It took two days to fix**, and only because a human happened to look.
3. **The user never came back.** Their last event was 2026-07-23 06:37.

That user is 3.7% of the entire real user base, lost to a failure the database
could have flagged in the first ninety seconds.

Secondary risk from the same incident: **`analytics_events` has no write
throttle.** One stuck client wrote 20k rows unbounded onto a FREE-plan database.
That is a cost and abuse vector, not just noisy telemetry.

### Related finding: a real user's email address is committed to a public repo

`migrations/082_origin_bind_duplicate_profiles.sql:1` names the affected athlete
by email in its header comment, and `tysoncooke865-debug/evoforge` is **public**.
The documents in `docs/exec/` were written without it deliberately.

This is **not fixed here**, on purpose: `migrations/` is a protected path, the
house rule is *never edit an already-deployed migration*, and editing the comment
would not remove the address from git history anyway. A real scrub means
rewriting the history of a public repository — Tyson's call, not an agent's.

**Recommended:** decide between (a) leave it, (b) redact at HEAD via an
`[architect]` comment-only edit, or (c) a history rewrite. And adopt the rule
going forward: **incidents are described by behaviour, never by identity**, since
every migration comment in this repo is world-readable.

---

## Current Biggest Opportunity

**Activation. It is worth more than every feature currently in flight, combined.**

The funnel, real users only (smoke accounts excluded):

```
27  signed up
24  created a profile          ──  3 abandoned before the first write   (−11%)
12  bound an Origin            ── 12 abandoned during onboarding        (−44%)
10  logged a set               ──  2 more never trained                 (− 7%)
 6  trained on 2+ days
 2  trained on 4+ days
```

**Time-to-first-set among the ten who activated:** 3 min · 11 min · 195 min ·
223 min · 1,355 min · 1,356 min · 1,663 min · 2,794 min · 2,892 min · 3,081 min.

Seven of ten took **between 22 and 51 hours** to log their first set. The product
constitution says *"users should complete their first workout within 5 minutes."*
Two of twenty-seven did.

Moving activation from 37% → 60% is worth **+6 activated athletes per 27 signups**
— more real users than every non-training feature in the app has produced in its
lifetime. And unlike a feature, it compounds against every future signup.

---

## What the product is actually being used for

Lifetime totals, all users, every system ever built:

| System | Rows | Reality |
|---|---:|---|
| **Training log** | **593 sets** / 12 users | the product |
| XP events | 662 | follows training |
| Achievements | 128 | follows training |
| Nutrition (Fuel) | 48 | thin but alive |
| Workout schedules | 28 | |
| **Battle participations** | **32** | **25 of them (78%) are Tyson, one power user, and smoke accounts** |
| Battle matches | 20 | 5 other real users each tried exactly one |
| Evo ratings | 19 | |
| Social posts | 17 | |
| AI plans generated | 17 | |
| Bodyweight logs | 11 | |
| Physique assessments | 9 | |
| Competitive matches | 8 | |
| Friendships | 5 | |
| Routines | 3 | |
| Rivalries / PvP matches | 2 / 2 | |
| **Push subscriptions** | **1** | the retention instrument, unused |
| **Gyms** | **1** | |
| **Measurements / damage photos** | **0 / 0** | built, never touched |

Read that column honestly: **the Arena — the subsystem receiving essentially all
current engineering — has been played by five real users, once each.** Not because
it is bad. Because 63% of signups never get far enough to see it.

This is the clearest evidence the CEO can offer: **the constraint is not content
depth. It is the first five minutes.**

---

## Top 5 priorities

### P1 — Activation rescue *(retention, enjoyment, consistency)*
Instrument the signup → first-set path end to end, find where the 63% actually
die, and fix it. We currently know *that* users drop between profile creation and
Origin binding (−44%), but not *why* — the analytics rail records `page_view` and
`origin_*` events but no step-level onboarding funnel with abandonment reasons.
**Ship instrumentation first, then fix what it shows.** Guessing here would waste
the whole quarter.

Known suspects, cheapest first: 6 s first-load; Origin binding asks for a
permanent identity choice before the athlete has logged anything; there is no
"log one set right now" path that skips onboarding entirely.

### P2 — Production observability + alerting *(reliability)*
The minimum that would have caught the 2026-07-21 incident inside two minutes:
a scheduled check over `analytics_events` for error-shaped bursts, a per-user
write throttle, and a notification that reaches a human. This is the honest
justification for the executive dashboard — see
`docs/exec/DASHBOARD_ARCHITECTURE.md`. Build the alerting spine before the pretty
pages.

### P3 — A reason to come back tomorrow *(retention)*
Six of 27 users have trained on two separate days. Web push works on iOS 16.4+
installed PWAs and on Android today — the app already has the
`push_subscriptions` table and a `send-push` function, with exactly **one**
subscriber. Either activate that rail properly or accept that retention waits on
a native build. Do not build more in-app content until one of those is true.

### P4 — Close the launch gates *(needs Tyson)*
Cheap, blocking, and only Tyson can do them: configure custom SMTP (Resend/
Postmark/SES), fill the three legal placeholders, commission the legal review.
Until SMTP exists, password reset is capped at two emails an hour and frequently
spam-filtered — every locked-out user is permanently lost.

### P5 — Arena 2.0: continue, but time-boxed and re-sequenced
P0–P5a shipped today and the work is excellent — the determinism doctrine (new
state out of the digest, effects in) is exactly right, and 1.0 replays are
provably safe. **Recommendation: finish P5's champion kits, then pause before
P6.** P6 is meta/retention/ranked ladder — retention machinery for a mode five
real users have played once. It becomes the right investment the moment
activation is fixed, and the wrong one until then.

**Explicitly flagged: this reprioritisation contradicts the work currently in
flight.** That is the recommendation, and it is Tyson's call to accept or reject.

---

## Recommended tasks by department

**Engineering (CTO / Lead Engineer)**
1. Onboarding funnel instrumentation — one event per step with an explicit
   abandonment reason; a `funnel_step` event name, not five bespoke ones.
2. Rate-limit `analytics_events` writes per user per minute (server-side, RLS-
   compatible) — the 20k-row incident must be structurally impossible.
3. A scheduled anomaly check (pg_cron or an edge function) over
   `analytics_events`: error-burst, activation-drop, zero-DAU.
4. Normalise duplicate `profile` rows and add a guard so the next RPC that
   forgets "latest wins" fails in CI, not in production.
5. Investigate the pre-existing carousel bug found on 2026-07-24 — opening any
   Modal on Train drops today's card out of the DOM (`ui/train/daily-workout-carousel.tsx`
   + RN-Web `Modal`). Reproduced with zero code changes.

**UX (UX Director)**
1. Re-time the Origin choice. It currently gates the training loop behind a
   permanent identity decision made by someone who has logged nothing. Test
   deferring it until after the first workout.
2. Build a "log one set in 60 seconds" path from a cold start and measure it.
3. Audit the first-run experience on a real phone over a real network — 6 s LCP
   is a UX problem before it is a performance problem.

**Product (Product Manager)**
1. Define activation formally (first set within 24 h of signup) and put it on
   the dashboard as the company's north-star metric.
2. Write the spec for P1 only after the instrumentation reports back.
3. Freeze new surface area. 35 screens; six systems with ≤5 lifetime rows.

**Data (Data Analyst)**
1. Stand up the daily metric snapshot so trend, not just level, is visible.
2. Cohort the funnel by signup week — the Origin flow launched 2026-07-17 and
   pre/post cohorts are currently mixed together in every number above.

**Marketing**
1. **Do not spend on acquisition yet.** At 37% activation and ~7% depth
   retention, paid traffic funds a leak. Fix P1 first; the same spend is worth
   roughly 2.4× more afterwards.
2. Prepare, don't launch: ASO copy, the referral mechanic, and the launch list
   can all be built while P1–P4 land.

---

## Potential blockers

| Blocker | Owner | Impact |
|---|---|---|
| Custom SMTP not configured | **Tyson** | password reset unusable; blocks growth |
| Legal placeholders + review | **Tyson** | blocks public launch |
| No native build | Tyson / eng | blocks push + Sentry + fixes LCP |
| AutoSprite art for 4 champions | **Tyson** (manual — no API in repo) | blocks Arena 2.0 P5 completion |
| Ranked ladder farm-proof rule | **Tyson** sign-off required | blocks Arena 2.0 P6 |
| Free-plan Supabase limits | eng | one stuck client wrote 20k rows unthrottled |

---

## Estimated completion dates *(engineering-days, assuming current velocity)*

| Item | Estimate | Earliest |
|---|---|---|
| Funnel instrumentation shipped | 1 day | 2026-07-25 |
| Alerting spine (anomaly check + throttle + notify) | 2 days | 2026-07-27 |
| Dashboard Phase 1 (read-only exec overview) | 2 days | 2026-07-29 |
| Activation fixes (post-instrumentation) | 3–5 days | 2026-08-02 |
| Arena 2.0 P5 kits complete | 3 days | dependent on art (Tyson) |
| Launch gates closed | Tyson-dependent | — |

---

## API usage, cost, and ROI

**Spend is not a constraint and should not influence any decision.** Lifetime AI
usage: ~100 cached scans, 17 AI plans, 17 Evo assessments, 9 physique judgements,
0 damage assessments — comfortably under **$5 lifetime**. Supabase is on the FREE
plan. Cloudflare Pages is free. Cost routing is already sensible: planners on
`gpt-5-mini`, the three judges deliberately kept on `gpt-5.1` for verdict
consistency and battle fairness.

**Expected ROI of today's recommended work:** the funnel instrumentation costs one
engineering-day and is the precondition for a change worth **+23 percentage points
of activation**. On the current base that is +6 athletes per 27 signups; at any
future acquisition volume it is a permanent multiplier on every marketing dollar
ever spent. Nothing else currently proposed comes close.

---

## What I did not do

- **No product code was changed.** This pass was inspection, documentation and
  planning, per the brief.
- **The Origin-flow drop-off cause is not diagnosed** — only located. The
  instrumentation to diagnose it does not exist yet, and guessing would be worse
  than waiting one day.
- **Retention numbers mix cohorts.** The Origin onboarding launched 2026-07-17;
  users before and after that date went through different products. The direction
  is unambiguous, the precise per-cohort figures are not yet split.
- **`last_sign_in_at` overstates activity** — it counts a session refresh, not a
  session. Where retention is claimed above it is measured on *training days*
  (`workout_log`), which cannot be inflated that way.

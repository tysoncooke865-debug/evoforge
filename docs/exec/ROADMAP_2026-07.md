# EvoForge roadmap — from 2026-07-24

Supersedes root `ROADMAP.md` (written 2026-07-11, pre-launch, Streamlit-era).
Evidence for every claim: `docs/exec/EXECUTIVE_REPORT_2026-07-24.md`.

---

## The one-sentence strategy

**Stop adding depth. Fix the first five minutes, learn when production breaks,
give people a reason to return — then resume building the game.**

The product currently loses 63% of signups before a single set is logged, and the
Arena — the destination for essentially all current engineering — has been played
by five real users once each. Depth is not the constraint. Entry is.

---

## Sequencing rationale

Ordered by *evidence strength × leverage ÷ cost*, not by appeal:

1. **You cannot fix what you cannot see.** Instrumentation before fixes.
2. **You cannot ship safely while blind.** Alerting is insurance on everything after.
3. **Activation compounds.** Every point gained applies to every future signup.
4. **Retention needs an instrument**, and the app's only one (push) has one subscriber.
5. **Launch gates are cheap, blocking, and Tyson-owned** — start them early so they
   run in parallel.
6. **Arena 2.0 is excellent work aimed at a mode nobody reaches yet.** It becomes
   correct the moment activation is fixed.

---

## NOW — this week

### N1 · Onboarding funnel instrumentation 🔴 blocking everything
One `funnel_step` event per step with an explicit abandonment reason, covering
sign-up → consent → profile → assessment → Origin candidates → Origin bound →
first workout opened → first set logged.
**Problem:** we know 12 of 24 profiled users die at Origin binding; we do not know why.
**Evidence:** funnel §"Current Biggest Opportunity".
**Success:** the drop-off step and its top reason are visible within 48 h of a signup.
**ROI:** ★★★★★ · **Effort:** 1 d · **Deps:** none

### N2 · Alerting spine + analytics write throttle 🔴
`migrations/083` (`exec_alerts`, `exec_metric_daily`) · `exec-watchdog` edge
function on a 5-minute schedule · per-user write throttle on `analytics_events` ·
push notification to Tyson. Rules and falsification listed in
`DASHBOARD_ARCHITECTURE.md` §4.
**Problem:** a 46-hour user-blocking outage went unnoticed; one client wrote 20k rows unthrottled.
**Success:** time-to-detection under 5 min (from ~48 h); the 07-21 event replayed against the rules fires an alert.
**ROI:** ★★★★★ · **Effort:** 2 d · **Deps:** none

### N3 · Duplicate-profile normalisation + CI guard 🟠
Collapse the two known duplicate `profile` rows; add a guard that fails CI when a
single-row profile read omits `order by created_at desc limit 1`.
**Problem:** 082 fixed two RPCs that forgot "latest wins"; the next one repeats the outage.
**Success:** guard falsified (broken → red → restored); zero duplicate rows.
**ROI:** ★★★★ · **Effort:** 0.5 d · **Deps:** none · **`[architect]` commit**

### N4 · Launch gates — Tyson-owned, start now 🔴
Custom SMTP (Resend/Postmark/SES) · fill `legal-content.ts` placeholders
(operator entity, monitored contact inbox, governing law) · book the legal review.
**Problem:** password reset is capped at 2 emails/hour on a shared, spam-filtered sender.
**Success:** `smtp_host` non-null; a reset email delivered to a real inbox in under 60 s.
**ROI:** ★★★★★ (blocking) · **Effort:** hours · **Deps:** Tyson only

### N5 · Decide on the public-repo email leak 🟠 Tyson-owned
`migrations/082…sql:1` names a real user by email; the repo is public. Choose:
leave it, redact at HEAD, or rewrite history. Adopt the forward rule —
**incidents are described by behaviour, never by identity.**
**ROI:** ★★★ · **Effort:** minutes to decide · **Deps:** Tyson only

---

## NEXT — the following two weeks

### X1 · Activation fixes 🔴 the main event
Scoped *after* N1 reports. Candidates, cheapest first:
- **Defer the Origin choice until after the first workout.** It currently demands
  a permanent identity decision from someone who has logged nothing — the single
  most suspicious step in the funnel (−44%).
- **A "log one set in 60 seconds" cold-start path** that bypasses onboarding entirely.
- **First-load cost.** ~6 s LCP is the first experience every user has.
**Success:** activation 37% → 60%; time-to-first-set ≤5 min for 50% of signups.
**ROI:** ★★★★★ · **Effort:** 3–5 d · **Deps:** N1

### X2 · Make the return instrument real 🟠
The `push_subscriptions` table and `send-push` function exist and work; there is
**one** subscriber. Either drive PWA push subscription properly (works on Android
and on iOS 16.4+ installed PWAs) or accept that retention waits on native.
**Problem:** 6 of 27 users have trained on two separate days; nothing invites them back.
**Success:** >50% of activated users subscribed; measurable next-day return lift.
**ROI:** ★★★★★ · **Effort:** 2 d · **Deps:** X1 (don't invite people back to a funnel that leaks)

### X3 · Executive dashboard Phases 2–3 🟠
The `(main)/exec/` route group, Executive Overview, Product Health and Analytics —
cohorted by signup week, with `domain/exec/` scoring under test.
**Success:** the daily executive report is generated from the app, not hand-written SQL.
**ROI:** ★★★★ · **Effort:** 4 d · **Deps:** N2

### X4 · Arena 2.0 P5 completion 🟢
Finish the champion kits (five kits need real engine ability handlers — targeting
is hardcoded per-id in `champion-abilities.ts`), plus the balance-harness re-check.
Art for four champions is blocked on Tyson (no AutoSprite API in the repo; the
Mass Monster PixelLab GIFs could be bridged by a GIF→atlas converter).
**Success:** five kits shipped, digest-safe, balance harness within tolerance.
**ROI:** ★★★ · **Effort:** 3 d + art · **Deps:** art (Tyson)

### X5 · The Train carousel Modal bug 🟠
Opening any Modal on Train shifts the daily hero carousel's virtualized FlatList
window and drops today's card out of the DOM until the user scrolls back.
Pre-existing, reproduced with zero code changes on 2026-07-24.
**Problem:** it degrades the single most important screen in the product.
**ROI:** ★★★ · **Effort:** 1 d · **Deps:** none

---

## LATER — once activation and retention are real

- **Arena 2.0 P6 (meta / ranked ladder).** Deliberately deferred. It is retention
  machinery for a mode five real users have played once, and the ranked ladder
  needs a farm-proof server rule, a migration and Tyson's sign-off besides. It
  becomes correct once players actually reach the Arena.
- **Arena 2.0 P7** — device pass and 1.0 cutover.
- **Native builds (EAS).** Unblocks push, Sentry, and the LCP problem in one move.
  The largest single technical lever remaining — and the reason to do it is
  retention, not performance aesthetics.
- **Sentry.** Real crash reporting; the dashboard's Product Health page stays
  honestly marked `NOT INSTRUMENTED` until it exists.
- **Payment rail.** No Stripe, no RevenueCat, no IAP exists. Revenue is $0 and
  structurally cannot be non-zero. Not urgent — monetising a funnel that loses
  63% of arrivals is premature — but it is the whole of objective #4 and cannot
  stay invisible forever.
- **Dashboard Phases 4–7** — Roadmap, Activity Feed, GitHub/Testing, screenshot
  diffing, and the AI Workforce rail if Tyson wants it real.
- **Strength percentile vs population** — asked for, never built. Cheap, and
  genuinely motivating for exactly the users who already train.
- **Marketing / acquisition.** Held deliberately. At 37% activation, paid traffic
  funds a leak; the same spend is worth ~2.4× more after X1.

---

## Rejected, with reasons — do not re-propose

| Idea | Why not |
|---|---|
| A separate Next.js dashboard app | Doubles the maintenance surface of a one-person company; the Expo app is already universal and already has the admin gate and design system. `DASHBOARD_ARCHITECTURE.md` §2. |
| Dashboard quick-actions (deploy / merge / approve from the phone) | The constitution forbids auto-merge and unapproved production deploys. Surface state and links, not triggers. |
| A mocked AI Workforce page | "A system without a backend is HIDDEN, never mocked" — the established rule from the Home redesign. Build the activity rail or omit the page. |
| Forecast charts today | 27 users. Any forecast is noise dressed as confidence. |
| More web bundle micro-optimisation | Async routes already cut the entry 3.5 MB → 1.1 MB. The remaining fix is native builds. |
| New muscle subgroup chips (obliques, rotator cuff, lower abs) | No exercise carries those tags; adding them means re-tagging ~960 exercises and migrating history the append-only ledger cannot survive. A data change, not a UI one. |

---

## The metrics this roadmap is judged on

| Metric | Today | 30-day target |
|---|---|---|
| Activation (signup → first set) | **37%** | 60% |
| Time-to-first-set ≤5 min | **7%** | 50% |
| Trained on 2+ days | **22%** | 45% |
| Trained on 4+ days | **7%** | 30% |
| Time-to-detection, production anomaly | **~48 h** | <5 min |
| Push-subscribed activated users | **1 user** | >50% |
| Product health score | **43** | 65 |

Re-measured by the same queries, every morning.

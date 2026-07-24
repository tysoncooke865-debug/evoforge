# Executive dashboard — proposed architecture

Status: **proposal, nothing built.** Decision required from Tyson on §2 before
any code is written.

---

## 1. What this is for, honestly

The brief asks for a beautiful cross-platform dashboard with ten pages. Applying
the product constitution's own test — *what user problem exists, what evidence
supports this* — the answer is unusually concrete:

> On 2026-07-21 a real athlete emitted 20,051 `session_start` events and 146
> `origin_binding_failed` over 46 hours and left forever. Nothing noticed. The
> fix landed two days later because a human happened to look.
> (`EXECUTIVE_REPORT_2026-07-24.md`)

**The value is in being told, not in having somewhere to look.** A founder who
must remember to open a dashboard has not been given leverage. So the sequencing
below builds the *alerting spine first* and the pages second — even though the
pages are the part that was asked for.

The second real problem it solves: today the only way to answer "how is EvoForge
doing" is to hand-write SQL against the management API, which is what produced
this morning's report. That is not repeatable by anyone but an agent with a
token.

**Success is measured by:** time-to-detection of a production anomaly (target:
under 5 minutes, currently ~48 hours), and Tyson making a prioritisation call
without asking anyone to run a query.

---

## 2. The load-bearing decision: extend, don't found

The brief lists React · React Native · Expo · **Next.js** · Supabase ·
TypeScript · Tailwind.

**Recommendation: build the dashboard inside the existing Expo app as an
admin-gated route group. Do not stand up a separate Next.js application.**

| | Extend the Expo app (recommended) | Separate Next.js app |
|---|---|---|
| Desktop / mobile / tablet | ✅ already universal — web, iOS, Android from one tree | web only unless a second RN app follows |
| Auth + admin gate | ✅ **already exists** — `app_admins`, `is_app_admin()`, Tyson is sole admin | rebuild |
| Design system | ✅ `theme/tokens.js` is the single copy of every design value, guard-enforced | duplicate or drift |
| Data access | ✅ supabase-js + RLS + definer RPCs already wired | rebuild |
| CI / deploy | ✅ existing 4-job pipeline, auto-deploy | new pipeline, new host, new secrets |
| Starting point | ✅ **`/insights` already ships** — admin-gated, three rollup RPCs, TanStack Query hooks | greenfield |
| Cost to a one-person company | one route group | a second application to maintain forever |

The `/insights` screen (236 lines, migration 080) is already a working v0 of
Executive Overview. The dashboard is a **promotion of that screen into a
section**, not a new product. A second app would double the maintenance surface
of a company whose stated goal is *reducing* founder management overhead.

Where Next.js would genuinely win — SEO, server rendering, public marketing
pages — none apply to an admin-only tool. If a public marketing site is wanted
later, *that* is the right Next.js project.

---

## 3. Shape

```
client/src/app/(main)/exec/          ← new admin-gated route group
  _layout.tsx        is_app_admin() gate + section nav (redirects non-admins)
  index.tsx          Executive Overview
  health.tsx         Product Health
  analytics.tsx      Analytics
  roadmap.tsx        Roadmap
  activity.tsx       Activity Feed + Notifications
  engineering.tsx    GitHub / Testing
  workforce.tsx      AI Workforce      ← only if §6 rail is built; otherwise absent

client/src/data/exec/                ← read hooks (extends data/analytics-admin.ts)
client/src/domain/exec/              ← pure scoring: health score, readiness,
                                       funnel maths, anomaly rules. TESTED.
client/src/ui/exec/                  ← presentation only
supabase/functions/exec-watchdog/    ← the alerting spine (§4)
supabase/functions/exec-github/      ← GitHub proxy, keeps the PAT server-side
migrations/083_exec_dashboard.sql    ← alerts, metric_snapshots, roadmap_items
```

Two house rules this must obey, both already load-bearing in this repo:

- **The thinking is pure and tested in `domain/`.** The health score, readiness
  percentage and anomaly thresholds are *derivations over rows*, so they belong
  in `domain/exec/` with tests — not inline in a screen.
- **A system without a backend is HIDDEN, never mocked.** (Established during the
  Home redesign, when LOADOUT was hidden rather than faked.) Every panel below is
  marked for whether its data source exists **today**.

---

## 4. Phase 1 — the alerting spine (build this first)

This is the part that would have caught the 2026-07-21 onboarding incident.

**`migrations/083`**
```sql
exec_alerts        id · kind · severity · title · detail jsonb · user_id?
                   · opened_at · resolved_at · notified_at
exec_metric_daily  day · metric · value        -- one row per metric per day
```
Both admin-read-only through definer RPCs. `exec_metric_daily` is the trend
substrate — today every number is a point-in-time level with no history.

**`supabase/functions/exec-watchdog`** — scheduled (pg_cron or an external
trigger), runs every 5 minutes, opens an alert when any rule fires:

| Rule | Threshold | Would it have caught 07-21? |
|---|---|---|
| Error-event burst, single user | >20 `*_failed` events in 15 min | ✅ **at ~09:05, 46 h early** |
| Event-write flood, single user | >200 events in 15 min | ✅ within minutes |
| Onboarding stall | user with a profile and no origin after 24 h | ✅ |
| Activation drop | 7-day activation below 30% | ✅ (ongoing) |
| Zero DAU | no sets logged in 48 h | ✅ (ongoing) |
| CI red on `expo-rewrite` | any failed run | n/a |

**Notification** — `send-push` already exists and works; Tyson is the one push
subscriber in the database, which for an admin alert channel is exactly enough.
Email fallback waits on SMTP (a launch gate anyway).

**Paired hardening, same phase:** a per-user write throttle on
`analytics_events`. The watchdog detects the flood; the throttle makes it
structurally impossible. Detection without prevention leaves the cost vector open.

Every rule gets **falsified once** — forced to fire against a crafted row in a
rolled-back transaction, then restored. A guard that cannot fail is not a guard.

---

## 5. The pages, and what each can actually know today

Green = the data exists in production right now. Amber = needs a rail built.
Red = needs an external service that does not exist.

### Executive Overview 🟢
Health score (large) · launch readiness % · today's priorities · current branch ·
latest commits · open alerts · build status. *Sources: rollup RPCs, `exec_alerts`,
GitHub API.*
**Quick actions** — deploy staging, approve/reject PR, run tests, pause AI:
🔴 **do not build these.** The constitution forbids merging major changes and
deploying production without approval; a one-tap deploy button on a phone is
exactly the affordance that rule exists to prevent. Surface *state* and *links*,
not triggers.

### Product Health 🟢 (mostly)
Retention · activation funnel · sets logged · avg session · DAU/WAU/MAU ·
most-abandoned screen · most-used feature.
🔴 **Crashes:** no crash reporting exists. Show the panel as
`NOT INSTRUMENTED — needs Sentry (native build)`, never a zero.
🔴 **Revenue / subscription %:** no billing rail exists. Same treatment.

### Analytics 🟢
Retention curves · workout volume · Evo Rating progression · onboarding funnel ·
session duration · daily growth. Trend needs `exec_metric_daily` (Phase 1) —
until it backfills, these are levels, not curves. **Cohort by signup week**: the
Origin flow launched 2026-07-17 and every current number mixes two products.
🟠 Forecasts: with 27 users, any forecast is noise. Defer until n is meaningful;
do not draw a confident line through ten points.

### Roadmap 🟢
Now / Next / Later / Done, each with ROI, difficulty, estimate, dependencies.
Backed by a `roadmap_items` table so it is one source of truth rather than a
markdown file that drifts. Seeded from `ROADMAP_2026-07.md`.

### Activity Feed + Notifications 🟢
Commits, CI runs, migrations applied, alerts opened/resolved. Real events with
real timestamps — no synthetic "09:24 UX improved onboarding" lines.

### GitHub / Engineering 🟢
Commits, PRs, issues, CI status, test count, coverage. Via `exec-github`, which
keeps the PAT server-side; the client never holds it.
🟠 Technical debt / code-quality score: only if it is a real measurement (lint
count, TODO count, bundle size, LCP from the existing Lighthouse job). A
subjective letter grade is decoration.

### Testing 🟢
Unit / integration / E2E counts, the six `verify-*` guards, coverage, Lighthouse
budgets — all already produced by CI, none currently surfaced anywhere.

### UX screenshot analysis 🟠
The repo already has Playwright tours and `arena-visual-tour.mjs`. A CI job could
capture screens per build and store them for side-by-side diffing. Automated
"spacing inconsistency detection" is a research project; **build the capture and
compare rail, not the AI critic.** Diffing two builds catches real regressions
today; a model guessing at padding does not.

### AI Workforce 🔴 — see §6

---

## 6. The AI Workforce page: what is actually true

The brief describes live departmental agents with status, current task, ETA,
CPU/API usage, and confidence.

**No such runtime exists.** Claude Code sessions are invoked by Tyson, run, and
end. Nothing persists between them, nothing reports status, nothing has a
confidence number. A page rendering "Engineer: coding feature… 78% confident"
would be fiction — and this repo has an explicit rule against exactly that.

Two honest options:

**(a) Make it real (recommended, small).** Add `exec_agent_activity`
(`session_id · department · task · status · started_at · ended_at · commit_sha`)
and have each agent session write a row when it starts, finishes, or commits. The
page then shows *what actually happened*, including the true answer "no agent has
run since 14:32". Cost: one table, one helper, a convention. Genuinely useful —
it is the audit trail of autonomous work, which matters more as more of it
happens unattended.

**(b) Don't build the page** until (a) exists.

Either is fine. Rendering imaginary agents is not.

---

## 7. Realtime, and why polling is the right answer

The brief asks for real-time updates. The honest engineering: **poll on a 30-second
interval via TanStack Query, and subscribe to Realtime on `exec_alerts` only.**

Metrics move on the timescale of human behaviour — a DAU counter that updates
every 30 seconds is already faster than the underlying reality. Alerts are the
one thing where seconds matter, so alerts get the socket. Subscribing to
high-churn tables on a free-plan project to animate a number that changes twice
an hour spends the connection budget on nothing.

---

## 8. Phasing

| Phase | Content | Est. | Depends on |
|---|---|---|---|
| **1** | Migration 083 · `exec-watchdog` + rules (falsified) · analytics write throttle · push alert to Tyson | 2 d | — |
| **2** | `(main)/exec/` group + admin gate · Executive Overview · `domain/exec/` scoring with tests | 2 d | 1 |
| **3** | Product Health + Analytics, cohorted; daily snapshot backfill | 2 d | 1 |
| **4** | Roadmap table + page · Activity Feed | 1 d | 2 |
| **5** | `exec-github` + GitHub/Testing pages | 1 d | 2 |
| **6** | Screenshot capture + diff rail in CI | 2 d | 2 |
| **7** | AI Workforce — only with §6(a) | 1 d | 6(a) decision |

**Phase 1 alone retires the biggest risk in the company.** Phases 2–7 are
leverage; Phase 1 is insurance, and it is the only part that is urgent.

---

## 9. Open questions for Tyson

1. **Extend `/insights` inside the Expo app, or a separate Next.js app?**
   (Recommendation: extend. §2.)
2. **AI Workforce — build the real activity rail (§6a), or omit the page?**
3. **Quick actions** — confirm that deploy/merge buttons stay out, per the
   constitution's approval rules. (Recommendation: out.)
4. **Alert channel** — web push to your installed PWA is available now; email
   waits on SMTP. Push only to start?

# Activation analytics (2026-07-25)

Extends `docs/ORIGIN_ANALYTICS.md`, which instruments onboarding and stops at
`onboarding_completed`. This covers what happens next — the stretch where
athletes are actually being lost.

## Why

The funnel, real users, split at the Origin flow's launch (2026-07-17) because
the cohorts went through different products:

| | post-Origin (10 users) | pre-Origin (17 users) |
|---|---:|---:|
| signed up | 10 | 17 |
| created a profile | 10 | 14 |
| bound an Origin | 8 | 4 |
| **logged a set** | **3** | 7 |

**In the current product the cliff is not onboarding — onboarding works.** Ten of
ten made a profile and eight of ten bound an origin. Then five of those eight
never logged a single set, and nothing in the rail says why.

*(An earlier read of this — `EXECUTIVE_REPORT_2026-07-24.md` — put the cliff at
Origin binding. That was cohort mixing: pre-Origin users never had the flow to
complete, so their absence looked like abandonment. The report is corrected.)*

What the four who vanished have in common, from the existing events: all four
completed onboarding, and three then emitted `pwa_nav_diag` — the nav-stall
beacon — before going quiet within 2–6 minutes. Stalls of 1.0 s, 0.9 s, 1.1 s,
and one of **18.9 s**. Suggestive, not conclusive: the sample is four, and
`page_view` did not exist until 2026-07-20, so three of them predate it entirely.

## What this adds that `page_view` cannot

Two structural gaps, not a nicer shape for the same data:

1. **`page_view` records the PREVIOUS route on navigation.** An athlete who
   lands on Home out of onboarding and quits without navigating emits *nothing*.
   That is exactly the population being measured. `home_reached` fires on
   arrival.
2. **`page_view` says a route was visited, never what was on it.**
   `train_opened` carries the state the athlete *found* — a plan or no plan, a
   workout or a rest day. That is the difference between "they didn't want to
   train" and "there was nothing to tap", and no existing event can tell them
   apart.

## The event

One name, `activation_step`, with an ordered `index`, so the funnel is
`max(index)` in SQL rather than a hand-written route-name query.

| index | step | fired from | extra props |
|---:|---|---|---|
| 1 | `home_reached` | Home mount | — |
| 2 | `train_opened` | Train mount, **after the plan queries settle** | `has_plan`, `day_kind` (`workout`\|`rest`), `exercise_count`, `plan_source`, `has_schedule` |
| 3 | `workout_opened` | workout page mount | `is_today` |
| 4 | `first_set_logged` | `useSaveSet` onSuccess, insert only, empty log | `durable` |

Every step also carries `step`, `index`, `ms_since_signup`, `ms_since_prev_step`.
Both durations are **null when unknown or negative** — a device clock that moved
backwards is not evidence, and a `0` would silently drag an average down.

`ms_since_signup` is the load-bearing prop. It separates the two hypotheses:
90 s from onboarding to Home is a technical failure; 400 ms to Home and then
three days of silence is a motivation failure. Nothing available today
distinguishes them.

Step 0 is deliberately **not** an event — a `profile` row is server truth and
exact, where an event can be lost. The funnel query below starts there.

## Bounded by construction

Each step emits at most once per athlete, and the ladder switches itself off
permanently once `first_set_logged` lands: **four rows per athlete, lifetime.**

This matters. On 2026-07-21 one stuck client wrote 20,051 rows into
`analytics_events` in 46 hours, unthrottled, on a free-plan database. This rail
cannot do that no matter what fails.

Duplicates are harmless anyway — the funnel query reads `max(index)` and
`min(created_at) per (user, step)`, both idempotent. **The local mark is a
write-volume optimisation, not a correctness mechanism.** That is precisely what
lets it be cleared on sign-out with every other cache, with no exception carved
out of the doctrine.

## The funnel query

```sql
with real as (
  select id, created_at from auth.users where email not like '%evoforge.internal'
),
reached as (
  select user_id, max((props->>'index')::int) as step
  from analytics_events where event_name = 'activation_step' group by 1
)
select
  count(*)                                                        as signed_up,
  count(*) filter (where exists (select 1 from profile p where p.user_id = r.id)) as profiled,
  count(*) filter (where coalesce(x.step, 0) >= 1)                as reached_home,
  count(*) filter (where coalesce(x.step, 0) >= 2)                as opened_train,
  count(*) filter (where coalesce(x.step, 0) >= 3)                as opened_workout,
  count(*) filter (where coalesce(x.step, 0) >= 4)                as logged_a_set
from real r left join reached x on x.user_id = r.id;
```

And the diagnosis — what the stalled athletes saw, and how long each step took:

```sql
select props->>'step' as step,
       count(*)                                             as athletes,
       round(avg((props->>'ms_since_signup')::numeric)/1000) as avg_s_since_signup,
       round(avg((props->>'ms_since_prev_step')::numeric)/1000) as avg_s_since_prev,
       count(*) filter (where props->>'day_kind' = 'rest')  as landed_on_rest_day,
       count(*) filter (where (props->>'has_plan')::boolean is false) as had_no_plan
from analytics_events
where event_name = 'activation_step'
group by 1 order by min((props->>'index')::int);
```

Because `max(index)` is a high-water mark, a deep link straight into a workout
counts as having reached Train too. That is intended: the funnel measures how far
an athlete got, not which doors they touched. `ms_since_prev_step` is measured
from the latest mark for the same reason.

## Inherited rules

Unchanged from `analytics.ts` / `ORIGIN_ANALYTICS.md`:

- **Fire-and-forget.** Never awaited, never gates navigation or a save. A
  rejected insert is swallowed.
- **No PII.** Counts and enums only — no exercise names, no weights, no reps,
  no dates beyond durations.
- **Falsify every guard.** The pure ladder is tested in
  `src/domain/__tests__/activation-funnel.test.ts`, including that the ladder
  goes silent after the terminal step and that a corrupt mark degrades to
  "emit again" rather than crashing a boot.

## What this does not do

- **It does not fix anything.** It is the instrument that tells us what to fix,
  and it deliberately shipped before any change to the onboarding hand-off.
- **It cannot see athletes who never return.** A step that is never reached
  emits nothing; absence is inferred from the profile row, not observed.
- **It says nothing about pre-2026-07-25 athletes**, who never ran this code.
  Roughly two weeks of new signups are needed before the funnel is worth reading
  — at the current rate, about nine athletes a week.

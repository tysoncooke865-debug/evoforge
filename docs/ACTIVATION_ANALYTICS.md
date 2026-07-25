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
| 1 | `home_reached` | Home mount | `ms_to_mount` |
| 2 | `train_opened` | Train mount, **focused**, after the plan queries settle (span starts at the tab press) | `ms_to_interactive`, `ms_home_to_interactive`, `device_class`, `device_tier`, `has_plan`, `day_kind` (`workout`\|`rest`), `exercise_count`, `plan_source`, `has_schedule` |
| 3 | `workout_opened` | workout page mount | `is_today` |
| 4 | `first_set_logged` | `useSaveSet` onSuccess, insert only, empty log | `durable` |

Every step also carries `step`, `index`, `ms_since_signup`, `ms_since_prev_step`.
Both durations are **null when unknown or negative** — a device clock that moved
backwards is not evidence, and a `0` would silently drag an average down.

## The stopwatch (WO-006, 2026-07-25)

`ms_since_prev_step` is the closest thing the original rail had to a duration,
and it conflates two unrelated quantities: **how long the app took** and **how
long the human thought about it**. An athlete who read Home for forty seconds and
one whose Home spun for forty seconds are the same row. The three props below
separate them, on the same events, with no new event name and no extra rows.

| prop | on | span |
|---|---|---|
| `ms_to_mount` | `home_reached` | the tap that ENDS onboarding → Home mounted |
| `ms_home_to_interactive` | `train_opened` | that same tap → Home's mission card stopped loading |
| `ms_to_interactive` | `train_opened` | the Train TAB PRESS → Train's plan queries settled |

The first two share a start deliberately: it is the moment the athlete finished
onboarding — the same tick `origin-flow.tsx::finish` emits `onboarding_completed`,
stamped by `onboarding.tsx`'s `onComplete` — not the moment a React component
happened to mount. The profile refetch that `onboarding.tsx` must await before it
can navigate is part of what the athlete sits through, and hiding it would be
measuring our own convenience.

### A span with no device is not the measurement that was asked for

The work order does not say "measure the hand-off". It says measure it **on a
real mid-range phone, not a desktop browser** — and `track()`
(`data/analytics.ts`) attaches nothing but the event name and the props. Pooled,
one percentile covers a developer's desktop, an iPhone and the mid-range Android
the drop-off is actually happening on; with ten athletes in the cohort, one
desktop row moves it. That is the same argument that forced `isHomeHandoff`
below, and the same failure mode: a flattering number that looks like evidence.

So `train_opened` — the event every span above rides — also carries:

| prop | values | from |
|---|---|---|
| `device_class` | `mobile` · `desktop` · `unknown` | `pointer: coarse` first, `maxTouchPoints` only where there is no media query |
| `device_tier` | `low` · `mid` · `high` · `unknown` | `navigator.deviceMemory`, **already bucketed by the spec** to 0.25/0.5/1/2/4/8 |

**Coarse on purpose.** A user-agent string would answer this and would also be a
fingerprint, which the analytics doctrine forbids (categories, never values —
the same reason ratings ship as `ratingBand`). The raw readings never leave the
device; only the bucket is emitted.

Two things to know before reading the column:

- **`device_class` beats `pad-env.ts` on touch-screen laptops.**
  `ui/core/pad-env.ts` ORs the media query with the touch count because its
  false positive is a spurious in-app keypad. Here it is precedence, not OR:
  `pointer: coarse` describes the PRIMARY pointer, so a laptop with a digitiser
  reads as the desktop it is. A desktop filed as a phone moves the percentile.
- **`device_tier` is `unknown` on iOS Safari and Firefox**, which do not expose
  `deviceMemory` at all. That is deliberate rather than patched over: inferring
  a tier from `hardwareConcurrency` would call an iPhone low-end, and a tier
  that is confidently wrong is the nav-stall beacon again. `device_class` still
  splits phone from desktop there, which is the question that was asked.

### …and only when onboarding hands off to HOME

Act I step 6 offers **BUILD MY OWN** and **SCAN MY PLAN**, and those athletes were
promised the routine builder, so that is where the tap sends them. `home_reached`
then fires whenever they eventually reach Home — however many minutes of building
a plan later. The first cut of this stopwatch stamped the span in
`origin-flow.tsx::finish`, which cannot see the destination, so for that cohort
`ms_to_mount` recorded **plan-building time as app time**: precisely the
`ms_since_prev_step` conflation this whole section exists to undo, and invisibly,
because a builder who finished in forty seconds looks identical to a Home that
spun for forty. With a cohort of ten, one such row moves the percentile.

The stamp is now guarded by `domain/activation-tti.ts::isHomeHandoff`, so those
athletes report `null` — unknown, which is true. The `count(prop)` column in the
re-measure query is what shows it, rather than a number that looks like evidence.

Home's interactive span rides `train_opened` rather than its own event because
`home_reached` has already fired by then, **on purpose**: it fires at mount so an
athlete who lands on Home and quits is still counted, which is the entire
population this funnel exists to see. A fifth step would break the
four-rows-per-athlete bound below. The cost is stated plainly: **Home's TTI is
only visible for athletes who went on to open Train.** For the ones who did not,
the funnel already answers the question that matters — they stopped at step 1.

**Rules, pure and tested in `domain/activation-tti.ts`.** A span is reported as
`null`, never as a number, when it:

- was never stamped (a cold boot, a deep link, or an onboarding tap that led to
  the routine builder rather than Home) — unknown is not instant;
- **touched a hidden document at any point** (`visibilitychange` + `pagehide` +
  `freeze`, because iOS PWAs suspend without the first);
- ran backwards (a device clock correction);
- exceeded **60 s**, the work order's own window — past that nothing was
  blocking a thread, and a span of hours is a suspended tab.

That second rule is the whole reason this is a module and not a subtraction. The
nav-freeze beacon *was* the subtraction: ~1,250 rows, 74.5% of them in the
900–1099 ms bucket that browsers produce by clamping timers on a hidden tab, and
a p50 of ~1001 ms on every route — which real jank never is. **Every
`pwa_nav_diag` row before 2026-07-25 is unusable, including the 18.9 s stall
quoted as evidence for the performance hypothesis this instrument tests.** An
instrument that reports noise is worse than none, because it looks like evidence.

A refused span is not a lost athlete. The step ladder is the census; this is only
the stopwatch.

### …and it is stamped ONCE, because the last tap of onboarding looked dead

`onComplete` cannot navigate until the profile refetch it awaits comes back — the
`(main)` gate bounces an athlete who arrives with a stale null profile straight
back to `/onboarding`. So **ENTER THE FORGE** sat lit and unchanged for a whole
Supabase round trip, which on the mid-range phone this work order is about is
long enough to read as a dead button. It cost twice:

- a second impatient tap emitted a **second `onboarding_completed`**, with a
  larger `duration_ms`;
- and it **restarted the stopwatch**, so `ms_to_mount` (and
  `ms_home_to_interactive`, which shares the span) reported only the time after
  the LAST tap.

The second is the one that matters here, and it is the house failure mode again:
the slower the hand-off, the likelier the extra tap, **so the instrument
flattered itself in proportion to the problem it was measuring** — the long spans
it exists to see are exactly the ones it would have truncated.

Two guards, because one of them lives in a component and components get rewritten:
`origin-flow.tsx` marks the button `busy` for the duration (the same `NeonButton`
state FORGE CHARACTER already uses), and the stamp goes through
`data/activation.ts::startActivationSpanOnce`, which refuses to restart a span
that is already running. Train's stamp is deliberately NOT once-only — a second
visit to Train really is a second hand-off. The once-guard is cleared on sign-out
with every other cache, so two athletes onboarding in the same tab are each
measured from their own tap. +3 tests.

The navigation is now unconditional — a rejected refetch no longer skips it — because
a busy button that can never clear is worse than the dead one it replaced, and of
the two failures the gate's own bounce is the recoverable one.

### The Train span starts at the PRESS, not at focus

`ms_to_interactive` is stamped by a `tabPress` listener on the Train tab
(`(main)/_layout.tsx`), not by the Train screen. This is the difference between
measuring the hand-off and measuring the tail of it: focus arrives **after** the
route's chunk has been fetched and the screen has rendered once, and on a
mid-range phone on mobile data that fetch is most of the wait. It is also exactly
what the two-wave preload removes — so a focus-stamped span would have read ~0 ms
both before and after the fix and declared the work done. **An instrument blind
to the fix it exists to judge is the nav-stall beacon again.**

The cost, stated: reaching Train **without pressing the tab** — a deep link, a
cold boot straight into Train, the mid-workout resume redirect — stamps nothing,
so `ms_to_interactive` is `null`. That is the honest answer rather than a
flattering one; a `0` there would drag the fleet average toward "we are fast".
Pinned by a test.

**What `ms_to_interactive` contained, so a high p90 can be read rather than
guessed at.** Until 2026-07-26 the Train route chunk carried the whole
~1,109-entry `EXERCISE_LIBRARY`, because `(main)/today.tsx` statically imported
`@/data/exercise-corpus` and `ui/train/exercise-search-bar.tsx` — both reached
only from the QUICK WORKOUT sheet, which is two taps away and usually never
opened. That is **≈246 KB of TypeScript source** (`exercise-library-imported`
164.6 KB · `exercise-library` 48.7 KB · `exercise-rank` 10.5 KB ·
`exercise-taxonomy` 8.4 KB · `exercise-search-bar` 8.0 KB · `exercise-sections`
4.9 KB · `exercise-history` 3.4 KB · `exercise-corpus` 3.2 KB) sitting in the
first chunk the two-wave preload fetches. The 2026-07-23 perf pass deliberately
kept that library out of the BOOT chunk; it came back on the hand-off's critical
path through a different door.

The sheet now lives in `ui/train/quick-workout-sheet.tsx` and is fetched through
`React.lazy` **on the tap**, so none of that rides the hand-off. Stated honestly:
those are SOURCE bytes from the static import graph, not exported chunk bytes —
no `expo export` has been run against the change (see HANDOVER). The number that
settles it is `ms_to_interactive` across the deploy split below.

### `train_opened` also requires FOCUS

Home's idle-time tab preload (`(main)/_layout.tsx`) prefetches `/today` in the
background, and a background mount runs mount effects like any other. Without a
focus guard, step 2 could fire — carrying correct-looking `has_plan` and
`day_kind` — for an athlete who never pressed Train, promoting the whole cohort
to step 2 and **deleting the exact drop-off this funnel was built to measure**.
`ready` now includes `useIsFocused()`. The guard is unconditionally correct
whether or not the prefetch mounts on a given platform: `train_opened` should
mean the athlete opened Train.

**Read the funnel accordingly:** step-2 counts recorded before 2026-07-25 may be
inflated by preloaded mounts. Compare like with like — post-fix rows only.

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

### The re-measure query (WO-006)

The one to run in two weeks, and the one to run again after any change to the
hand-off. Percentiles, not averages: a mean over a long tail hides the athletes
being lost, which is the whole failure mode here. `count(prop)` next to
`count(*)` is not decoration — it is how you tell "the app is fast" from "the
measurement is refusing everything", which is exactly how the nav-stall beacon
fooled us for a week.

```sql
select props->>'step'                                              as step,
       count(*)                                                    as athletes,
       count(props->>'ms_to_interactive')                          as tti_measured,
       percentile_disc(0.5) within group (
         order by (props->>'ms_to_interactive')::numeric)          as train_tti_p50_ms,
       percentile_disc(0.9) within group (
         order by (props->>'ms_to_interactive')::numeric)          as train_tti_p90_ms,
       percentile_disc(0.5) within group (
         order by (props->>'ms_home_to_interactive')::numeric)     as home_tti_p50_ms,
       percentile_disc(0.5) within group (
         order by (props->>'ms_to_mount')::numeric)                as home_mount_p50_ms
from analytics_events
where event_name = 'activation_step'
  and created_at >= '2026-07-25'
group by 1 order by min((props->>'index')::int);
```

Because `max(index)` is a high-water mark, a deep link straight into a workout
counts as having reached Train too. That is intended: the funnel measures how far
an athlete got, not which doors they touched. `ms_since_prev_step` is measured
from the latest mark for the same reason.

**Then run it again split by device — this is the number the work order asked
for.** The query above is the fleet; the one below is "a real mid-range phone,
not a desktop browser". Read the fleet first so you know how many rows exist,
then this, and expect the mobile p90 to be the ugly one:

```sql
select props->>'device_class'                                      as device_class,
       props->>'device_tier'                                       as device_tier,
       count(*)                                                    as opened_train,
       count(props->>'ms_to_interactive')                          as tti_measured,
       percentile_disc(0.5) within group (
         order by (props->>'ms_to_interactive')::numeric)          as tti_p50_ms,
       percentile_disc(0.9) within group (
         order by (props->>'ms_to_interactive')::numeric)          as tti_p90_ms
from analytics_events
where event_name = 'activation_step'
  and props->>'step' = 'train_opened'
  and created_at >= '2026-07-26'          -- the deploy that added the dimension
group by 1, 2 order by 1, 2;
```

`device_tier = 'unknown'` will be a large bucket and is not a defect — it is
every iOS and Firefox athlete (see above). Judge those on `device_class` alone.
A `device_class = 'unknown'` bucket that is anything but tiny IS a defect: it
means the read is failing, not that the devices are exotic.

### What `ms_to_interactive` is pointed at (2026-07-26)

The stopwatch exists to judge a specific claim, and the claim is about the Train
route chunk. Two changes have been made to it, both inside the span it measures:

| shipped | change |
|---|---|
| 2026-07-25 | the idle tab preload warms **Train alone** in the first wave; the other four tabs ride a second, chained pass |
| 2026-07-26 | the QUICK WORKOUT sheet moved to `ui/train/quick-workout-sheet.tsx` and is fetched **on the tap**, taking `EXERCISE_LIBRARY` (~1,109 entries, ~208 KB of source) and the ranking engine off the Train chunk |

So the re-measure is not one before/after but two. Split `created_at` on the
deploy that carries the second row — read the timestamp off the Cloudflare
deploy, not off the commit date, because CI gates it. Before that split the
Train chunk contains the library; after it, it does not. **Only
`>= 2026-07-25` rows are usable at all** (see the focus guard above).

Compare `ms_to_interactive` across that split — it is the prop the chunk change
moves. Do **not** read `ms_to_mount` across it: the `isHomeHandoff` guard landed
in the same window and deliberately changed which athletes report that prop at
all, so a shift there is a population change, not a speed change.

Read `tti_measured` next to `athletes` first, every time. If the measured count
collapses, the story is the refusal rules, not the app: the spans that survive
are the ones from a tab that stayed visible for the whole hand-off, and a change
that makes the hand-off longer gives a backgrounded tab more chance to poison it.
A p50 that improves while `tti_measured` falls is not evidence of anything.

Neither change has been measured on a real mid-range phone yet — that is the
outstanding half of WO-006, and it needs a device, not a desktop browser.

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

- **It cannot see athletes who never return.** A step that is never reached
  emits nothing; absence is inferred from the profile row, not observed.
- **It says nothing about pre-2026-07-25 athletes**, who never ran this code.
  Roughly two weeks of new signups are needed before the funnel is worth reading
  — at the current rate, about nine athletes a week.
- **It cannot see Home's TTI for an athlete who never opened Train** (see the
  stopwatch section — that number rides `train_opened`).
- **It does not measure the workout page or the first set.** Steps 3 and 4 carry
  no span. They were not the hand-off the drop-off points at, and every prop
  added here is a prop somebody has to keep honest.

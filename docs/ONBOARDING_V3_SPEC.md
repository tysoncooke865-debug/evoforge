# Onboarding v3 — earn the information, don't demand it

**Brief:** Tyson, 2026-08-05. **Status:** the contract for the v3 build.
Supersedes `docs/ORIGIN_ONBOARDING_SPEC.md` for the NEW-athlete path only;
that document stays authoritative for the migrated cohort and for the
candidate model itself.

The rule the whole document serves:

> An athlete must be able to join EvoForge, get a useful plan, log workouts,
> progress their character and take part in Reforge Day **without ever
> uploading a photograph.**

---

## 1. Why — what the funnel actually says

Read live on 2026-08-05 (real users only, `%evoforge.internal` excluded):

| stage | athletes | of previous |
|---|---:|---:|
| signed up | 31 | — |
| created a profile (finished Act I) | 25 | 81% |
| bound an Origin (finished Act II) | 16 | 64% |
| **ever logged a workout** | **11** | 69% |

**Sixty-five per cent of signups never log a rep**, and the two largest
absolute losses are both *inside onboarding*: nine athletes between the
profile row and the Origin, six before the profile row.

The event rail agrees. Of the 14 athletes who emitted `onboarding_started`,
only 10 emitted `initial_assessment_started` — **four abandoned the Act I form
itself**, a form that asks for height, bodyweight, three one-rep maxes,
training years, an eating phase, a physique photo and a globally-unique
username before it will hand over anything at all.

`docs/ACTIVATION_ANALYTICS.md` concluded "the cliff is not onboarding —
onboarding works". That was written at n=10 on 2026-07-25. At n=31 it no
longer holds and this document corrects it. The post-onboarding drop is
**also** real (5 of 16 bound an Origin and never trained) — v3 addresses both,
because the same fix serves them: hand over a first workout instead of a form.

### The specific defect

Onboarding asks for the highest-trust, most emotionally difficult input
before the athlete has received any value. And the cost of declining is not
neutral: `startingLevelV2` takes physique from the AI scan (0–15) or, when
skipped, from `derivedPhysiqueDefault`, **which caps at 10**. Declining to
photograph yourself is worth up to five levels today.

That inverts the correct relationship. Missing photos should reduce
**confidence**, never **score** — otherwise an athlete who protects their
privacy is penalised for it, and the athletes most likely to decline are
exactly the lower-confidence ones EvoForge could help most.

---

## 2. The compulsory path

Seven steps, one screen each, no scroll walls.

| # | step | asks | writes |
|---:|---|---|---|
| 0 | `intro` | nothing | — |
| 1 | `goal` | one primary + optional secondaries | `onboarding_goal`, `secondary_goals`, derived `primary_goal` |
| 2 | `experience` | one of five bands | `experience_level`, derived `training_years` |
| 3 | `route` | have a program / build me one | `training_route` |
| 3b | `plan` | days, session length, equipment, preferred days | `training_days_per_week`, `session_minutes`, `equipment_access`, `preferred_days` |
| 4 | `origin` | Origin + champion presentation | `origin_path`, `sex` |
| 5 | `ready` | nothing — the payoff | plan + schedule seeded |
| 6 | `today` | training today? | schedule / reminder intent |

Step 3b is skipped entirely on the "I already have a program" route.

### Copy that is load-bearing

- **0** — `FORGE YOUR STRONGEST SELF` / "Track your training, build your Evo
  Rating and watch your character evolve alongside you." / `BEGIN` +
  *Already have an account?* The fitness product leads; the game layer
  follows. No three-slide carousel.
- **1** — "What are you training for?" Never "what do you want to fix".
- **2** — "Where are you starting from?" + **"You can change this later."**
- **4** — "Choose your Origin", explicitly reversible.
- **5** — "Your Forge is ready." **One** CTA: `START FIRST WORKOUT`.
- **6** — "Are you training today?" is asked as the reveal's own two
  options rather than as a seventh screen: `START FIRST WORKOUT` (dominant)
  and a quiet `NOT TODAY`. An extra screen asking a question the CTA already
  answers is the kind of step this rewrite exists to delete. Yes opens the
  logger with a single hint on the first exercise ("Enter your weight and
  reps, then tap the tick when the set is complete"), and then **stops
  teaching**. Not today asks which day, and *re-lays the seeded week so that
  day is session one* — the answer changes the app, it is not just
  acknowledged.

### The reminder, stated truthfully

The reminder rail (migration 085) deliberately **never nudges an athlete who
has not logged a set** — a notification is not how you manufacture a habit
that does not exist yet. So the offer says exactly that: reminders begin
after the first logged workout and name the actual session. Permission is
requested on the `REMIND ME` tap and nowhere in signup.

Two goal answers deliberately store `primary_goal = NULL`: "become more
consistent" and "track my current program" point at no Origin, and the
candidate model reads `primary_goal` as an origin signal. The athlete's real
answer is kept verbatim in `onboarding_goal` (migration 134).

### What LEAVES the compulsory path

Height · bodyweight · bench/squat/deadlift 1RM · training years (typed) ·
nutrition phase · physique photo · body-fat · username · public/private.

Each one is still collected — later, at the moment it earns its keep:

| moved to | why then |
|---|---|
| first social surface (Social tab, leaderboard opt-in, friends) | a username only means something when someone can find you by it |
| after the first completed workout | physique baseline — value received first |
| Evo Rating calibration card | lifts, cardio benchmarks, bodyweight |
| the feature that needs it | health integrations, notifications |

This is progressive disclosure, and it is also Apple's current onboarding
guidance: postpone nonessential configuration and request private-data
permission only when the person reaches the relevant feature.

---

## 3. Placement, without lifts

`startingLevelV3(experience, goal)` replaces `startingLevelV2` **for new
athletes only**. V2 stays exactly where it is: it is parity-pinned, it
produced every existing `base_level`, and nothing may recompute those rows.

V3 takes experience band → a conservative base, plus a small goal-neutral
band, and **nothing else**. Consequences, all deliberate:

- Declining a photo cannot cost a level, because photos are not an input.
- Nor can declining to type a 1RM.
- The placement is *less precise*. It is allowed to be: `base_level` no
  longer drives the displayed Forge Level (XP-only since 2026-07-16), only
  avatar staging and the legacy arena level. Precision is bought back by the
  Evo Rating as evidence arrives, which is what the rating is for.

Later-supplied lifts refine the **Evo Rating strength pillar**, never
`base_level`. `base_level` stays immutable after onboarding, as today.

---

## 4. The Origin is chosen, never scanned

For new athletes the Origin is a straight five-way choice: Titan · Mass
Monster · Elite Aesthetic · Apex Engine · Shredder. No recommendation is
shown, because at this point there is **no evidence to recommend from**, and
this codebase does not mock a system that has no backing (`home-features`
doctrine). A confident-looking recommendation derived from four taps would be
a fabricated number.

The **candidate model v5 is not deleted.** It keeps running exactly where it
has evidence to run on:

- the **free Reforge** after three valid workouts — whose copy already says
  "now with real training evidence", which is now literally true;
- the **migrated cohort** (`docs/EXISTING_USER_ORIGIN_MIGRATION.md`), who
  arrive with a full profile.

`OriginScanPrompt` stops leading with photos. An origin-less athlete is
pointed at the *choice*, not at a scan. Assigning a character from a
photograph is the one thing this flow must never do: someone short on
confidence reads it as the app deciding they are not lean or muscular enough
to be the character they liked.

---

## 5. The Evo Rating calibrates in public

No complete rating during onboarding. After it:

```
EVO RATING · CALIBRATING
Log your first workout to begin your rating.
```

The calibration card names five areas and what moves each:

| area | status before evidence |
|---|---|
| Training | Starts after first workout |
| Strength | Learns from logged sets |
| Cardio | Add a run or benchmark later |
| Physique | Optional private calibration |
| Consistency | Builds over time |

After the first workout: `Starter Evo Rating: NN — Provisional · 2 of 4 areas
calibrated`. The four *pillars* are size, aesthetics, strength, cardio; the
five *areas* above are the athlete-facing version and include consistency,
which is momentum. The count shown is always pillar-derived, never a decorative
number.

`evo_rating_current.status` (`provisional` under 40 confidence) and
`confidence_label` already exist — v3 surfaces them rather than inventing a
parallel notion of completeness.

**Missing photos lower confidence, never score.** This is a *checked*
invariant, not an aspiration: `domain/__tests__/photo-confidence.test.ts`
asserts that removing the scan inputs from an otherwise identical review
leaves `displayedRating` byte-identical while lowering the physique pillars'
confidence — plus a positive control that a scan measuring something
*different* does move the rating, so the first claim cannot pass by the scan
being ignored.

One structural detail the test surfaced and the UI must respect:
`overallConfidence` is the **minimum** of the four pillars. For a new athlete
with no cardio evidence, cardio is the floor, and a physique scan therefore
changes the headline confidence by nothing at all. So the calibration card
names the **limiting** area rather than implying a photo is what every
athlete is missing — which would be both wrong and a nudge toward the one
thing the brief says never to push.

---

## 6. Photos: after value, never as a gate

**Never** in compulsory onboarding. The first prompt is a card offered after
the first *completed* workout, or on the second app visit:

> **Create your private starting point**
> Add front, side and back photos to calibrate the physique portion of your
> Evo Rating and compare future Reforge Days. Photos are optional — you can
> use every training feature without them.

`CREATE PRIVATE BASELINE` · `USE MEASUREMENTS INSTEAD` · `NOT NOW` ·
`DON'T ASK ME AGAIN`. All four are equally visible; the skip is never tiny
grey text under an oversized glowing upload button.

`DON'T ASK ME AGAIN` sets `photo_prompts_disabled` and is honoured **for
good**, by every prompt surface. That athlete keeps: workout analysis,
strength rating, cardio rating, consistency, PRs, character XP, Reforge
summaries, and a provisional Evo Rating.

### Consent and disclosure

Before any capture, plain language, then affirmative consent — not fine
print, and not on the legal page:

> EvoForge uses these photos to estimate physique changes and update the
> physique portion of your Evo Rating. They are never posted to your profile.

Then the true retention sentence for this app, which is unusually simple and
must not be diluted: **solo physique photos are analysed and discarded — never
persisted, in any bucket, cache or temp file** (`client/CLAUDE.md`; the one
amendment is battle round-3 media, which is a different surface with its own
consent). Never say "only seen by AI" unless that describes the entire
pipeline including providers, logs and human-access policy.

Capture rules: system picker only, never broad gallery access; permission
requested on tap, never at signup; neutral silhouettes and "Stand naturally.
No flexing is required."; no lean fitness model beside the camera guide;
retake before upload; delete photos and derived results in Settings.

---

## 7. Reforge Day — 28 days, photo-optional

**Naming collision, resolved.** This repo already has a "free Reforge": a
one-off Origin re-choice unlocked by three valid workouts. That keeps its
mechanics and is called **Origin Reforge** in copy from now on.

**Reforge Day** is the new 28-day ceremony, anchored to the first completed
workout (falling back to account creation).

Every 28 days — not fortnightly. Front, side and back physique photos are
emotionally and logistically demanding, and asking twice a month spends the
ceremony's meaning. Monthly also makes the comparison worth looking at.

Between Reforge Days nothing freezes: strength stats update continuously, PRs
land immediately, XP and Forge Level rise, consistency moves, and the athlete
can see the countdown.

On the day: review the last 28 days · offer optional physique calibration ·
recalculate · reveal the movement · give the next priorities · trigger an
evolution if one was earned.

**Without photos it still completes:**

> **REFORGE COMPLETE** — Your training and performance data have been
> updated. Your physique calibration was not refreshed.

The reveal is never blocked behind an upload. On a first Reforge with no
baseline, the offer explains itself: *"These photos will create your private
baseline. Your next Reforge can show visual change."*

### What is NOT changing

The **weekly Evo Review stays weekly.** It is the engine — momentum decays per
missed week, the in-flight week is never judged, `next_review_at` is +7 days
and the whole progression model is built on that period. Making the engine
monthly to match the ceremony would silently rewrite progression math for
every existing athlete. Reforge Day is the *event the athlete experiences*,
layered on a review cadence that does not move.

---

## 8. Home, for an athlete with nothing yet

1. **Primary** — Today's Mission / Start your first workout.
2. **Secondary** — Evo Rating is calibrating · complete one workout to begin.
3. **Tertiary** — Private physique baseline · *Optional · whenever you're ready*.
4. **Background** — champion, Forge Level, training arc, upcoming rewards.

The incomplete baseline is never styled as an overdue task, a warning or a red
error. It is an offer.

---

## 9. Instrumentation

Added to the `activation_step` rail and the flow events:

`onboarding_started` · `goal_selected` · `experience_selected` ·
`training_route_selected` · `plan_created` · `onboarding_completed` ·
`first_workout_viewed` · `first_workout_started` · `first_set_completed` ·
`first_workout_completed` · `photo_baseline_prompted` ·
`photo_baseline_started` · `photo_baseline_completed` ·
`photo_baseline_skipped` · `photo_prompts_disabled` · `reforge_day_viewed` ·
`reforge_completed_with_photos` · `reforge_completed_without_photos`

Existing names are kept where they already mean the right thing
(`first_set_logged` is `first_set_completed`; renaming it would split every
historical funnel query at the rename date for no gain).

The bounded-by-construction rule from `ACTIVATION_ANALYTICS.md` still holds:
each step emits at most once per athlete, and no rail may become a loop.

### The activation measures

1. % completing onboarding.
2. % starting a workout within 24 h.
3. % completing a first workout within 7 days.
4. % returning within 7 days.
5. % voluntarily adding a photo baseline **after** receiving value.

**Do not optimise onboarding photo-upload rate at the expense of completed
workouts.** (5) is a quality signal, never a target to raise on its own.

---

## 10. How this gets tested

Not by keeping forced photos as an A/B control. The funnel above is already
credible evidence that the demand blocks people; running a control arm to
re-prove it costs real athletes.

What to compare instead:

- **A** — optional baseline prompt after the first completed workout.
- **B** — optional baseline card on the second app visit.

Measured on first-workout completion, later photo opt-in, and 7-day retention.

At 31 users, interviews beat statistics. Recruit deliberately across confident
experienced lifters, beginners, returners, people uncomfortable with their
body, and people who only want workout tracking. Hand them the app with no
explanation and watch where they pause, hesitate, or ask whether something is
compulsory.

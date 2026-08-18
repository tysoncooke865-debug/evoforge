# HANDOVER â€” start here

> **You are picking up EvoForge. Read this file, then `client/CLAUDE.md`. Read
> nothing else until you need it.**
>
> `HANDOFF.md` is the layered history (long, chronological, still accurate). This
> file is the CURRENT state, the rules that cost real bugs, and how to work here.
> Last updated 2026-07-16 (the Home redesign + optimisation session).

---

## 1. What this is

A fitness RPG: real training data (Supabase) drives a levelling, evolving
character, plus 1v1 battles. **One app now:**

| | |
|---|---|
| **Expo client** (`client/`) | THE product. Branch **`expo-rewrite`**, auto-deploys to **https://evoforge.pages.dev** (~5 min per push). **NOT `expo-rewrite.evoforge.pages.dev`** â€” that branch alias is stale (see Â§3). Everything below is about this. |
| **Streamlit** (`app.py`, Python) | **RETIRED (Tyson, 2026-07-16)** â€” no support, no optimising around it. The code stays on `main` as reference; its `domain/` goldens remain the pinned correctness contract for `client/src/domain/`. The pre-push hook now skips the Python suite for client/docs-only pushes. |

Owner: Tyson. He works through other Claude sessions too â€” **always
`git pull --rebase` before pushing**, and expect new plan docs to appear.

---

## 2. State (all shipped, CI-green, deployed)

- **THE ICON CONSISTENCY OVERHAUL (2026-08-11)** â€” `docs/ICON_AUDIT.md` is the
  inventory and the classification; read it before replacing any icon.

  **The finding that shaped everything: EvoForge has almost no icon FILES.** Of
  118 assets, six were UI icons. The icon system is three systems â€” 35
  hand-authored SVG pixel glyphs (`ui/core/pixel-icons.tsx`), 45 PixelLab
  sprites, and **577 raw Unicode characters across 40 files**.

  **THE SVG GLYPH SET IS PRESERVED, DELIBERATELY.** It has no PixelLab
  provenance and is a replacement candidate by the letter of the brief.
  Replacing it would be a downgrade: the glyphs are TINTABLE (every
  active/inactive state depends on `color` being a prop), resolution
  independent, and drawn at **14â€“19px** where a 64px raster is a 4:1 downscale
  to mush. `forge-materials-gen.mjs` already recorded both halves of that
  lesson â€” "a baked PNG is one size and one colour", and "32px, not the arena's
  64 â€¦ a smaller source keeps the pixels honest".

  What was replaced is the **colour emoji**, which render in the platform's own
  emoji font and belong to no part of this palette. Nine of the fourteen
  most-used needed NO generation â€” `PixelBolt`, `PixelCamera`, `PixelFlame`,
  `PixelPeople`, `PixelBell`, `PixelShield`, `PixelTarget` and `PixelDumbbell`
  already existed and the emoji was simply an older call site. Three new grids
  (`lock`, `search`, `scales`) cover the small functional symbols.

  **Seven are PixelLab art**, chosen by one question: *does colour carry the
  meaning, and is it drawn bigger than ~20px?* Gold beside silver beside bronze
  cannot be a tint of one shape. `scripts/pixellab/{icon-manifest,generate-icons,
  validate-icons}.mjs`; provenance (endpoint, prompt, seed, date, what it
  replaced) in `assets/pixel-lab/icons/manifest.json`; review page at
  `docs/icon-preview.html`. Total payload **25KB**.

  **THE FIRST PASS OF FOUR OF THEM FAILED** at the size they actually render:
  the medals spent ~45% of the canvas on ribbon, leaving a seven-pixel disc,
  and the badge's ribbon tails read as three stray red pixels at 14px. Judge
  every icon at its REAL size, never at 64Ã—64 â€” that is what the size ladder in
  the review page is for. Prompts reworked, seeds bumped, regenerated.

  **`ui/core/icons.tsx` is the registry**: one typed name â†’ glyph or raster, the
  caller never chooses which. Rasters render `imageRendering: pixelated`;
  `label` is required and null-able so every caller makes an accessibility
  decision.

  **Guards, falsified:** the PixelLab key must not appear under `src/`, and no
  `src/` file may reference `api.pixellab.ai`. Both had to learn that
  **comments are not code** first â€” `ui/boot/forge-intro.tsx` contains a
  paragraph explaining that the key must never enter the bundle, and a naive
  substring search fails on the documentation of the rule it enforces. Same for
  the emoji-regression check. `__tests__` is excluded from both (test files are
  not bundled, and the icon test necessarily contains the strings it bans).


- **THE TRAINING SYSTEM UPGRADE (2026-08-10/11, migrations 192â€“194)**

  Four things, in the order they matter. The whole of it rests on ONE rule:
  **AI generates programming. EvoForge owns exercise identity.**

  **1. CANONICAL EXERCISE IDENTITY â€” the architectural fix.**
  `workout_log.exercise` is a text column and every history lookup compared it
  with `===`. So an AI plan writing `Bench Press (Strength Focused)` had NO
  history, NO prefill and a PR baseline of zero â€” and production carried the
  scar: 43 rows under that spelling beside 42 under `Barbell Bench Press`,
  eighty-five sets of one lift that could not see each other.

  `domain/exercise-identity.ts` is the ONE resolver (Â§6): exact id â†’ curated
  alias â†’ normalised catalogue name â†’ plural fold â†’ the athlete's own exercise
  â†’ peel a *prescription* descriptor and retry â†’ a stable `name_<slug>`.
  Wired into `last-performance`, `set-save::previousBest1rm`, `exercise-history`,
  `recent-pr`, `bodyweight-records` and the picker's ranking.

  **THE SAFETY PROPERTY, and it is why this could ship against live tester
  data:** the resolver only ever MERGES on high confidence and its fallback is
  name-identity â€” i.e. exactly the old behaviour. It can make history more
  connected than it is; it cannot invent a connection between two lifts. A
  missing alias costs a little history; a wrong one fuses two athletes' numbers
  forever. Those are not symmetric, so when in doubt it does nothing.

  - `PRESCRIPTION_WORDS` in exercise-identity.ts is the *only* vocabulary a
    trailing descriptor may be made of. **NOTHING MECHANICAL MAY EVER JOIN IT**
    â€” incline, dumbbell, smith, close-grip, seated, paused, single-arm. Each
    would merge two real exercises. `pause` and `rest` are deliberately absent
    (rest-pause is a real prescription, but `Paused Barbell Bench Press` is a
    real and different lift, and the second mistake is the expensive one).
  - The catalogue is GENERATED: `node client/scripts/gen-exercise-ids.mjs`
    emits `src/domain/exercise-ids.generated.ts` (1,099 ids, hot-path safe â€”
    it must never import EXERCISE_LIBRARY, the muscle-lookup.ts lesson) AND
    `supabase/functions/_shared/exercise-catalogue.ts` in the SAME run, so the
    edge function and the client cannot drift. Pinned by
    `__tests__/exercise-identity.test.ts`, which also asserts the generator's
    normaliser matches the runtime's byte for byte.
  - There is exactly ONE resolver. The edge function only VALIDATES ids; a
    second implementation is the drift this change exists to remove.
  - Migration **192** adds nullable `workout_log.exercise_id`; **193** backfills
    it. The backfill is not hand-written â€” every distinct production name was
    run through the real resolver and transcribed. It merged eleven groups
    (123 names â†’ 112 identities) and left 30 ambiguous names as islands.
    **The fingerprint of exercise/weight/reps/date/set/workout was byte-identical
    before and after** (`dfb83ef4a108bc06d79f7eed772d16eb`, 1,159 rows).
  - **THE AVATAR COULD NOT SEE A BENCH CALLED "BENCH PRESS" (2026-08-11).**
    The strength score and the plate achievements read three lifts by NAME â€”
    the built-in routine's exact spellings â€” so `Bench Press`, `Barbell Squat`
    and `Deadlift` all read ZERO. Bench had a hand-written 3-spelling fallback;
    squat and deadlift had none. All four surfaces (avatar, live current stats,
    achievement sweep, its progress bars) now match by canonical id. It only
    ever finds MORE of an athlete's own lifts â€” incline/dumbbell/Smith/close-
    grip still count for nothing toward the barbell standard, asserted both
    directions. **Python keeps the literal compare on purpose**: gen_fixtures.py
    says in its own header that `calculate_avatar_stats` and
    `check_achievements` "are not fixturable and are excluded", so nothing pins
    them; `strength_score_from_ratios` (the pinned math) is untouched and the
    goldens are green. Deviation recorded in PARITY.md and pointed at from
    `domain/avatar_stats.py`.
  - **THE REST BUZZ SURVIVES iOS EATING THE SERVICE WORKER (196/197).**
    The worker holding a timeout is the MECHANISM and still fires first; iOS
    terminating a backgrounded PWA's worker is the case it cannot cover, and
    there is no client-side fix â€” the only delivery iOS guarantees to a
    suspended PWA is a remote push. So `rest_alarms` (ONE row per athlete,
    user_id is the PK) plus a ten-second `rest-alarm-tick` cron is the
    BACKSTOP. Not "requiring push for a rest timer" (Â§14): the in-app timer
    and the worker path work with no server at all, and no permission means no
    row. **Duplicates are structurally impossible** â€” the PK, `rest_alarms_due()`
    marking sent in the same statement it returns, the shared `evoforge-rest`
    tag, and the foreground completion cancelling the row before it can send.
    **THE CRON GUARDS ITS OWN COST**: an unguarded 10s job would be ~259K edge
    invocations/month, over half the FREE plan's allowance, to poll an empty
    table â€” so the job checks `exists(...)` in Postgres and only calls the
    function when something is genuinely due. `rest_alarms_due()` returns other
    people's push endpoints and is service-role only, revoked from
    `authenticated` as well as guarded in the body.
  - **PREFERENCES AND PR CROSSINGS (2026-08-11, migration 195).** A star, a
    hide and the KGâ‡„LB lens were keyed on the literal name, so an AI rename
    dropped all three â€” and the unit one is the dangerous member: an athlete
    who works in pounds got a card relabelled to kilos mid-set. Prefs are
    still STORED by name (`(user_id, exercise)` is the upsert target and does
    not move) but READ canonically, and **every write carries its siblings** â€”
    without that, un-starring under a new spelling leaves an older row saying
    `true` and the star will not switch off. `report_pr_crossings` gained an
    optional `p_exercise_id`; a friend's `Bench Press` best is now crossable
    by your `Barbell Bench Press`, and the 12h anti-spam bucket stopped being
    one bucket per wording. **Every 079 security property preserved and
    re-falsified**, plus a coherence check: a supplied id must be one the
    caller has actually logged under that name, or it is discarded.
  - **Migration 133 is STILL not applied** (verified against
    information_schema): workout_log has none of the load columns, so every set
    save already fails once and retries stripped. `exercise_id` is therefore in
    its OWN optional group â€” a retry that dropped everything optional would
    leave the new column live and permanently empty. The write paths now loop,
    dropping only the group the error names.

  **2. QUICK WORKOUT IS ALWAYS REACHABLE (Â§1).** It used to exist only on the
  rest-day card and two taps inside MANAGE PLAN â€” so on precisely the days you
  had a plan, "something else today" was the hardest thing in the app to say.
  It now sits BESIDE the hero CTA. Beside, not under, because `train-scale.ts`
  is a device-MEASURED budget in which START WORKOUT clears the iPhone SE fold
  by ~3pt; a stacked second row would push the primary action under it.

  **3. TRAIN EARLY (Â§2, migration 194).** A planned session's identity is
  `(planned_date, workout)` â€” there is no session row in this schema, a plan is
  a weekday map over `user_plans`. `plan_session_claims` claims that pair.
  **The sets log to TODAY**, through the paths that have always written them, so
  XP, streaks, PRs, coins, Evo and the finish marker are untouched; the only
  thing a claim changes is whether the future day still asks. A claimed day
  reads COMPLETED and is **NOT locked** â€” locking keys only on the finish
  marker, which lives on the day actually trained. Refused when the workout
  NAME is already in play today: sets are keyed (date, workout) and two
  sessions may not share one key. `PUT IT BACK` is the undo.

  **4. THE REST TIMER (Â§13â€“Â§19).** The absolute-timestamp design was already
  right and is kept verbatim â€” only `endAt` is stored, remaining is derived
  from `Date.now()`, so backgrounding and lock screens are survived BY
  CONSTRUCTION. What was added: `state/rest-timer.ts` (identity, Â±30s),
  `domain/rest-clock.ts` (the pure arithmetic â€” it EXPIRES rather than showing
  a stale REST OVER from breakfast, which the old linger check got wrong),
  `data/rest-alarm.ts` scheduling a local notification through the service
  worker (`public/sw.js`, cache bumped to v3 â€” a timer handed to the old
  worker would be dropped on the floor), one-pulse vibration, and the ENABLE
  ALERTS ask on the FIRST rest and never again.

  **LIVE ACTIVITIES / DYNAMIC ISLAND ARE NOT IMPLEMENTED, DELIBERATELY.** There
  is no `ios/`, no `android/`, no `eas.json`; CI runs `expo export -p web` and
  the product is an installed PWA. A Live Activity needs a widget extension, an
  App Group and a native target. `data/rest-alarm.ts` is the seam Â§17 asks for:
  a native module implements two functions and nothing else changes. **Honest
  limit:** iOS may terminate the service worker while the PWA is backgrounded
  and the scheduled notification then never fires â€” the only guaranteed
  delivery is remote push, which Â§14 rules out. The catch-up on resume is what
  makes the experience correct anyway.


- **ENGAGEMENT v5.1 â€” THE COMPLIANCE MIGRATION (2026-08-09, migrations 159â€“176)**
  A design review rejected the staked Forge Drop plinko outright: coins into a peg
  board where an RNG bucket can return less than went in is simulated gambling
  under the Guidelines for the Classification of Computer Games 2023, which
  mandates R18+ against a 16+ single-app requirement. Earned-only coins and no
  cash-out do NOT exempt it â€” it is a mechanics test.

  Spec of record: `docs/ENGAGEMENT_V5.md`. Status, the full deviation register and
  the traps: **`docs/V5_MIGRATION_STATUS.md` â€” read it before touching coins.**

  **THE TWO GOVERNING INVARIANTS ARE STRUCTURAL, NOT ASSERTED.**

  1. *A balance may never be lower after an RNG event than before it.* No deduction
     anywhere is downstream of randomness. The board is retired; `forge_reveal_claim`
     takes one uuid and no stake, so a staked reveal is unconstructible in the
     schema rather than refused by a check.
  2. *Chance and pledge never combine.* Enforced at build time by
     `client/src/domain/__tests__/module-boundaries.test.ts`, falsified five ways.
     Pledges are skill-resolved with zero RNG; chance is additive with no pledge.

  **Â§10 BANS A VOCABULARY** (bet, wager, stake, odds, gamble, jackpot, spin, roll,
  casino, house, payout, cash out, double down, all-in, near miss) on every
  user-facing surface including SQL `raise exception` text, which reaches athletes
  as toasts. Say pledge, back, push, pool, trial, reveal, drop table, bonus, temper,
  claim, settle. `node tools/sweep-vocabulary.mjs --strict` is a CI step; it went
  78 â†’ 0 and must stay there.

  **NOTHING HERE CLAIMS THE APP IS LEGALLY CLEARED.** A one-off external legal
  sanity check before first submission with Trials live is still open.

  **THE OVERRIDE THAT MOST NEEDS RESPECTING**: Tyson lifted v5.1's ban on pledging
  above your own logged best (174â€“176, informed consent, recorded per pledge). He
  did NOT lift its other half â€” *the app may never solicit a max attempt*. No badge,
  no hint, no "go bigger" affordance. The confirmation appears only after the
  athlete has typed an above-best target themselves and the server has refused it.

- **LIVE WORKOUT CALL OUTS (2026-08-08, migrations 150â€“153)** â€” "50 says you
  can't hit this." A competitive layer over ONE upcoming working set, attached
  to the set the athlete was already going to perform. Full spec:
  `docs/WORKOUT_CALLOUTS.md`.

  **THE RULE EVERYTHING ELSE SERVES.** A logger who never touches it reaches the
  end of their workout with exactly the same taps â€” asserted mechanically, not
  by eye (tour TEST A): no callout node in the DOM, nothing overlapping the LOG
  button, and **zero `/rpc/callout_*` requests when a set is logged**. Every new
  prop on `ExerciseCard` is optional and absent by default, which is also why
  the Arena's Volume Duel is untouched.

  **THE STRUCTURAL IDEA: THE TRIGGER RESOLVES THE SET.** Logging a called set is
  the SAME TAP as any other. 153 hangs an AFTER INSERT OR UPDATE trigger on
  `workout_log` that fills the result in from the row. That makes it work through
  the durable offline queue, work for AI-transcribed workouts, and makes "the
  athlete cannot type their own wager result" structural rather than a promise.
  The whole body is wrapped in `exception when others then null`, for 146's
  reason: **the call out may be stale, the training may not be lost.**

  **THE ECONOMY.** Escrow rides `coin_events` like the duel's â€” `callout_stake`
  (negative, at ACCEPTANCE; nothing moves on an offer) and `callout_payout`
  (positive). A SEPARATE GUC, `evoforge.callout_authorized`: learning the duel's
  must not unlock this one. `-s -s +2s = 0` on every path.
  **No timeout ever pays anybody** â€” silence from either side refunds both, and
  the card says NOT ATTEMPTED (Tyson's call; among friends, the social cost is
  the right deterrent, and any auto-payout is farmable).

  **RULES THAT COST REAL BUGS HERE:**
  - **MIGRATION 133 IS NOT APPLIED IN PRODUCTION.** `workout_log` is still the
    legacy 13 columns â€” no `load_mode`, no `external_load_kg`. The client already
    knows (`isMissingLoadColumn` retries the insert without them); nothing else
    did. The trigger reads them through `to_jsonb(new)` so an absent column is
    NULL rather than a runtime error its own exception block would swallow â€”
    which would have made the feature silently never resolve, for everyone.
    `callout_judge` has a legacy `(weight, reps)` path and both are asserted.
  - **THE REVEAL GATES CREATING, NEVER ANSWERING.** Gating the incoming card on
    "has this athlete trained enough" leaves a friend's coins in an offer the
    recipient can never see. The SETTING gates both sides, and the server checks
    the setting, not the reveal.
  - **`both` is a reserved word in plpgsql** (`trim(both â€¦)`) â€” a bare syntax
    error on the assignment line, nowhere near the declaration.
  - **A `not exists` in HAVING that mentions the raw column is an
    ungrouped-column error.** Close the aggregate in a subquery first.
  - **RLS with no UPDATE/DELETE policy does not RAISE â€” it matches nothing.** A
    test asking "did it throw?" passes just as well on a wide-open table. Ask
    what changed instead.
  - **`set_config('request.jwt.claims', â€¦)` does not enforce RLS through the
    management API** â€” it still runs as the table OWNER, which is exempt. `set
    local role authenticated` is what drops the exemption, and without it a
    policy test is theatre.
  - **`decompose()` is wrong at micro scale.** It picks the smallest denomination
    that still FILLS a table, so a 50-coin pot drew as ten grey 5s â€” illegible at
    96pt and the COMMON band for a legendary moment. `potChips()` (minimal
    breakdown) is the right picture when the number sits beside it.
  - **`useChipTable` never draws the amount it is HANDED.** `ownAmount` starts
    equal to it, so the "changed from outside" effect no-ops: a micro pot that
    opens holding the caller's stake rendered "Throw chips in." where fifty coins
    of somebody else's money were supposed to be. Only a screenshot caught it.

  **VERIFYING IT.** `node tools/falsify-workout-callouts.mjs` â€” 137 SQL
  assertions against production as real athletes, self-cleaning, and its Â§16
  **removes each guard, shows the test go red, and rolls it back** (the one-live
  index, the judge, the coin guard). `node tools/tour-workout-callouts.mjs` â€” 57
  assertions through a browser on two phones, different workouts, zero console
  errors, screenshots of every state. Run BOTH: the browser one found the empty
  micro pot, a see-through card and a SEND button below the fold, all of which
  passed every structural test that existed at the time.

  **THE FOLLOW-UP PASS (same day, Tyson on a real phone):** the call is
  EDITABLE in the tray (steppers that write BACK to the set row via
  `state/set-draft.ts`, so a call and its set can never be two numbers); the
  tray is ~72% tall because at 50% the chip rail still fell below the fold and
  the two-tap path began with a scroll; the rail offers EVERY denomination â€”
  starting at 25 had quietly made 25 the real minimum stake when the config's
  floor is 5, a limit nobody chose expressed as a missing button; and tilt now
  works in the tray.

  **THREE DEFECTS THAT PASS ONLY BECAUSE ONE OF THEM CRASHED LOUDLY:**
  - **`useCalloutRealtime` MUST BE MOUNTED ONCE, AT THE AUTHENTICATED ROOT** â€”
    the rule `useOnlinePresence` already documents. It was on three screens, and
    a visited tab STAYS MOUNTED, so supabase-js handed the second screen the
    already-subscribed channel and `.on()` threw: *"cannot add
    `postgres_changes` callbacks for realtime:callouts::id after
    `subscribe()`"*. That took the whole route down on a tab change, seven times
    in twelve minutes. **The route error boundary's own `app_error` /
    `route_crash` rows named it exactly** â€” query `analytics_events` before
    theorising about a crash. The hook now also refuses a second subscribe.
  - **A PERMISSION AFFORDANCE MUST SURVIVE COMPACT MODE.** `compact` hid the
    quick row, and ENABLE TILT lived in it â€” so on an installed iPhone PWA, the
    platform this ships as, there was no way to grant motion in the one place it
    was newly wanted. A permission you cannot ask for is a feature you do not
    have.
  - **ASK FOR MOTION ONCE, IN SETTINGS** (`ui/duel/physics/motion-permission.ts`).
    A grant is remembered device-locally, so the tray stops asking; the Motion
    physics switch in Profile is the gesture that grants it, because a switch tap
    is a gesture and Settings is where somebody looks. The flag suppresses the
    ASKING only â€” a reading is still the only thing that reports tilt as live.

  **THE TILT, TWICE MORE (same day):**
  - **THE VERTICAL AXIS WAS MEASURED IN THE WRONG SPACE.**
    `orientationGravity`'s vertical term is the in-plane component `sin Î²` â€”
    honest for a phone lying flat, wrong for one held up. A phone is read at
    Î² â‰ˆ 90Â°, where `sin` peaks: the derivative is ZERO, so small pitches moved
    nothing, and Î² = 70Â° and Î² = 110Â° give the SAME value, so leaning the top
    toward you and away from you were indistinguishable. A hand thinks in
    ANGLES, so `orientationLeanDeg` measures the lean in degrees, subtracts the
    neutral in degrees, and only then takes `sin` of the DELTA â€” monotonic
    everywhere and identical from any hold. `sin(11.5Â°) = 0.2`, so the dead
    zone and gain keep the exact meanings they were tuned with.
  - **A REMEMBERED PERMISSION NEEDS A DEADLINE.** Remembering the motion grant
    stopped the tray asking every time â€” and then iOS dropped it across an app
    relaunch, so nothing arrived AND no ENABLE TILT appeared to fix it.
    Optimism with no way back is worse than the question it replaced. The web
    path now arms a 1.5s probe: no reading by then on a platform that gates
    motion means the grant is gone, so forget it and put the button back. Same
    shape as the boot-overlay rule â€” decide when the thing STILL has not
    happened, never on the first symptom.

  **A HARNESS THAT BREAKS WHEN THE PRODUCT SUCCEEDS IS MEASURING THE WRONG
  THING.** Both harnesses asserted a GLOBALLY empty `workout_callouts` at
  cleanup, which held only while they were the feature's only users. The day
  real athletes started calling sets, a correct cleanup began failing. Scoped to
  the smoke accounts; ledger conservation is now asserted over TERMINAL call
  outs only, since a live escrow legitimately nets negative until it settles.

  **A TRAP THAT COST AN HOUR:** another session was serving its own `dist` on
  4173, so `npx serve` died on the port collision and the tour ran against a
  STALE BUNDLE for three runs â€” features "missing" that were built and passing.
  **Check the served asset hash against `dist/index.html` before believing a
  browser tour**, and serve on your own port when the machine is shared.

- **THE FORGE DUEL (2026-08-08, migrations 144â€“148)** â€” the Challenges wager
  grew a chip table, a live pot, a raise negotiation, spectators and a
  supporter pool. Every existing duel, table and function from 139â€“143 still
  works; nothing was dropped and no row was deleted.

  **THE MONEY MODEL, in four sentences.** Forge Coins remain fictional,
  training-earned and non-purchasable; nothing here creates a path to
  real-world value. Participant escrow and supporter money are two tables, two
  coin kinds and two settlement functions, and neither can ever pay the other.
  The supporter pool is **pari-mutuel** â€” winners divide the losing side's
  stakes in proportion to their own â€” which is the only distribution that
  provably cannot pay out more than it took in. A duel touches `coin_events`
  and nothing else: XP, Evo Rating, Forge Level and the Training Arc have no
  code path from this feature.

  **WHAT IS NEW.** `stake` is a range instead of three buttons (bounded by
  `forge_duel_config`, one row, every knob); `current_stake` grows with
  accepted raises while `stake` stays the locked opening contract;
  `forge_duel_offers` carries raise / all-in / counter-stake proposals with a
  **partial unique index on (challenge_id) where status = 'pending'**, so two
  conflicting proposals are unrepresentable rather than merely discouraged;
  `forge_duel_support` holds one position per supporter per duel;
  `forge_duel_reactions` is five fixed names whose primary key IS its rate
  limit. 146 hangs triggers on `workout_sessions` / `cardio_log` /
  `workout_log` so the duel scores itself from training the athlete already
  logs â€” including via AI transcription, because the trigger sits under every
  write path rather than beside one of them. It also finally populates
  `forge_challenge_qualifying`, which 139 created and nothing ever wrote.

  **THE RULES THAT COST REAL BUGS HERE:**
  - **A trigger on `workout_log` can eat an athlete's set.** `forge_duel_touch`
    wraps its whole body in `exception when others then null`. The duel is
    allowed to be stale; the training is not allowed to be lost.
  - **`coin_events` is unique on (user_id, kind, source_id).** A raise
    therefore needs its OWN source (`<duel>:<offer>`) â€” a second
    `challenge_stake` row against the bare duel id collides with the opening
    one. That index is also what makes double-charging a raise impossible at
    the storage layer.
  - **A Reanimated completion callback must not re-assign its own shared
    value.** `withTiming(..., () => { v.value = withSpring(...) })` recursed
    into "Maximum call stack size exceeded" on every chip tap while LOOKING
    completely correct. Use `withSequence`.
  - **The global `staleTime: 45_000` is wrong for a duel.** Everything on that
    screen can be changed by somebody else, and an offer with a countdown
    cannot be served from a 45-second cache. The duel queries override to
    `staleTime: 0` + `refetchOnMount: 'always'` + a focused 30s poll.
  - **Accepting a duel must answer every open proposal about its terms** (147).
    Countering and then simply accepting left a `pending` counter that hid the
    raise button for the rest of the contest.
  - **A cascade can destroy coins** (148). Deleting an account takes the duel
    row and leaves the survivor's escrow pointing at nothing; the sweep repairs
    it, filed under `<duel>:orphan` so the repair groups with the stake it
    repaid and can never run twice.

  **VERIFYING IT.** `node tools/falsify-forge-duel.mjs` â€” 86 assertions in SQL
  against production as four real athletes (escrow, raises, counters, all-in,
  pari-mutuel splits, draws, cancels, orphaned escrow, ledger conservation on
  every path), self-cleaning and re-runnable. `node tools/tour-forge-duel.mjs`
  â€” the same lifecycle through a browser, 51 assertions and zero console
  errors. Run BOTH: the SQL one proves the server is right, the browser one
  proves an athlete can reach it, and every bug in the list above was
  invisible to the first.

- **THE PHONE IS THE TABLE (2026-08-08, no migration)** â€” the chip table gained
  device-tilt gravity and physical chip stacks. Tilting the handset moves the
  GRAVITY VECTOR inside matter-js (`use-tilt-gravity.ts` â†’ `world.setGravity`);
  nothing translates a sprite. Holding a tray chip builds a real column of
  individual bodies joined by breakable constraints, so it stands, slides
  downhill when the table leans, and comes apart when something hits it.

  **THE WAGER IS NOT PHYSICAL.** Money moves on commit, before a body is ever
  spawned; the simulation only draws what the ledger already says. Tilt cannot
  add, remove or revalue a chip, and the tour asserts the stake is unchanged
  after tilting, toppling and collapsing the pile.

  **THE RULES THAT COST REAL BUGS HERE:**
  - **`expo-sensors` DeviceMotion does not work on web at all in SDK 57.**
    `DeviceSensor.addListener` calls `this._nativeModule.addListener(...)`, and
    `ExponentDeviceMotion.web.js` is a plain object with `startObserving` /
    `stopObserving` and **no `addListener`**. Every subscribe threw a
    TypeError, was swallowed, and reported "no motion sensor" on a phone that
    has one. **EvoForge ships as an installed PWA, so web IS the phone.** The
    web path now binds `window.addEventListener` directly â€” `deviceorientation`
    for the reading, `devicemotion` as the fallback â€” and asks BOTH
    `requestPermission()`s from the one gesture (iOS gates them separately even
    though a single user toggle answers both); native keeps expo-sensors, where
    it works.
  - **Reduced motion must not switch tilt off.** Deliberately tipping your own
    phone is as user-initiated as an input gets. Gating it on the OS flag was
    the SAME mistake as hiding the whole chip table behind `useReducedMotion`,
    made a second time â€” the accommodation is CALM mode (gentler slope, wider
    dead zone), never absence.
  - **Ask for permission BEFORE probing availability.** `isAvailableAsync`
    decides by waiting 250ms for a real `devicemotion` event, and on iOS no
    such event can fire before permission is granted, so the probe reports "no
    sensor" on precisely the platform that has one.
  - **A reading is the only proof the sensor works.** iOS offers no way to
    query whether motion is already permitted, so the state starts at
    `'prompt'` and the first real sample promotes it to `'on'`.
  - **The screen says which of the four failures it is.** Tilt can be absent
    for four different reasons (no sensor / not asked / refused / switched
    off) and they are indistinguishable from "broken" unless the hint line
    names one. `wager-motion-state` does.

  **THE TILT WAS STILL WRONG â€” three defects, fixed 2026-08-08** (Tyson: "the
  tilt is back to front and only works horizontally"). Each one hid the next,
  and the first two shipped behind a comment confidently asserting the
  opposite:
  - **`accelerationIncludingGravity` HAS NO PORTABLE SIGN.** The spec (and
    Chrome/Android) report PROPER acceleration â€” upright portrait `(0, +9.81)`
    â€” while **WebKit reports the gravity vector itself, the exact negative**.
    EvoForge ships as an installed PWA on an iPhone, so every axis arrived
    reversed. The fix is not a platform sniff: `deviceorientation`'s
    beta/gamma mean the same thing in every engine, so screen gravity is now
    DERIVED from them (`cosÎ²Â·sinÎ³`, `sinÎ²`, in `tilt-math.ts`) and the
    accelerometer is a fallback whose convention is a named argument.
  - **Gravity that cannot point UP the screen has no vertical axis.** It was
    floored at `+0.4` down, so a lean forward or back could only make the
    chips lighter â€” the pile could never travel to the far edge, which is
    exactly what "only works horizontally" was. It also needs a lid: the
    ceiling sits a table-height above the box so a flick can arc out of sight,
    and up-gravity sent the whole pot up there to settle where nobody could
    see it. `containBody` clamps at the top edge WHILE gravity points up â€” a
    clamp, not a static lid, because a lid has a far side and every chip
    spawns above the box.
  - **A slope under 0.85 moves nothing, so "the sensor works" proved nothing.**
    Chips are ceramic on felt (`frictionStatic` 0.85). The old model kept the
    table's own downward pull and ADDED a sideways component, so a 35-degree
    lean produced lateral 0.72 against downward 1.35 â€” a slope of 0.53, and a
    pile that sat still while the probe showed a perfect gravity vector. Tilt
    now ROTATES gravity (`base Ã— (lean, 1 + lean)`, magnitude capped at 2.2):
    the RATIO grows with the lean, which is the only quantity friction answers
    to, and the vertical axis falls out of the same arithmetic.

  **AND IT BROKE ON EVERY RETURN TO THE APP** (Tyson, same day). Switch away,
  come back, and the pot was pinned in a corner and stayed there.
  - **Clearing `neutral` is not recalibrating.** The SMOOTHING BUFFER survived,
    so the first sample after the return was 82% of the angle the phone was at
    BEFORE the athlete switched away, and that stale average became the new
    neutral. Returning to an app IS returning to a different hold, so the table
    took a permanent phantom lean â€” after the gain, enough to hold the whole
    pot against a wall. `recalibrate()` now drops neutral, the smoothing buffer
    AND the last-sent vector, and hands the world plain gravity immediately
    (the first sample after a recalibration publishes nothing, so a stream that
    never resumes would otherwise leave the last leaned vector standing).
  - **The listeners go quiet too.** iOS stops delivering motion to a suspended
    page and does not promise to start again on its own, so returning also
    RE-ARMS the subscription. Every "we are back" signal is wired to it â€”
    AppState, `visibilitychange`, `pageshow`, `focus` â€” because the mapping
    react-native-web makes does not cover a PWA restored from the app switcher.
  - **A re-arm must not un-say "TILT ON".** Re-subscribing clears the
    have-seen-a-reading flag, and on iOS the status then guesses `'prompt'`,
    flashing ENABLE TILT over a working table. A reading now wins the race
    outright, and a sensor that was live before gets a 1.5s grace period before
    it is declared missing.

  **VERIFYING IT.** `chip-world.test.ts` â€” 16 behavioural tests over the real
  simulation, headless in half a second because `chip-world.ts` is React-free
  and matter-js is pure JS. Build that harness FIRST next time: tuning physics
  through a browser is a four-minute cycle per guess, and this found five bugs
  in minutes. `tilt-math.ts` is split out for the same reason â€” every DIRECTION
  is a unit test (`__tests__/tilt-gravity.test.ts`, 18 cases) instead of a
  phone in a hand. **Neither would have caught the third defect:** the browser
  tour (scratchpad `tilt-tour.mjs`) dispatches real `deviceorientation` events
  at the real `/challenges/new` table and MEASURES WHERE THE PILE WENT â€” right
  lean â†’ right wall, far edge down â†’ the pile rises to the top edge and stays
  on the table, 12-degree wobble â†’ nothing moves. A tilt test that asserts the
  gravity vector rather than the chips will pass while the table sits still.
  `tilt-resume.mjs` does the same across a background/foreground cycle.

  **TWO TRAPS IN THE BROWSER HARNESS ITSELF**, both of which produced confident
  wrong answers before they were spotted:
  - **The PWA's service worker serves yesterday's bundle.** A tour against a
    fresh `expo export` ran the OLD code, agreed with the OLD behaviour, and
    looked like a failed fix. Playwright contexts for this app want
    `serviceWorkers: 'block'`; a probe that never increments is the tell.
  - **`page.bringToFront()` does not hide a page in headless Chromium.** The
    "background the app" step was a no-op, so the test was measuring an
    ordinary change of hold and calling it a resume. Drive the real events:
    redefine `document.visibilityState`, dispatch `visibilitychange`, then
    `focus`/`pageshow` â€” which is what an iPhone actually fires.

- **THE FIRST WORKOUT IS A RECORD NOW (2026-08-06, migration 138)** â€” Train
  kept saying "YOUR FIRST WORKOUT / START FIRST WORKOUT" after the athlete
  had already opened it. Tapping again was harmless (nothing is created until
  a set lands) but it reads as a failed tap on a create-shaped button.
  **Every signal the client had was derived from logged SETS**, and a workout
  that is open but not yet logged has none: `workout_log` is empty,
  `workout_sessions` holds finish markers only, and the session store's
  `activeWorkout` is AsyncStorage â€” per device, and cleared by `signOut`.
  138 stores when/which/what date on the profile, write-once server-side, so
  a second tap, a refresh, a re-login and a second device all converge.
  `firstWorkoutCta()` (domain/today-session.ts) decides start / resume /
  completed / none; Home reuses its existing `in_progress` card so a started
  first workout reads RESUME with zero sets. Verified live including a full
  sign-out and sign-in.

- **`photo_consent_at` was written but never READ (2026-08-06)** â€” found
  while verifying the above. Migration 136 created the column, the mutation
  wrote it, `ProfileRow` declared it, and `useProfile`'s explicit SELECT was
  never updated â€” so `usePhotoPrefs().hasConsent` was `undefined` forever and
  the Reforge Day consent gate re-asked on every agree, with no way through
  to the photo screen. Nothing caught it: types consistent, write correct,
  row correct, **projection wrong â€” and a projection is invisible to
  TypeScript.** `data/__tests__/profile-projection.test.ts` now reads the
  source and asserts ProfileRow's fields and the SELECT list are the same
  set, in both directions. Falsified against the original bug.
  **Adding a profile column means THREE edits: migration, ProfileRow, SELECT.**

- **ONE SESSION COUNT: `domain/session-stats.ts` (2026-08-06)** â€” Tyson:
  "WORKOUTS 0 / 1, SESSIONS 0 / 1" on a finished workout. THREE counters
  answered "how many sessions?", none agreeing, each wrong differently:
  `weeklyContract().done` counted only SCHEDULED days (train off-plan â†’ green
  pip, zero counter) and ignored cardio and the finish marker;
  `periodTotals().sessions` ignored cardio (a cardio-only day read "0
  SESSIONS" on the card that read "30 CARDIO MIN"); `computeStreak()` used
  `weight > 0`, **not `isCountedSet`**, so 061's 0 kg bodyweight work counted
  everywhere except the streak. `completedSessions()` is now the only answer:
  a strength session is a distinct (date, workout) with a counted set OR a
  marker; a cardio row is a cardio session; `days` counts distinct dates so a
  day with both is ONE training day. **`done` can exceed `target`** â€” a bonus
  session is honest; 0 was not. Home, Progress, both streaks and the
  achievement sweep read it. Verified live: ALPHA's cardio-only week went
  "0 / 2" â†’ "1 / 2".

- **A CAPPED LIST MUST DROP THE OLDEST, NEVER THE NEWEST (2026-08-06)** â€”
  `fetchWorkoutLog`/`useCardioLog` ordered **ascending** under `.limit(2500)`.
  Past 2,500 sets the client would fetch the OLDEST 2,500 and this week would
  vanish from every derived stat, while the server and the XP ledger stayed
  correct â€” the exact symptom Tyson reported, arriving for real in a year.
  Busiest account: 363. Newest-first now, `.reverse()`d back to ascending so
  consumers' ordering assumptions hold.

- **A STATIC SCAN CANNOT SEE A RENDER-TIME BUG (2026-08-06)** â€” the Forge's
  Aesthetic and Leanness nodes carried the literal unit `"/100"`, so the
  screen read `51 / 100 /100`. No source grep finds that: the doubling only
  happens when the formatter appends the unit. Found by reading the live
  page. `formatFraction` now drops a unit that is itself a denominator, so a
  caller cannot reintroduce it. **Read the rendered text, not just the JSX.**

- **THE COMPLETION SCREEN IS ONE SCREEN (2026-08-06)** â€” it was five modal
  phases behind five CONTINUE taps, and `useFinishWorkout` then raised a
  SIXTH modal asking to share. Sharing is now a secondary action ON the
  screen; `openComposer()` is the athlete asking and deliberately ignores
  "don't ask again" (which means stop prompting me, not disable the button).

- **FOUR PROGRESSIONS, FOUR NAMES (2026-08-06)** â€” FORGE LEVEL (XP +
  consistency), EVOLUTION STAGE (the champion's form), EVO RATING (fitness
  capability), TRAINING PATHS. A bare "LV." is banned;
  `domain/__tests__/terminology.test.ts` scans the shipped source for it and
  for the retired names. **"Evo Review" left the UI but NOT the code**: the
  weekly engine keeps `useRunEvoReview`, `evo-review.ts` and `next_review_at`.
  Those countdowns read the WEEKLY cadence, so labelling them "Reforge Day"
  (the 28-day ceremony) would have stated the wrong date â€” they say "rating
  update" instead.

- **"EvoGuide" is retired; the feature is REFORGE DAY (2026-08-06)** â€” only
  two user-facing strings existed, both on Home's origin-less podium, and
  both told the athlete to *run an EvoGuide scan to get an Origin*. That was
  the last surface still routing to the camera for an Origin, so it was
  retired rather than renamed: the Origin is CHOSEN (135), and renaming it
  "Reforge Day scan" would have been wrong â€” Reforge Day is the 28-day
  review, a different feature. `/evo-scan` is now titled REFORGE DAY PHOTOS
  with the optional/privacy messaging promoted into the header block. The
  ROUTE, table names and stored keys are untouched. The remaining
  "EvoGuide" mentions are SQL comments in applied migrations 042/045/046 and
  one code comment recording the old copy â€” history, not UI.


- **TWO TARGETED FIXES from Tyson's second test (2026-08-06, migration 137)**

  **1. The logger looked empty for 2-3s.** `resolveDay` answers from
  `user_plans` + the saved source + saved routines, and an ad-hoc day's
  exercises live in the persisted session store. Until all of those land,
  `plan` is `[]` â€” so straight after START FIRST WORKOUT the page rendered
  **"0/0 SETS", "Nothing in this workout yet"** and a bare search box. A new
  athlete's first sight of their first workout was an empty one.
  `useDayPlan` already computed `loading` and the page **ignored it**; it now
  holds on a ForgeLoader ("Forging your workout"), and a failed plan read
  gets a RETRY instead of an empty logger. `routines.isPending` joined the
  hook's loading flag â€” `resolveDay` consumes routines, so a routine-named
  day had the same hole one source further down.
  **Rule: `plan.length === 0` is only "empty" once every source has landed.**

  **2. The tour interrupted an in-progress workout.** The previous gate was
  "has a logged training day" â€” true the INSTANT the first set lands, so it
  fired the moment an athlete logged one set and stepped back to Home.
  `data/tour-state.ts` is the gate now: a COMPLETED session, no workout in
  progress, Home only, and not seen. In-progress is read from the LOG
  (sets today with no finish marker), so it survives a refresh and a second
  device.
  **Seen-ness moved to the profile (137, write-once server-side)** â€” it lived
  only in AsyncStorage, which is per BROWSER: a new device replayed the tour
  and two athletes on one device shared a flag. The legacy key is read once
  as a backfill so nobody who already dismissed it sees it again.

  Verified live end to end with `user_plans` delayed 2.5s: loader shown, no
  "0/0 SETS", no "Nothing in this workout yet"; a set logs; no tour on the
  logger, on Home mid-workout, on Train, or after a refresh; the tour appears
  once the workout is COMPLETE, SKIP closes it, and it never returns across
  all six tabs or a refresh â€” with `tour_state='skipped'` in the profile.
  tsc, lint, **2000 vitest cases**, guards, export.


- **ACTIVATION FIXES from Tyson's authenticated test (2026-08-06, no
  migration)** â€” he finished onboarding and could not do the workout it had
  just promised. Four defects in one path, all traced live:

  1. **`router.prefetch` NAVIGATES.** The `(main)` layout "preloaded" five
     tabs after sign-in. In expo-router 57 `prefetch(href)` is
     `linkTo(href, { event: 'PRELOAD' })` â€” the same code path as push â€” so
     the app walked itself to the LAST href in the list and dumped the
     athlete on **Fuel**. Route trace: with the loop, `/onboarding` â†’
     `/fuel` in <250ms; without it, the identical tap reaches the logger.
     **It could steal any navigation near app start.** Removed, not
     re-guarded: no measurement ever justified it against that.
  2. **Onboarding handed over the next SCHEDULED day** â€” on a rest day,
     tomorrow, which the logger opens read-only as "Upcoming".
  3. **Home said RECOVERY DAY** to an athlete who had never trained.
  4. **TRAIN ANYWAY only changed tabs.**

  `domain/today-session.ts` is now the ONE decision â€” resume > scheduled >
  starter > none â€” and onboarding, Home, Train and TRAIN ANYWAY all ask it.
  A rest day is EARNED: before the first completed workout, day one of the
  athlete's own plan stays reachable (`deriveMission` gained
  `first_workout`). The tour waits for a logged training day and never
  renders over the logger.

- **React #418, and the "partially rendered logo" (2026-08-06)** â€”
  `web.output: 'static'` prerenders every route at BUILD time.
  `forge-intro.tsx` picked its environment from `todayIso()` **and rendered
  its label**, so every visit on a day other than the build day hydrated
  "VOLCANIC FORGE" over a prerendered "SPACE FORGE" â†’ a text mismatch.
  Reproduced by shifting the browser clock (+5d and +200d: one #418 every
  time), fixed by making the first render deterministic via
  `useSyncExternalStore` (NOT setState-in-effect, which the lint rule
  rightly bans), verified across 12 prerendered routes at +37d: zero.
  The partial logo was the same bug â€” a failed hydration repaints the tree.
  With JS disabled the prerendered splash is a clean background, so nothing
  half-drawn is baked into the HTML.
  **Rule: nothing derived from the clock may be rendered during first paint.**

- **Recommendations, and the vocabulary trap (2026-08-06)** â€”
  `domain/recommend-starter.ts` reads goal / experience / equipment /
  session length, centres on the target muscle and sequences compounds
  first. Two bugs the unit tests could NOT see, both caught in a browser:
  the library tags **"Front Delts"/"Side Delts"/"Rear Delts"** while
  `inferMuscleGroup` speaks the coarse **"Shoulders"** (5 exercises of 960
  carry the plain tag) â€” `expandMuscleTargets` maps between them; and
  `inferMuscleGroup` reads EXERCISE names, so handed the word "Shoulders" it
  answered **"Other"** â€” `targetMusclesFromText` checks group names first.
  **Any test that passes muscle tags directly is testing nothing about the
  wiring; use EXERCISE_LIBRARY.** A Shoulders session is now Clean and
  Press, Kettlebell Overhead Press, Barbell Upright Row, Cable Y-Raise.

- **Quick Workout names itself** â€” the field said "(optional)" and then
  refused to start without a name. Empty now yields "Thursday Push
  Workout", uniquified against every name in play that day so two sessions
  can never merge into one record.

- Also: the Oracle's optional-photo notice moved ABOVE the first upload with
  a real SKIP FOR NOW (it was 2xs text at the foot, under the thing people
  refuse to do); Home's masthead says **PLAYER LEVEL** and the Forge says
  **EVOLUTION PROGRESS Â· NEXT FORM**, so three different numbers stop
  looking like one.

  Verified: tsc, lint (0 errors), **1993 vitest cases**, tokens/motion/
  battle-engine/glicko, `expo export`, and three browser suites â€” fresh-account
  activation, the remaining checklist, and hydration across 12 routes.

- **HOME DESIGN LAB, phase A â€” baseline re-synced, fixture gap closed
  (2026-08-18, no migration)** â€” Tyson: analyse Home with the Impeccable
- **HOME DESIGN LAB, phase E — the wild card, and the mount-write the
  re-sync surfaced (2026-08-18, no migration)** — `home/arcade` (game
  start-screen: character-select card with static scanlines + corner
  brackets, TODAY'S QUEST banner, the week as a 7-segment WEEK POWER
  gauge; two gated loops, reduced-motion still complete). Home now has
  SIX lab entries. **The real find:** restoring ReforgeDayCard to the
  baseline armed `useReforgeDay`'s lazy anchor write — with the fixture's
  null `reforge_anchor_at` it PATCHes profile ON MOUNT, and signed out
  the zero-row PATCH *succeeds*, so its onSuccess invalidation refetched
  the seeded profile into RLS-empty null, un-hiding PhysiqueBaselineCard
  (whose own mount `track()` then fired into the real analytics rail).
  Fix: seedLabCache computes `reforge_anchor_at` (-64d) and
  `last_reforge_at` (-8d, quietly mid-cycle) at seed time; lab.test.ts
  pins all three disarm fields non-null. Playwright tour over the
  PAGE_LAB-flagged export: gallery lists 6, all six render in mock mode,
  the switcher flips in place, and mock mode's only network is the
  documented `app_flag_enabled` RPC. Known artifacts, NOT regressions:
  the /lab gallery fires one React #418 (reproduced identically on the
  deployed lab branch), and deep-linking /lab/<page>/<variant> on a
  plain static server 404s unless the service worker is installed (the
  dev server has neither issue).

- **HOME DESIGN LAB, phase D — the two bold restructures (2026-08-18, no
  migration)** — `home/command` (the veteran's HUD: condensed mission strip
  with the full state machine, WeekStrip + TrainingOverview promoted above
  the fold, identity compressed to ONE 96pt Pressable rail — 32px rating,
  tier/form, LV + XP bar, 80pt still portrait; zero Reanimated, stationary
  by doctrine) and `home/saga` (identity-maximal: champion + rating +
  forge level fused into ONE monumental Pressable — the live page's three
  stacked tap zones become one — with the mission DOCKED at the bottom
  edge outside the scroll, thumb-first; exactly one gated ambient loop,
  the aura breath). Both read the shared model; both fix rather than
  reproduce the audit's P1s (44pt targets, 10px floor, no sub-12px mute).

- **HOME DESIGN LAB, phase C — the shared model and the two safe variants
  (2026-08-18, no migration)** — `src/lab/variants/home/shared/
  use-home-model.ts` is Home's derivation half forked ONCE (the recipe's
  "copy beside" rule protects src/ui, not sharing BETWEEN variants —
  workout/compact/model.ts precedent); baseline does NOT use it and stays
  the diff-anchor; both rot-with-live and re-sync together. Variants
  `home/clarity` (10px type floor, mute→dim under 12px, drawn PixelGlyph
  flame, full-contrast missed pips + "N missed" a11y label, athlete-facing
  drift copy, crest-affordance whisper) and `home/stillness` (ambient
  loops removed from copied evo-hero/next-rank-card/forge-hint/
  home-ambience; exactly two living movements — the champion's breath and
  the today-pip beat — plus one-shot ceremony). Both from the Impeccable
  critique/audit of 2026-08-18 (Nielsen 30/40, audit 16/20; findings live
  in that session, directions approved by Tyson).

- **HOME DESIGN LAB, phase B — the in-page variant switcher (2026-08-18,
  no migration)** — flipping between takes of a page no longer detours
  through the gallery: every lab variant now carries a floating pill
  (bottom-right, collapsed) that expands into one chip per sibling variant
  and `router.replace`s across (`src/lab/variant-switcher.tsx`, mounted by
  the host OUTSIDE LabDataProvider so it survives the mode-keyed remount
  and never reads the mock client). The pure half is
  `src/lab/switcher-model.ts`: page-contract params (workout's
  date/workout/source) ride the swap, only the routing triple
  (page/variant/data) is rewritten — pinned in lab.test.ts and falsified
  once. The switcher carries NO motion of its own (it is judged next to
  designs being compared) and no Reanimated. testID contract for tours:
  `lab-switcher-toggle`, `lab-switcher-option-<page>-<variant>`.

- **HOME DESIGN LAB, phase A — baseline re-synced, fixture gap closed
  (2026-08-18, no migration)** — Tyson: analyse Home with the Impeccable
  design plugin and stage 5 alternative designs in the Page Lab. Groundwork
  first: `src/lab/variants/home/baseline.tsx` had DRIFTED from live Home
  (missing ReforgeDayCard, PhysiqueBaselineCard, the neverTrained
  mission-first hoist, marginTop 10-vs-6) â€” re-forked wholesale; the
  `git diff --no-index` anchor shows only the fork recipe again. Two fixture
  fixes: (1) `evo_rating_snapshots` is now seeded (`labEvoSnapshots`, key
  carries `LAB_EVO_SNAPSHOT_LIMIT` = Home's `useEvoSnapshots(26)` limit â€”
  the limit is part of the query key) so the mission card's "+N.N EVO" rate
  renders in mock mode; the history 28â†’42 matches labEvoRating's
  starting/current/lifetime fields exactly. (2) `LAB_PROFILE` gained
  `physique_baseline_at` â€” with it null, PhysiqueBaselineCard fires
  `track('photo_baseline_prompted')` ON MOUNT, the same un-shimmed-write
  class as the activation step, polluting the real analytics rail whenever a
  real session sits under the fake one. `PRODUCT.md` (repo root) is new: the
  Impeccable product record (avatar: 16â€“26 lifter who enjoys gamification;
  pixel/retro-RPG identity BINDING; positioning = truthful progression +
  competitive wagers, coaching loop deliberately secondary).

- **FULL-APP AUDIT â€” the sweep, and the five things it found (2026-08-05,
  no migration)** â€” Tyson: "run a full audit on the whole app and fix and
  repair any bugs, glitches etc, also remove any dead code, and improve the
  UI." A Playwright sweep drove **32 routes** signed in as ALPHA, recording
  console errors, page errors, failed requests, rendered text length and
  visible error strings per route (script kept at
  `<scratchpad>/sweep.mjs`).

  **The app is in good shape**: no page errors, no 5xx, no crash, no blank
  screen outside the one below. What it did find:

  1. **`/muscle-lab` rendered a bare tab bar over nothing.** The workbench is
     deliberately dev-gated, but it did it with `return null` â€” visually
     identical to the app having crashed. It says what it is now.
  2. **Body fat displayed as `0.0%` when never measured.** The domain ports
     coalesce a missing reading to 0 (`bfMid ?? 0`) and every CALCULATION
     already treats that as unmeasured â€” `requirementProgress` returns honest
     zero, `met` stays false. Only the label lied, printing an impossible
     measurement next to a 12.0% target. Renders `â€”` now.
  3. **`ai-bodyfat` told the model "Height: 0 cm".** Every other optional
     stat in that same prompt already said `Not provided`; height shipped its
     absence as a measurement â€” and onboarding v3, which no longer demands
     height, made that the common case. Fixed in the edge function, and the
     guided Evo Scan now ASKS for height once when the profile has none
     (it feeds FFMI directly), then keeps it.
  4. **Rank was a dead end.** A non-zero XP drift replaced the whole page
     with "RANKING UNAVAILABLE â€¦ reconciliation restores it" â€” and **no
     reconciliation exists** anywhere in the app or the schema. The integrity
     rule is that an unverifiable account is not LISTED, which the SERVER
     already enforces (014's rule inside `leaderboard_top`); hiding the board
     from that athlete added no integrity at all. It is a banner now, the
     board renders, and the copy promises nothing it cannot deliver.
  5. **WRIST and WAIST sat three fields apart** in the tape-measurement grid,
     one letter different, in a pixel face at 9px. Typing a waist into the
     wrist field is a silent data error nothing downstream can detect. Each
     field carries a placement hint now ("at the navel", "the joint").

  Also checked and found CLEAN, worth recording so it is not re-audited:
  every one of the **27 coach-mark targets resolves to a real testID** (one
  stale LABEL fixed â€” the Social mark called the FEED tab "Following"); the
  dead-code scan found nothing genuinely unreachable outside arena-game type
  exports (the `ui/character/skins/*` files that look orphaned are loaded by
  dynamic `import()` in `avatar-skins.ts` â€” do not "clean them up"); and
  180/180 public tables have RLS enabled.

  **`startingLevelV2` is now production-dead but deliberately kept**: no code
  path can create a v2 profile any more, so it survives only through its own
  tests. That is on purpose â€” it is the record of how every existing
  `base_level` was computed, and those rows are immutable. Do not delete it.


- **ONBOARDING V3 â€” "earn the information, don't demand it" (2026-08-05,
  migrations 134/135/136)** â€” Tyson's brief, executed in full. Spec:
  `docs/ONBOARDING_V3_SPEC.md`.

  THE EVIDENCE, read live before writing anything: 31 signed up â†’ 25 made a
  profile â†’ 16 bound an Origin â†’ **11 ever logged a workout.** Of the 14 who
  emitted `onboarding_started`, only 10 emitted `initial_assessment_started`
  â€” four abandoned the character-creation FORM, which demanded height,
  bodyweight, three 1RMs, training years, an eating phase, a physique photo
  and a globally-unique username before handing over anything.
  `docs/ACTIVATION_ANALYTICS.md`'s "onboarding works" was true at n=10 and is
  now marked superseded at the top of that file.

  **THE FLOW** is one screen per question: intro â†’ goal â†’ experience â†’ route
  â†’ [plan] â†’ Origin â†’ the reveal ("Your Forge is ready", ONE CTA). Height,
  bodyweight, 1RMs, nutrition phase, the scan and the username all LEFT the
  compulsory path and are collected where they earn their keep â€” the
  username at the first social surface, which already had a claim card
  (`social.tsx`) and an opt-in card (`rank.tsx`), so nothing broke.

  **PLACEMENT V3** (`domain/onboarding-v3.ts`) derives `base_level` from the
  experience band and NOTHING else. Under v2 physique came from the scan
  (0â€“15) or a derived default **capped at 10** â€” declining to photograph
  yourself was worth up to five levels. V3 cannot express that: it has no
  photo input and no lift input. Bands top out at 45 so placement never
  exceeds RARE; everything above that is earned. V2 is untouched and still
  parity-pinned â€” no existing `base_level` is recomputed.

  **THE ORIGIN IS CHOSEN, NEVER RATIONED (135).** `assign_origin_path` only
  accepted paths the candidate model offered â€” three of five â€” and under v3
  that shortlist is computed from a goal string, because no evidence exists
  yet. One clause: a v3 athlete's FIRST origin may be any of the five,
  recorded as `free_choice` in the result, the assessment snapshot and the
  migration log. v2/legacy/migrated athletes are untouched, a second bind is
  still `already_assigned`, an unknown path is still `invalid_origin` â€” all
  falsified as the signed-in smoke athlete inside a rolled-back txn.
  The candidate model keeps every surface where it HAS evidence: the free
  Reforge after three workouts, and the migrated cohort.

  **PHOTOS: after value, never as a gate.** `ui/progression/physique-baseline-card.tsx`
  renders only after a COMPLETED workout, offers four equally-visible
  choices, and is styled as an offer â€” never an overdue task. **DON'T ASK ME
  AGAIN** writes `photo_prompts_disabled` (134) and every prompt surface
  consults `usePhotoPrefs().mayAsk`. `origin-scan-prompt.tsx` no longer leads
  with "run a scan" â€” it points at the CHOICE, because assigning a character
  from a photograph is the one thing this flow must never do. Consent (136)
  is affirmative, versioned, and gates the capture surface ITSELF so a deep
  link cannot walk around it; the disclosure names the real pipeline
  (OpenAI) rather than saying "only seen by AI". Settings gains a physique
  card: what is stored, the prompt switch, and a real delete.

  **THE INVARIANT**, checked not asserted:
  `domain/__tests__/photo-confidence.test.ts` â€” missing photos lower
  CONFIDENCE, never SCORE, with a positive control that a scan measuring
  something *different* does move the rating. It also surfaced a real
  structural fact: `overallConfidence` is the MIN of four pillars, so for a
  new athlete cardio is the floor and a scan moves the headline by nothing.
  That is why the calibration card names the LIMITING area instead of
  implying everyone is missing a photo.

  **REFORGE DAY (28 days), photo-optional** â€” `domain/progression/reforge-day.ts`
  + `/reforge`. NAMING: the existing three-workout Origin re-choice is the
  **Origin Reforge**; Reforge Day is the periodic ceremony. The weekly Evo
  Review **does not move** â€” momentum decays per missed WEEK and the review
  is the engine; changing it to match the ceremony would rewrite progression
  maths for every existing athlete. The clock anchors to the first COMPLETED
  workout, is write-once + forward-only server-side (134 trigger), and the
  ceremony completes without photos: "Your training and performance data
  have been updated. Your physique calibration was not refreshed."

  **HOME** leads with the mission for an athlete who has NEVER TRAINED only;
  the 2026-08-03 identity-first order returns the moment a set is logged.
  The EvoHero empty state now says CALIBRATING and offers the first workout
  instead of a first review â€” a review with no evidence is a number about
  nothing, which the button's own note already said.

  Verified: tsc, `npx expo lint` (0 errors), **1948 vitest cases**, tokens /
  motion / battle-engine / glicko guards, `expo export`, and a Playwright
  tour of the new flow against production.


- **BUG: barcode scanner "detects, then errors on lookup" â€” made
  self-diagnosing, root cause still open (2026-08-05, no migration)** â€”
  Tyson's report, narrowed by his own follow-up: the camera DOES read a
  code; `lookupBarcode` (`data/food-lookup.ts`) then fails it even for a
  real product. Investigated hard before touching anything: the OFF v2
  product API is CORS-open (`Access-Control-Allow-Origin: *`, confirmed
  live) and auto-normalises UPC-A â‡„ EAN-13 server-side (a real Coca-Cola
  code round-tripped to the same product both ways); a full Playwright tour
  against PRODUCTION typed a real Nutella barcode by hand through the exact
  same `lookupBarcode` path the camera calls and it resolved correctly,
  539 kcal and all. So the fetch, the CORS policy, and OFF's own lookup all
  check out â€” what could NOT be verified without a real camera and a real
  product in hand is what the CAMERA decode itself returns: a zxing UPC-E
  read comes back in its OWN 6â€“8-digit compressed form, genuinely different
  from the UPC-A/EAN-13 digits printed under the bars, and a lookup on that
  raw string would 404 even though the product exists under its expanded
  code. **Did not implement that expansion blind** â€” guessing at the exact
  algorithm with no device to verify against risks silently matching the
  WRONG product, a worse failure than an honest "not found." Instead every
  error path in `lookupBarcode` now names the SCANNED DIGITS in its own
  text (`No product found for 01234565â€¦` etc.) â€” the next occurrence is a
  five-second read off the screen instead of another guess: an 8-digit code
  in the error points straight at UPC-E; a slow/mobile-network timeout
  message points at the 10s `AbortController` deadline instead. Verified:
  tsc, lint, all 1900 vitest cases; no test pinned the old un-parameterised
  error strings.

- **BUG: the plan-source dropdown "changed the label, not the workout" â€”
  fixed (2026-08-05, no migration)** â€” Tyson: "changing workouts with the
  dropdown box on Train doesn't change the workout." Real, and confirmed:
  `today.tsx`'s `pickSource(i)` re-stamped an EXPLICIT per-day source
  (`sources[dow] = i`) onto every trained weekday so a map `schedule.tsx`
  had written couldn't keep outranking the picker's choice â€” but it never
  touched `plan[dow]`'s stored NAME to match. `dayInSource` treats an
  explicit per-day source as proof the stored name already belongs to that
  source (true when `schedule.tsx`'s own `chooseSource` writes it â€” THAT
  handler remaps the name first, THEN stamps the source) â€” false here, so
  every trained day kept its OLD title, now flagged "explicit," which
  skips `week-status.ts::sourceDayFor`'s positional remap (the function
  actually built to rename a week's slots onto a newly chosen plan's own
  days) entirely. The dropdown's own label updated instantly (it reads
  `source` state directly); the card titled after it never did â€” exactly
  matching the report. Fix: `pickSource` now CLEARS the per-day map
  (`sources: {}`) instead of uniformly overwriting it â€”
  `explicitSourceForDate` then returns null everywhere, which is what
  "outrank the old map forever" actually needs, and every day correctly
  falls through to `sourceDayFor`. Verified by code trace (`sourceDayFor`'s own docstring
  states the exact behaviour being bypassed) and confirmed no regression:
  `tsc`, lint, all 1900 vitest cases. **Live UI verification was
  inconclusive on the smoke account** â€” MY PLAN and AI PLAN are both empty
  there, and an empty source's day-name list correctly returns the
  original title UNCHANGED either way (`sourceDayFor`'s
  `sourceDays.length === 0` early return), so switching into either one
  cannot distinguish the bug from the fix. Confirming end-to-end needs an
  account with two POPULATED plans holding different day names for the
  same weekday.

- **FUEL MODEL DUEL â€” VERDICT AND RETIREMENT (2026-08-06, same day)** â€”
  four live duels on the bench below answered the question it was built
  for: **gpt-5.6 buys NO accuracy on meal-scan, at 2-3Ã— the latency and
  flagship pricing â€” do not re-run this experiment, the answer is on
  record.** Table-priced paths tied exactly (eggs+toast 271 = 271; custom
  "500g raw 5% beef mince" 685 = 685, both matched `ground beef (raw 5%)`);
  the AI-estimate path tied within 2% (Snickers 254 vs 259, truth ~250);
  recipe serving math tied at 325 vs 326 with identical division. The
  July qualifier-aware matcher owns describe-accuracy; remaining error
  lives in FOOD_DB coverage and household-measure gram heuristics, NOT
  model capability â€” spend there. Tyson's call: keep gpt-5.1 live, remove
  the test version from existence. Removed same-commit: the server-side
  `model` allowlist (meal-scan/index.ts back to its pre-f625bf1 shape,
  re-pinned live), the `describeMeal` opts seam, the `fuel` LabPageId +
  `/lab/fuel/model-duel` + `fuel-probes` fixtures/pins. **`migrations/134`
  STAYS** (append-only history): `kind='meal-scan-test'` remains allowed
  in the ai_scan_cache CHECK, unused and inert â€” nothing writes it; its
  021-lesson falsification record below is still true and still the
  reference for the NEXT new kind. All meter rows were deleted (count 0).
- **FUEL MODEL DUEL â€” gpt-5.6 test bench in the Page Lab (2026-08-06,
  migration 134 APPLIED + falsified, RETIRED same day â€” see above)** â€”
  the describe-a-meal accuracy
  complaint (NUTRITION_PLAN_2.md item 1) gets an instrument before it gets a
  verdict. Server (commit f625bf1, deployed + curl-verified): `meal-scan`
  accepts an opt-in `model` field, ALLOWLISTED to `gpt-5.6` only â€” absent or
  unknown values fall through to `DEFAULT_MODEL`, pinned live (bare call â†’
  880 kcal, `model:null`; `"gpt-4o"` â†’ identical; `"gpt-5.6"` â†’ accepted by
  OpenAI, echoed additively in the result). Client: `describeMeal(text,
  mode, opts?)` threads the override (main-app call sites untouched);
  `/lab/fuel/model-duel` (first `fuel` LabPageId, real-mode-only,
  DISPLAY-ONLY â€” no `useLogMeal`, nothing writes) runs the same text through
  both models in parallel: two columns, latency, per-item DB/AI provenance,
  totals graded pass/fail against `lab/fixtures/fuel-probes.ts` â€” 8
  known-answer probes whose USDA-anchored bands are vitest-pinned through
  the same `matchFood` import the food-match suite uses (a FOOD_DB edit
  that invalidates a band fails CI, not the bench's honesty).
  **THE 021 BUG, HIT A THIRD TIME:** the override path meters each call
  with a `kind='meal-scan-test'` row so `rateLimited()` can count it â€”
  falsification (12 straight 200s as BRAVO, zero rows) showed 027's kind
  CHECK rejected it and `storeCache` swallowed the rejection â€” the gpt-5.6
  path shipped fail-open. `migrations/134` re-adds the constraint with the
  new kind; applied 2026-08-06 via the management API and falsified live as
  BRAVO per its header: meter row lands (count 1), seeded to HOURLY_LIMIT â†’
  429 "Test-model hourly limit reached", bare call still 200, bogus kind
  still rejected. Verified: tsc, lint (0 new), 1905 vitest (5 probe pins + 17
  arena tests un-broken by OneDrive hydration), tokens/battle-engine/
  motion, `expo export` with `EXPO_PUBLIC_PAGE_LAB=1`, Playwright tour
  11/11 (880 âœ“ both columns, one `"model":"gpt-5.6"` request, one bare,
  signed-out inline "Not signed in.", no unexpected console errors).
- **ORACLE + FUEL CONSISTENCY PASS (2026-08-05, no migration)** â€” Tyson's
  brief: bring Oracle and Fuel up to the Home/Train mission-briefing
  standard â€” one dominant hero, fewer competing cards, larger hierarchy,
  "what should I do next" answered on the first screenful. Not a redesign:
  same branding/colours/fonts/nav, pixel aesthetic kept throughout.
  **`ui/oracle/oracle-hero.tsx` and `ui/fuel/fuel-hero.tsx`** are new â€” each
  merges that page's masthead + summary card into ONE card (title, champion,
  Forge Level, the page's real headline number, all above one hairline),
  replacing `OracleHeader`+`EvolutionImpactCard` and `FuelHeader`+
  `NutritionSummaryCard` (all four deleted). Both heroes reuse
  `ui/home/next-rank-card.tsx`'s `NextRankRail` and the shared
  `ui/core/count-up.ts` (moved out of `ui/oracle/oracle-anim.ts`, which now
  re-exports it â€” Fuel's REMAINING figure and Oracle's rating both count up
  through the SAME primitive, not two).
  **Oracle**: the scanner (`body-scanner.tsx`) grew a real SCAN PROGRESS
  strip (N/3 Â· %, segments per slot); Body Fat wears its own `colors.warn`
  identity instead of Physique's cyan clone, plus a real LAST SCAN / REQUIRED
  PHOTOS strip off `useBodyfatHistory`; Physique's reveal now shows the AI's
  own `result.confidence` (real, was computed but never shown); AI ROUTINE's
  six goal buttons became archetype tiles with a REAL match % â€” new
  `domain/oracle.ts::goalCompatibility`/`recommendedGoal` (21 new domain
  tests) score each goal against the athlete's own weakest sub-score, never
  a fabricated number, floored/capped [10,98] so it never claims zero value
  or false certainty; History's timeline rows gained â–²/â–¼ trend arrows vs the
  PREVIOUS scan (not just the aggregate "since first scan" strip) and an
  "EVOLUTION JOURNEY" subtitle.
  **Fuel**: new `domain/nutrition.ts::nutritionScore` (6 new tests) â€” a real
  0â€“100 adherence-to-target read (average of `100 âˆ’ |1 âˆ’ consumed/target|
  Ã— 100` across kcal + 3 macros), null until something is logged, never a
  fabricated starting grade; SCAN A MEAL got `size="hero"` + a sweep (the
  page's one dominant CTA, per the brief); the KJâ‡„KCAL converter â€” real but
  named as dead weight in the brief â€” moved into a collapsed UNIT CONVERTER
  disclosure at the foot of the page; SAVED MEALS (already-real favourite-
  meal data) moved up under the scanner in its place; QUICK LOG's button
  went `size="hero"`; meal slots read "{SLOT} READY" in the slot's own
  tint instead of dim "Not logged", with a filled/dashed completion ring â€”
  **no fabricated "+N XP"**: meal logging does not grant Forge XP in this
  app (confirmed against `domain/xp.ts` â€” only `XP_PER_SET` and
  `XP_PER_CARDIO_MINUTE` exist), so the brief's own "+15 XP" example was
  adapted rather than copied.
  Verified: `tsc`, `expo lint` (0 new warnings/errors), all 1900 vitest
  cases (27 new: goalCompatibility/recommendedGoal Ã—21, nutritionScore Ã—6),
  `verify-tokens`, `expo export`, and a live Playwright pass at 375/390px â€”
  the Oracle hero rendered real data (rating 46, Physique 46/Size 42, NEXT
  RANK Â· Developed Â· 9 TO GO) merged with the masthead in one card; the Fuel
  hero rendered a real manually-set 2,500 kcal target (macros, goal
  switcher, provenance line) with the "NO TARGET YET" fallback correctly
  keeping its own masthead now that the header no longer renders
  separately; meal slots showed BREAKFAST/LUNCH/DINNER READY in their tint
  colours; the converter opened collapsed. No horizontal overflow at either
  width, no console errors.

- **ORACLE HERO PROMOTION (2026-08-04, no migration)** â€” the Oracle
  (`ai.tsx`, `ui/oracle/*`) was already close to the Home/Train/Cardio
  standard (ORACLE_REDESIGN, 2026-07-18: real theatrical reveals, count-up
  scores, honest no-fabrication copy throughout) â€” this pass is a targeted
  elevation, not a rebuild. **`evolution-impact-card.tsx` ("YOUR CHAMPION
  EVOLUTION") moved out of `PhysiqueScanCard` and up to lead `ai.tsx`,
  right after the header** â€” it used to render ONLY inside the gate
  `{result ? <EvolutionImpactCard/> : null}`, i.e. only after a fresh scan
  THIS SESSION, so an athlete with a real rating from last week saw nothing
  about it on Oracle unless they scanned again today. It is now the page's
  own "at a glance" hero (the role the Evo Rating plays on Home, the mission
  card on Train/Cardio) and shows every visit â€” its own honest internal gate
  (a confirmed rating must exist, else the "run your first review" prompt)
  is unchanged. Its label switched from a hand-rolled `Text` to the shared
  `SectionLabel size="lg"` the other three Oracle cards already use â€” it was
  the only card on the page not using it. `oracle-header.tsx`'s champion
  frame now PULSES (shadow only â€” there is no fifth sprite pose to fake
  "scanning" with, so `anim` stays `"idle"`, which is accurate) while ANY of
  the three tool cards below is genuinely mid-request; each card mirrors its
  own `busy` state up via an `onBusyChange` callback (the exact lifting
  pattern `session-form.tsx` used for Cardio) rather than a new store.
  `oracle-history-card.tsx` gained a loading skeleton instead of returning
  `null` during the first fetch; `routine-forge-card.tsx`'s Oracle Summary no
  longer flashes "no scan yet" while `physique_ratings` is still loading â€”
  it now shows a neutral "Reading your latest scanâ€¦" line until the real
  data (or the real absence of it) is known. Verified: `tsc`, `expo lint`
  (11 pre-existing warnings, 0 new, 0 errors), all 1889 vitest cases,
  `verify-tokens`, `expo export -p web`, and a live Playwright pass at
  375/390px signed in as ALPHA confirmed YOUR CHAMPION EVOLUTION renders
  with real data (rating 46, TRAINED, Aesthetics 46/Size 42, "next Evo
  Review in 7d") ABOVE AI PHYSIQUE ANALYSIS with zero fresh scans that
  session, no horizontal overflow at either width, no console errors. The
  header pulse itself was verified by code review against its two proven
  siblings (`scan-frame.tsx`'s sweep, `champion-charge.tsx`'s frame glow)
  rather than a live AI call â€” it did not seem worth spending the smoke
  account's hourly scan-rate-limit budget to screenshot a box-shadow.

- **CARDIO MISSION REDESIGN (2026-08-04, no migration)** â€” the CARDIO mode of
  Train raised to the 2026-08-03 mission-briefing standard (Train's own
  `mission-brief.tsx`, Home's hero). `DailyCardioSummary` ("Today's Protocol")
  is retired; `ui/train/cardio/cardio-mission-card.tsx` is the new focal
  point â€” TODAY'S CONDITIONING MISSION, the animated 0â†’30 MIN progress bar,
  a MISSION REWARDS block (real `cardioEventAmount(target)` XP, never
  fabricated), weekly session count, a compact glowing badge that swaps to
  the chosen activity's own pixel icon, and a CTA that reads the whole
  page's state (CHOOSE ACTIVITY â†’ START SESSION â†’ LOG SESSION Â· +N XP â†’
  MISSION COMPLETE â€” no invented CONTINUE SESSION; cardio logging is a
  single write, there is nothing to resume). **Nothing is silently
  pre-selected any more**: `cardioType` in `today.tsx` defaults to `null`,
  so CHOOSE ACTIVITY is a real first state, not a Treadmill default nobody
  chose â€” the header companion's cardio pose (`cardioAnim`) now returns
  `undefined` for `null` and the champion falls back to its own real
  done/target/finished reading of `dailyMission()` (previously it read
  LIFT's today-card progress even while CARDIO was open). The mission card's
  CTA never duplicates the save path: `session-form.tsx` registers its own
  submit handler up through a ref (`registerSubmit`) and mirrors its live
  (mins, XP) preview up (`onPreviewChange`), so pressing the mission card's
  button fires the EXACT SAME mutation the form's own LOG SESSION does,
  budget-ask branch included. Pressing CHOOSE ACTIVITY/START SESSION draws
  the eye to the (now single, combined) session card with a one-shot glow
  pulse + haptic rather than a scroll-jump (`ScreenShell` doesn't expose its
  scroll ref to children). Activity selection gained a full-width OTHER row
  (seven cards is odd â€” a lone half-width card at the end read as
  unfinished) and a tick badge on the selected card (colour is never the
  only cue). The reward preview no longer shows a dim "+0 FORGE XP" before
  minutes are entered â€” no digit at all until there's one to show. Recent
  Sessions gained real loading/error states. `Label`/`ProgressBar` extracted
  out of `mission-brief.tsx` into `ui/core/mission-kit.tsx` so Train and
  Cardio share one shimmer-progress-bar implementation instead of two that
  drift. Verified: `tsc`, `expo lint`, all 1889 vitest cases, and a live
  Playwright pass at 375/390px signed in as ALPHA â€” CHOOSE ACTIVITY â†’ RUN
  picked â†’ 30 MIN preset â†’ LOG SESSION via the MISSION CARD's own CTA (not
  the form's) confirmed the lifted-submit wiring end to end: the XP toast
  fired, the progress bar moved to 15/30, weekly sessions ticked to 1/4, no
  console errors beyond the documented 404/409 noise, no horizontal overflow
  at either width.

- **THE "COULD NOT START" FLASH â€” fixed (2026-08-04, no migration).** Tyson: a
  scary "Could not start" error showed for half a second, every launch,
  right before the forge intro. Real bug, and it predates the intro: the
  BOOT-FAILURE SAFETY NET (`+html.tsx`, 2026-07-16) called `reveal()` on the
  VERY FIRST global `error` event, with no check for whether boot was merely
  milliseconds away. React 19's hydration-mismatch recovery on this static
  export legitimately fires ONE global error on ordinary loads â€” a known,
  harmless, self-correcting path (React discards the mismatched pre-rendered
  node and re-renders it client-side; the app boots normally regardless) â€”
  and that alone was enough to flash the whole overlay before the existing
  500ms poll tore it down once `__EVO_BOOTED` flipped true. **An error no
  longer reveals anything by itself** â€” it only arms a 600ms check, and
  `reveal()` only runs if boot STILL hasn't happened by then. A genuine
  failure (a 404'd chunk, a throw before mount) never sets the flag either
  way, so it is caught just as reliably â€” **falsified by blocking every JS
  chunk outright**: the overlay still appears (~650ms), with working Reload
  and Reset-&-reload buttons (`scratchpad/boot_flash.mjs`). Confirmed clean
  across 5+ runs on Chromium and WebKit that the overlay never appears on a
  normal load, polled continuously across the whole ~2.7s intro.

- **THE FORGE LOADER â€” one loading mark for the whole app (2026-08-04, no
  migration).** `ui/core/forge-loader.tsx`: the same broken-ring sigil the
  launch sequence resolves and `boot-hold.tsx` already held still, extracted
  into a reusable, captioned, `useAmbient()`-gated primitive so a SCREEN or a
  SECTION waiting on something reaches for one recognisable shape instead of a
  bare `ActivityIndicator` on empty space. Replaced five: the Arena's own boot
  screen ("ENTERING THE ARENA"), Customise while skins resolve ("Reading your
  loadout"), the leaderboard while identity loads ("Reading the leaderboard"),
  and both origin-flow waits ("Reading your training profile" /
  "Forging your candidates" / "Calibrating"). **Deliberately NOT applied to
  button busy-states** (SAVE, EXPORT, LOG, the arena's own in-button spinner) â€”
  those stay a plain small `ActivityIndicator` sized to the control; a full
  sigil inside a 44pt button is the tail wagging the dog. Caught live in a
  browser mid-load on both the Arena boot and Customise
  (`scratchpad/loader_check2.mjs`) â€” correct caption, clears once real data
  arrives, page usable after.

- **THE FORGE INTRO â€” the launch sequence (2026-08-03, no migration).** Tyson:
  "feel like opening Destiny, Diablo IV or Clash Royale, NOT a normal fitness
  app." ~2.7s, procedural, every launch: embers drift inward -> they spiral and
  a forge sigil resolves -> a hammer falls and STRIKES an anvil (flash, impact
  bloom, sparks, camera shake, one heavy haptic) -> EVOFORGE is assembled
  letter by letter from converging molten fragments, white hot cooling to
  electric blue -> an energy pulse crosses the wordmark and FORGE YOUR
  ASCENSION is etched behind it, plasma-bright then crisp white -> the plate
  rises and dissolves into the app. `domain/boot-sequence.ts` owns the timeline
  (25 goldens); `ui/boot/` owns the rest. **It replaced a bare
  `ActivityIndicator`**, which was the app's entire loading experience.

  **IT IS AN OVERLAY, NEVER A GATE â€” and that is the whole design.** This is
  the exact shape of the July 16 bug that stranded the installed iPhone PWA on
  a blank screen (a Reanimated opacity gate around the app whose animation
  frame never ticked). So: it is the LAST SIBLING in `_layout.tsx`, not a
  wrapper â€” the app paints underneath it from frame one; dismissal is a plain
  `setTimeout`, not an animation callback; there is a SECOND independent
  deadline (`BOOT_HARD_CAP_MS`); and it UNMOUNTS rather than sitting at
  opacity 0. **Falsified by killing `requestAnimationFrame` before any app
  code runs** (`scratchpad/boot_intro.mjs`): the intro still clears and the
  app is still reachable, on Chromium AND WebKit.

  **CORRECTED THE SAME DAY: THE OVERLAY IS `pointerEvents="none"` FOR ITS
  ENTIRE LIFE, NOT JUST AFTER IT.** It shipped with a tap-to-skip
  `Pressable` covering the full screen. Tyson reported he could not type into
  the sign-in email/password fields afterwards â€” every launch, on Safari AND
  the installed PWA, not fixed by reopening or hard-refreshing (ruling out a
  stale cache). It could not be reproduced in Playwright on Chromium OR
  WebKit â€” mouse, real touch emulation, tapping mid-intro to trigger the skip
  path, waiting the full sequence out, local build and live site, all clean.
  **That absence of a repro is itself the signal**: a full-screen element
  intercepting touches for ~2.7s over an app that is already mounted and
  interactive underneath (by design), removed at an arbitrary instant by a
  TIMER rather than the user's own tap-release, is exactly the shape of a
  real-device touch/responder bug neither engine's automation faithfully
  reproduces â€” if the element holding an in-progress touch is torn out of the
  tree before the browser delivers that touch's `touchend`, some engines
  retarget or drop the remaining events, and native touch tracking can be left
  believing something still holds the gesture, silently swallowing the very
  next tap on whatever is now revealed underneath. Rather than keep chasing an
  unreproducible mechanism, the risk was removed at its root instead of
  patched around: **`pointerEvents="none"` for the whole overlay, the whole
  time.** It was never required to be skippable â€” that was an added-for-
  politeness escape hatch, and it was exactly the one element positioned to
  swallow input on a device this repo has no way to test against. Re-verified
  end to end: typing now succeeds even WHILE the intro is still visually
  playing, on both engines (`scratchpad/type_repro3.mjs`).

  **TWO BUGS THE BROWSER FOUND THAT tsc AND LINT COULD NOT:**
  * `useWindowDimensions()` returns **0x0** inside the overlay on the web
    build. Expo STATICALLY PRE-RENDERS every route in Node, where
    react-native-web's Dimensions has no window, and hydration does not re-run
    the render with corrected values. The wordmark shipped at `font-size: 0` â€”
    eight one-pixel letters, invisible, on an otherwise perfect animation. It
    measures the plate with `onLayout` now, with non-zero fallbacks.
  * **A Reanimated style applies on the worklet's FIRST EVALUATION, not on the
    first paint.** Any layer whose opacity lived only in its worklet painted at
    OPACITY 1 until the engine ran â€” the strike's full-screen flash washed the
    entire launch screen pale cyan. Every timed layer now carries `...HIDDEN`
    in its STATIC style.

  **What the brief asked for and did NOT get, with reasons.** SKIA: not in this
  project, and it is a native module â€” adding it means a prebuild for an app
  whose primary surface is an installed PWA. Bloom, motion blur and trails are
  approximated with layered shadows and stretched squares. PIXELLAB: the key is
  a BUILD-TIME secret (`PIXELLAB_AI_KEY`, not `EXPO_PUBLIC_`), so shipping it
  to the client would publish it to every visitor, and generated backdrops are
  exactly the heavy assets the brief bans. The five rotating environments are
  procedural palettes instead, chosen by CALENDAR DAY (`forgeEnvironmentFor`) â€”
  no storage, no `Math.random()` in render, and "the forge changes each day"
  beats "the forge is random", which reads as a glitch.

  Reduced motion gets a different, calmer 900ms sequence â€” no shake, no spiral,
  no particle fields. `/lab` and `?nointro=1` suppress it (the Dev Lab
  photographs the real app). **The native splash background was `#208AEF`, a
  bright blue against the app's `#04070e`** â€” a hard cut on every native
  launch, now matched.

- **TRAIN â€” THE MISSION BRIEFING (2026-08-03, no migration).** Tyson: "the page
  should feel like beginning a mission. Not filling out a form." Not a redesign:
  every value, every door and every resolution rule is the one that was already
  there â€” the source picker, the per-day source rule, SWAP TODAY'S DAY, PLAN
  SCAN, quick workouts, routines, extras and the week bars all behave exactly as
  before. What changed is ORDER, LANGUAGE and MOTION.

  **THE HERO IS A BRIEFING** (`ui/train/mission-brief.tsx`), in the brief's own
  hierarchy: TODAY'S MISSION â–¸ name â–¸ **objective** â–¸ PRIMARY MUSCLES â–¸
  DIFFICULTY Â· EST. TIME â–¸ **MISSION REWARDS (Evo first)** â–¸ progress â–¸ the one
  CTA. Two things the card never said are now on it, and both are derived:
  * **MISSION OBJECTIVE** â€” `domain/mission-brief.ts::missionObjectiveFor`
    scores the day's MUSCLES into a theme and names it ("Build width &
    V-taper"). Derived from muscles, never from the day's NAME: athletes call
    days anything, and the muscles are the only fact the app always has. Returns
    null on an unrecognised/empty day rather than inventing a purpose.
  * **DIFFICULTY** â€” `difficultyFor(plannedSets)`, banded volume, and that is
    all it claims to be. Nothing in a plan carries load intensity before the
    sets exist, so a difficulty that read "effort" would be inventing it. Zero
    sets returns null: an unplanned day is not an easy day.
  22 goldens.

  **"+N EVO" ON TRAIN IS THE SAME NUMBER HOME SHOWS** â€” `evo-per-session.ts`,
  the athlete's own measured rate, with the same refusals. The mock's "After
  this workout: Strength +0.3 Â· Size +0.2 Â· Evo +0.4" was NOT built: per-pillar
  per-session forecasts do not exist (`session-evidence.ts`). What is true from
  the first session is WHICH pillars it becomes evidence for â€” the PRIMARY
  BENEFIT line, which the progress row replaces once a set is logged (same line
  of the block; before you start, what it buys is the news, mid-session how far
  you have to go is).

  **THE FIGURE IS A READOUT AND A DOOR** (`ui/train/muscle-hologram.tsx`):
  blueprint grid, ambient bloom under the lit regions, a scan that crosses once
  per 5.5s, HUD brackets, and a POWER-ON on the 0.30-0.62 window of the page's
  entrance clock. The art is untouched.

  **TAPPING A MUSCLE ON THE CARD WAS FIXED SEPARATELY (Tyson: "it's hard to
  press on the individual muscles on phone").** The first version put per-muscle
  press targets on the card's 130pt figure, which makes an individual region a
  15-30pt blob - about four millimetres - and, worse, a MISS flipped the view,
  so the usual outcome of aiming at a muscle was the figure spinning. Neither
  bigger hit paths (they overlap each other long before they are comfortable)
  nor nearest-muscle resolution (the athlete cannot tell what they are about to
  open) fixes that. **The card's figure is now ONE DOOR** - tap it anywhere -
  and the precision work happens on the **MUSCLE LOAD BOARD**
  (`ui/train/muscle-board.tsx`), where the same figure is drawn at the sheet's
  full width: measured 8/10/31/31/37/37pt per region against the card's
  15-30pt, and every muscle also has a **358x58 row**. Selecting one ISOLATES
  it on the figure, which is the payoff the small card could never give.
  The PRIMARY MUSCLES chips open the board too (hitSlop takes them to 44pt) and
  **flipping got its own button** (`map-flip`) instead of being the figure's
  fallback action.

  **THE LIST IS NOT A FALLBACK - IT IS THE ONLY WAY IN FOR THREE REGIONS.**
  Front traps, the adductors and the abductors have hand-painted mask artwork
  but NO entry in `front-muscle-paths.ts`, so they can be LIT and never TAPPED,
  at any figure size. Anything that makes the figure the sole control surface is
  wrong for them by construction.

  Each muscle shows what the region DOES (`MUSCLE_FUNCTION`, 17 lines of
  anatomy), today's exercises that hit it with their sets, and THIS WEEK'S REAL
  VOLUME against the 10-set growth floor. **"Estimated growth" was refused** -
  it is not predictable from a plan, and "you are three sets short on lats" is a
  decision where "+0.3 cm" would have been a lie.

  **THE MISSION GRADE** (`domain/progression/mission-grade.ts`, 26 goldens):
  S / A+ / A / B / C from COMPLETION (55) + OVERLOAD (25: this session's tonnage
  vs the athlete's own last session of the same workout) + PACE (20: the median
  gap between set timestamps). The brief also listed intensity and rest-timer
  adherence; there is no RPE column and the timer persists nothing, so those are
  NOT read and not pretended. An unmeasurable factor scores NEUTRAL (0.6) and
  the card SAYS "NOT MEASURED" â€” a disclosed convention, not a hidden fill.
  `sessionPace` refuses outright (null) for a session typed in afterwards, one
  with out-of-order stamps, or fewer than four sets. **A COMPLETION CEILING
  (40 + 60 Ã— completion) exists because three PRs and a 30-day streak lifted a
  session abandoned after four of twenty sets to a B**; the records are real but
  they did not happen to that mission. Rendered at the top of the existing
  summary phase (no extra tap): letter materialising inside an opening ring, one
  scan sweep, factor bars, bonus chips, then SETS Â· MINUTES Â· XP Â· PRS Â· STREAK.
  No confetti.

  **THREE GREY UTILITY CARDS â†’ ONE PLAN RAIL.** `plan-rail.tsx` is
  `CURRENT PLAN / <name>` + `MANAGE PLAN â€º`; `manage-plan-sheet.tsx` holds every
  door they carried (switch loadout, import, quick workout, edit schedule, edit
  plan, create AI plan) plus SWAP TODAY'S DAY. **Every testID is verbatim** â€”
  `today-source-0/1/2`, `swap-day-*`, `change-scan`, `start-empty`, `edit-week`,
  `build-routine`/`create-my-plan`, `forge-ai-plan`, `change-close`,
  `change-workout`. The loadout rows show what a plan IS and how many days it
  holds; **the mock's â˜…â˜…â˜…â˜…â˜… was not built** â€” nothing rates a plan, and five
  stars on every row teaches athletes the real numbers are decoration too.

  **ENTERING MISSION** (`mission-launch.tsx`) covers the /workout route's
  arrival. It NEVER delays navigation â€” `router.push` fires on the same frame â€”
  and it renders inside Train's own view tree via the new `ScreenShell overlay`
  prop, so the pushed page draws over it and it is cleared on the next FOCUS
  (clearing on blur killed it before it painted, because blur fires within a
  frame of the push on web).

  **THE CHAMPION READS TODAY** (`champion-charge.tsx`): idle at zero, the punch
  cycle while the day fills with the glow rising, victory once it is done, and a
  charge plate under it. Same sprite, same profile-menu tap. **THE WEEK IS A
  CAMPAIGN** (`week-bar.tsx`): today breathes (the ONE loop in the list),
  completed days glow and pop their tick once, future days read locked (0.72 +
  a â–®â–¯ glyph). The rows survived rather than becoming the mock's seven-column
  strip â€” a strip cannot carry the sets fraction, PARTIAL, a day's EXTRA
  workouts or EDIT.

  **THE FOLD, MEASURED (`ui/train/train-scale.ts`, `scratchpad/train_tour.mjs`)**:
  START WORKOUT clears the PHONE's fold at all four sizes â€” **+114 at 390Ã—844,
  +170 at 430Ã—932, +11 at 375Ã—667, +14 at 320Ã—720**. 375Ã—667 is the first time
  the Train CTA has fitted an SE without a flick. `RewardPill` moved to
  `ui/core/` and Home's card now imports it; `HomeAmbience` became
  `ui/core/ambience.tsx::ScreenAmbience` (Home keeps the alias) and Train
  mounts it too.

- **HOME â€” THE AAA PASS (2026-08-03, third brief, no migration).** Tyson:
  "elevate it from a polished beta into a premium AAA mobile game experience
  through refinement, clarity, motion, delight and microinteractionsâ€¦ the page
  should feel alive, not busy." Layout and hierarchy were declared close to
  final, so nothing was re-laid-out; everything below is motion, reward
  hierarchy and polish.

  **"+0.4 EVO" SHIPPED â€” AS A MEASUREMENT, NOT A FORECAST.** Asked for three
  times and declined twice; the third ask got a version that is true.
  `domain/progression/evo-per-session.ts` divides the athlete's REAL rating
  gain by the training days that produced it, so "+0.4" is *their own recent
  rate* off `evo_rating_snapshots` and the workout log â€” personal, checkable,
  and it moves when their training moves. A per-session FORECAST still cannot
  exist (see `session-evidence.ts`: the rating is recomputed from the whole
  evidence base at review time, so a session's delta is path-dependent). The
  module therefore REFUSES rather than defaults â€” null on fewer than two
  snapshots in the window, on a flat or falling rating, or on fewer than four
  training days â€” and the pill disappears entirely rather than showing a
  fabricated number. 10 goldens pin every refusal. On the card: `ESTIMATED
  REWARDS` â†’ the Evo gain as the LEAD pill (bigger, purple, bloomed) â†’ XP
  second in gold â†’ `PRIMARY BENEFIT  STRENGTH & SIZE Â· <muscles>`.

  **THE RATING NOW ASSEMBLES ITSELF, every time Home is focused** (~700ms, one
  `intro` clock, all layers derived in worklets): energy ring in â†’ crest glyphs
  illuminate â†’ purple glow expands â†’ digits materialise as twelve pixel shards
  converge â†’ lock with one overshoot â†’ ambient takes over. `evo-burst.tsx`
  gained a `converge` direction so the entrance and the celebration are one
  component.

  **THE LEVEL-UP IS A â‰¤1s SEQUENCE.** Digits COUNT (51 â†’ 52, off rAF
  timestamps â€” no clock call anywhere), a soft camera emphasis swells the crest
  and dips a non-blocking vignette behind it, shards burst, a success haptic
  fires, `playPowerUp()` sounds, and an achievement toast goes up. That toast
  is the SIGNAL: HeroStage already blooms the champion from it, and
  `platform-tech.tsx` now subscribes to the same store and surges the deck. One
  real event, four surfaces reacting, no new plumbing. **The UI is never
  actually frozen** â€” the vignette is `pointerEvents="none"`; a reward that
  eats input is a dropped tap.

  **THE FORGE HINT WENT BACK ABOVE THE RATING** (Tyson: "it teaches interaction
  before the user sees the Champion"), breathing 0.9â†’1.0 with a chevron nudge
  once per 4.4s cycle. The podium plaque kept the form NAME and dropped the
  instruction â€” `JUGGERNAUT / CURRENT FORM` is a STATE, not a label arguing
  with the hint above it.

  **WHAT PAID FOR IT.** The hint costs 24pt with its slot and the rewards block
  45pt â€” both explicit asks, neither free. Reclaimed: the `RISE Â· TRANSFORM Â·
  CONQUER` creed was deleted (a static tagline nothing could act on, 14pt), the
  PRIMARY BENEFIT label and value share a row, the mission card's padding is 14
  and two of its internal gaps dropped a step, and **the champion gave back the
  8% it gained last pass (126 â†’ 112 at `tall`)**. Net measured against the
  PHONE's fold: START MISSION clears by **18pt at 390Ã—844** and **48pt at
  430Ã—932**. If Tyson wants the champion bigger, the levers are the hint or the
  rewards block â€” not the CTA.

  **NEW MOTION, and the driver budget it cost.** `home-ambience.tsx` (three
  drifting fog masses on unequal Lissajous periods + six rising pixel motes,
  every opacity under 0.05) mounts behind the ScrollView through a new
  `ScreenShell backdrop` prop â€” a PROP, not a change to the shell's own glows,
  because those render on every screen and the tab preload keeps five mounted.
  The podium gained an energy pulse every 4s, three steam wisps and the reward
  surge, all off its existing clock. The crest gained the rotating ring off the
  hero's existing clock. Reward chips pop in staggered; tab presses tick
  (`Haptics.selectionAsync` + `playSelect`). `verify-motion`: **22 looping
  components, all 22 gated**.

  **WHAT COULD NOT BE BUILT: the champion's blink and cloak movement.** The
  champion is a rotating sprite GIF; a blink or a cloak needs ART FRAMES, not a
  transform. What shipped instead is everything that is achievable without new
  art â€” breathing, the weight shift with its 0.35Â° roll, floating pixels, the
  contact shadow tracking the float, and the platform's life underneath. New
  frames would need to come out of the AESTHETICS pipeline.

  **Two defects the browser caught, both invisible to tsc and lint:** the crest's
  energy ring was drawn at foreground opacity and 0.78Ã— the crest, so its lower
  arc ran straight through "OVERALL FITNESS SCORE" and read as a line struck
  through the text (now 0.64Ã— and at the emblem's own opacities); and the
  reward block pushed START MISSION under the fold before the reclaims above.

  Verified: tsc, cold lint (0 errors), **1816 vitest**, verify-tokens,
  verify-motion, verify-battle-engine, verify-glicko, `expo export -p web`, and
  a Playwright tour at 390Ã—844 / 430Ã—932 / 375Ã—667 / 320Ã—720 across
  with-Origin and no-Origin, reduced motion (every section present, nothing
  stuck at opacity 0, the entrance pinned complete), the no-rating DISCOVER
  state, the coach mark, the Evo sheet, the "+N EVO" pill with a seeded rating
  history, and the tap-theft regression.

- **HOME â€” THE PREMIUM PASS (2026-08-03, no migration).** Tyson's second Home
  brief: refine, do not redesign; make it feel like a AAA mobile game
  (Supercell / Clash Royale / Diablo, with Duolingo's clarity); make the EVO
  RATING the product rather than a statistic; make it understandable without
  documentation; bring the page to life without making it busy.

  **THE HIERARCHY DIAGNOSIS.** The first screen had FOUR elements at roughly
  equal weight, all glowing: the wordmark (30pt + an 18px cyan bloom), the
  rating, the NEXT RANK card and the mission CTA. Nothing dominated, so the
  page had no two-second answer to *who am I*. Three merges fixed it and paid
  for everything else:
  - **NEXT RANK became a rail inside the crest** (`next-rank-card.tsx` now
    exports `NextRankRail`). Two purple modules about ONE number meant neither
    could be the identity. Same tier name, same countdown, same sub-integer
    bar, same door â€” **âˆ’58pt**, and the whole crest is one tap target.
  - **The forge hint became the podium's plaque** (`forge-hint.tsx` now
    exports `ForgeNameplate`), carrying the CURRENT FORM name with it. That
    chip was the brief's **"THE GRIND card"** â€” audited and judged worth
    keeping (real identity, the only door to the Forge) but not worth a card
    orbiting the champion. **âˆ’20pt**, and it teaches the tap where the tap
    happens. The champion's left flank is now deliberately empty.
  - **The masthead gave up its glow.** Prestige is a CONTRAST relationship:
    the rating cannot be loudest while a glowing wordmark sits above it. The
    neon policy already reserved glow for CTAs / progress / rarity / aura /
    unlock moments â€” a brand name is none of those.

  Spent on: **+15% numeral**, the **"OVERALL FITNESS SCORE"** subtitle, and an
  **8% bigger champion**. Net result measured on the built export against the
  PHONE's fold: **START MISSION clears by 29pt at 390Ã—844 (was 15) and 53pt at
  430Ã—932 (was 44)** â€” better than before, not worse. 375Ã—667 and 320Ã—720 still
  cannot fit the hierarchy (they show through the estimates line, which is
  further down than the old title-line cut).

  **THE EVO RATING IS NOW SELF-EXPLANATORY.** Three new pieces:
  - `evo-detail.tsx` â€” tapping the rating opens a SHEET, not a page: the four
    pillars in plain English with animated bars and their weights, the two
    ladders (next integer, next rank), the five levers, and a **proven**
    momentum badge (`+N Evo in 90 days`, a real subtraction over
    `evo_rating_snapshots`, hidden when there is no gain). `/evo` is one more
    tap for history and forecasts.
  - `evo-coach-mark.tsx` â€” the one-time "â­ EVO RATING / this is your overall
    fitness score" card, dismissed forever. It **waits behind** the first-run
    tutorial AND the home help tour so it can never be the second overlay in a
    session (three stacked overlays is how athletes learn to dismiss overlays
    unread).
  - `evo-burst.tsx` â€” twelve pixel shards when the rating goes UP, keyed off a
    real change against a stored per-device baseline. It also pushes an
    achievement toast, which is what makes the CHAMPION bloom (HeroStage
    subscribes to the toast store) â€” the character answers the number.

  **"+0.4 EVO" WAS ASKED FOR AGAIN, AND IS STILL IMPOSSIBLE â€” but the intent
  shipped.** `domain/progression/session-evidence.ts` carries the full reason
  (the rating is RECOMPUTED from the whole evidence base at review time, so a
  session's delta is path-dependent and unknowable in advance; the
  `projected_impact_low/high` columns exist and nothing writes them). What the
  mission card says instead is true and tested: **`â—ˆ BUILDS STRENGTH & SIZE`**
  â€” which pillars the session becomes evidence for, read straight off the
  review's own inputs. The completed card closes the loop with `â—ˆ BANKED AS
  EVIDENCE FOR YOUR NEXT EVO REVIEW`. 13 new goldens pin the claim.

  **THREE COLOUR MEANINGS, HELD EVERYWHERE.** purple = the Evo Rating and
  everything about it (including the rank ladder) Â· cyan = training, action
  and machinery Â· gold = CURRENCY, i.e. XP and coins and nothing else. This is
  why the rank rail is purple (it was briefly gold and disagreed with itself),
  why the mission's XP pill went gold, and why `RUN FIRST EVO REVIEW` is now
  `epic` â€” as a cyan gradient it was pixel-for-pixel the same button as START
  MISSION one section below, so a rating-less athlete met two identical
  dominant CTAs.

  **MOTION: PAY PER DRIVER, NOT PER EFFECT.** On web every Reanimated loop runs
  on the main JS thread, so the count that matters is animation DRIVERS. Home
  went from 13 to 11 while gaining far more life:
  - `particle-layer.tsx` â€” 6 drivers â†’ **1** (phases folded into the worklets),
    and the motes are square now: it is a pixel game.
  - `platform-tech.tsx` (new) â€” **1** driver for the rotating deck ring, the
    light sweep, three chasing rim LEDs and an occasional spark.
  - `evo-hero.tsx` â€” **1** driver for the breathing bloom and the crest sweep.
  - `avatar-stage.tsx` â€” a weight shift on a **7300ms** clock, deliberately not
    a multiple of the 4600ms float, so the two drift in and out of phase over
    ~37s and the idle never reads as mechanical.
  - `neon-button.tsx` â€” `sweep` (hero CTAs only) + a 1px press SINK derived
    from the same shared value as the scale.
  - `week-strip.tsx` â€” one one-shot pops the completed days in on mount (the
    day flips on the workout screen, so this mount IS the completion moment)
    and one ambient pulse rings TODAY.
  - Coin balance shines once every 24s. Every loop rides `useAmbient`;
    `verify-motion` reports **20 looping components, all 20 gated**, and the
    guard was falsified against the new podium layer (gate removed â†’ red â†’
    restored â†’ green).

  **SCROLL PARALLAX WAS DELIBERATELY NOT BUILT.** It needs the ScrollView's
  live offset, which on web arrives on the same main JS thread every loop
  already shares â€” on the exact device the "everything lags" rule came from.
  `below-fold.tsx` does a 340ms mount entrance instead, which reads as the same
  depth for one one-shot. Revisit only if native builds become primary.

  **"Aesthetics" is now "PHYSIQUE" in every DISPLAY string** (Home sheet,
  `/evo`, the radar, help, the Oracle cards, the origin reveal). The stored
  column keeps its name; the word an athlete reads does not, because a pillar
  must never be two names in two places.

  **Found by the browser tour, invisible to tsc and lint:** the week pips
  rendered as SQUARES because `className="rounded-pill"` on an `Animated.View`
  is dropped by the NativeWind interop (the xp-bar lesson, Â§3) â€” and the podium
  ring was drawn in the champion's rarity colour, which for a COMMON athlete is
  a grey stroke at 0.2 opacity on a purple disc, i.e. nothing. Both fixed;
  neither was findable without looking at a real build.

  Verified: tsc, cold lint (0 errors), 1806 vitest, verify-tokens,
  verify-motion (falsified), verify-battle-engine, verify-glicko,
  `expo export -p web`, and a Playwright tour at 390Ã—844 / 430Ã—932 / 375Ã—667 /
  320Ã—720 covering the with-Origin and no-Origin states, reduced motion (every
  section present, nothing stuck at opacity 0), the no-rating DISCOVER state,
  the coach mark, the Evo sheet, and the tap-theft regression (a press over the
  rating still lands on the rating, not on the champion's overflowing sprite).

- **HOME REDESIGNED AS A GAME HOME SCREEN (2026-08-03, no migration).**
  Tyson's brief: the page must answer *who am I / what do I do next / why
  care* in two seconds, with ONE focal point â€” the champion â€” and feel like
  Clash Royale rather than a dashboard. New order: masthead â†’ forge hint â†’
  **EVO RATING hero** â†’ **the champion** â†’ **NEXT RANK** â†’ **TODAY'S MISSION**
  â†’ **THIS WEEK** â†’ the fold â†’ everything else.
  - **The order reversed back, and the 2026-08-02 constraint was removed
    rather than ignored.** That commit put the mission FIRST because the hero
    rig was 360pt and nothing else fit. Now `ui/home/home-scale.ts` sizes the
    champion to the viewport, `hero-stage.tsx` takes a `headroom` multiplier
    (0.25 default, Home passes 0.08), and the rig is ~198pt on a 390Ã—844
    phone â€” so the character, the rating and the next rank all sit ABOVE
    START MISSION and the button still clears the tab bar. **If a future
    change pushes the CTA under the nav, shrink the rig; do not re-order.**
  - **`artScale` (new, `avatar-stage.tsx`): grow the ART, not the rig.** A
    rotation frame is ~59% transparent (24% under the feet, ~35% over the
    head), so a champion drawn at `size` reads only ~0.58Ã—`size` tall â€”
    raising `size` buys podium and empty sky at the same rate. Home passes
    1.5, which puts the athlete back at ~100pt inside a 198pt rig. The feet
    never move: SPRITE_BOTTOM_PAD is a fraction of the drawn height, so the
    contact line is scale-invariant. Painted fallback art is deliberately
    NOT rescaled (it is framed differently). Every other stage passes 1.
  - **MEASURE AGAINST THE PHONE'S FOLD, NOT THE BROWSER'S.** A desktop export
    gives `paddingTop 14` + a 58pt tab bar; an iPhone PWA gives 47 + 88. The
    device is **63pt meaner**, which is the difference between "CTA above the
    fold" in a screenshot and under the nav on Tyson's phone. The tour script
    reads every section's rect and reports both. Result: CTA clears by 15pt
    at 390Ã—844 and 44pt at 430Ã—932. A 375Ã—667 SE cannot fit this hierarchy at
    any size â€” it shows through the mission card's title and needs one flick.
  - **Four duplicates merged, nothing deleted.** The Mâ€“S pips left
    TrainingOverview (the new `week-strip.tsx` owns them); the streak badge
    left the champion's flank (it counts the same days); NEXT EVOLUTION % left
    the fold (EvolutionTeaser already shows it, with the silhouette);
    "PROVISIONAL" folded into the descriptor pill; the mission's `sub` folded
    into its kicker; the reward box + muscle pills became one reward row and
    the three metric towers became one estimates line. `evo-core.tsx` is gone,
    replaced by `evo-hero.tsx` with every one of its states intact (flag off,
    loading, no rating = the DISCOVER door, review-ready, provisional).
  - **NEXT RANK is real ladder arithmetic**, not a motivational number:
    `evoTierStanding()` in `domain/progression/evo-rating.ts` reads
    EVO_RATING_TIERS and the review's own `evolution_progress` hundredths, so
    "9 EVO TO GO" is `ceil(nextTier.min âˆ’ (rating + progress/100))`. Six new
    goldens pin the boundaries, the summit and garbage input.
  - **NO "+0.4 EVO" REWARD, and there never can be one.** The mock showed a
    per-workout Evo grant; no such grant exists â€” the rating is recomputed
    from pillar evidence at review time, so no workout can promise a delta in
    advance. XP (10/set) and the muscle read are real and shown; the Evo line
    is omitted, per "a system without a backend is hidden, never mocked".
  - **Below the fold is deferred, not dropped.** `below-fold.tsx` mounts the
    path summary, weekly numbers, PR, evolution teaser, radar, leaderboard and
    drift warning after `InteractionManager.runAfterInteractions`, behind a
    placeholder of the same slot so the sections above never re-flow.
  - **The overlay threshold moved 380 â†’ 320.** Below it the champion's chips
    wrap into a stacked row UNDER the stage that costs ~200pt of first
    screen â€” on a 375pt phone that was the single biggest thing pushing the
    CTA off. Checked at 320 against the sprite's own ~25% transparent side
    margin, which is wider than the overlap.
  - Copy note: the card is still **TODAY'S MISSION / START MISSION**, not
    "QUEST" as the brief's mock reads. "Mission" is the app-wide term (push
    notifications, `domain/origin/first-mission.ts`, Train, help, the legal
    copy); renaming Home alone would make Home and Train disagree. One-line
    change if Tyson wants the rename done properly across all of them.
  - **A 30-agent adversarial review (6 lenses, every finding sent to an
    independent skeptic) confirmed 8 defects; all 8 are fixed here.** The four
    worth remembering are now rules in Â§3: InteractionManager is a no-op stub
    in RN 0.86; an overflowing box still eats taps; the SVG a11y props are
    inert on web; and `aria-hidden` on an `<Svg>` made the crest vanish because
    the scene janitor's size guard read `offsetHeight` (undefined on
    SVGElement) and failed open â€” that guard is fixed for the whole app. The
    other four: `evoTierStanding` under-counted by one when
    `evolution_progress` rounded to 100 (the countdown now comes off the
    DISPLAYED integer, so Home's two numbers can never disagree â€” new golden
    walks every tier at progress 0 and 100); the seven week pips overflowed the
    divider below ~357pt (now flex squares capped at 30); and the mission
    kicker could cut the section label itself (label and qualifier are separate
    Texts, only the qualifier shrinks).
  - **Both tap-theft and the pip overflow were FALSIFIED**: broken on purpose,
    watched go red in a browser tour (`elementFromPoint` over the rating
    returned `hero-avatar`; the last pip's right edge crossed the streak
    column), then restored and watched go green.
  - Verified: tsc, cold lint (0 errors), 1796 vitest, verify-tokens,
    verify-motion (16 loops, all gated â€” the two new ones ride `useAmbient`),
    verify-battle-engine, verify-glicko, `expo export -p web`, and a Playwright
    tour at 390Ã—844 / 430Ã—932 / 375Ã—667 / 360Ã—720 / 320Ã—720 in both the
    with-Origin and no-Origin states.

- **HOME RE-STACKED FOR THE FOLD (2026-08-02, no migration).** Tyson: shrink
  the avatar + podium 20%, simplify the Evo Rating, and make TODAY'S MISSION
  viewable without scrolling. Measured on the built export at 390Ã—844 and
  375Ã—667 (Playwright, smoke ALPHA):
  - **The hero rig scales from ONE number.** `avatar-hero.tsx` passes
    `HOME_HERO_SIZE = 192` (was the 240 default) and `hero-stage.tsx` now
    derives its headroom as `size * 0.25` instead of a constant 60 â€” so the
    champion, the 1.5Ã— podium and the sky above them shrink together.
    Verified: podium 360Ã—193 â†’ 288Ã—154, champion 357 â†’ 285, stage 450 â†’ 360.
    All exactly 80%. The other stages (`/avatar` 230, customise 190) pass
    their own sizes and only lose â‰¤12pt of empty headroom.
  - **The Evo card says three things, not eight.** Rating + descriptor, a
    progress bar, and a review door only when a review is actually
    actionable. The four pillar scores, the limiting pillar and the
    "Next review: 8d" countdown were NOT deleted â€” they live on `/evo`,
    which the card is the door to. 175pt â†’ 113pt.
  - **THE MISSION CARD NOW LEADS THE PAGE, above the hero.** Shrinking alone
    could not do it: on production the mission's CTA sat at y=981 against a
    fold at y=786, and the two size cuts bought ~160pt of a ~330pt deficit.
    On a 375Ã—667 phone nothing would have been enough. Order is now
    identity â†’ mission â†’ character â†’ evo core â†’ â€¦; the CTA lands at y=308,
    fully above the fold on both sizes, and the podium still meets the fold
    so the champion is on the first screen. Mirrored into the Page Lab
    fork (`src/lab/variants/home/baseline.tsx`) â€” its diff against
    `(main)/index.tsx` is still exactly the three-item fork recipe.
  - **FOUND EN ROUTE â€” the "1px transparent" origin placeholder was a
    HALF-OPAQUE BLUE PIXEL.** `avatar-hero.tsx`'s `BLANK` data URI decoded
    to filter-Sub + RGBA(0,0,255,127); AvatarStage stretches the champion
    source to sizeÃ—1.35, so every athlete WITHOUT an Origin met a 325Ã—323
    blue slab hanging over the podium behind the gold FORGE YOUR ORIGIN
    button â€” on the first screen of their first session. Replaced with a
    decoded-and-checked transparent pixel. **Lesson: decode a data URI
    before trusting the comment next to it** (`zlib.inflateSync` over the
    IDAT is four lines).
  - Smoke ALPHA's password had gone stale again (400 on sign-in, same as
    2026-07-25); reset to the Â§5 documented value via the admin API.

- **EVOFORGE COMMAND (2026-07-25, migrations 088-090) â€” a SEPARATE Next.js site
  at `C:\Users\tyson\evoforge-command`, not part of this app.**
  Tyson's founder-council / autonomous-studio platform for Tyson, Jesse and
  Charlie. It shares THIS Supabase project (same auth, same three admin
  accounts) but nothing in it is reachable by an athlete: every `command_*`
  table is founder-only RLS and every write goes through a SECURITY DEFINER
  RPC that audits itself in the same transaction.
  - **This supersedes the 07-25 decision "extend the app, not a Next.js
    project" for the GOVERNANCE layer only.** `/exec` inside the app stays as
    it is â€” it answers "how is the product doing". Command answers "what are
    we building, who approved it, and what shipped".
  - **Migrations 088/089/090 are applied. Next free number: 091.**
  - `supabase/functions/command-notify` â€” phone push so a founder can vote
    from anywhere. Cron `command-notify`, every minute. Same VAPID pair as
    `send-push`; same gateway-auth pattern as 086 (publishable key as the
    bearer to pass the gateway, `x-cron-secret` as the real authorisation).
  - Cron `command-exec-cycle` runs the AI Exec every 10 minutes as PLAIN SQL,
    so unlike 084/085 it has no edge gateway in front of it and cannot be
    silently 401'd. It either raises a proposal or records why it did not.
  - **The one rule to know if you touch it:** approving a proposal opens work,
    it does not deploy. Deployment needs an explicit founder authorisation â€”
    either a release vote, or a proposal the founders approved knowing it was
    marked auto-deploy. Monetisation, ownership and privacy are forced to the
    gated path by a TRIGGER, not by convention, so no UI change can lift it.


- **THE EXEC DASHBOARD (2026-07-25, migration 087) â€” `/exec`, admin-only.**
  Tyson's four decisions, implemented: **extend the app** (no Next.js project â€”
  reuses `is_app_admin()`, the rollup RPCs, the tokens and the existing deploy),
  **quick actions YES**, **AI Workforce built FOR REAL**, name redacted.
  - `exec_overview()` returns the whole front page in ONE round trip, and its
    funnel is **cohort-split at 2026-07-17** â€” mixing the cohorts is what
    produced the wrong diagnosis on 07-24, so the split is baked into the RPC
    rather than left to whoever writes the next query.
  - `domain/exec-health.ts` (pure, 10 tests) holds the score: weights and
    targets are DATA, so changing a target is a one-line diff. **Activation is
    read from the post-Origin cohort, depth from lifetime** (two weeks cannot
    show a 4-day habit). Falsification-by-construction: an empty product scores
    0 without NaN, and beating a target caps at 100 rather than reporting 340%.
  - **THE SCORE IS NOT THE 43 IN THE 07-24 REPORT.** Different model â€” this one
    adds onboarding + reachability, drops revenue, and scores observability,
    which we then fixed. It reads **58** live. The two are not comparable; the
    dashboard's is the one that updates itself.
  - **QUICK ACTIONS AND THE APPROVAL GATE:** a founder pressing a button *is*
    the constitution's approval â€” the rule exists to stop an AGENT acting
    unilaterally. So each action is admin-gated server-side, written to
    `exec_action_log` **with who pressed it**, and reversible or read-only.
    Pausing the watchdog is the only one that can HIDE a problem, so it
    confirms. Deploy / merge / dispatch-CI are **deliberately absent** â€” they
    need a GitHub token this project does not have, and a button that cannot
    work is worse than no button.
  - **`exec_agent_activity` is the real AI-Workforce rail.** Agent sessions
    write it through the service role (an agent is not a signed-in user). The
    page shows what actually ran, including the honest "no agent session has
    reported yet" â€” never a simulated status.
  - **`Date.now()` IS NOT ALLOWED IN RENDER** (React Compiler: "Cannot call
    impure function during render"). Every relative time on the page is anchored
    to the server's `generated_at`, which also stops a skewed device clock
    mis-aging every row.
  - Verified by a real admin tour of the built export against production; the
    quick actions were run and their audit rows confirmed, then deleted.
  - **TWO OPERATIONAL FINDINGS:** (1) `app_admins` holds **three** accounts â€”
    `tysoncooke865@`, `newletterwhore@` and `charli.lachlan.davis@` â€” not just
    Tyson, and admin now includes pausing alerting. Worth a deliberate decision.
    (2) The smoke passwords in Â§5 had gone stale (400 on sign-in); ALPHA's was
    reset back to the documented value.
- **THE NAV-FREEZE BEACON WAS MEASURING BACKGROUNDING, NOT JANK (2026-07-25,
  no migration).** It shipped 2026-07-18 to hunt the iOS PWA freeze, has written
  ~1,250 rows since, and taught nobody anything â€” because its data is noise:
  ```
    700â€“899 ms   12.8%
    900â€“1099 ms  74.5%   <- browsers clamp timers to 1/sec while HIDDEN
   1100â€“1999 ms  10.2%
   2000â€“4999 ms   0.6%   <- the only plausibly-real bucket
   5000+ ms       1.8%   <- suspended tab, up to 10 HOURS
  ```
  A 250 ms heartbeat clamped to 1 s produces a ~1,000 ms "gap", which is why the
  **p50 was ~1001 ms on every single route** â€” real jank never distributes like
  that. Fix: `domain/nav-stall.ts` (pure, 9 tests) refuses any window that
  touched a hidden document (`visibilitychange` + `pagehide` + `freeze`, since
  iOS PWAs often suspend without the first), floors at **1500 ms** so a
  partially-throttled tick cannot masquerade, and ceilings at **15 s** because
  beyond that nothing was blocking a thread â€” the tab was asleep. The
  hidden-flag is **consumed every tick**, or one backgrounding would silence the
  beacon for the rest of the session. **Why it matters:** performance is now the
  leading hypothesis for the post-onboarding drop-off, and this is the only
  instrument the app has for it â€” an instrument that reports noise is worse than
  none, because it looks like evidence.
  **Historical `pwa_nav_diag` rows before 2026-07-25 should be treated as
  unusable.** Falsified: the hidden-document guard broken â†’ 2 red â†’ restored.
- **TRAINING REMINDERS â€” push finally has a reason to exist (2026-07-25,
  migration 085).** The rail has worked since 053 and had **one subscriber**,
  for two reasons: the only opt-in is buried in a modal behind the Social tab's
  bell AND pitched as a social feature ("get pushed when friends react") on a
  feed with 17 lifetime posts â€” and **nothing had ever SENT a training message**
  (`send-push` fires only for social events), so even that one subscriber got
  nothing worth returning for.
  - **085 `training_reminder_due()`** decides WHO in SQL, so the rule is
    falsifiable without a deploy. It refuses to nudge anyone whose nudge would
    be noise: never someone who has **never logged a set** (a stranger is not
    owed a notification), never twice a day, never on a day they already
    trained, never on **their own scheduled Rest day**, and never after 21 days
    of silence (that is a win-back campaign â€” different thing, different
    consent). `push_reminder_log` PK `(user_id, day, kind)` makes a double-send
    impossible **by construction**, and the sender **claims the day BEFORE
    sending**: the failure mode of a reminder system must be silence, never a
    double buzz.
  - **TIMEZONE, stated not assumed:** there is no per-user timezone in the
    schema, so the function uses `Australia/Sydney` explicitly. Cron fires
    08:00 UTC = 18:00 AEST. Revisit when timezones are stored.
  - The message **NAMES their session** ("PULL 1 â€” BACK THICKNESS is waiting").
    "Time to train!" is spam; the difference is whether the athlete believes the
    app knows anything about them.
  - **Client:** `state/push-prompt-store.ts` + `ui/core/push-prompt.tsx` ask
    after a workout â€” but **from the SECOND finish onward**, because a finish
    already raises up to two other sheets (share, save-routine) and a third one
    asked eagerly just teaches people to dismiss sheets. Mounted FIRST in
    `(main)/_layout.tsx` so it stacks BENEATH those two (the convention they
    already use). Never asked when permission is `denied` â€” a browser-level
    block a sheet cannot undo.
  - **`pushNeedsInstall()`**: iOS gives the Push API to home-screen apps only,
    and the notifications card previously **hid itself entirely** on that
    platform â€” telling the users most likely to be on it nothing at all. It now
    says to Add to Home Screen.
  - **FALSIFIED:** all five selection rules driven in a rolled-back txn
    (rest-day â†’ not picked Â· eligible â†’ picked AND named Â· never-trained â†’ not
    picked Â· trained-today â†’ not picked Â· already-reminded â†’ not picked), plus
    the first-finish suppression broken â†’ red â†’ restored. 7 store tests.
- **THE ALERTING SPINE (2026-07-25, migrations 083 + 084).** Nothing watched
  production; time-to-detection was ~48 h. Now it is 5 minutes, in-database.
  **The 2026-07-21 incident was a SPIN LOOP, not a slow retry** â€” the 46-hour
  average (~7 writes/min) hid it. Per minute that client wrote **2,412 rows in
  one minute** (08:49) and 60% of all 20,862 of its events inside the first 32
  minutes: ~40 inserts/second.
  - **083** â€” `exec_alerts` (partial-unique on `(kind, subject)` where unresolved,
    so a 5-minute scan cannot stack 300 copies of one problem) Â· `exec_metric_daily`
    Â· **the analytics throttle** (BEFORE INSERT trigger: 120/hour per
    `(user, event_name)`, 1,500/day per athlete, **RETURN NULL not RAISE** â€”
    `track()` swallows errors so an exception would be invisible, and dropping
    quietly avoids teaching a retry loop to retry harder) Â· **`exec_watchdog_scan()`,
    six rules IN SQL** so they can be replayed and re-tuned without a deploy:
    error_burst Â· write_flood Â· onboarding_stall Â· **activation_stall** (the
    current cliff) Â· activation_drop (needs â‰¥8 signups in the window â€” with 3
    signups a week, one unlucky athlete is not a trend) Â· zero_training, plus
    auto-resolve when the athlete moves on.
  - **084** â€” enables **pg_cron + pg_net** (neither was installed) and schedules
    `exec_watchdog_scan()` every 5 min, `exec-notify` every 5 min, and the daily
    snapshot at 00:07 UTC **for the day that just CLOSED**, never a partial day.
    Also **corrects 083 rather than editing it** (never edit a deployed
    migration): three snapshot metrics were computed "as of now", so a backfill
    would have written today's totals onto past dates â€” a trend line that looks
    plausible and is fabricated. Every metric is now a function of its own day,
    which is what makes the **14-day backfill honest** (it landed: 27 signups,
    557 sets, 10 activated).
  - **`supabase/functions/exec-notify`** â€” the only leg that cannot live in
    Postgres (VAPID signing). Auth is a shared secret in `x-cron-secret`,
    constant-time compared, **refusing to run if unset rather than defaulting
    open**. Sends **ONE push per run, not per alert** (five alerts is one
    incident to a human; five buzzes is how people learn to swipe notifications
    away). Stamps `notified_at` even when nothing could be sent, so an alert
    raised before any admin subscribed never arrives later as a burst of stale
    pushes â€” the OPEN alert is the durable channel.
  - **SECRETS ARE NOT IN THE REPO** (it is public): `CRON_SECRET` is an edge
    secret, and the same value sits in **Vault** as `cron_secret`, read at fire
    time by the cron job. To rotate, change both.
  - **086 â€” THE SPINE DID NOT ACTUALLY WORK UNTIL THIS.** 084/085 posted with
    only `x-cron-secret`, and **every scheduled call returned
    `401 UNAUTHORIZED_NO_AUTH_HEADER`**: Supabase's edge gateway verifies a JWT
    *before* the function body runs, so the custom header was never reached. The
    watchdog was writing correct alerts while the notification leg 401'd every
    five minutes â€” an alerting system that could not alert, with three green
    cron runs to its name. **A green schedule proves nothing; read
    `net._http_response`.** Fix: send the PUBLISHABLE key (already public â€” it
    ships in the browser bundle) as the `Authorization` bearer purely to pass
    the gateway; `x-cron-secret` stays the real authorization. Verified live:
    `200 {"ok":true,"sent":1,"alerts":6,"pruned":0}` â€” a real push delivered.
  - **FIRST REAL FINDINGS, unprompted:** within 10 minutes of going live the
    watchdog opened **5 `activation_stall` + 1 `onboarding_stall`** on real
    athletes â€” exactly the cliff the funnel work identified, found by the
    system rather than by a person running SQL.
  - **FALSIFIED, both directions.** Replaying the real 07-21 window
    (`select exec_watchdog_scan('2026-07-21 09:05+00')` in a rolled-back txn)
    opens `error_burst` (77 failures/15 min) AND `write_flood` (10,173
    events/15 min) at **09:05 â€” 16 minutes after that athlete signed up, 46
    hours before they gave up, 2 days before 082 shipped**. The throttle: 400
    attempted inserts of one event name â†’ **exactly 120 landed**. Both rolled
    back, zero rows left.
- **ACTIVATION FUNNEL INSTRUMENTATION (2026-07-25, no migration).** The origin
  program instrumented onboarding and stopped at `onboarding_completed`;
  everything after it was dark, and that is where athletes are actually lost.
  **The cliff is NOT Origin binding** â€” that read was cohort mixing (the Origin
  flow launched 2026-07-17, so earlier signups never had a flow to abandon).
  Split at that date, the post-Origin cohort is **10 profiled â†’ 8 bound an
  origin â†’ 3 logged a set**: onboarding works, the hand-off after it does not.
  New event **`activation_step`**, one name with an ordered `index` so the funnel
  is `max(index) per user` instead of hand-written route SQL: `home_reached`(1) Â·
  `train_opened`(2) Â· `workout_opened`(3) Â· `first_set_logged`(4). Every row
  carries `ms_since_signup` + `ms_since_prev_step` (**null, never 0, when unknown
  or when the device clock ran backwards** â€” a 0 would drag an average down), and
  `train_opened` carries **the state the athlete FOUND** (`has_plan`, `day_kind`
  workout|rest, `exercise_count`, `plan_source`, `has_schedule`) â€” the one signal
  that separates "didn't want to train" from "nothing to tap", which nothing in
  the rail could distinguish. **Why not just `page_view`:** it records the
  PREVIOUS route on navigation, so an athlete who lands on Home out of onboarding
  and quits emits *nothing* â€” exactly the population being measured â€” and it
  never says what was on the page. **BOUNDED BY CONSTRUCTION: each step emits
  once per athlete and the ladder switches OFF PERMANENTLY at step 4 â€” four rows
  per athlete, lifetime.** It cannot repeat the 2026-07-21 flood (one stuck
  client, 20,051 rows, unthrottled). Duplicates are harmless regardless: the
  funnel query reads `max(index)` / `min(created_at) per step`, both idempotent,
  which is *why* the local mark is cleared on sign-out with every other cache
  rather than carving an exception out of the doctrine. `first_set_logged` has a
  second guard â€” an EMPTY log â€” so a returning athlete on a new device stays
  silent. Files: `domain/activation-funnel.ts` (pure, 14 tests, **two guards
  falsified**: the terminal-step switch-off and the negative-clock clamp),
  `data/activation.ts` (emitter + `useActivationStep`), wired in
  `(main)/index.tsx`, `today.tsx`, `workout.tsx`, `mutations.ts::useSaveSet`,
  cleared in `auth-context`. Doc: `docs/ACTIVATION_ANALYTICS.md` (carries the
  funnel SQL). Gates: tsc, 1,647 tests, cold lint (0 errors â€” the first cut wrote
  a ref during render, which the React Compiler rules reject), tokens/motion/
  battle-engine/arena-purity/arena-anim, export, and a **Playwright tour of a
  throwaway production account through all four steps** (fresh account â†’ Home â†’
  Train â†’ add an exercise â†’ log a set), confirming the wire, the props, the DB
  rows, the documented funnel query, and that 3 Homeâ†”Train round-trips plus a
  hard reload emit **nothing extra**. Probe account and every row it created
  deleted afterwards (verified 0 rows, user count back to 29). **Found en route,
  not fixed:** a brand-new athlete with no schedule lands on Train showing a REST
  day with nothing to do, and the workout page opens a 4-step first-run tour over
  an empty workout â€” measured, not guessed at, and now instrumented.
- **SWAP TODAY'S DAY (2026-07-24, no migration, Tyson-reported): trade a
  split day for a different one from the same plan** â€” "meant to be Push 1,
  want Pull 1 instead." Surfaced as a new section inside the existing CHANGE
  WORKOUT modal (`today.tsx`, `swap-day-<name>` chips: every day in the
  currently-active source's list, minus whatever's already showing today),
  offering EVERY other day the CURRENT source knows (MY PLAN / AI PLAN /
  BUILT-IN, whichever the athlete is on) â€” picking one asks the same
  SAVE/JUST-TODAY question `workout.tsx` already asks for exercise edits:
  **JUST TODAY** writes `daySwap` (new field) into `session-store.ts`, the
  SAME self-expiring-at-midnight AsyncStorage store `adhoc` already lives in
  â€” no network call, and `dayInSource` checks it BEFORE the schedule, so it
  outranks everything and vanishes on its own tomorrow. **SAVE TO MY
  SCHEDULE** goes through the existing `useSaveSchedule`, replacing just
  today's weekday's PRIMARY in the latest row's `plan` (extras riding along
  untouched) â€” same shape schedule.tsx's own SAVE writes, effective today
  onward. Falsified live against ALPHA: the week-bar testID for today
  flipped from `weekbar-2026-07-24` (Rest) to
  `weekbar-2026-07-24-Pull 1 - Back Thickness` after JUST TODAY â€” no DB
  writes, confirmed via network trace. **Found, not fixed (pre-existing, out
  of scope): opening ANY Modal on Train â€” even the pre-existing CHANGE
  WORKOUT source picker, no swap involved â€” shifts the daily hero
  carousel's virtualized FlatList window left, dropping today's card out of
  the DOM until the athlete manually scrolls back. Reproduced with zero code
  changes; worth its own investigation (`ui/train/daily-workout-carousel.tsx`
  + RN-Web's `Modal`), not chased here.** Files: `today.tsx`,
  `state/session-store.ts`. Gates: tsc, 1,634 tests, cold lint (fixed two
  `react/no-unescaped-entities` on the new copy), tokens/motion/battle-engine,
  export, the live falsification above.
- **TWO BUG FIXES: the plan-source dropdown going inert, and false "COINS NOT
  BANKED" errors on PRs (2026-07-24, no migration, Tyson-reported).**
  (1) **Plan-source dropdown**: Today's "CHANGE WORKOUT" modal (MY PLAN / AI
  PLAN / EVOFORGE PLAN, `today.tsx`'s `plan-dropdown`) stopped changing what
  showed the moment the athlete had ever saved `/schedule` â€” `schedule.tsx`'s
  2026-07-20 redesign started writing a UNIFORM per-day `sources` map on every
  save (comment: "Train's per-date reader ... honours an explicit per-day
  source"), and `today.tsx`'s `sourceForDate` gives that map priority over the
  dropdown's own choice. Schedule's write kept `active_plan_source` (035) in
  sync with its own map, but the dropdown only ever wrote
  `active_plan_source` â€” never the map â€” so the FIRST schedule save froze
  `sources` at whatever it was then, and it outranked every dropdown tap
  forever after. Fix: the dropdown's `onPress` now re-stamps the latest
  schedule row's `sources` uniformly to the tapped choice too (same
  "trained day" test as `schedule.tsx`'s `onSave`), so the two writers stay
  symmetric â€” exactly like `workout.tsx`'s existing built-inâ†’MY-PLAN fork
  write already does selectively. Falsified live against ALPHA: tapped MY
  PLAN, confirmed via SQL the new `workout_schedule` row landed with
  `sources` remapped and `profile.active_plan_source` updated; tapped back to
  EVOFORGE PLAN and confirmed it reverted. (2) **False COINS NOT BANKED**: the
  Today/Train exercise cards log every set through the `durable` (P2 offline)
  queue â€” `mutations.ts` mints the row id, hands it to `enqueueSet`, and
  returns immediately; the actual `workout_log` INSERT happens later in
  `set-queue.ts`'s background `flushQueue`. The PR coin claim fired
  EAGERLY, in the same tick as the (still-queued, not-yet-synced) row â€” the
  013/061 guard's `pr` branch couldn't find the row yet and raised
  `"coin_events: no matching owned set (...)"`, which `coin-claims.ts`
  didn't recognise and surfaced as a scary "COINS NOT BANKED" error toast on
  an ordinary PR. Fix: `enqueueSet`/`QueuedSet` now carry the verdict's
  `isPr`, and the PR claim moved into `flushQueue` right after ITS insert is
  confirmed (mirroring the XP grant, which already worked this way);
  `mutations.ts`'s immediate claim now skips entirely when `queued`. Also
  hardened `classifyClaimError` as a backstop: any `coin_events:`-prefixed
  guard message not already named falls into the silent `guard` bucket
  instead of `error` â€” only a message that ISN'T the guard's own voice
  (network, RLS, a dropped column) should ever toast. Falsified live against
  ALPHA: logged 220kgÃ—10 Barbell Back Squat (prior best 200kgÃ—9, e1RM
  260â†’293.3) on the durable path, confirmed via network trace NEW PR fires
  immediately, `workout_log`/`xp_events`/`coin_events` all POST 201 ~200-400ms
  later from the flush, "COINS BANKED +50" toast lands, no error toast at any
  point; seeded rows deleted after. Files: `today.tsx`, `mutations.ts`,
  `set-queue.ts`, `domain/coin-claims.ts` (+1 test). Gates: tsc, 1,634 tests
  (1 new), cold lint, tokens/motion/battle-engine, export, the two live
  Playwright/SQL falsifications above.
- **ARENA MARKSMAN MOB â€” first frame-animated combatant (2026-07-24, no
  migration)**: the `drone-archer` (Javelin Marksman) ranged unit now plays a
  full animation set sliced from a user-supplied external sheet
  (`client/assets/arena-madmog-src/madmog-streamavatars.png`) by the new
  committed slicer `client/scripts/arena-madmog-gen.mjs` (same 2px team-outline
  + pngquant as the PixelLab pipeline). `toward`/`away` run cycles (team
  selects direction â€” the vertical lane faces player units away, opponents
  toward), an `attack` firing loop while engaged, and a `death` collapse; the
  hit reaction reuses the existing white-flash + recoil. All frame-driven off
  the frame clock (no per-unit state / no Animated â€” the arena perf doctrine).
  Death identity is resolved by pairing the structured `death` log line with
  its adjacent `fx death` line in `combat-fx.ts` (NO engine change â†’ no replay-
  hash risk). The character's red palette is a DOCUMENTED divergence from
  ART_BIBLE Â§2/Â§5 (external user-directed asset). See
  `client/src/arena-game/ASSETS.md` + `PROGRESS.md` (Marksman section). Gates:
  tsc, 1,599 tests (4 new), lint baseline, motion/tokens/arena-purity, export,
  real-battle Playwright zoom captures.
- **PERF PASS: BOOT CHUNK + SET-SAVE NETWORK BUDGET (2026-07-23, no
  migration)**: five independent hot-path fixes, no behavior change intended.
  (1) **Boot-chunk slimming**: set save, the set queue and the Home/Train
  cards resolve exerciseâ†’muscle through the new
  `client/src/domain/muscle-lookup.ts` seam, which carries only the compact
  GENERATED nameâ†’muscle projection (`muscle-by-name.generated.ts`, regenerate
  via `node scripts/gen-muscle-by-name.mjs`, pinned to `EXERCISE_LIBRARY` by
  `__tests__/muscle-by-name.test.ts`) â€” the full ~1,109-entry library now
  stays behind the picker/builder route chunks instead of riding the shared
  boot chunk. `exercise-library.ts`/`exercise-search.ts` re-export
  `libraryMuscleFor`/`userMuscleFor`/`UserExercise` so picker-side callers
  keep one import; precedence (user > library > inferMuscleGroup) unchanged.
  (2) **Achievement sweep network budget** (`data/achievement-sweep.ts`):
  was ~7 fresh round-trips PER SET; now `achievements` + `xp_total` stay
  always-fresh (they make the insert honest) while the other inputs read the
  Query cache when it can answer COMPLETELY (bodyweight's 180-row window only
  stands in when it holds the whole history) with byte-identical fresh-read
  fallbacks; concurrent saves COALESCE into one running + one trailing sweep.
  Cache-fed sweeps can only fire an unlock LATE, never wrongly (C8 rule).
  (3) **Leaderboard polling gated on focus** (`data/hooks.ts`): both
  leaderboard queries poll only while their screen `useIsFocused()` â€” the
  idle-tab preload kept Home mounted, so the old visibility-only gate polled
  the two most expensive RPCs forever from behind other tabs. Also
  `data/keys.ts`: a `public_profile` write no longer invalidates the two
  leaderboard keys (a name/privacy edit reorders nothing; /rank refetches on
  visit; order changes ride `user_progression`).
  (4) **Lift bests memoised** (`useLiftBests` in `data/hooks.ts`): the five
  `bestE1rmFor` scans over the 2,500-row log moved out of per-render
  `useCurrentStats` into a module-scope TanStack `select`; bench precedence
  order preserved. (5) **Picker filter count debounced** (`exercise-picker.tsx`,
  120ms) and the QUICK WORKOUT sheet extracted into its own component in
  `today.tsx` so name keystrokes stop re-rendering the whole Train hub.
  Guards: full suite 1,558 green (incl. new `muscle-by-name.test.ts`), tsc +
  lint clean, tokens/battle-engine/motion guards green, export clean.
- **EXERCISE LIBRARY + SPLITS EXPANSION (2026-07-23, no migration)**: added
  **88 new curated exercises** (variants of the staples â€” every triceps-pushdown
  grip/handle, overhead-extension, curl, lateral/front raise, upright row, cable
  fly, pulldown/row, squat/lunge, hip-thrust, calf and shrug variant) to
  `CORE_EXERCISES` in `client/src/domain/exercise-library.ts` (core 113â†’201,
  whole library ~1021â†’1109). Every name was collision-checked (case-insensitive)
  against the full library incl. the ~908 imported `free-exercise-db` entries â€”
  the 23 that already existed there were dropped, not duplicated (the
  NO-DUPLICATE test fails on any). New entries carry `popularity: 90` so the top
  staples (100) still surface first in search/substitution. Also added **10 new
  `DAY_PRESETS`** (Chest, Back, Shoulders, Chest & Triceps, Back & Biceps,
  Shoulders & Arms, Upper/Lower Power, Upper/Lower Hypertrophy) and **5 new
  `SPLITS`** (`bro5full` full-seed bro, `arnold6`, `phul4`, `ppul5`, `ubro4`;
  non-custom splits 6â†’11). All preset exercise names are byte-identical to
  library entries. **Hand-authored surface only â€” NOT the generated `catalogs.ts`
  EVOFORGE PLAN**, which stays contract-locked. Guards: `exercise-library.test.ts`
  35/35, full suite 1426 green, tsc + lint clean.
- **OVERNIGHT ARENA HARDENING RUN COMPLETE â€” P1â€“P14 (2026-07-23, no
  migration)**: the full 14-phase program executed in one autonomous run
  (audit â†’ five-champion rebuild â†’ engine reliability â†’ stability â†’ FX â†’
  readability â†’ balance â†’ cards â†’ AI tendencies â†’ journey â†’ gym slice â†’
  reward safety â†’ final verification). Final state: five official
  champions with passives/roles, 20 cards / 7 synergies, save v6,
  Arena suite 487 (full suite 1,558), deep harness 362 matches with 0
  defects and win rates [45%, 54%], P13 reward-safety audit CLEAN,
  every guard green. **Read
  `OVERNIGHT_ARENA_BUILD_REPORT.md` (repo root)** â€” phase table, final
  state, and the decisions that need Tyson (XP reward policy,
  `gym_detail origin_path` migration, on-device pass). Per-phase detail
  in the entries below + `client/src/arena-game/` docs.
  hardening P12)**: official-path squad ROLES, data-driven from champion
  content (`features/gyms/path-roles.ts` â€” Titan Anchor, Mass Bulwark,
  Shredder Finisher, Cardio Pacer, Aesthetics Coach; team-aura flags
  derived, not hand-written), shown on roster + squad picker. Borrowed
  passives verified functioning in auto-cast context by 6 probe tests
  (auras key on kind==='champion', not commandable). Squad picker now
  previews spawn-live synergies (`synergy-preview.ts`, pinned test-equal
  to `createBattle` aura output; deck potential deliberately
  under-stated). Honesty pass: Arena-local disclaimers on gym war
  stats/contribution, estimated-builds headers, "never their ultimate"
  copy. Stale squad ids pruned on load; no save bump (v3's
  gym.selectedSquad reused). No battle-affecting changes. Arena 487.
  P11)**: full first-run journey traced and repaired (8 defects). Arena
  onboarding no longer asks for a name (EvoForge identity wins â€”
  `applyProviderIdentity` at init; Origin champion adopted until
  onboarding completes); rebuilt as 2 steps (Origin-prefilled champion
  pick + 3-block core-loop primer). First battle now defaults to the
  training AI tier, harder tiers win-gated with ðŸ”’ chips (save **v6**
  migration re-defaults difficulty ONLY for never-battled saves).
  Tutorial/ghost battles award zero rating (single delta source
  `ratingDeltaForOutcome`); results overlay shows the Arena Rating
  delta + explicit "no Forge XP, no Evo Rating change" line; "rank
  points"â†’"Arena Rating" everywhere (audit #6 resolved); profile shows
  REAL provider fitness; debug entries dev-gated; gym non-membership is
  a friendly state routing to /social, not an error. Arena suite 469.
  hardening P10)**: data-driven per-champion AI tendency profiles
  (`arena-game/features/arena/champion-tendencies.ts`, knobs in its
  TENDENCY table): Titan holds Quake Stomp for â‰¥2 targets or a
  stunâ†’smash combo; Mass casts Gravity Well on clumps or defensively;
  Shredder holds Final Cut until it actually kills (shield-aware,
  mirrors engine targeting); Cardio Overclocks only into engaged
  fights; Aesthetics reads stances (Bulwark â‰¤55% hp/focused, Assault
  â‰¥70% + engaged) and rallies with â‰¥2 allies. Tier-scaled via
  `tendencyFollowChance` (0 / 0.75 / 1, range-validated); one
  deterministic RNG roll per decision; legality still goes through the
  validators â€” no illegal commands possible. Openings vary by seed
  (lane + style draw at AI-runtime creation, 20s window). Meta shifted
  â†’ re-tuned: Titan HP 1470, Shredder ult charge/dealt 0.06 (tendency
  knobs measured and reverted â€” see ARENA_BALANCE P10 addendum). Final
  deep-harness spread: all five in [45%, 54%]. Arena suite 453; RNG
  stream shift re-pinned 3 seed-sensitive fixtures.
  hardening P9)**: card catalog brought to official fitness-forge
  terminology â€” six cyberpunk leftovers renamed (Neon Boxerâ†’Cardio
  Boxer, Cyber Medicâ†’Recovery Coach, Drone Archerâ†’Javelin Marksman,
  Support Droneâ†’Spotter, Shadow Strikerâ†’The Cutter, Blade Runnerâ†’Tempo
  Cutter, Neon Bladesâ†’Cutting Program; ids unchanged). Aesthetic and
  Shredder finally got path synergies (`aesthetic-poise` 2-count,
  `shredder-cut-deep` 3-count) â€” 7 synergies total, every official path
  covered (now a content-validation ERROR if not, plus a
  threshold-reachability validator; both falsified). 20 playable cards.
  Deep-harness win rates unchanged from P8 ([46%,53%]). Arena suite 433.
  hardening P8)**: tuned from the P5 deep harness (362 deterministic
  AI-vs-AI matches). Win-rate spread narrowed **18 â†’ 7 points** (all
  five in [46%, 53%]): Aesthetics buffed (HP 1150, dmg 66, Stance Shift
  10s, Rally heal 150 â€” was the 39% laggard), Mass Monster's summon
  tempo trimmed (HP 1820 â†’ baked 2002, taken-damage ult charge 0.06 â†’
  0.045 â€” the HP pool was charging Mass Uprising passively). Content
  numbers only; BALANCE_VERSION stays 0.6.0 (unreleased). Data +
  rationale in `arena-game/ARENA_BALANCE.md` P8 section; two Colossal
  Frame tests re-pinned to the new baked max.
  hardening P7)**: new-player readability audit + fixes, visual only.
  Real bug caught: `pathCardio` was `#22D3EE` â€” bit-identical to
  `colors.player` team cyan, so an ENEMY Cardio champion wore friendly
  colors â†’ retinted `#818CF8` indigo. Added: per-unit direction chevrons
  (colorblind-safe team cue beyond hue), low-health amber on ALL health
  bars below 35% (deliberately matches Shredder Killer Instinct
  threshold so execute range is visible), lane-momentum edge glow,
  floater vertical stagger (no more overlapping numbers), energy pips,
  cooldown-fraction fill + ult charge fill under HUD buttons,
  unaffordable card cost highlighted. Pure helpers in
  `features/arena/components/readability.ts` (19 tests). No pulsing
  glow / radial sweep (reduced-motion + RN primitive constraints â€”
  KNOWN_ISSUES). Arena suite 428.
  P6)**: battle FX layer, zero engine/digest impact, all in the existing
  frame-driven floater pattern (no Animated values, no per-unit React
  state, `'use no memo'` untouched). New pure module
  `arena-game/features/arena/components/combat-fx.ts`
  (`deriveCombatSignals` â€” one log-delta scan per frame; 27-case test).
  Effects: hit flash (150ms, clipped to sprite, proximity-matched â€” fx
  log has no target id), death dissolve ring, ability/ultimate
  telegraphs (expanding ring + real ability name in path color; ults
  bigger/longer), summon-arrival poof, deploy landing ring, Forge Core
  shake+flash on damage (red under 25%, via optional CoreBar `hit`
  prop). Idle bob deliberately deferred (only looping candidate).
  verify-motion still 14/14. Arena suite 409.
  hardening P5)**: stability harness extended to **208 matches** default
  (413 with `ARENA_STABILITY_DEEP=1`): 5Ã—5 matchup matrix Ã— 3 AI tiers,
  squads with guaranteed borrowed Mass/Cardio, maxTicks outcome paths,
  ghost recordâ†’transformâ†’replay per champion. **Zero defects**: no
  stalls/throws/invariant violations, zero borrowed ultimates, 100%
  digest-identical replays. Per-champion stats recorded in
  `arena-game/PROGRESS.md` (P5 section) for the P8 balance pass â€” headline
  spread: Mass 63% / Titan 56% / Shredder 48% / Cardio 48% / Aesthetics
  37% win rate. Suite runtime unaffected (~10s wall for the package).
- **ARENA ENGINE RELIABILITY PASS (2026-07-23, no migration â€” overnight
  hardening P4)**: adversarial review (4 finder + 8 verifier agents) of the
  Arena battle engine post five-champion rebuild; 8 confirmed defects, all
  fixed with 13 regression tests (suite 1,426â†’1,441). Notables: `play-card`
  with a null/malformed target THREW instead of rejecting (crashed live
  ghost battles â€” shape guards in `cards/effects.ts` + ghost-transform
  normalization); schedule entries with null `command` threw inside
  `runBattle`; untrusted `championScaling` in battle records was never
  validated (1e999 â†’ Infinity-health unkillable ghost champions â€” new
  `isValidChampionScaling` [0.1,10] enforced at record-parse AND
  `createBattle`); `record.commands` now capped at 10,000; and the
  borrowed/AI Cardio **Lane Shift ping-pong** is gated
  (`autoCastValidate`: shift only to JOIN combat â€” own lane quiet, other
  lane has an in-range enemy; commanded player casts stay unconditional;
  deterministic, no RNG). No BALANCE_VERSION bump (0.6.0 unreleased same
  run). All under `client/src/arena-game/`. NOTE: committed alongside
  another session's in-flight work â€” this commit stages the arena package
  + HANDOVER only. **P4 addendum (same day)**: the passives dimension
  (finder died mid-review) was re-run â€” Iron Hide stacking, Killer
  Instinct threshold vs baked max, Colossal Frame across respawn,
  alive-only aura one-tick latency, summon shields/synergy tags all
  verified clean-or-documented by numeric probe; one real fix: tick-0
  spawn-active synergies now log `synergy-on` (createBattle seeds auras
  via the logging recompute â€” log-only, zero digest impact). +6 tests
  (arena 376).
- **ARENA FIVE-CHAMPION ROSTER + REAL PROGRESSION (2026-07-23, no migration â€”
  overnight hardening P2+P3)**: the Arena now fields THE official five
  champions â€” **Aesthetics, Titan, Mass Monster, The Shredder, Cardio
  Machine** â€” keyed `champion-<slug>` to the live BranchV2 roster
  (`aesthetic|titan|mass|shredder|cardio`; retired `hybrid` folds to
  aesthetic). Speedster/Hybrid are GONE from player-facing surfaces; local
  save migration v4â†’v5 remaps old `championId`s non-destructively
  (`save.ts::migrateChampionId`). Mass Monster is a NEW kit (Gravity Well
  cross-lane slow field + Mass Uprising summons via the new deterministic
  `CardEffects.summon` handler), each champion has a data-driven passive
  (`ChampionPassiveDefinition`), display names are content-validation
  ERRORS, BALANCE_VERSION 0.6.0 (old replays gated stale, by design).
  Evolution stage is now the REAL one via
  `arena-game/integration/evoforge/progression-mapping.ts` reusing
  `src/domain` functions â€” Shredder's stage is body-fat-driven
  (`bodyfat_log`), others level-driven; fallbacks only ever under-state.
  Dev fitness editor demoted to the debug screen (labeled dev-mock); gym
  roster builds labeled "(EST.)". Sprite pipeline now lives IN this repo
  (`client/scripts/arena-sprite-tools.mjs` + `client/assets/
  arena-pixel-src/`, pngjs devDep); five champion sprites regenerated.
  `client/vitest.config.ts` added (only the `@`â†’`src` alias for tests â€”
  discovery untouched). Suite 1,387â†’1,426, all gates green. Remaining
  phases of the overnight run tracked in
  `client/src/arena-game/ARENA_BETA_AUDIT.md`.
- **PAGE-HELP HOME SLIDE-OFFSCREEN FIX (2026-07-23, no migration)**: opening the
  guided tour ("?" FAB) on Home slid the whole screen off to the left. Cause:
  `ui/help/page-help.tsx::useSpotlight` called `scrollIntoView({block:'center',
  inline:'center'})` whenever the target was off-screen on EITHER axis (the
  f8c2c0b Train-carousel change). Home's first target (`home-level-module`) is
  horizontally visible but below the fold, so the vertical scroll also forced a
  horizontal re-centre, scrolling the page sideways. Fix: scroll each axis only
  when it's actually off (`block: offV ? 'center' : 'nearest'`, `inline: offH ?
  'center' : 'nearest'`) â€” `'nearest'` is a no-op when the axis is in view, so
  the Train-carousel horizontal case is unchanged.
- **EVOFORGE ARENA CARD-BATTLER INTEGRATED (2026-07-22, no migration)**: the
  standalone Arena beta (built separately at `C:\Users\tyson\evoforge-arena` â€”
  deterministic tick engine, cards/champions/synergies/augments, three AI
  tiers, ghost battles + verifiable replays, gym squads, 318 tests) now lives
  at **`client/src/arena-game/`** (self-contained feature package; tests ride
  in `npm test`, total suite 1,387) and mounts as the hidden route group
  **`/(main)/forge-arena/`** (thin route files re-export `arena-game/screens`;
  route strings are `/forge-arena/...`-prefixed). Entry: the â™œ door on the
  Arena hub, behind `arena-game/features.ts::arenaGameEnabled`. Boot:
  `forge-arena/_layout.tsx` validates game content then `initArenaForUser` â€”
  **per-user namespaced AsyncStorage** (`u/<userId>/...`) + the
  **SupabaseEvoForgePlayerProvider** (`arena-game/integration/evoforge/
  supabase-provider.ts`): pillars from `evo_rating_current`
  (strength/cardio/sizeâ†’muscularity/aesthetics) + `profiles.leanness_score`,
  Forge Level via the pinned `forgeProgressFor` curve, champion from the
  Origin lock (`origin_path`â†’ shredderâ†’shredder, titan/massâ†’titan,
  cardioâ†’speedster, aestheticâ†’hybrid), REAL gyms via `my_gyms`/`gym_detail`/
  `discover_gyms` RPCs (member builds approximated from evo_rating +
  forge_level). Fitness advantage is hard-capped Â±12% in-game. **Battle
  results are COSMETIC** (local rank/stats only, gym-battle precedent): no
  server writes, NO XP minting â€” an Arena reward kind is a future migration +
  Tyson decision. Sign-out calls `resetArenaSession()` in auth-context
  (stops the battle loop, drops in-memory state; disk is per-user
  namespaced). The Arena package renders a mutable sim from refs on a
  version counter BY DESIGN: those three components carry `'use no memo'`
  (React Compiler opt-out) and eslint scopes `react-hooks/refs|purity|
  set-state-in-effect` off for `src/arena-game/**` only â€” every other rule
  (and react/no-danger) still applies. No tokens/engine/glicko/motion/goldens
  surface touched (all guards verified green). Sprites (52f4a4d): the Arena
  renders Kenney 1-Bit Pack (CC0) pixel sprites recolored to the palette â€”
  26 pre-tinted PNGs at `arena-game/features/arena/sprites/` (provenance:
  `arena-game/ASSETS.md`; the slicing/tinting pipeline lives in the upstream
  repo's `scripts/sprite-tools.js`). Standalone repo remains the
  upstream for engine work; `EVOFORGE_INTEGRATION.md` there documents the
  boundary this integration implements.
- **HOME v2 CLEANUP + COIN CLAIM HONESTY (2026-07-22, no migration)**: Home
  slimmed â€” header arena rank (`home-arena-rank`) gone; EVO RATING title is
  SectionLabel-lg with NO status suffix (PROVISIONAL is a quiet tag beside
  the descriptor); the STREAK is a hero badge under CURRENT FORM
  (`hero-streak`, â†’ /streak; CURRENT FORM re-iconed ðŸ”¥â†’â—ˆ so the flame means
  streak); `status-grid.tsx` and `weekly-schedule-card.tsx` DELETED (testIDs
  `status-*`, `weekly-schedule-card` gone; XP door lives on /profile, coins
  keep the hero CoinRow). **Coins diagnosed live**: guard/trigger/RPC all
  correct in prod (no amount=1 rows; ledger === coin_total) â€” the "not
  logging" symptom was the SILENT â‰¥10-set floor rejection. Fix:
  `domain/coin-claims.ts` classifies the guard's raise strings
  (`ClaimOutcome`), `claimCoin` returns it, `useClaimCoin` invalidates via
  `invalidateTable` (prefix â€” kills the userId-null race) and toasts ONE
  honest case: workout_complete under the floor â†’ "NO COINS YET Â· Coins bank
  at 10+ counted sets". Duplicates/non-PRs/unproven milestones stay silent.

- **ANGLED FORK GLYPH (2026-07-21)**: `FORK` in `pixel-icons.tsx` redrawn â€”
  the fork leans up-right with a 7-row handle (was a 4-of-9 vertical stub).
  Sheared on the grid, never transform-rotated (anti-aliasing kills pixel
  art); a full 45Â° draft dissolved the head into slashes at tab size, the
  shipped shear keeps the crossbar solid. Used by the Fuel tab + meal slots.
- **FUEL PAGE v2 (2026-07-21, NUTRITION_PLAN_2)**: the summary card is the
  command centre â€” CUT/MAINTAIN/BULK switcher chips (inactive chips quote
  their stored kcal; tapping writes an effective-dated target upsert, ZERO AI;
  a manual/pre-081 target with no derivable triple toasts RECALCULATE FIRST
  and opens the intake) + the âœ¦RECALCULATE/EDIT actions moved up from the
  deleted `daily-target-card.tsx` (testIDs kept verbatim). `fuel-bonus-card`
  (protein goal box) deleted â€” protein renders with `emphasis` in the macro
  rows instead (weight/size, same colour). New `saved-meals-card.tsx` beneath
  the scanner: â˜† SAVE FOR LATER in the confirm sheet names a meal; the card
  one-tap logs it (slot picker + delete in the expander; renders null when
  empty). TODAY'S MEALS moved to the page bottom with a SectionLabel-lg
  title. The converter's "Maths worksâ€¦" helper line is gone (feature stays).
- **SAVED MEALS + GOAL TRIPLE (2026-07-21, migration 081 APPLIED + falsified)**:
  `saved_meals` (name â‰¤60 unique per user case-insensitive, `items` jsonb 1..12
  in the nutrition_log.items MealItem shape, denormalised kcal/macro totals,
  owner select/insert/delete â€” no update, v1 has no rename) and three nullable
  `nutrition_targets` columns `kcal_lose/kcal_maintain/kcal_gain` (1000..6000)
  â€” the goal triple computed client-side at intake time so CUT/MAINTAIN/BULK
  switching is a plain effective-dated upsert, zero AI tokens. Falsified per
  the migration header (dup name 23505, item/kcal/macro CHECKs, BRAVO
  isolation, 999 reject, triple accept); seeds cleaned.
- **MEAL-SCAN QUALIFIER-AWARE MATCHING (2026-07-21, no migration)**: "500g raw
  10% beef mince" used to read 1250 kcal â€” the 'mince' alias hit the cooked
  ~17%-fat `ground beef` row and DISCARDED the AI's correct raw estimate. The
  curated table/matcher moved to `supabase/functions/meal-scan/food-match.ts`
  (import-free, pinned by `client/src/domain/__tests__/food-match.test.ts` via
  a cross-root import): `parseQualifiers` reads raw/cooked + fat% ("10%",
  "90/10", "95% lean"; plain â‰¥50% reads as lean), `BASE_META` declares what
  each base row assumes, `VARIANTS` carries USDA raw/cookedÃ—fat% rows (ground
  beef, chicken, steak, rice, pasta, oats), and a qualified food the table
  can't model returns null â†’ the AI's clamped per-100g (`source:'ai'`). Both
  prompts now demand qualifiers echoed verbatim into item names; for
  single-item results the user's own text/hint is a fallback qualifier source.
  Unqualified matches are byte-identical to before (doctrine unchanged).

- **ROUTINES AS SCHEDULE PRIMARY (2026-07-21, no migration)**: the EDIT
  SCHEDULE split dropdown now also lists saved routines (â˜…-prefixed, after the
  plan's days) â€” "abs" can be a day's MAIN workout, not just an extra (multiple
  per day keep working via 065 extras). A routine-name primary is LITERAL:
  `chooseSource` never remaps it, the uniform `sources` write + Train's
  explicit-source short-circuit keep it verbatim, and the resolver's
  routine-by-name fallback opens it. A deleted routine left in the primary slot
  gets the âš  warning. Pinned: streak/weeklyContract count a routine primary as
  scheduled; `sourceDayFor` history keeps the literal name.
- **SAVE CHANGES AT FINISH (2026-07-21, no migration)**: finishing an edited
  day now asks "Save changes?" (skips ad-hoc â€” it has its own save-routine
  flow). `domain/plan-edits.ts` is the pure bridge: `diffDayEdits` (skip/order
  are NEVER template changes; a swap-then-remove is a removal of the slot;
  net-zero deltas are clean), `applyEditsToDay` (1..8 intent clamp, swapped
  slots lose their coaching `reason`), `mergeDayIntoCustomPlan`. SAVE routes by
  the day's source: MY/AI â†’ whole-payload `user_plans` upsert; **BUILT-IN forks
  into MY PLAN** and points the schedule's matching weekdays at source 0 (066
  per-day sources) â€” `active_plan_source` untouched; routines â†’ new
  `useUpdateRoutine` (016's owner UPDATE policy, first client use). Supersets
  persist: `PlanExercise.supersetWith` (optional, validatePlan partner-checks
  it), `RoutineExercise`, `ResolvedDay.supersets` (symmetric via
  `supersetsOf`), seeded into the session once per day by `seedSupersets` â€”
  `emptyDay()` deliberately does NOT define `superset` so undefined means
  "never touched" and an unlinked-to-empty map is never re-seeded. JUST TODAY
  keeps today's behaviour (overrides expire at midnight).
- **FINISH FLOW (2026-07-21, no migration)**: logging the last set no longer
  auto-opens the SummarySheet â€” the jingle/haptic celebration stays, and the
  coin claim stays IN the ceremony effect (the offline finish-queue flush never
  claims, so that effect is the only coin path for an offline finish; claims are
  idempotent per 013). FINISH WORKOUT is now the last thing on the page; pressing
  it with sets still owed opens a "You have N sets remaining" confirm
  (`finish-anyway` / `finish-cancel`) before the summary.
- **SUBSTITUTIONS PERSIST + HONEST COMPLETION MATH (2026-07-21, no migration)**:
  the â‡„ swap moved from `workout.tsx` component state into the session store â€”
  `DayOverrides.substituted` (ORIGINAL slot â†’ substitute; every other override
  map keys by the DISPLAYED name, and `applySubstitution` migrates those keys so
  a âˆ’SET tweak / superset pairing survives the rename). Applied INSIDE
  `buildEffectivePlan`, so a mid-workout refresh keeps the swap and `planTotals`
  judges done/target against the substituted exercise. The Train hub's `setsFor`
  now runs TODAY through the same pipeline (`dayProgress`) with today's
  overrides â€” a swapped/edited day can no longer read PARTIAL on the hub while
  the workout page says complete (past dates keep the raw plan; overrides expire
  daily as ever). Drive-by: `toggleSuperset` now goes through the date-guarded
  `edit()` like every other store write.
- **FITNESS-DUEL MATCHMAKING + ONLINE COUNT (2026-07-20, migration 077 APPLIED +
  two-client verified).** The System-A real-workout duel (battle_matches) no
  longer uses an invite_code â€” Arena "FIND A DUEL / FIND A VOLUME DUEL / FIND A
  COIN DUEL" queue you by FORMAT and auto-pair you into a match; you drop into the
  EXISTING /arena/battle/[id] flow (VsPhaseâ†’readyâ†’roundsâ†’settle unchanged). 077:
  `battle_duel_queue` + `battle_matchmake(format,snapshot)` (advisory-locked,
  pairs by format, creates the match + 2 participants born at status='matched',
  invite_code NULL) + `_poll` + `_cancel`; `clean_battle_snapshot` (SQL port of
  the edge fn's cleanSnapshot â€” clamps stats, forces the public_profile name, so a
  client can't inflate/spoof). SECURITY DEFINER is safe: matches/participants have
  no guard triggers. Client: `useDuelMatchmaking` in data/matchmaking.ts; Arena
  removed the CREATE/JOIN tabs + code box + CodeCard + openInvite and added a
  SEARCHING modal; athlete "âš” CHALLENGE" (the last code-minter) removed. Falsified
  (pair, format isolation, poll, cancel, clamp) + two-client Playwright (both hit
  FIND A DUEL â†’ paired into the SAME match â†’ FACE OFF with correct clamped
  identities). **battle-invite/battle-join edge fns are now dead (left in place,
  harmless). ALL join-by-code is GONE from the app.** A targeted "challenge a
  specific friend" (direct invite via notification) is a possible follow-up.
- **Players-online count:** `data/presence.ts` â€” a global Supabase Realtime
  Presence channel (joined once in (main)/_layout) counts unique players online;
  `OnlineBadge` (â— N ONLINE) on the Arena masthead + Quick Match. Verified.
- **GYM CODES RETIRED â†’ online discovery (2026-07-20, migration 076 APPLIED +
  falsified).** Gyms are no longer joined by a 6-char code â€” you BROWSE/SEARCH
  public gyms and join, or use a shareable gym LINK for private crews (same
  pattern as friends 073). 076: dropped `gyms.join_code`; added `is_public`
  (default TRUE) + `share_token`; `discover_gyms(q,limit)` (public gyms search),
  `join_gym_by_id(gym, token)` (public OR token-gated for private),
  `my_gym_share_token`, `set_gym_public` (owner toggle); `my_gyms`/`gym_detail`
  drop join_code; **`gym_battle_prepare` now takes the opponent gym id** (pick
  from discovery), not a code; dropped `join_gym(text)` + legacy `gym_battle
  (uuid,text)`. Client: `gyms-view.tsx` "JOIN BY CODE" â†’ "FIND A GYM" browse; the
  gym screen shows SHARE GYM LINK + an owner PUBLIC/PRIVATE toggle + battle-a-gym
  by search; `gym/[id]` reads `?invite=` to join a private gym via link. Falsified
  (public discover+join; private hidden; token-gated join; owner toggle).
- **REAL-TIME LIVE PvP MATCHMAKING (roadmap Phase 4) â€” SHIPPED + two-client
  verified (2026-07-20, migrations 074 + 075 APPLIED).** Champion battles are now
  live turn-by-turn PvP vs a matched real opponent â€” replacing the RPG
  join-by-code. **Arena â†’ QUICK MATCH** (`/pvp`): pick champion â†’ `pvp_enqueue`
  â†’ paired â†’ fight over Supabase Realtime.
  - **Determinism:** `domain/battle-rpg/prng.ts` (`turnRng(seed,turn)`). Both
    clients resolve the CANONICAL battle (seat1=player) and seat 2 swaps only the
    VIEW â€” because `decideOrder` breaks speed ties on `rng()<0.5` favouring
    "player", local-perspective resolution would desync. `prng.test.ts` proves
    convergence.
  - **Backend 074:** `pvp_queue`/`pvp_matches`/`pvp_moves` + `pvp_enqueue`
    (advisory-locked matchmaker), `pvp_poll`, `pvp_submit_move` (own-seat,
    one-per-turn), `pvp_finish` (idempotent â†’ `record_rivalry_result`),
    `pvp_forfeit`, `pvp_cancel_queue`. pvp_matches/pvp_moves in the realtime
    publication. Casual = nothing farmable â†’ client-authoritative is safe.
  - **Client:** `data/matchmaking.ts` (enqueue/poll/realtime), `ui/battle/
    use-online-battle.ts` (canonical resolve + seat-2 view/event swap + Realtime
    move exchange, reuses `resolveTurn`), `ui/battle/online-battle-runner.tsx`
    (reuses BattleArena/MoveGrid), `app/(main)/pvp.tsx` (champion pick â†’
    searching â†’ live match). Arena "COMING SOON quick match" placeholder â†’ real.
  - **Verified with TWO live browser clients (ALPHA+BRAVO):** they paired over
    Realtime, both entered the match, exchanged a move, both advanced to the same
    turn; seat-2 view-swap correct (each sees their own champion). Backend also
    two-JWT falsified.
  - **075 removed the RPG challenge-by-code system** (dropped rpg_challenges +
    3 RPCs; deleted battle-rpg-challenge.ts + challenge-hub.tsx; stripped
    `challenge` mode from battle.tsx/use-battle.ts/types BattleMode; JOIN box is
    now fitness-duel-only). **System A `battle_matches` invite_code (real-WORKOUT
    fitness duel) is a SEPARATE feature and was KEPT** â€” it still uses a code; the
    Arena "CREATE BATTLE Â· GET CODE" / athlete "âš” CHALLENGE" flows are System A.
    Convert those to matchmaking too only if Tyson asks.
- **FRIEND CODES RETIRED â†’ fully online friending (2026-07-20, migration 073
  APPLIED + falsified).** Removed the 6-char friend code (dropped `friend_codes`
  table + `my_friend_code` + `send_friend_request`; deleted `useFriendCode` /
  `useSendFriendRequest`; removed the "YOUR ADD CODE" card). Friending is now:
  name search (071) + requests, OR a **shareable profile link**. Each athlete has
  a stable `public_profile.share_token` (backfilled); `my_share_token()` returns
  it; `friends.tsx` "SHARE MY PROFILE LINK" shares `â€¦/athlete/<id>?invite=<token>`.
  **Privacy gap closed:** `request_friend(p_user, p_token)` now admits a request
  to a PRIVATE athlete IFF the caller presents their share token (they shared
  their link) â€” so private users stay cold-addable without a manual code, and
  cold spam is still impossible (no token + not public â†’ not_addressable). The
  old 1-arg `request_friend(uuid)` was dropped; the client always sends p_user
  (+ optional p_token from `athlete/[id]`'s `?invite=`). Falsified: private target
  refused w/o token, added with the right token, my_share_token correct.
  **NOTE: battle/challenge codes (034) + gym join codes (068) are SEPARATE and
  untouched here** â€” the live-matchmaking task removes battle codes.
- **RIVALRY "PR BEATEN" NOTIFICATIONS + AVATAR SHADOW + GHOST AUDIT (2026-07-20,
  migration 072 APPLIED + falsified)**:
  - **PR-beaten notifications.** Log a set whose e1RM passes a FRIEND's best for
    that lift and they get "USERNAME just destroyed your <lift> PR â€” reclaim your
    status" (in-app bell + push twin). 072 widens the `social_notifications` type
    CHECK to add `pr_beaten` (FIRST â€” the 054/058 rollback rule), adds a `detail`
    jsonb column, re-creates `my_notifications` to return it, and adds
    `report_pr_crossings(exercise,new_e1rm,prev_e1rm)`. **Detection is a client-
    called RPC, NOT a workout_log trigger** â€” fires only on an actual PR (is_pr),
    and a bad insert can't roll back the set save. Fires once per friend per lift
    (crossing guard `friend_best in [prev,new)` + 12h dedup). Wired from
    `mutations.ts` is_pr branch â†’ `reportPrCrossings` â†’ in-app rows + `pushNotify`
    per crossed friend. `send-push` gained a friend-verified `pr_beaten` branch.
    Client learned `pr_beaten` (+ the two 058 comment types that were missing):
    `social-notifications.ts` union/detail, `notifications.tsx` VERB + âš” red row
    deep-linking to Friends&Rivals. Falsified via simulated JWT (crosses both of
    a user's friends, inbox shows the lift, dedup + already-beaten guard both []);
    test rows purged. **A NEW notification type = widen the CHECK in the same
    migration, add to send-push VERB + a recipient branch, add to the client
    union + the VERB Record (compile-forcing).**
  - **Avatar contact shadow** (`avatar-stage.tsx`). Replaced the flat dark
    rounded-rect under the champion with a soft radial SVG ellipse â€” dark core +
    a faint rim in the champion's OWN aura colour, footprint scaled by the stage
    growth. It's DRIVEN by the float (no separate groundPulse loop): tightens and
    lightens as the champion rises. Layout footprint pinned to ~14px (the taller
    SVG overflows via absolute centring) so it never lifts the champion off the
    podium.
  - **Ghost audit.** Confirmed **Workout Ghost Battles (037) are FULLY WIRED** end
    to end (publish from summary â†’ Arena GHOST BATTLES â†’ `/battle?mode=ghost` â†’
    rivalry); all 4 RPCs + `workout_ghosts` present in prod. RPG Challenges (034)
    also complete. The ONLY unbuilt ghost is the **deferred real-time arena ghost
    race** (`ghost_snapshots`, migrations 009/028) â€” an orphan table with no
    writer/reader/edge fn/UI; still deferred (a real Phase-3 build if wanted).
- **FIND-A-FRIEND-BY-NAME + WHOLE-WEEK SCHEDULE (2026-07-20, migration 071
  APPLIED + falsified)** â€” two UX fixes Tyson asked for:
  - **Add a friend by display name.** The 060 search + friends typeahead existed
    but its gate was `is_public AND discoverable`; `discoverable` defaults OFF
    (055) â€” production had **only 1 of 14 public athletes discoverable**, so
    search found nobody and read as broken. **071** drops `discoverable` from BOTH
    `search_athletes` and the `request_friend` add gate â€” `is_public` (the
    leaderboard/profile-view opt-in) is now the "findable + addable" gate;
    `discoverable` means only "also show me in passive Discover/Suggested". Also
    modernised search's forge_level/rank off the retired `avatar_progression`
    onto `user_progression`/`evo_rating_current` (matches 067). Falsified with a
    simulated JWT: a public non-discoverable athlete now hits search AND is
    addable; a private athlete still returns [] / not_addressable; 1-char â†’ [];
    caller excluded. `friends.tsx` reworked so name-search is the PRIMARY card
    (code demoted to "ADD BY CODE" for private adds).
  - **Whole-week schedule source.** `schedule.tsx` replaced the per-day SOURCE
    dropdown (066) with ONE picker at the top â€” MY PLAN / AI PLAN / EVOFORGE PLAN
    for the whole week. Save writes `active_plan_source` (035) AND a UNIFORM
    `sources` map (every trained day â†’ the chosen source), so Train's existing
    per-date reader renders each day from that plan with no remap and no
    today.tsx change. Per-day cards keep REST/TRAIN + a SPLIT dropdown from the
    one chosen plan. No migration needed (sources column already exists).
- **FULL GYM BATTLES + more Supabase hardening (2026-07-19, migration 070)** â€”
  gym battles now run the REAL RPG combat engine member-vs-member, not an Evo
  sum. `gym_battle_prepare()` hands the client both rosters' combat inputs
  (champion path + the four pillars, show_evo-gated â†’ neutral 40s when hidden)
  + a server seed; `domain/battle-rpg/gym-battle.ts::runGymBattle` pairs seats
  by rating and runs each duel through `createBattle`/`resolveTurn`/
  `chooseAiMove` DETERMINISTICALLY from the seed (deeper roster gets byes);
  `record_gym_battle()` stores the tally + per-duel HP log in
  `gym_battles.detail`. Both RPCs membership-gated + rate-limited. Gym battles
  grant NOTHING farmable, so the client-run engine has no exploit surface â€” the
  deliberate trade for not mirroring the client-only RPG engine into Deno. The
  gym screen shows a VICTORY/DEFEAT/DRAW modal with the duel breakdown.
  Security also: **M1 fixed** â€” the `social-media` bucket read is now gated by
  post visibility via the definer `can_read_social_object()` helper (images
  still render â€” they're caller-signed and the predicate mirrors `social_feed`);
  and **Auth config hardened** via the management API (password_min_length 6â†’10,
  require-reauth-on-password-change ON; HIBP leaked-password needs a Pro plan â€”
  not settable on the current plan; OTP expiry/MFA-TOTP/refresh-rotation already
  good). All falsified with a simulated session; test data purged.
- **SECURITY OVERHAUL (2026-07-19, migration 069 APPLIED + 2 edge fns)** â€” the
  audit found the data-security posture already STRONG (no secrets, full RLS,
  correct definer revokes); the gaps were App-Store *compliance features*:
  - **Account deletion** (Apple 5.1.1(v)): new `delete-account` edge fn
    (JWT-derived uid â†’ `admin.deleteUser`, cascades everything), + a type-DELETE
    DANGER ZONE in `profile.tsx`. `useDeleteAccount` in `data/moderation.ts`.
  - **Block users** (1.2): `blocked_users` + `block_user`/`unblock_user`/
    `my_blocks` RPCs + an internal `is_blocked()` (revoked); a `friend_requests`
    BEFORE-INSERT trigger rejects requests across a block; blocking severs the
    friendship. Client hides blocked users (`useBlockedSet`) in friends
    search/suggested + gym chat; BLOCK/UNBLOCK on the athlete profile.
  - **Report coverage** (1.2): generic `content_reports` + `report_content`
    RPC for comments / gym messages / profiles (posts keep `social_reports`);
    âš‘ report on the athlete profile + each gym-chat message.
  - **M2**: `send-push` no longer trusts `body.to_user` â€” friend_request/mention
    pushes require a real pending request / actor-authored post, and never push
    across a block.
  - **M3**: rate-limit triggers on `friend_requests` (30/hr) + `gym_messages`
    (8/10s); `report_content` capped 30/hr.
  All RPCs falsified with a simulated session (block registers, friend-request
  trigger raises, unblock clears). NOT done (documented, low-risk): M1 storage
  bucket read gated by post visibility; L2/L3 are Supabase-dashboard/store-listing
  config, not code. Edge fns deploy via `client.yml` on push.
- **GYMS (2026-07-19, migration 068 APPLIED)** â€” player groups on the Social
  page (a 4th non-feed scope, branched like RIVALS): create/join-by-code, a
  private group chat (`gym_messages`, 5s poll), and GYM-vs-GYM battles decided
  by aggregate roster Evo Rating (`gym_battle` â†’ `gym_battles`). Tables
  (`gyms`/`gym_members`/`gym_messages`/`gym_battles`) are RLS-locked with NO
  client policies â€” ALL access is through security-definer RPCs, each
  membership-gated via internal `is_gym_member()` (revoked from clients). Owner
  leaving hands off to the earliest member, or disbands if empty. Hooks in
  `data/gyms.ts`; UI in `ui/social/gyms-view.tsx` + `app/(main)/gym/[id].tsx`.
  NOTE unrelated to 032's PvE `gym_progress` / mode 'gym' (single-player boss
  clear). Verified on web (create â†’ roster â†’ chat â†’ battle DRAW); test data purged.
- **PROFILE AVATAR + CHALLENGE + SUGGESTED FRIENDS (2026-07-19, migration 067)**
  â€” `public_athlete_profile` returns `active_stage`+`sex` (show_evo-gated) so
  `athlete/[id]` draws the champion via `avatarArtV2`; a "âš” CHALLENGE" button
  mints a code-based invite; `recommended_athletes()` ranks suggested friends by
  mutual-friend count; friends search is debounced (150ms) + tappable. The
  QUICK WORKOUT sheet regained a "PREFILL WITH RECOMMENDED EXERCISES" button
  (corpus/ranking engine). Radar projection recut to realistic gains. Schedule
  uses SOURCE/SPLIT dropdown boxes.
- **PER-DAY SCHEDULE SOURCE (2026-07-19, migration 066 APPLIED)** â€” the weekly
  schedule can pin a SOURCE (my plan / AI plan / EvoForge) to each day and a
  SPLIT from that source, so a week can mix AI push / my-plan legs / built-in
  pull. Storage is a PARALLEL `workout_schedule.sources` jsonb ('0'..'6' â†’
  SourceIndex) next to the unchanged string `plan` â€” so `scheduled_streak()`
  and every string-reading twin stay byte-identical (a day absent from
  `sources`, or a null column, follows the global source exactly as before â€”
  zero change for any pre-existing schedule). EDIT SCHEDULE gained a per-day
  source selector (filtered to sources that have days) + a split picker from
  that source; `today.tsx` resolves each day via `sourceForDate(date)` (past
  days keep the global source; the explicit-source path skips `sourceDayFor`'s
  positional remap since the stored name is already right for its source).
  `week-status.ts`/`scheduled-streak.ts` untouched (they take callbacks).
  Verified on web: editor renders/switches sources+splits (injected plans),
  and a pinned MY-PLAN day resolves its own exercises on the Train card. Also:
  the "CHANGE WORKOUT" utility on Today is now "CHOOSE/UPLOAD MY WORKOUT".
- **MULTI-METRIC LEADERBOARD (2026-07-19, migration 065 APPLIED)** â€”
  `leaderboard_by_metric(p_metric, n)` (additive; `leaderboard_top` untouched)
  ranks by EVO RATING / FORGE LEVEL / CONSISTENCY / TOTAL XP, server-ordered +
  numbered, returning every metric per row. It reuses 014's exact
  mintable-drift integrity gate for ALL metrics, and the honest live sources:
  `forge_level_for_xp(lifetime_xp)` (never the ratcheted column),
  `evo_rating_current.displayed_rating` (only when `show_evo`, null otherwise â€”
  Evo is a DISPLAY metric here, not yet defended competitive authority),
  `current_momentum_weeks`. Client: `useLeaderboardByMetric` + `rankByMetric`;
  `/rank` gained a metric chip row (default EVO); the Home teaser now shows the
  Evo board; `LeaderboardRowView` renders the active metric's tail. Falsified
  in prod (all four orderings, null-evo sorts last) + verified on web via the
  teaser (both smoke accounts are drift-gated out of `/rank` itself â€” a
  pre-existing self-gate, unrelated).
- **HOME RADAR = EVO PILLARS + PROJECTION (2026-07-19)** â€”
  `client/src/ui/home/evo-radar.tsx` now sources Home's stat wheel from the
  SAME four scores that build the Evo Rating
  (`evo_rating_current.{size,aesthetics,strength,cardio}_score`, floored to
  match the EVO CORE card), so the wheel finally lines up with the rating
  beside it (it used to draw five legacy `calculateAvatarStats()` axes â€” a
  different scoring system). It overlays a dashed PROJECTION of where those
  pillars head after a chosen block (8/12/16 wk) of consistent training â€”
  `domain/progression/projection.ts`, a diminishing-returns headroom model
  scaled by momentum (`consistencyFromMomentum`), never past 100. Before the
  first Evo review (no row) it falls back to the legacy live 5-axis radar.
  `StatRadar` gained an optional `overlay` (dashed polygon) + legend.
- **DRAG-TO-REORDER (2026-07-19)** â€” `client/src/ui/train/reorderable-list.tsx`
  (fixed-row-height, grip-handle pan on gesture-handler+Reanimated; `_layout.tsx`
  now wraps the app in `GestureHandlerRootView`). Used in the Routine Builder
  (reorders `plan[day]`, which SAVE persists) and DURING a workout via a
  "â‡… REORDER EXERCISES" toggle (persists to a new today-scoped `order` override
  in the session store; applied by `applyOrder()` in `session-plan.ts` AFTER
  `buildEffectivePlan`, so add/remove/skip/substitute are untouched). The
  Routine Builder's full exercise library is now COLLAPSED by default behind a
  "BROWSE THE FULL LIBRARY" toggle so SAVE MY PLAN is no longer buried; the
  search bar stays the always-visible fast path. Today's "CHOOSE WORKOUT"
  utility is now "CHOOSE/UPLOAD MY WORKOUT" (testID `change-workout` unchanged).
  Verified end-to-end on web (Playwright, ALPHA).
- The 8-phase product transform (`EVOFORGE_TRANSFORM.md`) â€” P1â€“P8 complete.
- `PHASE_3_PLAN.md` (Stage 1: flexible workout logging) â€” complete.
- `TRAIN_IMPROVEMENTS.md` (finish marker + week bars) â€” complete.
- `TRAIN_PAGE_V2.md` (the workout as its own page) â€” complete.
- The Add Exercise redesign (960-exercise library, ranking engine) â€” complete.
- KGâ‡„LB per-exercise toggle (`domain/units.ts`; DB stays kg forever) â€” complete;
  migration `020` **applied 2026-07-15**, column read back (`weight_unit`, default kg).
- The inline `ExerciseSearchBar` on every add surface (`data/exercise-corpus.ts`
  is the shared recipe) â€” complete.
- PLAN SCAN (photo/typed workout â†’ `ai-plan-scan` â†’ corpus-mapped draft â†’
  builder â†’ MY PLAN; `domain/workout-import.ts`) â€” complete; `ai-plan-scan`
  **deployed 2026-07-15** and falsified end-to-end (real OpenAI call, shorthand
  normalized, repeat call cache-hit). En route found+fixed: 007's `kind` check
  rejected `'plan-scan'`, so the cache AND the hourly rate limit were both dead
  for scans (storeCache swallows errors) â†’ migration `021` extends the check.
- SUPABASE_SETUP.md steps all done; `SUPABASE_ACCESS_TOKEN` repo secret set and
  the parked CI step wired into `client.yml` â€” edge functions now deploy on push.
- FUEL (nutrition) is ON MAINLINE â€” the old `origin/nutrition` branch is
  superseded; its SQL landed as `037_nutrition.sql` (+ `043_meal_scan.sql`
  macros), both applied. See Â§875ff for the numbering note.

- **SOCIAL FEED â€” FOUNDATION + FLAGGED SLICE 2026-07-18** (Tyson's spec):
  built on the existing friends/rivalry backend (036 â€” friend_codes/requests/
  friendships/rivalries + definer RPCs, already live). NEW this pass:
  `migrations/049_social_feed.sql` (social_posts[typed envelope + payload
  jsonb], social_reactions[1/user/post], social_comments; owner RLS; the
  `social_feed(scope,before,limit)` definer RPC enforcing own+friends-visible+
  public; `toggle_reaction`; `are_friends` helper revoked from clients) â€”
  **WRITTEN, NOT YET APPLIED**. Client: `domain/social-feed.ts` (the 7-type
  discriminated union + `toPost` validator + `applyReaction` + `relativeTime`,
  12 tests), `data/social-feed.ts` (useSocialFeed infinite query + optimistic
  useToggleReaction, degrade-to-empty), `ui/social/*` (post-cards for all 7
  types + shared shell + reaction-bar + the Social screen: FOLLOWING/RIVALS/
  DISCOVER tabs, friends activity row, empty/loading states). **049 APPLIED to
  production + `feedEnabled` FLIPPED ON 2026-07-18 (Tyson).** Migrations applied
  through **049**; next free **050**. Verified LIVE vs prod as ALPHA:
  social_feedâ†’200, cards render, toggle_reactionâ†’200. Apply-time fix:
  avatar_progression has NO stage column â†’ the RPC returns `null::int as
  author_stage` (cards use the author initial, never a faked sprite). **THE
  GAP: nothing writes social_posts yet â†’ real feeds are EMPTY (the polished
  YOUR-FORGE-IS-QUIET state).** Two demo posts seeded on ALPHA (friends-only,
  invisible to real users), removable. **POST CREATION + COMMENTS SHIPPED
  (050 applied):** the feed is now a full loop â€” CreatePostModal (`ï¼‹` in the
  header) shares an UPDATE (text `status` post), the latest WORKOUT (real
  sets/volume via `workoutPostPayload` from workout_log), or the latest PR
  (recentPr) with a visibility choice; CommentsModal reads via the 050
  `post_comments` definer RPC + inserts under RLS; own posts delete via the
  `â‹¯` (soft delete). All verified LIVE vs prod as ALPHA: createâ†’201,
  post_commentsâ†’200, commentâ†’201, deleteâ†’204. `status` is the 8th post type
  (migration 050 widened the CHECK). STILL DEFERRED: photo upload, privacy
  granularity beyond visibility, notifications, event-driven share prompts,
  contextual-action deep links, discover/public infra. + photo
  upload); comments UI; privacy composer; notifications; pagination polish;
  contextual-action deep links. The nav list in Tyson's spec (Home/Train/
  Social/Forge/Arena) is STALE â€” it would drop Fuel + re-add Forge; kept the
  current bar. Home avatar now shows a "TAP YOUR CHAMPION TO ENTER THE FORGE"
  hint (avatar-hero.tsx).

- **TABS â€” Forge â†’ Social 2026-07-18** (Tyson's call): the bottom bar dropped
  Forge and gained **Social** (`app/(main)/social.tsx` â€” an HONEST "COMING SOON"
  placeholder, not a mocked feature; awaits Tyson's spec). The Forge/avatar
  screen is unchanged and now opens by tapping the champion on Home
  (`AvatarHero.openCharacter â†’ /avatar`, already wired); `avatar` is `href:null`
  (routable, off the bar). Idle prefetch swapped `/avatar`â†’`/social`. New
  `PixelPeople` tab icon. Bar is now HomeÂ·TrainÂ·OracleÂ·SocialÂ·ArenaÂ·Fuel.

- **FUEL BATCH â€” EXECUTED 2026-07-18** (Tyson's follow-up asks): (1) the
  QuickLog label input moved to its own full-width row so it fits at 320px;
  (2) **calories BURNED** (cardio_log.calories, `useCaloriesBurned`) fold into
  the day's ceiling â€” `effectiveTarget = daily_kcal + burned`, meter + macros
  computed against it, summary shows a "1,994 +320 burned" line (real data,
  invalidated when cardio logs); (3) **food SEARCH** â€” `searchFoods` via OFF
  **v2 `/api/v2/search`** (the legacy cgi/search.pl is throttled â†’ HTML error
  page; v2 returns clean JSON), a debounced `FoodSearchModal` that appends
  MealItems; (4) **DESCRIBE / RECIPE** â€” a text modal (`describe-meal.tsx`) â†’
  `describeMeal` â†’ the meal-scan edge fn's NEW **text mode** ({text} OR
  {image}; recipe with a serving count â†’ ONE serving; the deterministic food
  table still prices, the AI only names foods+grams â€” the photo doctrine).
  All four doors (scan/search/barcode/describe) on the meal card land in the
  SAME confirm sheet and save via useLogMeal (which refuses over-CHECK totals).
  Also: `useLogCardio` now writes cardio_log.date as the LOCAL day (localIso).
  **The edge fn change deploys on push** (supabase/** in client.yml). Toured
  live: burned math (remaining 1,894 = 1994+320âˆ’420), search 13 live hits â†’
  confirm 159 kcal, 320px label fit, no overflow. Tabs-removal ask deferred to
  Tyson (which of the 6 is ambiguous + destructive).

- **CARDIO_REDESIGN â€” EXECUTED 2026-07-18** (Tyson's brief + reference mock):
  the CARDIO mode of Train (today.tsx mode===1) is now `CardioDashboard`
  (`ui/train/cardio/*`), replacing the old `CardioCard` (cardio-logger.tsx
  DELETED; `cardioAnim` moved to `ui/train/cardio/activities.ts`). Composition:
  DailyCardioSummary (today's minutes vs a DEFAULT goal, mission bar, streak,
  week sessions) Â· CONDITIONING SESSION card = ActivityTypeSelector (7
  pixel-iconed activity cards, no emoji) + CardioSessionForm (adaptive fields
  per activity â€” the cardio-logger field map verbatim â€” duration presets,
  optional INTENSITY, expandable notes, LOG SESSION) Â· CardioRewardPreview Â·
  WeeklyCardioProgress (Monâ†’Sun strip) Â· RecentCardioSessions (empty state).
  **THE HONESTY LINE:** cardio-score.ts's rule is that logging sessions earns
  Forge XP, NEVER Cardio Score â€” the Conditioning pillar is measured from
  fitness TESTS at the scheduled Evo Review. So the reward preview shows ONLY
  the real +Forge XP (floor(minutesÃ—2) = cardioEventAmount, the migration-002
  literal the save actually grants) and a truthful "Conditioning pillar is
  measured from fitness tests at your next Evo Review" â€” NO fabricated
  +conditioning/+cardio-rating/+recovery numbers (the reference mock's chips
  have no backend). `DEFAULT_CARDIO_TARGETS` (daily 30 min / weekly 4 sessions
  / 120 min) is a labelled suggested goal, not stored user data (the Fuel
  DEFAULT_MACRO_TARGETS precedent). Save contract + every testID preserved
  (cardio-minutes/distance/incline/speed/calories/rounds/notes/save/speed-unit;
  boxing minutes=roundsÃ—len, mphâ†’km/h on save, minsâ‰¤0 refused, XP grant
  unchanged). New pure `domain/cardio-stats.ts` (todayMinutes/weekStart/
  weekStrip/weekTotals/cardioStreak/dailyMission, 16 tests, all take todayIso â€”
  the no-wall-clock rule). Intensity + boxing rounds ride in `notes` (no schema
  column). Toured (ALPHA): empty + rich (READ-intercepted) states, boxingâ†”run
  field adapt, presets/intensity, XP preview +60 @30min; 320/390 clean.

- **ORACLE_REDESIGN â€” EXECUTED 2026-07-18** (Tyson's brief + reference mock):
  ai.tsx (THE ORACLE) rebuilt as a composition over `ui/oracle/*` â€” OracleHeader
  (hero title over ScanBackdrop â€” one useAmbient-gated sweep + static motes â€”
  framed champion + Forge LV) Â· PhysiqueScanCard (premium BodyScanner FRONT/
  SIDE/BACK slots that glow when filled, RUN ANALYSIS, animated reveal
  SCANNINGâ†’âœ“â†’tiered /100 face + count-up + three filling AttributeBars +
  Top-Strength/Main-Weakness/Recommended-Priority) Â· EvolutionImpactCard
  (**HONEST** â€” reads REAL `evo_rating_current`; shows the rating + the
  Aesthetics/Size pillars the verdict feeds + WHEN it applies at the next
  scheduled review; renders a "run first review" pointer, NEVER invented
  numbers, when no rating exists) Â· BodyfatScanCard (FRONT/BACK, count-up %,
  four-band BodyfatScale marker, lean/fat MassTiles only when a real
  bodyweight is known) Â· RoutineForgeCard (six goal CARDS â€” free goal strings
  to the same ai-plan fn â€” with a REAL Oracle Summary naming the weakest
  attribute) Â· OracleHistoryCard (timeline of STORED VERDICTS, never photos;
  PROGRESS-SINCE-FIRST-SCAN deltas + score sparkline + tap-to-expand
  sub-scores). THE REAL FLOW IS UNCHANGED: estimate save:false â†’ confirm
  conditions â†’ finalize save:true; photos live in state only and DROP on save
  (the house privacy rule). Pure domain `domain/oracle.ts` (tier/scoreOutOf100/
  attributeLines/top+weakness/bodyfatScale/massSplit/scanProgress, 16 tests);
  history hooks `data/oracle-history.ts` (usePhysiqueHistory/useBodyfatHistory,
  invalidated on save). Reveal hooks `ui/oracle/oracle-anim.ts` derive the
  non-animating case in render (no setState-in-effect) and reduced-motion â†’
  final immediately; light success haptic on save (native only). Toured
  (ALPHA): empty states, goal selection, and rich history/impact via READ
  interception; 320/390 clean, no overflow. NOTE: the photo before/after
  SLIDER from the brief is deliberately NOT built â€” solo photos are never
  persisted, so the honest substitute is the ratings-based
  PROGRESS-SINCE-FIRST-SCAN comparison.

- **FUEL_REDESIGN â€” EXECUTED 2026-07-18** (Tyson's reference mock): fuel.tsx
  is now a composition over `ui/fuel/*` â€” FuelHeader (framed champion + Forge
  LV, the Train pattern) Â· NutritionSummaryCard (remaining kcal loud + three
  macro rows; two-col â‰¥380px, stacked below; meter colour rules unchanged) Â·
  AIMealScanCard (epic treatment; photo scan AND the new **barcode scan**
  share ONE confirm sheet + useLogMeal) Â· MealsSection (slots wear
  BREAKFAST/LUNCH/DINNER/SNACKS via `mealSlotName` â€” position IS meaning,
  meal_no stays the contract; 5..8 stay numbered; ï¼‹/âˆ’ MEAL kept) Â·
  FuelBonusCard (protein goal; **deliberately NO "+Recovery XP" promise â€”
  no such backend exists**, hidden-never-mocked) Â· QuickLogCard (+100/200/
  300/500 chips ADD to the field; LOG IT is the only write) Â·
  DailyTargetCard Â· converter + quick-adds kept. Domain adds (all tested):
  `mealSlotName/macroProgress/macroTargetsFor` (2g/kg when intake knows
  weight, else 30/40/30 split; `DEFAULT_MACRO_TARGETS` fallback)
  /`mealMacroTotals`/`streakDays` (unlogged TODAY doesn't break the run).
  Data adds: day query now selects `protein_g/carbs_g/fat_g`;
  `useNutritionDates` (streak window, invalidated by every log/delete).
  **Barcode:** `@zxing/browser` lazy-imported over getUserMedia
  (`ui/fuel/barcode-video.web.tsx`; native twin stubs unavailable â†’ photo
  decode â†’ manual digits), product lookup = direct Open Food Facts v2 fetch
  (`data/food-lookup.ts` â€” keyless+CORS-open, per-100g normalised, serving
  default). NeonButton grew the `epic` variant; pixel-icons grew the fuel
  set (sun/bloom/moon/apple/muscle/bolt/drop/camera/barcode/target/shield).
  Toured against production (ALPHA): real OFF lookup via the modal
  (Coca-Cola 139 kcal/330ml), quick-log writeâ†’delete self-cleaned, rich
  state via READ interception. **Tour gotcha: the origin-v5 DISCOVER YOUR
  ORIGIN sheet floats over every page for accounts without an origin â€” click
  its LATER before driving anything.**

- **`TRAIN_OVERHAUL.md` â€” EXECUTED IN FULL 2026-07-15** (4 commits): hero
  briefing card (title/sub split, muscle pills, â‰ˆSETS/MIN/KCAL, hero
  START/RESUME), pixel icon kit + tab dumbbell, three grey utilities +
  CHANGE WORKOUT sheet (the one source switcher; scan rows in both sheets),
  THIS WEEK status circles + PARTIAL (marker && done<target; derivation never
  invents it; still locked). Toured against production incl. seeded
  RESUME/PARTIAL; seeds deleted.
- **Neon MuscleMap (Tyson's spec, same day; refined Ã—2 on his feedback)**
  replaced the first-pass pixel body: two permanent black 16-bit base
  characters (`client/assets/muscle-map/`) under translucent 3-layer cyan
  SVG overlays (`ui/muscle-map/`, stepped 6px staircase paths in the images'
  887Ã—1774 grid), FRONT|BACK toggle w/ smart default, zone zoom (all-upper â†’
  torso, all-lower â†’ legs, mixed â†’ full; `focusFor`), pulse gated on reduced
  motion, `domain/muscle-map.ts` = the pure 15-MuscleId contract + label
  normaliser + `pillLabelsFor` (the hero chips speak the same fine
  vocabulary â€” Triceps, never "Arms"). Regenerate paths: scratchpad
  `gen_muscle_paths.py` â€” pec plates are cv2-contour-EXTRACTED from the art
  itself (bright regions only; the shadowed delt/arm regions fragment under
  thresholding and stay hand-authored over gridded 2Ã— crops).
- **Krita hand-drawn masks (Tyson, 2026-07-15) now drive the FRONT overlays**
  for ALL 12 front regions (chest/shoulders/biceps/triceps/forearms/traps/
  abs/obliques/quads/abductors/adductors/calves â€” the last five landed the
  same evening; abductors+adductors became their own MuscleIds) â€” the .kra is the
  source of truth, extracted by `tools/extract_muscle_masks.py` (decodes
  Krita's LZF-planar tiles; refuses to export unless its recomposite is
  pixel-identical to the file's own mergedimage.png). Exact masks +
  pre-tinted `-lit` variants (white fill â†’ #18D9FF, black linework kept â€”
  RN tintColor would recolour the lines) in `client/assets/muscle-masks/`.
  BACK view: 9 Krita-masked regions (`silhouette - back.kra` â€” rear delts,
  triceps, traps, calves, hamstrings, glutes, erectorsâ†’lowerBack, lats,
  upperback); only back forearms/biceps still ride SVG paths. Lit fills bake
  ~51% alpha (FILL_ALPHA in the tool) so the base model's definition shows
  through; linework stays full-strength. The tool's proof ladder: mergedimage recomposite (opacity-aware â€”
  Tyson dims the base while tracing) â†’ prior-export equivalence â†’
  --base-proof vs the source PNG. Dev workbench:
  `/muscle-lab` (renders nothing in production; enable locally via __DEV__
  or EXPO_PUBLIC_MUSCLE_LAB=1 at export).

- **2026-07-15 LATE SESSION (one Claude, ~15 commits) â€” the Train hub in its
  current form.** Read this block before touching `(main)/today.tsx`:
  - **Daily carousel**: the hero card swipes one calendar day at a time
    (`ui/train/daily-workout-carousel.tsx` â€” paged FlatList, today Â±7 via
    `datesAround`, `CAROUSEL_REACH` to widen). Every card derives from ITS
    date (`cardDataFor(date)` in today.tsx): progress via `setsFor(date,â€¦)`
    (isolation is structural), states START / CONTINUE (sets, no marker) /
    VIEW WORKOUT (marker) / REST DAY / NO WORKOUT PLANNED. This Week rows
    FOCUS the carousel (`carouselRef.scrollToDate`); the card button is the
    door. The figure is tap-to-flip (horizontal swipes = day).
  - **EQUAL CARDS**: `CARD_HEIGHT` 396 on wrapper+list+items; GlowCard
    `fill`; footer `marginTop:'auto'`; figure in a fixed 40%Ã—196 box; chips
    in a fixed 56px area capped 3+`+N`; everything numberOfLines-clamped.
    Content must NEVER size a card.
  - **16-bit type**: Silkscreen Reg+Bold (`assets/fonts/`, `theme/fonts.ts`,
    loaded in root `_layout`, no splash gate). `pixelFont(bold)` helper;
    NeonButton `pixel`, SegmentedTabs `pixelLabels`. DISPLAY text only â€”
    subtitles/helper copy stay sans. Real Bold face, never fontWeight.
  - **Source switching**: `sourceDayFor` (week-status.ts) renames today +
    future onto the chosen plan â€” keep-rule is per-WEEK ownership (per-day
    froze on name collisions: all of Tyson's plans have a "Legs"); past
    dates never rewrite. The card sub-line names WHOSE version renders
    (plan_name / 'Built-in Routine').
  - **Copy (2026-07-16)**: CHOOSE WORKOUT / QUICK WORKOUT / EDIT SCHEDULE
    (+subtitles); sheet options MY PLAN / AI PLAN / EVOFORGE PLAN
    (`SOURCE_LABEL[2]` renamed); SCAN WORKOUT, EDIT/CREATE PLAN, CREATE AI
    PLAN, CANCEL; schedule page heading EDIT SCHEDULE. testIDs unchanged.
  - **Taxonomy is 19 tags**: Erectors + Abductors (retagged exercises ride
    the same commits; conventional deadlifts are erector-primary; RDL/GM/
    Rack Pull carry Erectors as secondary). Avatar heat map untouched by
    design â€” it recomputes via parity-pinned inferMuscleGroup(name).
  - **Pending / loose threads**: back-view forearm+biceps masks (draw â†’
    `tools/extract_muscle_masks.py <kra> back` â†’ add ids to BACK_MASKED_IDS
    + requires in back-masks.ts); verify the CI deploy of `0cd1769` went
    green; old TASKS.md `[human]` items. Tour screenshots for Tyson land in
    `Downloads/evoforge-screenshots/` (he cannot see Claude-context images).

- **`HOME_REDESIGN_PLAN.md` â€” EXECUTED IN FULL 2026-07-16**: Home is the
  RPG character hub (Tyson's mock): HomeHeader (wordmark + LV/XP module â†’
  /profile), AvatarHero (HeroStage with tier/form/evolution badges +
  CUSTOMISE overlaid â‰¥380px, row below under that), TODAY'S MISSION (all
  states via `domain/home-mission.ts`; reward = activityXp over the plan's
  sets, coins never implied), status grid (streak/coins/XP/tier doors),
  TRAINING OVERVIEW (contract + periodTotals, no fabricated goals), RECENT
  PR (`domain/recent-pr.ts` â€” set-save's e1RM rule replayed for display),
  EvolutionTeaser, schedule door, the build bars (kept). Flags in
  `ui/home/home-features.ts` â€” LOADOUT hidden (no cosmetic backend), and
  that is the rule: A SYSTEM WITHOUT A BACKEND IS HIDDEN, NEVER MOCKED.
  Home computes the mission EXACTLY like the Train hub (same sourceDayFor /
  resolveDay / setsFor / estimates) so the two screens cannot disagree.
- **The pixel face is now Jersey 25 (display) + Jersey 10 (small labels),
  2026-07-16** â€” Silkscreen's W and ~ were unreadable (Tyson), Pixelify
  Sans's bold 5 reads as S (side-by-side proof in the session log). Single
  weights: `pixelFont()` still maps boldâ†’Jersey25/regularâ†’Jersey10; never
  synthesize bold. `~` estimate prefixes became explicit `EST. MIN` labels.

- **`OPTIMISE_PLAN.md` â€” EXECUTED 2026-07-16 (same session as the Home
  redesign):**
  - **Route-level code splitting IS possible on this pipeline** â€” expo-router
    `asyncRoutes: {web: true}` (app.json). The 3.5MB single entry became a
    1.1MB entry + 1.8MB shared chunk + ~25 per-route chunks (Home 55KB,
    Train 38KBâ€¦). Â§7's old "no splitting" claim is dead.
  - Platform twins keep native-only weight off web: `data/url-polyfill.*`
    (whatwg-url/punycode) and `data/session-storage.*` (aes-js/buffer â€”
    supabase falls back to localStorage on web, which is safe here).
  - **`src/ui` is grouped by feature now**: `core/` (shell, hud, buttons,
    icons, fields) Â· `character/` (avatar, stage, sprites, XP, evolution) Â·
    `train/` (logger, picker, carousel, cardio) Â· `arena/` (battle,
    leaderboard) Â· `home/` Â· `muscle-map/`. No barrels (they fight
    splitting). Dead components deleted (quest-card, stat-meter,
    avatar-card â€” unreachable after the Home redesign).
  - **Motion**: root boot cross-fade (M3) + ScreenShell one-shot focus
    fade/rise (M1), both reduced-motion gated; verify-motion still green.
  - **Idle tab preload** ((main)/_layout): once signed in + idle,
    `router.prefetch` background-mounts the four sibling tabs, so every
    tab switch is 60â€“80ms with ZERO network (falsified with a
    request-counting tour). Safe by audit: no tab screen has mount-time
    subscriptions; focus-scoped effects stay focus-scoped. The workout
    page is NOT preloaded (params-dependent). If a future tab screen
    gains a mount effect, re-audit this list.
  - Moving a ui file one level deeper breaks its `../assets/` imports â€”
    the codemod missed them once; tsc alone does NOT catch broken asset
    requires (only `expo export` does). Export before trusting a move.

- **AI cost/latency routing (2026-07-16, falsified live):** `ai-plan` and
  `ai-plan-scan` ride `FAST_MODEL` (gpt-5-mini) with `reasoning: low` â€”
  generation/transcription with large outputs, ~5Ã— cheaper and faster;
  validatePlan/validateScan stay the quality gate. **The three judges
  (bodyfat, physique, battle-physique) stay on gpt-5.1 ON PURPOSE** â€”
  verdict consistency across an athlete's history and battle fairness
  outrank pennies; don't downgrade them for cost. All calls request
  `json_object` (a malformed response was a wasted paid call). Real-money
  facts: every paid action is one `callOpenAiJson` round trip; per-user cap
  is `HOURLY_LIMIT` 10/hr across kinds; the content-hash cache makes
  repeats free; Supabase is the FREE plan (14MB / 500MB used).
  **`supabase/**` is now in client.yml's trigger paths** â€” before this, a
  functions-only push triggered NO workflow and deployed nothing (the
  committed-but-undeployed trap, structural edition).

- **PROGRESSION_OVERHAUL (2026-07-16, executing): P1+P2 SHIPPED.**
  `domain/progression/` carries the Evo Rating core: 30/25/30/15 geometric
  mean, tier gates with SMOOTH soft caps (raw 92 failing a 90-gate reads
  89.x, explained), L100 manual-only, four pillar calculators (size FFMI/
  frame/regional Â· aesthetics w/ definition PLATEAU below healthy bf Â·
  strength best-2-of-last-4 w/ the ONE movement mapping + versioned
  reference curves Â· cardio provisional-never-zero), confidence-before-
  score staleness, evo-state peak-ratchet reducer. 49 new tests. Forge
  curve TS+SQL twins pinned by machine-verified fixture. Migrations
  023/024 APPLIED + falsified (guard clamps forged XP to server values;
  snapshots immutable; peak/starting trigger-enforced). Flags OFF in
  `data/progression/features.ts` â€” nothing user-visible yet.
- **P3 SHIPPED (same session): the recurring Evo loop.** Pure:
  `evidence.ts` (staleness windows; the DECLINE RULE â€” 2-of-last-3 below
  noise, no protective marker, or nothing moves) + `evo-review.ts` (the
  weekly review as ONE pure function: strength/cardio recompute,
  Size/Aesthetics preserved between scans, forecast generated). IO:
  `data/progression/evo-review-io.ts` + `use-evo-rating.ts` hooks.
  Migration 025 (cardio_evidence; strength_evidence DEFERRED â€” derivation
  from workout_log beats duplication until P9 anti-cheat needs the audit).
  **TRUST BOUNDARY: the review computes client-side; DB triggers enforce
  peak-ratchet/starting-write-once/immutability. Competitive surfaces and
  any Evo leaderboard must NOT read evo_rating_current as authority â€”
  server recomputation first (the xp_drift-refusal doctrine).** Falsified
  against production with ALPHA's real data (rating 46 Trained, honest
  provisional confidence, due-gating idempotent); smoke rows deleted.
- **P4 SHIPPED (same session): Forge Level + Weekly Momentum.**
  `momentum.ts` (weeks vs target; misses DECAY by 2, protective modes and
  recovery weeks BRIDGE, the current week is never judged early);
  migration 026 APPLIED: weekly_momentum + `forge_claim_weekly` (server
  re-proves the week: 100%â†’250 XP, 80%â†’150) + `forge_migrate_history`
  (the Â§43 one-shot: ALPHA's real history â†’ 5 sessions â†’ Forge Level 2,
  legacy 1020 XP frozen; rerun = 0 new). The 023 guard now recognises
  SECURITY DEFINER grants by current_user â€” a distinction PostgREST
  clients cannot forge. Client: `award-xp.ts` (event-key builders, send 0
  and let the server decide) + `use-forge.ts` hooks. ALPHA's Forge rows
  are REAL migrated data and stay (permanent smoke fixture).
- **P5 SHIPPED â€” THE FLAG IS ON (`newProgressionEnabled` +
  `evoReviewsEnabled`).** Home carries the EVO CORE (spec Â§30 hierarchy:
  rating/descriptor, four pillars w/ limiting highlighted, Evolution bar,
  review countdown; no data â†’ DISCOVER runs the first review). New routes
  `/evo` (spec Â§31: current/starting/peak, pillars+confidence, forecast,
  pending evidence, review history, manual review) and `/forge-level`
  (spec Â§32: level, ledger, Momentum, weekly claim, the legacy record
  line). The (main) layout runs the idempotent history migration + the
  due review on launch (invalidates the reads after). finish-queue
  awards workout_completed XP on every confirmed flush (fire-and-forget;
  awardForFinish looks the marker id up itself â€” do NOT chain .select on
  the queue's insert, the tests pin the plain shape). Toured against
  production: ALPHA reads 46 TRAINED w/ real pillars; zero console noise.
  REMAINING for the full terminology sweep: the header LV. module and
  rarity badges still speak the LEGACY level â€” swap their source when
  the old level retires (deliberate: two vocabularies never at once,
  and the legacy level remains the app-wide `summary.level` consumer
  contract until then).
- **P6 SHIPPED: guided Evo Scans + Evolution Chapters.** Migration 027
  (physique_assessments + evolution_chapters + the ai_scan_cache kind
  extension â€” the 021 lesson, applied BEFORE it bit). `evo-scan` edge fn:
  2-3 photos + bodyweight/waist â†’ sub-scores + 14 regional scores on the
  gpt-5.1 judge; 28-day eligibility; >6-point swings come back
  pending_confirmation (7-day confirmation window). **Solo photos are
  STILL never persisted â€” hashes only; the house privacy rule outranks
  the spec's bucket design** (battle round-3 stays the lone exception).
  /evo-scan guided screen; a confirmed scan postdating the last review
  feeds Size/Aesthetics THROUGH the pillar calculators at the next
  review. Chapters: first review opens chapter 1; reviews roll chapters
  every 84 days with before/after summaries (maintainChapters in
  evo-review-io).
- **P7 SHIPPED: Rival Rank.** Glicko-2 lives as a FOURTH byte-pinned
  contract: `contracts/rival/glicko2.ts` master â†’ client domain copy +
  functions copy, `scripts/verify-glicko.mjs` (in CI) â€” and the maths is
  pinned to Glickman's published worked example (1500/200/0.06 â†’
  1464.06/151.52/0.05999). Migration 028: competitive_ratings (NO client
  write policy â€” `rival-settle` service-role only), competitive_matches
  (unique(battle_id) = the settle idempotency lock), ghost_snapshots.
  rival-settle verifies the settled battle + participants server-side and
  rates BOTH players. `/rival` page reconciles unrated settled battles on
  visit (idempotent). Tiers Ironâ†’Apex Ã—III/II/I, 5 placements, RD-based
  confidence; matchmaking constraints (never rank-only, never Evo-only,
  farming cap) in rank-tiers.ts. `/rank` remains the XP leaderboard â€”
  its drift gates are load-bearing; do not rename it into Rival Rank.
- **P8+P9 SHIPPED â€” THE OVERHAUL IS COMPLETE.** player-stats.ts (the Â§25
  mapping; Technique from history alone, log-plateaued), versioned Evo
  Class rules (first match wins, Specialist fallback, always explained),
  confidence-GATED traits (a 75 strength at confidence 20 earns nothing),
  Equalised/Handicap ruleset transforms. Migration 029: player_stats,
  player_traits, analytics_events (thin, no PII), evo_rating_audit
  (immutable trail of every official movement). The review pipeline now
  ALSO: clamps impossible jumps (Â±8/review, NAMED in changes + flagged in
  audit), refreshes stats/class/traits, writes audit + analytics â€” all
  best-effort riders that can never fail a review. Falsified live as
  ALPHA end-to-end. PLAYER STATS panel on /evo.
  DEFERRED HONESTLY: ghost-match UI (table + snapshots exist), seasonal
  events, notifications (needs native push), Evo leaderboards (need the
  server-recomputation gate first â€” the audit table is its foundation),
  battle-engine stat integration (rulesets are pure transforms awaiting a
  battle-format decision; the engine stays byte-pinned).

- **Mass Monster sprite set (Tyson, 2026-07-16):** WAS five GIFs in
  `client/src/assets/sprites/mass-monster/` (rotations-8dir Â· walk Â· run Â·
  jab Â· cross, 92Ã—92 @200ms) â€” ALL RETIRED by the redesign pack below. The ROTATION is the main avatar now:
  `animatedAvatar(branch)` in avatar-art.ts (one shared idle until
  per-class gifs land â€” extend ANIMATED_AVATARS), rendered by AvatarStage
  behind the SAME reduced-motion/perf gate as every ambient loop (static
  art fallback), `imageRendering: pixelated` for crispness. The PATHS
  page previews it on active/eligible mass-line destination cards.
  Falsified: gif in DOM + two captures 700ms apart DIFFER (it really
  rotates). The walk/run/punch gifs await the battle layer.
  **Correction (Tyson, same day): the rotation is MASS-LINE ONLY** â€” a
  shared default had replaced his Aesthetic stage-3 art with the wrong
  body. Never substitute one class's art for another's. The sprite
  renders 1.35Ã— on the stage (92px frames carry more padding than the
  painted art), and the PATHS mass-line cards preview it in EVERY state
  (dimmed 0.55 while gates are closing). TOUR GOTCHA: tabs stay mounted â€”
  a querySelectorAll('img') "found it on PATHS" can be HOME's copy;
  assert on the right page's own state.
  **Aesthetic rotations, stages 1â€“4 (Tyson, same day):** `assets/sprites/
  aesthetic/rotations-stage{1..4}.gif` (124Ã—124). `animatedAvatar(branch,
  stage, sex)` is now STAGE- and SEX-aware â€” male only until female sets
  land (no body substitution, ever). Sprites draw at 1.35Ã— and translate
  DOWN by their MEASURED ~24% bottom padding (PIL-measured, constants in
  avatar-stage.tsx) or the character floats above the podium â€” re-measure
  when new sets land. PATHS previews any line with a rotation, dimmed
  until eligible.
  **Companion replaced with the Cyber Athlete pack (l4_aesthetic.zip,
  Tyson, 2026-07-16):** all four MALE stage sprite sets (idle = the
  8-frame rotation Â· run 8 Â· punch 3 Â· victory 3 from rotation poses)
  rebuilt from the pack's frame folders â€” strips + singles regenerated
  with PIL union-bbox trims, ASPECT re-measured, COUNT is now PER SEX
  (countFor â€” female sets keep their original counts/art untouched).
  Stale lvN_run_9/punch_4-6 removed. The old male companion character no
  longer exists anywhere. Regeneration recipe: the unpack + build script
  in the session scratchpad (frames land in assets/avatars/sprites).
- **Victory = the FRONT DOUBLE BICEP (Tyson, 2026-07-16):** 9-frame flex
  for stages 2-4 (stage 1 keeps the rotation sway until its art lands) â€”
  frame counts now DERIVE from the FRAMES arrays (the COUNT tables are
  gone; per-stage counts made a flat table a lie). Plays in the MISSION
  COMPLETE ceremony and the Home header companion (anim="victory").
- **THE LEVEL CUTOVER (Tyson, same day): the game level is the FORGE
  LEVEL â€” earned XP only, from zero.** Header LV. module (Home + Train),
  the level-up detector and the ceremony's LEVEL PATH read
  user_progression via forgeProgressFromRow. A one-shot service-role
  conversion granted migration:v1 events for ALL 8 users with history
  (idempotent keys), froze each legacy xp_events total into
  user_progression.legacy_xp, and set every evo_rating_current
  next_review_at = now() so EVERY current user re-reviews with the
  current formula at next open (users without ratings get their initial
  then â€” the launch effect covers both). STILL LEGACY-KEYED ON PURPOSE:
  avatar stages/evolution gates + the /rank leaderboard ride
  summary.level so no character regresses; rekeying evolution to
  Evo-gates is the next seam. summary.level no longer displays anywhere.
- **Retro SFX (Tyson, 2026-07-16):** synthesized square-wave blips
  (`assets/sfx/press.wav` 700â†’1050Hz chirp Â· `select.wav` 1500Hz tick â€”
  ORIGINAL, generated with python wave/struct; recipe in the commit).
  `ui/core/sound.ts`: HTML5 Audio on WEB only (native silent until
  expo-audio arrives with native builds), resolved via expo-asset like
  the sprite strips, always gesture-triggered so autoplay never blocks,
  gated on settings `soundEnabled` (default on; profile toggle beside
  perf mode; reset on sign-out like every store). Wired: NeonButton â†’
  press, Chip + SegmentedTabs â†’ select. Falsified with an
  HTMLAudioElement.play spy: exactly ['press'] on a NeonButton click,
  ['select'] on a tab switch. NOTE: the sign-in button is a plain
  Pressable, not a NeonButton â€” silent by design.
- **THE AMBIENT GATE (Tyson: "everything lags", 2026-07-16):**
  `ui/core/use-ambient.ts` â€” ambient = FOCUSED + motion allowed. The idle
  tab preload keeps five screens mounted, and on web every Reanimated
  loop runs on the MAIN JS THREAD whether visible or not: five screens
  of auras/motes/floats/sprites ticking at once was the lag (presses
  queue behind animation frames on phones). Now gated: AvatarStage's
  four loops + the gif (static art when unfocused), ParticleLayer
  (renders nothing), muscle-map pulse, SpriteCompanion (frozen).
  Measured: ONE running animation app-wide at idle (was 5 tabs' worth),
  60fps at 6x CPU throttle. verify-motion now accepts useAmbient as a
  compliant gate (it embeds useReducedMotion) â€” extension FALSIFIED
  (broke a gate, guard went red, restored). Screen entrance trimmed to
  140ms/6px for snappier tab feel. RULE: new ambient loops use
  useAmbient, and it must only be called INSIDE navigator screens
  (useIsFocused throws elsewhere â€” root overlays keep useReducedMotion).
- **Sprite STILLS (Tyson: "the old PNG flashes on hero taps"):** gating
  the gif on focus swapped to the FALLBACK â€” the old painted art â€” for
  the transition frame. Every rotation set now has a frozen SOUTH pose
  (`stillAvatar()`, same canvas as the gif so the layout math aligns and
  nothing jumps): ambient â†’ gif, gated â†’ still, painted art ONLY where
  no sprite set exists. Falsified: 60ms after a hero press the Home
  stage serves still-stage3; the old PNG never appears. Stills for new
  sets: aesthetic = rotations/south.png; mass = gif frame 0 (recipe in
  the commit).

- **MASS MONSTER REDESIGN, stages 1â€“4 (Have_his_face_be_ful.zip, Tyson,
  2026-07-16):** the whole mass line re-drawn at 148Ã—148 with per-stage
  sets, replacing the single 92Ã—92 gif. Hero: `mass-monster/
  rotations-stage{1..4}.gif` + `still-stage{1..4}.png` â€” animatedAvatar/
  stillAvatar mass/titan branches are now STAGE-keyed like aesthetic
  (bottom padding measured 23.6â€“24.3%, the existing 0.24 constant holds â€”
  no layout change). Companion: the male sets now split by LINE â€”
  `companionLine(branchV2)` in domain/branches-v2.ts (PURE, unit-pinned:
  mass/titan â†’ 'mass', all else â†’ 'aesthetic'; a Mass Monster never wears
  another line's body) selects STRIPS_M/FRAMES_M/ASPECT_M (lvNm_* strips
  + singles, idle 8 = rotation Â· run 8 Â· jab 3 Â· victory 9 = most-
  muscular flex at L1, double bicep L2-3, flame-aura double bicep L4);
  female sets stay sex-keyed and untouched. Old walk/run/cross-punch/
  lead-jab east gifs deleted (referenced nowhere). Falsified in-browser:
  PATHS' mass+titan cards serve the dist asset whose MD5 equals
  mass-monster/rotations-stage2.gif (hash-matched â€” both packs name
  files rotations-stageN, so match by CONTENT hash, not filename) and
  two clipped screenshots 500ms apart DIFFER; Home hero still serves
  aesthetic stage 3. TOUR LESSON: canvas drawImage() samples only a
  GIF's FIRST frame per spec â€” a drawImage frame-diff is ALWAYS static;
  diff SCREENSHOTS instead.

- **CUSTOMISE â€” the champion select (Tyson, 2026-07-16):** Home's
  CUSTOMISE button now opens `/customise` (hidden Tabs.Screen pushed over
  Home â€” tab bar stays, Home keeps its scroll). Structure: roster grid
  (real classes; locks are the LIVE branch gates via branchPathsV2 +
  honest ??? COMING SOON slots) â†’ HeroStage preview with live gates for
  locked champions â†’ evolution-stage carousel (real ladders; locked
  stages previewable) â†’ OUTFIT/AURA/EFFECTS/EMOTES tabs â†’ EQUIP.
  PREVIEW â‰  EQUIPPED: the screen edits a local Selection; EQUIP writes
  the persisted loadout-store (AsyncStorage `evoforge-loadout`, cleared
  on sign-out in auth-context WITH its persisted copy â€” the every-cache
  doctrine). `domain/customise.ts` is the pure model (26 vitest pins):
  buildRoster/stageOptions/equipState/resolveDisplay â€” resolveDisplay
  re-validates the loadout against live state ON EVERY READ, so a gate
  that closes after equip silently falls back to the derived identity.
  Home renders through `data/use-display-identity.ts`; the header
  companion plays the equipped EMOTE (the real companion anims, forge-
  level gated). NOTHING here invents progression: roster locks = branch
  gates, stage locks = ladders, cosmetic gates = real Forge Level.
- **SKINS (Tyson: "red, green, yellow, orange, white, black recolours of
  all skins", 2026-07-16):** 120 generated palette swaps (luminance
  duotone, scratchpad gen_skins.py â€” regenerate in place when base art
  changes): both male lines' rotations+stills Ã— 4 stages Ã— 6 colours
  (assets/sprites/skins/) + female aesthetic painted Ã— 6
  (assets/avatars/skins/). `ui/character/avatar-skins.ts` is a GENERATED
  require map; `skinned*` resolvers return undefined for 'standard'/
  missing sets and every caller falls back to base art â€” a skin can
  recolour a body, never substitute one. Applied on Home hero, customise
  preview, roster/stage/outfit cards. Companion strips are NOT skinned
  (v1 scope). Falsified in-browser: select red â†’ equip â†’ Home hero
  serves aesthetic-red-stage3.gif â†’ SURVIVES A FULL RELOAD â†’ standard
  re-equipped (cleanup).

- **FIX BATCH (Tyson's live reports, 2026-07-16 evening):**
  1. *"Mass Monster is missing stage 4; stages 1 and 2 are the same"* â€”
     the pinned core ladder spreads five rows over the THREE painted
     stages (1,1,2,3,3). `massArtStage()` in branches-v2 remaps the mass
     LINE to the aesthetic spread (25/50/75 â†’ stages 1,2,3,4,4); wired in
     avatarStageRowsV2 (mass rows + the titan stageFor), customise
     currentStageFor, SpriteCompanion, PATHS destinations, the evolution
     teaser. Core goldens untouched. ALSO fixed: avatarImage() fell back
     to AESTHETIC STAGE 1 for any out-of-range stage (a stage-4 Mass
     Monster in the wrong body) â€” it now clamps to the line's own top.
  2. *"Epic Bloom is blocked despite me having it unlocked"* â€” his Forge
     Level is 3 (checked in prod), but his TIER is EPIC: tier-NAMED
     cosmetics now carry a `tier` unlock kind evaluated against the
     legacy display level's rarity (epicâ†’Epic Bloom, legendaryâ†’Gilded
     Field); forge gates remain for the colour auras (crimson 5,
     emerald 10). cosmeticUnlocked takes an UnlockContext{forgeLevel,
     legacyLevel} now.
  3. *"Customising doesn't change the Forge avatar screen"* â€” avatar.tsx
     EvolutionView renders the DISPLAY identity (useDisplayIdentity):
     equipped branch/stage/skin/aura on the hero, the evolution line
     follows the displayed champion in the equipped skin.
  4. *"Each avatar grows 5% per stage"* â€” AvatarStage scales the body
     (sprite AND painted) by 1 + 0.05Â·(stageâˆ’1); the bottom-pad translate
     rides the grown size so feet stay on the podium. Measured in-tour:
     stage 3 = 360px vs 324 base.
  5. *"Music stops when EvoForge plays sound"* â€” HTMLAudioElement claims
     the platform MEDIA SESSION (iOS pauses Spotify for a 90ms blip).
     sound.ts now synthesizes the same square-wave chirps with WEB AUDIO
     oscillators (no media element, mixes with background audio); the
     WAV assets are deleted. Falsified: a Chip press constructs ZERO
     Audio elements and exactly one AudioContext. RULE: SFX must never
     create an HTMLMediaElement; a future native build must use the
     ambient/mixWithOthers audio category.

- **TITAN LINE + TRUE ADAM + LADDER FIXES (Tyson, 2026-07-16 late):**
  1. *Titan_L4.zip*: Titan stands on its OWN body now â€” cyberpunk Viking,
     rotations-stage{1..4}.gif + stills (136Ã—136, pad 22.8â€“24.3% â€” the
     0.24 constant holds) in assets/sprites/titan/, plus all 7 skin
     recolours. avatarArtV2 male titan returns hasArt:true (the still
     stands in as painted). ROTATIONS ONLY: companionLine(titan) stays
     'mass' until Titan's move set lands; avatar-skins now resolves
     tables per-line explicitly (skinTables â€” skins must NOT follow the
     companion borrow). The stray "Viking warrior" folder in the zip is
     an L1 duplicate, ignored.
  2. *"Only 4 stages per skin; level 100 True Adam unlocks the Adam
     skin"*: avatarStageRowsV2 folds duplicate-art rows (uniqueStages â€”
     one row per BODY, current recomputed onto the kept ladder). Folded
     forms (True Adam, Titan Prime, Perpetualâ€¦) remain FORM NAMES via
     evolutionNameV2. NEW SKIN 'adam' (violet-shadowed white-gold,
     distinct from Volt): gated {kind:'tier', slug:'mythic'} = level 100
     exactly, label "REACH LEVEL 100 â€” TRUE ADAM". SkinItem carries
     unlock now; resolveDisplay/equipState validate skins like auras.
  3. *"Stages of locked champions show unlocked"*: stageOptions takes
     characterUnlocked â€” a locked champion's ladder is all-locked
     ("UNLOCK THIS CHAMPION FIRST"), previews only; your level lights
     stages only on champions whose gates you met.
  4. *"Equipping a lower-level avatar doesn't work"*: own-champion
     loadouts store branch:null (follow evolutions), but resolveDisplay
     compared null===branch and dropped every own-champion stage pick.
     Now (loadout.branch ?? derived.branch). Proven in-browser: stage 1
     + red equips, Home serves aesthetic-red-stage1 at base size (no
     growth at stage 1), form badge CYBER RECRUIT.

- **CARDIO MACHINE LINE (Enduro_L4.zip, Tyson, 2026-07-16):** the last
  silhouette falls â€” cardio has its own 4-stage blue-flame runner
  (120Ã—120) in assets/sprites/cardio/ + all 7 skin recolours. BUILD
  NOTE: L4's frames carried only 15% bottom padding (vs the ~24% every
  other set measures); the build shifted its content UP 11px in-canvas
  (23px top clearance absorbed it) so the global SPRITE_BOTTOM_PAD
  constant holds â€” NORMALISE PADDING AT BUILD TIME when a pack deviates,
  never fork the layout constant. Cardio joins the 4-stage body spread
  (stageFor = massArtStage for both new classes; currentStageFor +
  PATHS special-case it â€” its shape DONOR stays 'hybrid' for
  silhouettes only). avatarArtV2: every male branch returns real art
  now. Companion remains the Cyber Athlete move set.

- **HYBRID REMOVED FROM THE GAME (Tyson, 2026-07-16):** at the V2 layer
  only â€” the pinned core resolver (golden-fixtured) still knows the
  branch, but resolveBranchV2 folds core-hybrid athletes into the
  AESTHETIC default line, branchPathsV2 offers no path to it, the
  customise roster lists five classes, and the PATHS destinations no
  longer feed it. Old persisted loadouts with branch:'hybrid' fall back
  to derived automatically (resolveDisplay's roster validation). The
  hybrid PAINTED ASSETS remain as the cardio/female SILHOUETTE shape
  donor only (displayDonor/shapeDonor keep returning 'hybrid' â€” that is
  internal geometry, not a class). The v2 sweep test now pins the fold
  WITH a hybridsSeen>0 positive control.

- **SHREDDER LINE (Shredder_L4.zip, Tyson, 2026-07-16):** the redemption
  arc gets its own body â€” hooded start â†’ dual-blade blue-flame shredded
  (108Ã—108, pad 25-27%). Replaces the old baked-background painted set
  (which could never silhouette); avatarArtV2 male shredder now returns
  the pack still as real art. Stages still ride BODY FAT (shredderStage).
  All 7 skin recolours; skinTables resolves shredder to its own set.
- **THE SKIN SHOP (Tyson: "colours locked by forge coins, price
  ascending, cheaper on aesthetics", migration 030):** colour skins
  (redâ†’black) are BOUGHT with forge coins, PER LINE. Server is the
  authority: skin_price() holds prices, purchase_skin() (security
  definer, advisory-locked, balance-checked) writes the spend +
  user_skin_unlocks row in one txn. Prices â€” aesthetic 50/75/100/150/
  200/250, every other line double (100/150/200/300/400/500); ascending,
  aesthetic cheapest. 'standard' free, 'adam' stays the level-100 (mythic
  tier) reward â€” neither is priced.
  SECURITY LESSON (caught in falsification): my first 030 guard reused
  the `current_user not in (authenticated,anon)` bypass from the xp
  ledger â€” but inside a SECURITY DEFINER trigger current_user is ALWAYS
  the owner, so a raw client `spend` insert returned 201. Fix: a
  transaction-local GUC (evoforge.spend_authorized) that ONLY
  purchase_skin sets; the guard admits a spend only when it matches the
  row's source_id. A client POST is its own single-statement txn and can
  never set it. Re-verified: raw spend + raw unlock BOTH rejected, buy
  deducts exactly the price, duplicate/insufficient/unknown all rejected,
  cross-user reads empty. NEVER use current_user to gate a definer
  trigger â€” use a txn-local GUC or service_role.
  Client: data/skins.ts (useSkinUnlocks + usePurchaseSkin, invalidates
  wallet+unlocks), domain skinPrice/skinUnlocked/skinKey (display twins,
  pinned), equipState gains a 'buy-skin' state (the primary button
  becomes BUY Â· N COINS / NEED N COINS), the CUSTOMISE header shows the
  wallet, resolveDisplay/useDisplayIdentity take ownedSkins so a bought
  colour renders on Home/Forge and an unowned one falls back to standard.

- **CAPTAIN GYMERICA â€” the first PREMIUM CHARACTER (Captain_Gymerica.zip,
  Tyson, 2026-07-16):** a purchasable hero (10000 forge coins, one buy
  unlocks both stages) equipped as an avatar OVERLAY â€” his art shows on
  Home/Forge while the player's real training branch + stats stay
  untouched underneath. Two stages (armoured â†’ 20kg-plate shield) + two
  looks: navy/cyan Forge Standard and the red/white/blue "United States
  of Aesthetics" (assets/sprites/gymerica/, 168Ã—168). Renders at the
  STAGE-4 size everywhere (Tyson: "same size as a stage 4 character") â€”
  use-display-identity forces display.stage=4 for the overlay and
  GymericaPanel's HeroStage uses stage={4}; the ART still uses the real
  1/2 stage via source props.
  MODEL: additive overlay, NOT a BranchV2 â€” Loadout/Selection gain
  character/characterStage/characterSkin (branch system fully intact).
  domain/customise: SpecialCharacterId, GYMERICA/PREMIUM_CHARACTERS,
  characterStageOptions, resolveDisplay sets a `character` overlay field
  ONLY when owned (else falls back to the branch), equipState adds a
  'buy-character' state. UI: RosterSection premium cards, a dedicated
  GymericaPanel (preview + 2 stages + 2 looks), use-display-identity
  overlay branch. NO colour-skin set for Gymerica (his 2 looks are the
  whole wardrobe).
- **MIGRATION 031 â€” the character shop:** user_character_unlocks
  (select-only RLS) + character_price() + purchase_character() (security
  definer, advisory-locked, atomic spend+unlock), same secure pattern as
  030's skin shop incl. the evoforge.spend_authorized txn-GUC (source_id
  'character:gymerica'). Applied to prod + FULLY FALSIFIED as the smoke
  user: raw unlock insert + raw spend forge both rejected, insufficient/
  unknown/duplicate rejected, a funded buy deducts exactly 10000 and
  writes the unlock, cross-user reads empty. client: data/characters.ts
  (useCharacterUnlocks + usePurchaseCharacter). TEST-FUNDING NOTE: the
  coin guard runs even for direct management-API SQL (not service_role),
  so fund a test wallet by DISABLING coin_events_guard_bi around an
  adjustment insert, then re-enable; clean up the spend+unlock+topup
  after (ALPHA restored to 225 each time).

- **CRASH HOTFIX (Tyson: "app crashes every time I click Customise",
  2026-07-16):** a loadout persisted BEFORE the Gymerica overlay fields
  existed rehydrated them as `undefined`, not null â€” and `undefined !==
  null` is TRUE, so selection.character tripped gymericaMode into
  GymericaPanel with characterSkin=undefined â†’ art lookup crash. Fixed at
  THREE layers: (1) loadout-store persist `merge` spreads DEFAULT_LOADOUT
  under the saved values so every rehydrated wallet is complete; (2)
  selectionFromLoadout defaults each field with `?? `; (3) the overlay
  checks use loose `!= null`. RULE: when you add a field to a PERSISTED
  zustand store, add a persist `merge` (or migrate) â€” a fresh account
  (my tours) never has the stale shape, so only real users hit it.

- **TURN-BASED BATTLE RPG BETA (Tyson, 2026-07-16):** a PokÃ©mon-style 1v1
  system ADDED ALONGSIDE the byte-pinned BLITZ engine (never touched it).
  domain/battle-rpg/ is a pure, deterministic engine (RNG threaded â†’ 17
  vitest pins: damage floor/defence/crit, stamina gating, priority+speed
  order, bleed tick, status expiry, regen, defeated-can't-act, victory,
  battle-over no-op, AI always-legal, gym anti-farm, stat-scaler band).
  4 champions (Elite Aesthetic/Titan/Apex/Shredded â†’ aesthetic/titan/
  cardio/shredder sprites), 4 moves each + shared Recover, 5 statuses,
  createBattleStats maps real SIZE/AES/STR/CND at a controlled 0-20% and
  NORMALISES opponents toward the player's combat power (competitive
  across Evo Ratings). Modes: Gym (Iron Foundry / Brax, defensive AI),
  Rival (simulated Vex from Forge Level), Training (no stakes). UI:
  ui/battle/* (animated sprites via transforms â€” idle bob, lunge, hit
  shake+flash, victory glow, floating damage numbers; reduced-motion
  gated), MoveGrid (2Ã—2 + Recover, unaffordable disabled), result modal,
  DEV-ONLY debug panel. Route app/(main)/battle.tsx (?mode=&gym=), 3
  cards on the Arena hub. Persistence LOCAL-FIRST (state/battle-rpg-store,
  cleared on signout) with migration 032 (battle_results/gym_progress/
  rivalry_records, applied) as the documented Supabase seam. Rewards are
  recorded locally, NOT minted into the guarded coin ledger (needs a
  server grant RPC â€” next step). CRASH LESSON: setting a Reanimated
  shared value INSIDE a withTiming completion callback stack-overflowed
  on web â€” use withSequence (the app idiom), never a callback that writes
  a value. Verified in-browser: full loop Arenaâ†’Trainingâ†’pickâ†’10-turn
  fightâ†’VICTORYâ†’+5 Forge XP; gym preview shows Brax.

- **BATTLE RPG â€” POKÃ‰MON POV + real rewards (Tyson: "make it better, POV
  facing each other", 2026-07-16):** the turn-based beta got its visual
  transformation and a secure economy.
  * POV: ui/battle/battle-pov-art.ts extracts BACK (north-east frame) and
    FRONT (south-west frame) stills from each line's rotation GIF (no new
    art) â€” the PLAYER shows their back (near, lower-left, 148px), the
    OPPONENT their front (far, upper-right, 104px). BattleArena
    (ui/battle/battle-arena.tsx) fakes depth with two platforms + a
    perspective floor + a MODE-TINTED haze (gym=orange, rival=pink,
    training=cyan), SCREEN-SHAKES on impact and WHITE-BLINKS on crits/
    ultimates. Sprites lunge on the DIAGONAL toward the foe (art already
    faces correctly â€” no mirror). Typewriter message box with TAP-TO-
    ADVANCE (useBattle.advance skips the event dwell) + a speed order hint.
  * Audio: playHit/playCrit/playHeal/playVictory/playDefeat added to
    ui/core/sound.ts (Web Audio oscillators, web-only, settings-gated,
    mixes with music), fired per battle event.
  * 3 gyms now (config): Iron Foundry/Brax, Velocity Lab/Rhea, Mirror
    Hall/Cass + a badge case on the Arena hub. All reduced-motion gated
    (verify-motion: 11 components).
- **CRITICAL SECURITY FIX â€” xp_ledger exploit (migration 033, found while
  building battle rewards):** xp_ledger_guard used `current_user not in
  ('authenticated','anon')` to detect a definer grant, but inside a
  SECURITY DEFINER trigger current_user is ALWAYS the owner â†’ the bypass
  fired for EVERY insert. A raw client POST of {event_type:'anything',
  xp_awarded:99999} LANDED VERBATIM â€” any user could mint arbitrary Forge
  XP (also a latent correctness bug: client rows stored xp_awarded 0).
  FIX: the txn-local GUC pattern (evoforge.xp_authorized='server') only
  definer grant functions set â€” forge_claim_weekly + forge_migrate_history
  updated to set it; client inserts fall to the allowlist (forces amount,
  rejects unknown kinds). SAME LESSON as the coin guard (030): NEVER gate
  a definer trigger on current_user â€” use a txn GUC or service_role.
  Falsified: the exploit + bogus workout + raw battle_win/battle_reward
  ALL rejected; legit paths intact.
- **grant_battle_reward RPC (033):** server-authoritative battle coins +
  Forge XP â€” idempotent per result key, DAILY-CAPPED (200 XP / 120 coins)
  so it can't be farmed; coin guard learns a 'battle_reward' kind admitted
  only via the spend GUC. Client: data/battle-rpg.ts (useGrantBattleReward
  â†’ invalidates wallet + Forge Level). Battle HISTORY stays local (032
  seam) for the beta. Verified in-browser: gym POV battle shows Brax
  front-facing vs your back-view champion on a tinted stage; grant is
  live + capped.

- **BATTLE RPG â€” champion locking + VERSUS + UI polish (Tyson: "lock
  unlocked champions, improve UI/animation, add vs friends", 2026-07-16):**
  * LOCKING: domain/battle-rpg/unlock.ts (unlockedChampionSet /
    championRequirement) reuses the CUSTOMISE roster's live branch gates â€”
    a battle champion is playable iff its branch is unlocked. The picker
    (ui/battle/champion-picker.tsx) dims locked champions, shows a padlock
    + the nearest gate ("STRENGTH 55+"), and can't select them. A picked-
    but-now-locked champion falls back to the derived class.
  * VERSUS (pass-and-play, mode 'versus'): two humans on one device. The
    hook (use-battle) collects P1's move then P2's before resolving (no AI,
    reuses resolveTurn). A "PASS TO PLAYER 2" gate hides P1's pick until P2
    taps (derived from turnNumber â€” no setState-in-effect). P2 may pick ANY
    champion (guest); P1 is unlock-gated. Versus pays NOTHING (rewardsFor
    'versus' â†’ 0/0), no rival/gym markers, result modal says PLAYER 1/2
    WINS. Scaling maps versusâ†’training. Arena hub gains a VERSUS card.
  * UI/animation: a VS intro splash (ui/battle/vs-intro.tsx â€” champions
    slide in, VS flashes, reduced-motion gated); champion cards show HP/PWR/
    SPD mini-bars; the HP bar gained a classic "ghost" damage trail + a red
    low-HP state. verify-motion: 11 components.
  Verified in-browser: Aesthetic unlocked, the other 3 locked with gates;
  VS preview (P1 vs P2 pickers), the pass-device gate, and a resolved
  versus turn â€” zero page errors.

- **VERSUS BY CODE â€” async friend battles (Tyson: "it was meant to be VS
  join by code", migration 034, 2026-07-16):** create a challenge from your
  champion â†’ get a 6-char code â†’ a friend JOINS by code from their OWN
  device and battles YOUR champion (AI-driven from your real saved stats).
  Wins/losses post back (record_rpg_challenge_result) so you see how your
  champion fares. rpg_challenges (owner-RLS) + 3 definer RPCs
  (create/get/record â€” cross-user join goes through get_rpg_challenge, not
  the table). Code gen = md5 hex (pgcrypto gen_random_bytes is NOT enabled
  â€” use md5(random()||clock_timestamp())). FALSIFIED across two accounts:
  create â†’ cross-user join â†’ RAW table read blocked by RLS â†’ record â†’
  owner sees plays/defeats â†’ unknown code safe â†’ owner self-play not
  counted. Client: data/battle-rpg-challenge.ts, ui/battle/challenge-hub
  (CREATE/JOIN tabs + a code display + a same-device pass-and-play link).
  Battle: mode 'challenge' builds the opponent from the CHALLENGER's real
  input (capStats clamps power â‰¤1.35Ã— the joiner so it's tough not
  impossible); no reward (bragging rights); result posts back. The Arena
  "VERSUS Â· BY CODE" card opens the hub (pass-and-play kept as a
  same-device option). Verified in-browser 2-account: ALPHA created a
  code, BRAVO joined + fought ALPHA's champion to a result. LIVE
  move-by-move PvP remains the documented next step.

- **THE PALETTE SHOP (Tyson: "sell reskins of the entire website â€” colour
  palettes bought with forge coins, own for life, equip or remove whenever",
  migration 044, 2026-07-17):** whole-app recolours, per athlete. Six
  palettes â€” emerald 500 / crimson 750 / synthwave 1000 / solar 1250 /
  arctic 1500 / void 2000 (ascending) â€” sold by `purchase_palette()` +
  `palette_price()` on the exact 030/031 secure pattern (advisory lock,
  balance check, the `evoforge.spend_authorized` txn-GUC; ZERO coin-guard
  changes) into select-only-RLS `user_palette_unlocks`.
  THE THEMING LAYER: tailwind colour utilities now resolve through
  `var(--c-<key>, <standard>)` (generated in tailwind.config.js from
  tokens.js, which is UNTOUCHED â€” verify-tokens holds); `ui/core/theme-root`
  applies the active palette as NativeWind `vars()` + web
  `document.documentElement` properties (RN-web Modals portal outside the
  tree), so ~850 className usages restyle with zero per-file work. Every
  inline `tokens.colors` read (785 across 90 files) was AST-codemodded to
  `useThemeColors()` (`theme/use-theme`, fed by `state/theme-store`).
  `theme/palettes.ts` carries the colour records â€” rarity + success/warn/
  danger are PINNED IDENTICAL in every palette (rarity is a cross-app
  vocabulary; semantic colours encode meaning). CUSTOMISE gains a THEMES
  tab: tapping a card previews the palette APP-WIDE while the screen is
  focused (ownership-free try-before-you-buy; blur/unmount restores), BUY
  rides the coin ledger (invalidates wallet + unlocks + history), EQUIP
  persists `loadout.paletteId`, and `resolveActivePalette`
  (domain/customise) re-validates ownership on EVERY read â€” an unowned
  equipped palette silently renders standard. RULE THE WRAPPER CREATES:
  Tailwind cannot alpha-transform a var() colour, so a colour class with an
  opacity modifier (`/40`) silently generates NOTHING â€” verify-tokens now
  walks src and fails on any; use inline hex-alpha suffixes. NOT themed in
  v1 (deliberate): glow/shadow tokens (`--glow-*` vars are the v2 seam),
  +html.tsx boot colours (pre-hydration), sprite art, AURAS/GYMERICA
  literals. Falsified: the full 044 checklist as ALPHA/BRAVO (raw inserts
  rejected, exact deduction, duplicate/unfunded/unknown refused, cross-user
  empty) + a 15-check Playwright tour (preview cycling recolours the live
  page, wallet 1225â†’475 on a 750 buy, /coins agrees, reload survival,
  standard revert, sign-out teardown; screenshots in
  Downloads/evoforge-screenshots/palette-*). Artifacts deleted, ALPHA
  restored to 225.

- **ORIGIN CLASSIFICATION v3 + THE GLOBAL RE-ASSESSMENT (Tyson: "most
  characters' origin having to be aestheticsâ€¦ more varietyâ€¦ every current
  player is required to get a new evo rating and origin character",
  migration 045, 2026-07-17):** v1/v2 compared the four pillar scores RAW,
  and the pillars live on different effective scales (production 2026-07-17:
  aesthetics averaged 60.6 and beat size on 10/10 rating rows; strength/
  cardio bottom out at provisional floors) â€” so 3/3 assigned origins were
  aesthetic. v3 ranks CALIBRATED AFFINITIES (score âˆ’ per-pillar baseline:
  aesthetic 60 Â· mass 52 Â· titan 50 Â· cardio 48, versioned in the function
  like the strength reference curves), gates recommendation on per-pillar
  confidence â‰¥ 25 (no Apex Engine without a single logged run â€” the pillar
  still SHOWS in the breakdown), and adds Tyson's Shredder rule: cutting
  phase + fresh (â‰¤90d) bf_mid â‰¥ 20% male / 28% female â†’ THE SHREDDER,
  outright; cutters below the threshold keep shredder_eligible as before.
  Choice margins (â‰¤8 spread / top-two â‰¤5) now ride the affinities.
  `classify_evo_path_for(uuid)` is the core (service-role only);
  `classify_evo_path()` keeps its exact client signature and returns new
  `affinities`/`ranking`/`shredder_auto` fields (origin-panel sorts the
  score chips by ranking, not raw score â€” raw-desc order would contradict
  the recommendation). `require_origin_reassessment_v3(dry_run)` EXECUTED
  LIVE 2026-07-17: all 3 assigned origins (all aesthetic) retired to
  needs_assessment with previous state archived to user_path_migration_log
  (migration_version 3), is_origin cleared, EARNED user_paths
  stages/unlocks untouched (verified: stages 2â€“4 all survived), re-run = 0
  (idempotent). Every account now re-discovers its origin through the
  existing machinery: sign-in scan prompt + Home podium button â†’ new Evo
  scan (origin-unset cooldown exception reopens it) â†’ v3 reveal â†’ claim
  equips. Falsified on production: the 3 scan accounts now classify
  titan/titan/mass (was aesthetic Ã—3); smoke-account shredder positive
  (cutting + bf 24 â†’ shredder outright) and both negatives (bf 15 â†’
  choice, bulking â†’ ineligible); staged rows deleted after. plpgsql trap
  for the next reader: a bare `CASE â€¦ THEN` inside an `IF` condition eats
  the IF's THEN â€” parenthesise the CASE.

- **ORIGIN CHOICE (raw Â±5) + THE ORIGIN LOCK (Tyson live feedback,
  migration 046, 2026-07-17):** "I somehow got given Titanâ€¦ if the top stat
  is within Â±5 of another, let the player decide; the only equipable
  character from then on is the origin character." classify_evo_path v4:
  the choice set = every evidenced pillar within 5 RAW points of the
  evidenced raw max (affinity top always included; >1 member â†’ the player
  decides); recommendation/ranking still ride the 045 affinities; Tyson's
  own row now offers titan+mass+aesthetic (verified live) and his v3 titan
  claim was reset to re-choose. THE ORIGIN LOCK: server-side,
  set_active_champion refuses any non-origin path ('origin_locked' â€”
  falsified with forged JWT claims both directions); client-side, ONE seam
  (buildRoster's originPath param + originAsBranch) locks customise equip,
  stage ladders, and battle champion select (unlockedChampionSet), while
  resolveDisplay pins the displayed branch, ghost publishes + versus
  snapshots carry the origin branch, and path-sync mirrors the ORIGIN
  line's derived stage as the active champion. DECISION: premium
  characters (Gymerica) remain equipable â€” purchased overlays, not path
  champions; non-origin lines keep progress/purchases, they just cannot
  render. Verified: 778 vitest (new origin-lock describe), tsc, lint, and
  a Playwright tour with a titan-origin smoke account (Home podium =
  titan champion; customise roster 1/9 unlocked, others LOCKED; battle
  select ORIGIN LOCKED; smoke restored after).

- **THE 09:34 INCIDENT â€” scan auto-claim vs the choice rule (2026-07-17,
  same evening):** Tyson reported "still stuck as Titan, the origin scan
  has not come up". Root cause in the AUDIT TRAIL (user_path_migration_log
  + evo_assessments raw snapshots): evo-scan.tsx's 042-era auto-claim
  assigned the RECOMMENDED path ~300ms after every scan, ignoring
  requires_choice â€” his scan at 09:34 classified as a three-way choice and
  the client claimed Titan anyway; and the once-per-day prompt key had
  already burned for the day, so no nudge either. FIXES (client-only, the
  server was correct): (1) the scan auto-claims ONLY when requires_choice
  is false (shredder_auto included) â€” a close call toasts "YOUR SCORES ARE
  CLOSE" and routes to the Forge reveal where the choice buttons live;
  (2) the prompt's day-key now stores date|origin:migration_status, so an
  origin RESET re-prompts the same day; (3) when classification is already
  open, the prompt modal AND the Home gold button read CHOOSE YOUR ORIGIN
  and route to /avatar (the Forge reveal) instead of another scan. His
  titan claim was reset a third time â€” next launch he lands in the choice.

- **THE 047 PROGRAM â€” ORIGIN IN ONBOARDING (candidate model v5, 2026-07-17,
  takeover of an interrupted session):** the full program docs live in  `docs/ORIGIN_*.md` (7 specs + `ORIGIN_HANDOFF_AUDIT.md`, the takeover
  audit). SHIPPED: migration 047 (profile: primary_goal/battle_style/
  onboarding_flow_version/firstbound_origin/reforge_granted_at/reforge_used_at
  + write-once guard; user_paths + user_champion_bond monotonic guards;
  bond table owner-SELECT-only; `origin_candidates_compute(jsonb)` â€” the
  PURE SQL twin of `client/src/domain/origin/candidates.ts`, pinned by 21
  goldens in `contracts/fixtures/origin_candidates.json`
  (`tools/replay_origin_goldens.py`: 21/21 EXACT); `origin_candidates_for/
  origin_candidates`; `assign_origin_path` v5 â€” advisory-locked now,
  already_assigned success-shaped, validates against a FRESH candidate
  generation or the v4 choice set; `claim_free_reforge`/`reforge_origin`).
  Falsified live (`tools/falsify_origin_047.py`: 32/32, throwaway account
  deleted after). Client: onboarding is now TWO ACTS â€” Act I form gains the
  DRIVE section (goal + battle style), insert stamps
  onboarding_flow_version=2; Act II is `ui/origin/origin-flow.tsx`
  (rating reveal â†’ 3 candidate cards â†’ confirm â†’ bind â†’ awakening â†’ Home);
  the (main) gate bounces flow-v2 origin-less users back (legacy users
  untouched â€” flow version NULL). Existing users get the candidate reveal
  on the Forge page behind ORIGIN_FLAGS.candidateRevealEnabled; ReforgeCard
  ships the free reforge (claim on visit, KEEP = dismiss). First mission:
  binding seeds the origin split rotated so today = training day 1 (only
  when the user skipped the split step). Analytics: `data/analytics.ts`
  track() + the ORIGIN_ANALYTICS vocabulary.
  **GOTCHAS:** (1) `useBindOrigin` must NOT invalidate ['profile'] on
  success â€” onboarding's legacy redirect reads profile.data and an early
  refetch yanks the athlete out of the awakening mid-ceremony (the O-series
  tour caught it); OriginFlow.onComplete invalidates + navigates. (2) The
  plpgsql CASE-in-IF trap (045's note) bit again in 047 â€” parenthesise.
  (3) JS Math.round = floor(x+0.5), NOT Postgres round() â€” the SQL twin
  uses floor(x+0.5) everywhere or .5 boundaries drift. (4) O-series tour:
  `tools/tour_origin_onboarding.py` (throwaway account, screenshots to
  Downloads/evoforge-screenshots).

- **048 â€” ORIGIN DATA IS EXCLUSIVE (Tyson, 2026-07-17, same evening):**
  "nobody should have any data on any character other than their origin."
  Reverses 046's "non-origin lines keep progress" AND 047's "old origin
  stays collected": `assign_origin_path` v5 and `reforge_origin` now DELETE
  every non-origin user_paths row and every non-origin-champion bond row
  at bind. Purchases (skins/palettes/Gymerica) and firstbound_origin are
  never touched. One-off cleanup applied for existing origin-havers
  (Tyson: aesthetic 3 + titan 3 wiped; shredder kept â€” he had just used
  the free Reforge titanâ†’shredder, the FIRST real reforge, and asked why
  shredder was stage 3: the reforge grants stage 1, then path-sync mirrors
  the DERIVED stage from real stats, preserve-higher, by 046 design).
  Origin-LESS users' legacy rows are UNTOUCHED â€” they have no origin yet;
  their rows wipe when they bind (048's assign delete). Falsified 5/5
  (legacy row wiped on bind, old origin wiped not collected on reforge,
  bond follows the new champion). FOLLOW-UP (same evening): the wipe
  resurrected â€” `path-sync.ts` still recorded the DERIVED (non-origin)
  branch "as roster truth" on every Forge visit (046-era comment). Now,
  with an origin set, it mirrors ONLY the origin line; the legacy mirror
  stays for origin-less users. Grep before declaring any wipe durable:
  `record_path_progress` had exactly one call site. Docs updated:
  EXISTING_USER_ORIGIN_MIGRATION Â§4, ORIGIN_DATA_MODEL Â§5.

- **ROUTE ERROR BOUNDARY (2026-07-19, Tyson: "screen is all background
  colour" entering a workout / edit week):** with web asyncRoutes every
  route is a lazy chunk and NOTHING caught a failed load or a render throw
  â€” the screen stayed bare background. Now `ui/core/route-error-boundary`
  is exported as `ErrorBoundary` from BOTH `app/_layout.tsx` and
  `app/(main)/_layout.tsx` (the (main) copy recovers without unmounting
  query/auth/theme providers). `domain/chunk-error.ts` recognises chunk
  failures â€” Metro's REAL message is `AsyncRequireError: Loading module â€¦
  failed` (captured live by deleting a route chunk from a served dist; the
  webpack shapes are kept for other surfaces) â€” and `ui/core/error-screen`
  auto-reloads ONCE for those (localStorage `evoforge-chunk-reload-at`,
  5-min cap, its own key â€” NOT version-guard's), renders UPDATINGâ€¦; any
  other error renders SOMETHING BROKE + RETRY (no animation on purpose).
  Falsified: chunk deleted â†’ boundary caught it, reload fired once and
  the cap held; ordinary messages do NOT match (reload loops on real
  bugs would be worse than the blank screen).

- **HOME REWORK (Tyson's improvement doc Â§1, 2026-07-19):** CUSTOMISE is the
  hero action now â€” `QuickAction size='hero'` (~112px, icon 32, pixel-16
  label; the overlay action column widened 100â†’140, and on <380px it owns a
  full wrap-row) with the FORGE-COIN balance riding beneath it
  (`hero-coins`): CoinIcon + `formatCompact()` from NEW `domain/format.ts`
  (13120â†’13.1K, â‰¤3 significant digits, display-only, vitest-pinned; null
  wallet renders NOTHING, never 0). The hero TIER badge is GONE (form/next-
  evolution moved up) and so is the status-grid TIER fallback (with Rival
  Rank off the grid is 3 cards). The build section always shows the RADAR
  (BARS view + toggle deleted; StatBar itself lives on â€” evo.tsx and the
  customise preview still use it) and the "Weak point focus" line is gone
  (`weakPointFocus` still computed in avatar-stats-calc for the Oracle).
  Toured at 390+320 via origin READ-interception (ALPHA's origin is reset;
  the FORGE YOUR ORIGIN state hides hero actions â€” intercept
  `profile*origin_path*` to tour the real hero).

- **CUSTOM MEAL TYPES (improvement doc Â§8.5, migration 056, 2026-07-19):**
  `nutrition_prefs` (one row/athlete, owner-only RLS, jsonb `meal_names`
  CHECKed by `nutrition_meal_names_ok` â€” array â‰¤12, strings 1..24 chars or
  null) carries the athlete's own slot names; `mealSlotName(slot, names)`
  consults them first (uppercased, clamped, garbage-safe â€” vitest-pinned).
  `useMealNames`/`useSaveMealNames` in data/nutrition.ts; âœŽ RENAME lives in
  the expanded slot (empty = restore default), and the ASSIGN picker offers
  every named slot even when the device's local meal count lags (count =
  max(4, local, names.length) â€” names are server truth, count is local).
  Applied + falsified 6/6 (13 names / 25 chars / non-string / cross-user /
  forged user_id all rejected); toured live: rename â†’ reload survival â†’
  picker chip â†’ default restored.

- **CARDIO CALORIES (improvement doc Â§4, migration 057, 2026-07-19):**
  `cardio_log.count_toward_budget boolean default true` â€” after LOG with
  calories > 0 the form asks "add ~N kcal back to today's fuel budget?";
  NO stores the burn with the flag false (writing calories=0 would have
  destroyed the record), YES/no-dialog keep today's behaviour.
  `useCaloriesBurned` filters on the flag client-side. NEW pure
  `domain/cardio-estimate.ts::estimateCardioKcal` (Compendium METs keyed on
  the activity catalogue types, kcal = METÃ—3.5Ã—bw/200Ã—min, vitest-pinned)
  drives an EST. pill beside the CALORIES field â€” REAL bodyweight only
  (profile â†’ latest log; without one the pill is disabled with the reason,
  never a fake number); the fill stays editable. Falsified live: two 1-min
  sessions landed flags [false,true], read back as ALPHA, deleted after.

- **SOCIAL ROUND 2 (improvement doc Â§6, migrations 058/059/060, 2026-07-19):**
  * **058 comment interactions** â€” comments carry the SAME four reactions as
    posts (`social_comment_reactions`, 049's exact posture; definer
    `toggle_comment_reaction` re-checks PARENT-POST visibility) and take
    ONE-level replies (`social_comments.parent_id`, depth guard rejects
    reply-to-reply). The notifications type CHECK was widened FIRST (the 054
    rollback lesson) with `comment_reaction`/`comment_reply`; a reply
    notifies the parent comment's author (052 already tells the post
    author). `post_comments` returns parent_id + reaction_count +
    my_reaction. Client: `groupCommentThreads` (orphaned replies surface
    top-level, never vanish; pinned), optimistic `useToggleCommentReaction`,
    `CommentReactionRow` + reply-targeting composer in the comments modal.
  * **059 reports** â€” `social_reports` (reason CHECK, â‰¤300 note,
    unique(reporter,post)), INSERT-only RLS, **NO client select** (service-
    role review only). Record-only v1 ON PURPOSE: auto-hide without review
    tooling would be a mocked moderation system. The â‹¯ on OTHERS' posts
    opens the report sheet; duplicates read "already reported".
  * **060 username search** â€” `search_athletes(q)` mirrors
    discover_athletes' exposure (is_public AND discoverable, the
    request_friend gate â€” search can never surface an athlete ADD then
    refuses), prefix-ranked. ADD BY USERNAME card on the friends screen.
  * **Username mandatory (Tyson's call):** onboarding's name field is
    always-on + required and saves BEFORE the profile insert â€” a taken name
    (004's case-insensitive unique index, falsified) blocks with an inline
    re-prompt instead of the old silent catch. GO PUBLIC stays visibility-
    only. Legacy no-name accounts get a CLAIM YOUR NAME card on Social
    (browse open, posting waits; claims save PRIVATE).
  * The ðŸ”” emoji became `PixelBell` (the PixelGlyph set).
  All falsified live (18/18 server checks + duplicate-name clash + a full
  postâ†’commentâ†’hypeâ†’reply tour as ALPHA; every seed deleted/purged).

- **BODYWEIGHT SETS â€” 0 kg IS A SET (improvement doc Â§3.1, migration 061,
  2026-07-19):** THE RULE, everywhere at once â€” a COUNTED set is
  `weight >= 0 (non-null) AND reps > 0`; PR/e1RM/lift-chart paths keep
  `weight > 0` (a 0 kg set earns its flat 10 XP but can never be a PR, and
  battle_events_guard is UNCHANGED on purpose â€” 0 kg moves no weight in a
  lift battle). 061 recreated SIX live functions with only the predicate
  edited (xp_events_guard set-branch, coin_events_guard workout_complete
  [PR sites untouched], leaderboard_top's derived oracle, forge_claim_weekly,
  scheduled_streak, claim_free_reforge) â€” guard and oracle move in ONE
  transaction or honest accounts read as drift. NO BACKFILL: zero historic
  weight=0 rows existed (both sides refused them until now). Client:
  `isCountedSet(weight, reps)` in domain/workouts.ts is THE predicate
  (null/garbage weight is NOT zero â€” pyFloat semantics; vitest-pinned) and
  every counting surface routes through it (summary, setsFor, validRowsFor,
  week-status, session-plan via the screens, scheduled-streak,
  workout-estimates, exercise-history, digestHistory, progress
  periodTotals, muscleHeatMap, workoutPostPayload, decideSetSave, the
  logger guards). Charts and recent-pr deliberately keep weight>0. History
  labels read "Last: BW Ã— 12" for 0 kg. The retired Python reference
  (domain/workouts.py) swept to match. Falsified: server suite (0kg mint
  lands at amount 10; 0-rep refused; PR refused; ALPHA's drift UNCHANGED
  by the set+mint pair â€” oracle moved with the guard) + a real UI log on
  production (1/3 SETS, +10 XP, rest timer fired); seeds deleted (each
  deleted granted set leaves its append-only mint â€” ALPHA's permanent
  smoke drift grew by design, the drift gate is its own falsification).

- **AUDIT FIX BATCH â€” PHASE 1: the six bugs (migrations 062+063, 2026-07-19):**
  * **A2** the ONLINE finish path now awards the Forge workout_completed XP
    (sessions.ts onSuccess â†’ the idempotent awardForFinish; only the offline
    queue flush did before â€” lifetime XP depended on wifi).
  * **A3/C2 (062)** ONE HOME FOR PLANS: user_plans is the only plan store.
    062 one-shot-copied every surviving legacy custom_workout_plan into the
    slot the client would have resolved (groupPlanRows + looksLikeAiPlan
    ported to SQL; idempotent; falsified â€” canonical 6-day â†’ 'ai' in week
    order, personal splits â†’ 'custom'). Client: resolvePlanSources lost its
    legacyPlan input, useCustomPlan deleted, DISCARD deletes the real home
    (the audit's half-delete bug), the blitz page reads user_plans.ai.
    custom_workout_plan is RETIRED â€” never write it again.
  * **A4** origin first-mission seeding invalidates user_plans +
    workout_schedule (Train updates immediately, no reload).
  * **A5/C3/C4** NEW data/keys.ts â€” TABLE_READERS + invalidateTable(): the
    map of every query key reading a table, so a mutation can't miss a
    reader (register new hooks' keys there!). Wired: identity+privacy saves
    refresh ALL five public_profile readers; the PR coin claim refreshes
    /coins history; the Evo review refreshes player_stats; a damage verdict
    refreshes XP readers. profile keeps its documented bind-ceremony
    exception.
  * **A6** NEW domain/bodyweight-current.ts::currentBodyweightKg â€” THE one
    chain (latest log â†’ profile â†’ null; callers own defaults), wired into
    Home, Train, cardio EST, current-stats, avatar-data. Home/Train
    previously trusted the ONBOARDING snapshot over fresher logged
    readings. En route: Home's mission counter got the missed 061
    counted-set predicate (it disagreed with Train about 0 kg sets).
  * **A1 (063)** LIVE LEVELS: public_athlete_profile / discover_athletes /
    search_athletes now serve forge_level_for_xp(user_progression
    .lifetime_xp) computed AT READ TIME, and the profile evo block reads
    evo_rating_current (4 live pillars). avatar_progression (written by
    nothing, frozen) is out of every social read. FALSIFICATION CATCH: the
    forge_level COLUMN is a greatest()-ratcheted cache still holding
    pre-033-exploit inflation (ALPHA: column 38, honest level 2) â€” NEVER
    serve that column; compute from lifetime_xp.

- **AUDIT FIX BATCH â€” PHASE 2: Supabase efficiency (064, 2026-07-19):**
  * **B7** latest-value reads bounded: measurements (newest-first 120-row
    window, per-column-latest preserved), physique ratings (desc limit 1),
    bodyfat series (newest 90, reversed â€” ascending contract holds; note:
    the Shredder STARTING reading is now earliest-in-window), bodyweight
    (newest 180, reversed). No more 2500-row pulls for one number.
  * **C8** the achievement sweep reuses the workout_log CACHE â€” the
    just-saved row rides along explicitly (the fresh-row rule its header
    demands survives); the Evo review accepts cachedWorkoutRows from its
    two callers instead of an unbounded refetch.
  * **C6** rival-settle accepts battleIds[] (â‰¤10, single-id compat kept) â€”
    reconciliation is ONE call, not one per battle. **commit_evo_review()
    (064):** the review persists in ONE definer RPC â€” core (snapshot +
    current + evidence) unguarded, riders (chapters/stats/traits/audit/
    analytics) exception-guarded server-side, evo_class written once in
    the txn (C1's drift window closed), maintainChapters ported verbatim
    into plpgsql. ALL RULE MATH stays in the pinned client domain fns â€”
    the RPC is pure persistence. Falsified: clean commit, malformed rider
    never loses the core, peak-ratchet fires inside the RPC.

- **AUDIT FIX BATCH â€” PHASE 3: performance (2026-07-19):**
  * **B2** global `staleTime: 45s` (QueryClient defaults) â€” the six mounted
    tabs no longer refetch everything on every window refocus; mutations
    still repaint instantly via keys.ts invalidation. Per-hook overrides
    survive.
  * **B1/B3/B11** NEW `domain/workout-index.ts` (buildWorkoutIndex â€”
    rows/byDate/byDateWorkout/countedByDateWorkout, vitest-pinned) exposed
    as `useWorkoutIndex()` via TanStack `select` on the SAME
    ['workout_log'] cache entry: Train's carousel cards + week bars and
    Home's mission counter are O(1) lookups now (was ~12 full 2500-row
    scans per Train render, ~5 re-normalisations per Home render). The
    061 counted-set rule lives in the index, so Home and Train literally
    share one source.
  * **B4** the 308-entry skin require tables split into per-line LAZY
    modules (`ui/character/skins/*`, dynamic import + module cache;
    resolvers stay synchronous and fall back to base art for in-flight
    frames â€” the seam the skin system already had). `useSkinsReady()`
    repaints Home/Forge/customise when a chunk lands. __common: 2.72MB â†’
    2.65MB (âˆ’68KB) + six on-demand chunks; the skins' asset registrations
    left the boot path entirely.
  * **B5** the scene janitor is EVENT-DRIVEN (MutationObserver on
    aria-hidden + 5s safety sweep â€” was a 250ms forever-poll of
    querySelectorAll+getComputedStyle); the nav-freeze beacon stops after
    its 3 reports or 10 minutes.
  * **B6** the social feed is a virtualised FlatList (`FlatListShell` in
    ui/core/shell â€” ScreenShell's exact frame around a FlatList; header
    content rides ListHeaderComponent; LOAD MORE became infinite scroll).
  * **B8** hand-written useMemos removed from progress/goals/streak/
    create-post (the compiler rule); line-chart's geometry memo and
    shell's useFocusEffect callback stay deliberately. En route:
    progress.tsx's exercise list got the missed 061 predicate (bodyweight
    exercises now appear).
  * **B9** ONE rest-timer tick (module interval, acquire/release on live
    clocks) â€” the inline bar and floating pill are subscribers, not
    timers.
  * **DEFERRED to the battle session:** B10 (battle select('*') +
    interval gates), battle-file memos, battle-pov lazy-loading.

- **AUDIT FIX BATCH â€” PHASE 4: repo leaning (2026-07-19, Tyson's D1 call):**
  * **THE STREAMLIT APP IS DELETED from this branch** (history lives on
    main): verify.yml + its 13 verify_*.py + shot.py, app.py, views/,
    services/, .streamlit/, sprite_test/ (5.4M), avatar_assets/ (4.8M),
    sprites.png (1.8M), requirements.txt â€” ~12.7MB and eleven CI checks
    per push gone. **KEPT, load-bearing:** domain/*.py + config/
    constants.py + contracts/ + tools/gen_fixtures.py (the goldens
    contract â€” verified 4,832 cases green after the deletion), root
    data/ + auth/ + ui/ (gen_fixtures' import chain; auth is a lazy
    function-scope import), assets/styles.css (verify-tokens parity),
    requirements-dev.txt (the fixtures job installs it), tools/hooks/
    (protected-path list rewritten for the new world). CLAUDE.md
    rewritten around the surviving contracts.
  * Executed plan docs (15 files, ~250KB incl. HANDOFF.md and the 68K
    IMPROVEMENT_PLAN) â†’ docs/archive/. Six one-shot tools â†’
    tools/archive/. reset-project.js + Expo/React template images gone.
  * Six unused npm deps removed (@expo/ui, expo-blur, expo-device,
    expo-glass-effect, expo-symbols, expo-web-browser).
  * Dead flags deleted: ghostMatchesEnabled/playerStatsGameplayEnabled
    (zero refs) and showLoadout + the LOADOUT branch. ORIGIN_FLAGS stay
    (all-true but their conditions guard live ceremony logic â€” collapsing
    them is riskier than the win; deliberate deviation from D4).
  * The 4 orphaned aesthetic_stage_N.png removed (zero refs incl.
    dynamic); helpers consolidated â€” ONE addDaysIso (domain/today) and
    ONE Epley (e1rmFor delegates to estimated1rm, keeping its repsâ‰¤10
    evidence guard).
  * **Two post-push corrections the deletion forced:** tools/hooks/
    pre-push's Python gate is now `gen_fixtures.py --check` (it still
    enumerated the 11 deleted verify scripts and blocked its own push),
    and **requirements.txt is back as a SLIM file** â€” the goldens
    import-chain pins only. Two things need the FILE to exist:
    requirements-dev.txt `-r`-includes it, and the fixtures job's
    setup-python `cache: pip` HARD-FAILS the job when its default glob
    (**/requirements.txt|pyproject.toml) matches nothing â€” that skipped
    a deploy once (run 29677670014). Don't delete it again; a workflow
    fix was not pushable (git/gh tokens here lack `workflow` scope â€”
    remember that before editing .github/workflows/*).

- **MULTI-WORKOUT SCHEDULE â€” MIGRATION 065 (applied 2026-07-20):**
  * **The wire shape**: `workout_schedule.plan` values widen from a single
    string to `string | string[]` â€” `[primary, ...extras]`, slot 0 may be
    `'Rest'`, extras never are (built-in day names or `routines` names). A
    day with NO extras still serializes as a plain string, byte-identical
    to every pre-065 row: no backfill, no table DDL, no RLS change.
  * **Semantics (TS lockstep: `client/src/domain/scheduled-streak.ts`)**:
    a date is SCHEDULED iff it has â‰¥1 non-Rest entry ('Rest'+extra IS a
    training day â€” stricter streak, the schedule page says so); TRAINED
    stays day-granular (any counted set that date preserves the streak).
    `scheduled_streak()` redefined on **061's** body (`weight >= 0` â€” NOT
    012's, which would revert the bodyweight fix): array values yield
    their first non-Rest entry, scalars read as before.
  * **En-route find: 012's revoke never worked.** `revoke ... from
    authenticated, anon` left the default PUBLIC execute grant
    (`=X/postgres`) â€” clients could call scheduled_streak since 012. 065
    revokes from `public` too; falsified live (has_function_privilege
    trueâ†’false; postgres/service_role keep execute, the 013 coin guard is
    definer-owned and unaffected).
  * Falsified as ALPHA: streak before/after identical on scalar rows
    (0/null); seeded backdated array row over ALPHA's real 07-11..13
    history â†’ extra-only trained days extend, primary+extra counts ONCE,
    extra-only untrained breaks (probe: length 3, run_start 07-11),
    scalar 'Rest' inside a mixed plan bridges; seed deleted, ALPHA
    restored (2 rows, 0/null). Client (editor add/remove, week extra
    bars, quick-workout save prompt) lands in the following commits.
  * **Client (same program, later commits):** `dayWorkouts()` in
    `domain/scheduled-streak.ts` is THE normalizer â€” every plan reader
    goes through it. `scheduledDayFor` PROMOTES the first non-Rest entry
    (a ['Rest','Core'] Sunday is a Core day on every primary surface);
    `scheduledExtrasFor`/`extraScheduledBars` carry the rest as bars
    beneath the day's primary (today's extras are `in_progress` â€” that
    status alone is the blue highlight, `week-bar.tsx` unchanged).
    `extraBarsForToday` now takes an exclusion LIST (primary + extras) so
    a trained scheduled extra never doubles as an ad-hoc bar; a
    swapped-AWAY stored name deliberately stays eligible. `resolveDayIn`
    falls back to SAVED ROUTINES last (case-insensitive; plan sources WIN
    over a same-named routine â€” equal names are one workout_log grouping
    key); the workout page labels that case FROM MY ROUTINES.
    `serializePlan` (data/schedule.ts) keeps extra-less days as plain
    strings on the wire. Editor (`schedule.tsx`): chips = primary slot;
    extras listed with âœ• remove + "+ ADD WORKOUT" bottom-sheet picker
    (BUILT-IN DAYS + MY ROUTINES, day's names excluded, deleted-routine
    refs flagged âš  but removable); `?add=<name>` appends to TODAY's
    weekday unsaved and glows the card â€” the athlete still presses SAVE.
    Streak strictness note added to the page copy. Extras never inflate
    weeklyContract (one pip per day, deliberate).
  * **Quick-workout save prompt:** finishing an AD-HOC workout offers to
    keep it â€” `state/save-routine-prompt-store.ts` (ephemeral, reset on
    sign-out) + `ui/train/save-routine-prompt.tsx` (three steps: save? â†’
    name it [defaults to the ad-hoc name; duplicate keeps the step open]
    â†’ add to schedule? â†’ `/schedule?add=<name>`), mounted in
    `(main)/_layout`. Offered from `workout.tsx finish()` only when
    something was performed, the ceremony's own SAVE AS ROUTINE didn't
    already fire (`savedInCeremonyRef`), and no routine already owns the
    name (strip a `" (today)"` suffix first â€” restarted routines never
    re-prompt). NOTE: the SHARE prompt's modal mounts after ours (its
    offer lands async from the finish mutation) so it stacks ON TOP â€”
    dismissing it reveals the save prompt beneath; accepted, not a bug.
  * **The `?add=` seed race (fixed during the tour):** schedule.tsx's
    seed effect and the add-append MUST be one effect â€” as two, the
    deferred seed overwrote the appended extra. Toured LIVE vs prod as
    ALPHA (quick workout â†’ prompt â†’ save â†’ pre-added on /schedule â†’ SAVE
    â†’ extra bar beneath Monday's, FROM MY ROUTINES on open â†’ remove â†’
    SAVE â†’ scalar wire shape restored). Every seeded row deleted; ALPHA
    restored (2 schedule rows, streak 0/null). Tour gotchas for next
    time: the ORIGIN sheet re-prompts EVERY sign-in and eats clicks
    (dismiss `origin-scan-later` before interacting); `todayIso()` is the
    LOCAL calendar date â€” Playwright must use `getDay()`, not
    `getUTCDay()`, when computing the app's weekday.

- **FUEL CONVERTER CALCULATOR (2026-07-20):** both sides of the KJâ‡„KCAL
  converter take label arithmetic â€” "435*5" converts the five-serving
  total; + âˆ’ Ã— Ã· with normal precedence, decimals, unary minus.
  `evalEnergyExpression` (`domain/nutrition.ts`, pure, tested) is the ONE
  evaluator: keypad glyphs (Ã— Ã· âˆ’) and x/X normalize to * and /; a
  TRAILING operator evaluates the complete prefix (no mid-typing flicker
  on the other side); malformed input / division-by-zero â†’ null, never
  NaN. `NumberField`/`KeyPad` gained an opt-in `calculator` prop: the
  touch keypad grows a + âˆ’ Ã— Ã· row and a live `= total` line, the
  first-keystroke-replaces rule is suspended for operators ("Ã—5" over a
  seeded 435 means 435Ã—5), and the steppers act on the EVALUATED result
  (collapsing the expression â€” calculator convention). Toured on desktop
  (typed) and touch (keypad) against the real build.
  **Second pass (same day): the QUICK LOG amount field opted in too**, and
  entry now COLLAPSES to the result â€” keypad DONE and desktop blur both
  replace "435Ã—5" with "2175" (`collapseExpression` in number-field), so
  the box, the logged row, and the day's history all carry the NUMBER
  (falsified live: the seeded nutrition_log row read kcal=520 from a kJ
  expression, then deleted). `enteredKcal`/`bump` evaluate expressions, so
  +N chips and LOG IT work mid-equation. The quick-log card was reordered
  around prominence: the energy field is first, centered and `big` (62px,
  24px face, "maths ok" hint); label + meal slot sit quieter beneath.
  Calculator fields now: the two converter fields + fuel-amount; every
  other NumberField is unchanged.

- **THE LOCKOUT POSTMORTEM (2026-07-20):** devices were PERMANENTLY stuck
  on "SOMETHING BROKE / RETRY" after deploys â€” hard refresh useless,
  device-scoped, socials implicated. Root cause, reproduced live before
  fixing: the persisted query cache (`evoforge-query-cache-v1`,
  localStorage) had a STATIC buster ('v1'), so a deploy never invalidated
  it; the feed persists `toPost`-NORMALIZED objects, and a new build's
  cards dereferenced fields an old build never wrote (`post.tagged.length`
  â€” `tagged` postdates 96a48a8) â†’ render throw â†’ boundary. RETRY re-read
  the same bytes; hard refresh clears HTTP caches, NOT localStorage; other
  tabs' successful queries kept re-persisting the poisoned entry so maxAge
  never expired; and the +html.tsx nuclear reset never showed because the
  app HAD booted before the route threw. Sign-out clears the key â€” why
  other devices worked. THE FIXES:
  * **Per-build buster** (`domain/build-id.ts` â†’ `app/_layout.tsx`): the
    buster is the running `entry-<hash>.js` hash (the version-guard's own
    regex; fallback 'v1' on native/dev/static render). A deploy discards
    the persisted cache exactly once; same-build reloads keep it warm.
    Already-stuck devices heal on their next launch of the new bundle.
    INVARIANT: any future cache that stores NORMALIZED domain objects
    rides this buster â€” never assume a persisted shape survives a deploy.
  * **`data/cache-keys.ts`** â€” the localStorage keys (query cache + both
    reload guards), zero imports, ONE source of truth for the persister,
    sign-out, version-guard and the error screen.
  * **Error-screen escape hatch** (`ui/core/error-screen.tsx`): web-only
    ghost button CLEAR CACHE & RELOAD â€” removes the query cache + both
    reload-guard keys (re-arming the auto-heals) and reloads. NEVER
    touches auth (no forced sign-out) or the zustand stores/queues holding
    unsynced work; `localStorage.clear()` stays exclusive to the +html
    boot overlay.
  * **`isRenderablePost`** (`domain/social-feed.ts`, vitest-pinned):
    restored feed pages are filtered at the two `pages.flat()` choke
    points (social.tsx, athlete/[id].tsx) â€” a post missing fields the
    cards dereference is DROPPED, never thrown on. Plus `display_name?.[0]`
    at the five avatar-initial sites.
  * Falsified end-to-end vs the built dist: poisoned blob (tagged deleted
    from the REAL persisted feed) locked the pre-fix build through RETRY
    AND reload; the fix build discards it (new buster = entry hash),
    renders clean, keeps warm cache within a build, and the real button
    (forced via a deleted chunk) clears the guards while `sb-*` auth
    survives.
  * **Nutrition was suspected and EXONERATED**: fuel persists raw rows and
    every render coerces (`Number()`, `?? []`); no conflict markers; the
    evalEnergyExpression chain is a clean DAG. Timing coincidence.
  * **A second, bounded lockout exists and is NOT code-fixable:** an OLD
    cached bundle reading NEW 065 array plan values crashes at
    `workout.trim()` (pre-065 plan-sources). Only the new bundle heals it
    (version-guard + the SW's stale-while-revalidate do this next launch);
    exposure = mixed-build devices whose account saved an extras day.
    Watch iOS standalone PWAs â€” the surface where stale shells linger.

**Migrations applied through `070`. Next free number: `071`.**
(`065` is a SHARED number, like `037`: `065_leaderboard_metrics.sql` and
`065_schedule_extra_workouts.sql` were written by parallel sessions the same
weekend â€” both applied.)
(The line above previously said 048/049 â€” stale: the social program took
049â€“055. See the social blocks above.)
(Historical: `022` was reserved for the nutrition branch and never used â€”
nutrition landed as `037_nutrition.sql`, which COLLIDES with
`037_workout_ghosts.sql`; both are applied, the number is just shared.)

<!-- superseded: **Migrations applied through `021`. Next free number: `022`.** -->
`016` user_exercises+routines Â· `017` workout_sessions Â· `018` user_plans Â·
`019` user_exercise_prefs Â· `020` weight_unit Â· `021` ai_scan_cache +plan-scan.

**496 tests. Four executable guards** (all in CI):
`verify-tokens` Â· `verify-battle-engine` (byte-pin Ã—3) Â· `verify-motion` Â·
`lighthouse` (budgets in `client/lighthouserc.json`).

- **2026-07-23 â€” Arena polish pass, Phase 1 (visual audit) done.** A new
  multi-session program to turn the working-but-plain Arena into a polished
  vertical slice (real pixel art, combat feel, full-bleed premium UI). The
  three living docs are in `client/src/arena-game/`:
  `ARENA_VISUAL_AUDIT.md` (evidence from a real played battle â€” screenshots
  via the new `client/scripts/arena-visual-tour.mjs`),
  `VERTICAL_SLICE_PLAN.md` (phase map + model schedule + constraints),
  `KNOWN_POLISH_ISSUES.md` (living checklist, presentation-only â€”
  engineering issues stay in the package `KNOWN_ISSUES.md`). Code unchanged
  this phase. NOTE for the asset phase: `client/.env.local` carries an
  unused `PIXELLAB_AI_KEY` (pixel-art sprite generation API) â€” validate
  before building on it.

- **2026-07-23 â€” Arena polish Phases 2+3 done: the 1-bit look is gone.**
  PixelLab (that key, now validated) generated the full battle asset set â€”
  5 champions / 10 units / 2 cores with cracked damage variants / lane
  floor â€” via the new idempotent `client/scripts/arena-pixellab-gen.mjs`
  (generate = API with pinned seeds, build = team-outline post-process,
  raws in `client/assets/arena-pixellab-src/`). Renderer: floor + deploy
  boundary + team base plates + walk-bob (reduced-motion gated via new
  `use-reduced-motion.ts`) + white-silhouette hit-flash + pixelated
  rendering; sim untouched, arena suite 487 green, Playwright tour
  re-verified on the export. Known limits (documented in
  KNOWN_POLISH_ISSUES.md): PixelLab walk-cycle/rotate animation unusable â€”
  the walk-bob carries motion; direction is still chevron-carried.

- **2026-07-23 â€” Arena polish Phase 4 done: combat-feel system + character
  animations.** One escalation ladder in `arena-game/features/arena/
  components/impact.ts` (TIER_FX): tier-scaled damage numbers, screen
  shake, hit-stop/slow-mo via a new store-level time dilation (ticks
  delayed never skipped â€” replay digests untouched, fake-timer tested),
  ranged projectiles, defender recoil, spawn drop-in, and a 1.1s
  core-destruction climax before the result overlay. Engine's `fx hit`
  log entries now carry target id + shield flag (digest-inert; legacy
  fallback kept). CHAMPION WALK CYCLES ARE REAL now â€” the PixelLab
  turn-around failure was cracked with a frame-0 inpainting anchor +
  image_guidance 3.0 (`arena-pixellab-gen.mjs animate`); 4 frames Ã— 5
  champions Ã— 2 team outlines, cycled while moving, reduced-motion gated.
  Audio stayed out deliberately (public-gym context â€” Tyson's call,
  see KNOWN_POLISH_ISSUES A3). Arena suite 504 (+17), full 1,575, all
  guards green, export + tour verified the climax flow on screen.

- **2026-07-23 â€” Arena polish Phases 5â€“7 done: champion identity,
  readability, premium UI.** Per-path telegraph shape language (Titan
  shockwave+cracks / Mass pressure dust / Shredder slash arcs / Cardio
  pulses / Aesthetics gold ring+sparks) + Cardio speed afterimage +
  Shredder strike ghost; unit-pile lateral fan-out
  (`computeStackOffsets`, id-stable, tested) + champions draw on top +
  crimson core-danger edges; **the tab bar now hides for the whole
  /forge-arena group** ((main)/_layout.tsx â€” the game is full-bleed);
  pixel display faces (Jersey family names pinned as strings in the arena
  theme â€” do NOT import src/theme/fonts.ts there, its .ttf requires break
  vitest) on timer/energy/wordmark/result banner; card chips are
  mini-cards with sprite thumbnails + category edges (two-line names â€”
  truncation fixed); champion select + lobby carry real sprite portraits;
  ResultOverlay is a staged ceremony (banner slam â†’ facts â†’ rating â†’
  actions, outcome-colored, reduced-motion instant), verified mid-stage
  by a dedicated Playwright check. Arena suite 510, full 1,581, all
  guards green.

- **2026-07-23 â€” Arena polish Phases 8+9 done: roster identity + match
  flow.** P8: starter-deck COMPOSITION deliberately unchanged (the AI
  fields DEFAULT_DECK_CARD_IDS â€” the deck is coupled to the tuned
  45â€“54% balance band; role audit in PROGRESS.md confirms full
  coverage); three sprite identity fixes instead (human sprinter,
  javelin thrower, gym spotter â€” art now matches the fitness-renamed
  cards). P9: every non-tutorial battle (and every Rematch) opens with
  `battle-intro.tsx` â€” opponent line, team-framed champion portraits,
  VS, 3-2-1-FIGHT pixel countdown â€” over a sim FROZEN by the store's new
  `holdForIntro` (delay-only, 3.5s cap, fake-timer tested; players can
  pre-select a card during the count). Timer turns amber <30s, red in
  sudden death. Tooling gotcha recorded in PROGRESS: PS `Select-Object
  -First N` kills upstream native commands â€” never filter the pixellab
  generator through it. Arena suite 511, full 1,582, all guards green,
  tour-verified.

- **2026-07-23 â€” Arena polish COMPLETE (Phases 11+12): hardening +
  independent review.** Deep harness on the final build: 362/362, zero
  defects, champion win rates IDENTICAL to pre-polish (zero sim drift
  across ten phases of visual work). Timer/leak audit clean; measured
  render-derivation cost 0.014% of frame budget; repeated-rematch leak
  test added. **The program report is `VERTICAL_SLICE_BUILD_REPORT.md`
  at the repo root** â€” verdict: presentable vertical slice, ready for
  testers/recording on web. Its open findings (also in
  KNOWN_POLISH_ISSUES): R1 HIGH â€” Training AI may be too punishing for
  the entry tier (five scripted players lost five straight; needs one
  HUMAN playtest before any tuning, TENDENCY-only); R2 â€” add testIDs
  (audit C6, highest-value follow-up); G2 gym-war on-screen check;
  the standing on-device pass. Arena suite 514, full 1,585.

- **2026-07-23 â€” Arena PREMIUM program, Session 1 (Phases 1-3): audit +
  render architecture + stress lab.** New 19-phase program (premium
  mobile quality; Clash Royale as a quality bar only). Docs live in
  `client/src/arena-game/`: ARENA_PREMIUM_AUDIT (two corrections: the
  wider app HAS a full avatar/cosmetic system the arena ignores â€”
  path-only sprites, no stage/sex/skin; and an app-level synth SFX
  system exists), ARENA_RENDER_ARCHITECTURE (as-is pipeline + ranked
  evidence-gated optimizations, deliberately unapplied),
  ARENA_PERFORMANCE_BASELINE / ARENA_QUALITY_GATES /
  ARENA_GOLDEN_SLICE_PLAN / AVATAR_VISUAL_SOURCE_MAP /
  KNOWN_ARENA_ISSUES / **ARENA_STRESS_TEST_REPORT** (+ raw JSON).
  New instrument: Render Stress Lab (`/forge-arena/dev-stress`, linked
  from debug) â€” battle mode `'dev-stress'` (never recorded/persisted/
  rated), density driver, alloc-free frame profiler
  (`window.__ARENA_PROFILE`), headless bench (ARENA_STRESS_BENCH=1),
  browser sweep `scripts/arena-stress-measure.mjs` (CDP script/layout
  split + CPU throttle + heap trend). THE FINDING: sim is never the
  bottleneck (tickHz holds 20 everywhere); desktop 60fps through
  30/team; **4Ã— CPU throttle (mid-phone proxy) â†’ 9fps, script-bound
  (78% core) while layout stays <5%** â€” the whole-tree un-memoized
  20Hz re-render is the cost. Heap flat over 10 matches. New CI guard
  `verify-arena-purity.mjs` (engine imports no UI; falsified).
  GOTCHA: React 19 does NOT flush zustand subscribers synchronously in
  set() â€” publish timing measures scheduling only; trust the rAF
  sampler. **Session stopped by design: Phase 4 (renderer decision) is
  scheduled for Opus 4.8 at xhigh, independent, on this evidence.**

- **2026-07-23 â€” Arena PREMIUM Session 2 (Phase 4): renderer decision
  (Opus 4.8 xhigh, independent).** Doc: `client/src/arena-game/
  ARENA_RENDERER_DECISION.md`. **DECISION: stay on React Native views; do
  NOT migrate the battlefield to Skia now.** The prompt's migration gate is
  unmet (it needs "multiple optimisation attempts have failed" â€” zero
  exist), and Skia on the static-web PWA means CanvasKit WASM (~1.5MB+
  gzip) on the critical path with no native build to amortize it (Reanimated
  4.5 + worklets 0.10 are already installed as the lighter off-thread
  alternative). Independently re-verified in source and corrected the Phase 3
  framing: the render is **20Hz** (browser idles 60fps between ticks; rAF
  avgFrameMs floors at 16.67ms on 60Hz â€” use CDP script% + drop counts, not
  rAF, for headroom). Cost decomposes as a **~12% fixed chrome floor
  (memoizable) + ~0.5-0.7%/core per actively-fighting unit that changes
  EVERY tick (NOT memoizable â€” memoizing UnitMarker, the Phase 3 top lever,
  does not help the stress case)**. Ordered, measurement-gated plan: **Step 0
  BLOCKING = real-device baseline via the lab (NEEDS-TYSON â€” recent+old
  iPhone + ordinary Android, PWA + Expo Go, 30/team; may show the renderer is
  already fine)** â†’ Step 1 memoize chrome â†’ Step 2 cheaper-per-unit â†’
  Step 3 Reanimated off-thread motion (no new dep) â†’ Step 4 Skia only if
  1-3 fail on real hardware. Execution folds into Phase 7/16, not its own
  phase. **Next: Session 3 (Phases 5-7, avatar source of truth) on Fable 5
  Ultracode; run Step 0 before any Phase 7 renderer change.**

- **2026-07-23 â€” Arena PREMIUM Session 3 (Phases 5-7): avatar source of
  truth + art bible + performance-safe cosmetics.** P5: the Arena now
  renders the athlete's REAL champion identity â€” `ArenaAvatarProfile`
  pushed by an app-side bridge in the arena layout from
  `useDisplayIdentity()` (the exact resolver Home/Customise use; the arena
  keeps zero cosmetic state), battle-asset fidelity chain
  (variantâ†’canonicalâ†’glyph, layer-drift rule, pure+tested), lobby shows
  the app's own skinned/staged still + "Stage N â€” form" line, intro
  carries stage identity. Doctrine kept: a finished player's arena pick is
  never overridden (own-path guard); display path refines the FIRST-RUN
  prefill only â€” verified fix: originless smoke ALPHA used to prefill
  Titan while Home showed an aesthetic "Elite Aesthetic"; it now fields
  Aesthetics everywhere. P6: `ARENA_ART_BIBLE.md` (mandatory generation
  spec: pipeline law, per-champion continuity with real seeds, variant
  naming `--s<stage>[--k-<skin>]`). P7: precomposed single-sprite
  cosmetics adopted, runtime layering rejected (recolour-class cosmetics
  only), cached per profile key, zero draw-cost change â€” verified by a
  same-machine A/B after the re-sweep's absolutes came out 3Ã— worse than
  the P3 baseline and production showed the SAME degradation. **STANDING
  MEASUREMENT RULE (PR-8): perf claims only from same-machine same-session
  A/B (TOUR_BASE_URL vs local dist) â€” never cross-session absolute
  tables.** Variant ART still pending (Phase 8 golden pipeline contract in
  `ARENA_COSMETIC_COMPATIBILITY.md` Â§5). Next: Session 4 = Phase 8 on
  Sonnet 5 high (golden champion), reviewed by Fable 5.

- **FORGE DROP** (2026-08-08, migrations **154**+**155**, `docs/FORGE_DROP.md`) â€”
  a single-player Plinko board played with Forge Coins, at `/forge-drop`. Five
  boards keyed to Evo Rating (SCRAP RIG â†’ CELESTIAL FORGE, max stake 5â†’25,
  target RTP 80â†’92%, max payout 15â†’150), held in the `forge_drop_tiers` TABLE
  so a rebalance is SQL with no deploy. **Forge Drop reads Evo Rating and never
  writes it** â€” a game that could move a rating would make it a currency.
  Tier/multipliers/`config_version` are snapshotted onto the drop row, so a
  retune mid-fall cannot change a drop in flight. `forge_drop_play` is one
  transaction (validate â†’ debit â†’ resolve â†’ credit) and idempotent on
  `(user_id, idempotency_key)`; the client writes the key to disk BEFORE the
  request, so a dead tunnel is recoverable via `forge_drop_fetch` and never
  re-wagered. Balance is always the server's `coin_total()` â€” nothing
  optimistic, one query key across Home/Challenges/Customise/Vault/Forge Drop.
  Entry points: Vault, More, and Customise **only when short of coins**; NOT in
  the workout logger. The fall is a REPLAY of a settled result, not a
  simulation. Reduced motion skips the fall, not the result. Verified by 65
  domain tests (incl. a 100k-sample statistical test per lane per tier),
  `tools/falsify-forge-drop.mjs` (SQL, ledger conservation + 100k real-resolver
  samples) and `tools/tour-forge-drop.mjs` (47 assertions, three tiers, four
  widths, reduced motion).

- **FORGE DROP â€” CHIPS, AND SEVERAL AT ONCE** (2026-08-09, migration **156**) â€”
  the board is now played by throwing chips: a rack of 1/5/10/15/25/50 under a
  board that never leaves the screen, flicked up-and-sideways so aiming and
  committing are one motion, with a full tap/keyboard path that does everything
  the gesture does. **Three chips may be in the air on a phone, five on a
  desktop**, in mixed denominations and mixed lanes, each with its own key, its
  own server call and its own independent result. Also on the rest timer between
  sets (opt-in button only, never auto-opens, never touches the clock, refuses
  new drops in the final 10s, closes itself when rest ends) â€” Challenges already
  ran on the same chip components and were not rebuilt. New: `forge_drop_play`
  takes a per-user advisory lock; `forge_drop_fetch_many` recovers every
  in-flight key in one round trip; `domain/forge-drop-session.ts` +
  `data/forge-drop-session.ts` + `ui/forge-drop/chip-rack.tsx`. Verified by 29
  new domain tests, `falsify-forge-drop.mjs` (concurrency + batch recovery
  sections added) and `tour-forge-drop.mjs` at **70 assertions** including three
  chips thrown without waiting for any of them.

- **OVERNIGHT AUDIT** (2026-08-09) â€” `tools/audit-activation.mjs` added: it signs
  up a REAL disposable account and walks discover â†’ sign-up â†’ onboarding â†’
  first workout, timing every step and recording console errors, overflow and
  dead ends. Three things fixed from it: the **inverted vertical tilt**
  (`orientationLeanDeg` returned `y = -beta` against `x = +gamma`), a **220px
  horizontal scroll on every signed-out screen** (decorative discs, copy-pasted
  in five files, now one clipped `AmbientLight`), and **migration 132 applied**
  â€” `app_flag_enabled` did not exist in production, so every session 404'd on
  it. The flag seeds OFF at 0%, so nothing users see changed; the client had
  been failing closed on the error. A signed-in sweep of 26 routes found no
  error screens, no blanks, no bounces and no overflow.

---

## 3. The rules that cost real bugs

### Wagering maths

- **A random walk on a peg board moves HALF a column, not a whole one.** Each
  peg deflects left or right by half a slot; only after two rows is the puck a
  whole column across. Stepping Â±1 whole column made half the board unreachable
  and pushed a side lane's return **above 100%** â€” a losing game that paid out.
  Track half-columns `h` in `0â€¦2*rows`, slot is `h/2` (so `rows` must be EVEN),
  and **reflect** at a wall rather than clamping â€” clamping piles probability
  onto the rim slots, which carry the biggest multipliers.
- **How you round a payout to whole coins IS the RTP.** Flooring is the obvious
  rule and it silently rewrites the economy: it loses up to a coin on every
  drop *regardless of stake*, so the smallest stake loses the most. A board
  published at 86% actually returned **15%** at a 1-coin stake, and no stake on
  any tier ever reached its advertised figure. Pay the fraction as a
  PROBABILITY instead (`floor(x) + (random() < frac(x) ? 1 : 0)`): the
  expectation is exactly `stake Ã— multiplier`, so the published number is true
  at every stake. Check the top multiplier Ã— max stake is a whole number, or
  rounding up can breach the advertised ceiling.
- **The THIRD of the THREE EDITS is the one that gets forgotten, because
  nothing fails without it.** A coin kind needs the CHECK constraint, the
  `coin_events_guard()` branch and the CLIENT LABEL. The first two fail loudly.
  The third fails silently â€” the ledger screen renders a blank where a
  description should be, in the one place an athlete goes to check what
  something actually paid them. Forge Drop shipped its constraint and its guard
  and forgot its labels, and no test anywhere noticed.
  `tools/falsify-forge-drop.mjs` Â§10 now reads the CHECK constraint out of the
  live database and `COIN_LABELS` out of the source and refuses to let them
  disagree â€” for EVERY kind, not just Forge Drop's, because the next one will
  be forgotten too.
- **Every overflow check we owned ran signed IN, so a 220px horizontal scroll
  sat on 100% of first impressions for months.** The signed-in screens are
  clipped by the tab navigator; the landing page, sign-in, sign-up and all six
  onboarding steps are not. `body { overflow-x: hidden }` does not stop it â€”
  the document element still scrolls. Check the SIGNED-OUT screens too, and
  clip decoration in its own wrapper rather than putting `overflow: hidden` on
  a shell root that legitimately hosts the rest timer and the call-out layer.
- **A physical model is the only honest oracle for a physical control.** The
  vertical tilt shipped inverted, with three test cases agreeing with it,
  because all three were written from the same wrong sentence about which way
  `beta` rises. Pinning the lean model's SIGN against `orientationGravity`
  (`y = sin beta`) is a guard no confident reasoning can talk its way past â€”
  and it is what a hand reported before any test did.
- **A 404 that the client "handles" is still a bug.** `app_flag_enabled` was
  called on every session and did not exist, because migration 132 was written
  and never applied. The client failed closed, which is why nobody noticed â€”
  correct behaviour arrived by accident, from an error path. Check
  `pg_proc`/`to_regclass` for the functions the client actually calls; a
  migration in the repo is not a migration in the database.
- **A balance check without a lock is not a balance check.** `forge_drop_play`
  read `coin_total()` and compared it to the stake with nothing serialising it.
  One drop at a time that was invisible; the moment two chips could be thrown at
  once, **six concurrent five-coin drops against a TEN-coin balance were all six
  accepted**. Any read-then-decide on an append-only ledger needs
  `pg_advisory_xact_lock` on the user, and the key is namespaced
  `evoforge.coin_spend:<user>` rather than per-feature so the next spender to
  adopt it is protected against the ones already there.
- **Do not test an overdraft by looking at the closing balance.** Payouts land
  in the same transaction as their stake, so winnings refinance the overdraft
  and the balance looks healthy while six drops were authorised against funds
  for two. Assert the AUTHORISATION: with one stake affordable, somebody has to
  be told no.
- **Derive a displayed balance from the server every render; never carry one
  forward.** The first concurrent build anchored to the balance at the last
  quiet moment and applied each movement on top â€” and double-counted, because
  once the board went quiet the anchor became the post-settlement total and the
  revealed drops were re-applied to it. It showed as a permanent one-coin
  disagreement between the header and the ledger. Adjust the server's own total
  only to HIDE what has not been shown yet; there is then nothing to keep in
  step and nothing to drift.
- **Sample the PAYOUT, not the multiplier.** The 100k-sample harness asserted
  the mean multiplier matched the board and passed happily while the flooring
  bug was live â€” the multiplier was right, the coins were not. A statistical
  guard has to sample the thing the athlete actually receives, at the SMALLEST
  legal stake as well as the largest. The maximum stake is the one value where
  a rounding bug looks nearly acceptable.
- **An uncorrelated subquery in Postgres is evaluated ONCE.** The first version
  of the SQL sampler reported one drop repeated a hundred thousand times; a mean
  multiplier of exactly 1.000 was the tell. Extract the walk into its own
  function and sample that.

### Touch targets

- **`hitSlop` DOES NOTHING on web.** react-native-web 0.21.2 honours it only
  in the legacy `Touchable` module â€” `Pressable`, which this app uses
  everywhere, ignores it (`grep hitSlop node_modules/react-native-web/dist`:
  every hit is in `exports/Touchable/index.js`). Falsified in a browser: a
  click 6px outside a chip does nothing. So for years the documented fix for
  the 44px floor was decorative on the platform that actually ships, the PWA.
  **Make the BOX clear the floor** â€” `minHeight: 44` on the Pressable, with
  the visible pill as an inner View so the look is unchanged. Keep `hitSlop`
  alongside it: native Pressable does honour it and native builds are coming.
- The 2026-08-05 audit took undersized targets from **111 to 25** across 27
  routes this way (`Chip`, `NeonButton` base, the help FAB, the plan
  dropdown, view-calendar, radar horizons). Re-measure with the UI probe
  rather than by eye â€” `getBoundingClientRect` is the only honest judge.
- **Known and deliberately NOT changed:** `NumberField`'s steppers are 26Ã—26.
  They are the core set-logging control, deliberately tuned (fused steppers,
  in-app keypad), and stacked vertically 1px apart â€” reshaping them is a real
  UX change that needs interactive testing, not a floor sweep.


Every one of these was a live bug. Do not relearn them.

### Process
- **Warm lint caches HIDE what CI catches.** Always
  `rm -rf .eslintcache node_modules/.cache` before trusting lint. A whole phase
  once sat undeployed because CI (cold) refused what passed locally (warm).
- **A green local build is not a deploy.** After pushing, grep the LIVE bundle
  for a marker string from your change.
- **THE LIVE HOST IS `evoforge.pages.dev`, NOT `expo-rewrite.evoforge.pages.dev`**
  (found 2026-08-03). Every doc named the branch alias, and that alias is
  FROZEN several deploys back â€” it was serving `__common-53d1b05câ€¦` while the
  last three expo-rewrite deploys produced `2022d76a`, `0ddbf499` and
  `5e537c56`. The root host tracks the latest deploy; the branch alias does
  not (the project's production branch was changed in the Cloudflare dashboard
  after `wrangler pages project create --production-branch=main` ran, so
  `--branch=expo-rewrite` deploys land on the ROOT and the preview alias is
  orphaned). **Verify against `evoforge.pages.dev`, and cross-check the
  per-deployment URL the workflow logs (`https://<hash>.evoforge.pages.dev`)
  when the two disagree.**
- **A guard that cannot fail is not a guard.** The motion guard's first version
  matched a bare identifier, so `const reducedMotion = false` passed it. **Break
  every guard, watch it go red, restore it.** Do this before you trust it.
- **A guard can pass on a file and still be wrong about the LINE.**
  `verify-motion` tested for a gate anywhere in a FILE. `ui/train/week-bar.tsx`
  holds a gated one-shot (a completed day's tick) and a looping one (today's
  row breathing); deleting the LOOP's gate left the one-shot's
  `useReducedMotion` behind and the guard stayed GREEN on a genuinely broken
  loop. Found by falsifying it, 2026-08-03. It now scopes to the enclosing
  COLUMN-ZERO declaration, with one narrow escape for the parent-gates-child
  shape (`CoinFlip` â†’ `NativeSpin`, `SpriteAvatar` â†’ `NativeSprite`,
  `MoveFxLayer`): a gate on an EXPORTED declaration covers a loop in a private
  child it decides whether to render. **When a falsification passes, the guard
  is the thing that is broken.**
- **Falsify persistence bugs against production.** "It works" means: seed it,
  tour it in a browser, restart the app, read the row back from the database â€”
  then delete what you seeded.
- **THIS REPOSITORY IS PUBLIC. Describe incidents by BEHAVIOUR, never by
  identity.** Migration 082's header named a real athlete by email address and
  sat on GitHub for two days (redacted at HEAD 2026-07-25, Tyson's call; the
  original is still in git history, which only a published-history rewrite would
  remove). Commit messages, migration comments and docs are all world-readable â€”
  a user id is acceptable when it is genuinely needed, an email is never.
- **Secrets belong in Vault or edge-function secrets, never in a migration.**
  `cron_secret` and `edge_gateway_key` are read from `vault.decrypted_secrets`
  at fire time for exactly this reason.

### Dates and time
- **`domain/today.ts::todayIso()` is the ONLY source of "today"** â€” the athlete's
  LOCAL calendar day. `toISOString()` is the UTC date: east of Greenwich it is
  wrong for part of every day, and it filed early-morning workouts under
  yesterday.
- **Timestamps stay UTC.** `xp_events.created_at` is a `timestamptz` and Postgres
  reads a naive string as UTC â€” a local wall clock would file every XP grant hours
  in the future. A calendar date is what an athlete means by "today"; a timestamp
  is an instant. Only one of them was ever wrong.

### The XP contract (load-bearing)
- Flat 10 XP/set, 2/cardio-minute; curve `500 + (L-1)*25`. `domain/xp.ts` is the
  only place XP is minted. The ledger is **append-only** â€” an edit must never
  re-grant, and a granted set can never be un-granted.
- **Never invalidate `workout_log` for a QUEUED verdict** â€” it drops the optimistic
  row.
- **Battle sets must use the direct path**, never the durable queue:
  `battle_events` need a server-confirmed row id.

### Status vs locking (`domain/week-status.ts`)
- **Status derives WITHOUT a marker** (past + sets = COMPLETED) â€” or a year of
  history reads as MISSED.
- **Locking keys ONLY on the marker** â€” or you lock history nobody agreed to lock.
- Conflate them and you lie about the past in one direction or the other.

### Exercises
- **`libraryMuscleFor()` beats `inferMuscleGroup()`** on every set-save path.
  Inference is a heuristic tuned on names it has seen; it has never seen the 848
  imported ones. `inferMuscleGroup` itself is parity-pinned â€” it moves for nobody.
- **Ranking: the CLASS of match dominates** (exact > alias > word > substring);
  popularity only orders WITHIN a class. Rank by position instead and "Bench
  Sprint" beats "Barbell Bench Press".

### React
- **The React Compiler is on.** A hand-written `useMemo` it cannot prove stable
  makes it **bail out of the whole component** â€” worse than no memo. Prefer plain
  derivations. (`Compilation Skipped: Existing memoization could not be preserved`
  is the lint error that tells you.)
- **`router.back()` pops the previously focused TAB**, not the screen you came
  from. Navigate explicitly.
- A tab screen with `href: null` **stays mounted**. Per-mount refs are NOT
  per-workout â€” reset them on the params.
- **`InteractionManager` is a DEPRECATED NO-OP in RN 0.86.** `runAfterInteractions`
  is a bare `setImmediate`, which bridgeless polyfills to `queueMicrotask` â€” the
  callback, the state update and the re-render all land in the SAME task as the
  first render, so it defers NOTHING on native (and warns on every run). Use
  feature-detected `requestIdleCallback` **with a `timeout`**, the way
  `(main)/_layout.tsx`'s route warmer and `ui/home/below-fold.tsx` do. The
  timeout is not optional on web: a page booted in a hidden tab is never given
  an idle slot at all.
- **`className` on an `Animated.View` is DROPPED on web.** The NativeWind
  interop does not compose class styles onto Reanimated nodes, so
  `className="rounded-pill items-center justify-center"` on an animated pip
  silently rendered SEVEN SQUARE DAYS on Home's week strip â€” green in tsc,
  green in lint, wrong in the browser. **Animated nodes carry inline styles
  only.** (Known since the xp-bar; it bit again the moment a static View was
  made animated. When you animate an existing node, move its classes inline in
  the same edit.)
- **A decorative colour that is DERIVED can evaluate to invisible.** The
  podium's tech ring was drawn in `auraColour`, which for a COMMON athlete is
  `#94a3b8` â€” a grey stroke at 0.2 opacity on a purple-lit disc, i.e. nothing
  at all. Tune opacity against the REAL art and the WORST-CASE colour the prop
  can take, not against the one the design was mocked in.
- **A FIXED height inside a fixed-height card cannot give space back.** The
  Train briefing's figure had `height: mapHeight`; when a set is logged the
  progress row appears and the blocks below it grew, so on a compact screen the
  rewards block was pushed under the card's own `overflow: hidden`. A card whose
  height is a budget (the equal-cards rule) needs at least one child that
  YIELDS: the figure is `alignSelf: 'stretch'` with `maxHeight`/`minHeight` now,
  and the crop it already ran makes losing its edges harmless.
- **The same testID lives on more than one screen, and preloaded tabs stay
  MOUNTED.** Home and Train both render `mission-rewards` / `mission-evo-gain` /
  `mission-xp` / `profile-menu`. A tour's `document.querySelector` found Home's
  hidden copy and measured 0Ã—0 at y=0 â€” which reads exactly like "the element is
  missing" and nearly sent a real layout pass chasing a phantom. **Measure the
  first node with a non-zero box, not the first node.**
- **A Reanimated style applies on the worklet's FIRST EVALUATION, not on the
  first paint.** Until then only the BASE style object exists, so a layer whose
  opacity lives solely in its animated style paints at opacity 1 â€” the forge
  intro's full-screen strike flash washed the whole launch screen pale cyan on
  the static pre-render and on every slow first frame. **Put the resting value
  in the static style** (`...HIDDEN` in ui/boot/forge-intro.tsx). Same family as
  the July PWA bug, one level down: never let an animation own a resting state.
- **`useWindowDimensions()` returns 0x0 on the web build outside a screen.**
  Expo statically pre-renders every route in Node, where react-native-web's
  Dimensions has no window, and hydration does not re-render with corrected
  values. The launch wordmark shipped at `font-size: 0`. **Measure with
  `onLayout` and floor every derived size** â€” a zero here is an invisible
  element that tsc, lint and the type system all consider perfectly fine.
- **A full-screen element that intercepts touches, over an app that is
  already interactive underneath, and is removed by a TIMER rather than by
  the user's own gesture, is a real-device bug risk that Playwright â€” on
  Chromium OR WebKit â€” will not reliably reproduce.** The forge intro's
  tap-to-skip overlay caused "can't type into sign-in" on Safari and the
  installed PWA, every launch; automation found nothing wrong on either
  engine, with a mouse, with touch emulation, tapping mid-sequence, waiting it
  out, local and live. **When a bug is reported as reliably reproducible on
  device but the same interaction cannot be made to fail in the test harness,
  don't keep hunting the mechanism â€” remove the risky element's ability to
  intercept anything at all** (`pointerEvents="none"`) rather than trying to
  time its removal more carefully. A decoration that was never required to be
  interactive should never have a way to become the thing standing between an
  athlete and their own keyboard.
- **A safety net that fires on the FIRST symptom, with no grace period, is
  itself a bug generator.** `+html.tsx`'s boot-failure overlay revealed on the
  very first global `error` event â€” and this app's static export legitimately
  fires ONE recovered React hydration-mismatch error on ordinary loads, which
  was enough to flash "Could not start" in front of every athlete before the
  poll-based auto-dismiss caught up ~500ms later. **A monitor for "did the
  critical thing eventually happen" must wait long enough for it to plausibly
  happen before treating its absence as failure** â€” arm a short check on the
  first symptom, decide only when that check fires and the thing STILL hasn't
  happened. Re-verified the guard still catches a REAL failure afterwards
  (blocked every JS chunk outright; the overlay still appeared, on schedule,
  with working buttons) â€” the fix must never just make the guard quieter.
- **A tap target's SIZE is a feature, and a miss's CONSEQUENCE is part of it.**
  Train's card figure gave each muscle a 15-30pt target and made a miss FLIP
  the view, so the common outcome of aiming at a muscle was the figure spinning
  - which reads as the app being broken, not as a near miss. **When a control
  is too small, move the control; do not make the tap cleverer.** The card's
  figure became one door to a full-width figure, and the fallback action got its
  own button. Check hit rects in a real build (`scratchpad/train_muscles.mjs`
  prints them against the 44pt floor); tsc and lint cannot see this.
- **Some lit regions have NO hit geometry at all.** Front traps, the adductors
  and the abductors have Krita masks but no path in `front-muscle-paths.ts`, so
  they light up and can never be pressed at any size. Any per-muscle
  interaction needs a non-figure path in for them - a labelled list, not a
  bigger figure.
- **An overflowing box still eats taps.** A child drawn larger than its parent
  (Home's champion at `artScale`, whose sprite frame reaches ~48pt above the rig)
  is invisible up there but fully hit-testable, and it silently stole every tap
  meant for the section ABOVE it. Mark decorative overflow `pointerEvents="none"`
  at its source; a `zIndex` on the neighbour is the second line, not the first.

### Accessibility on web
- **`accessibilityElementsHidden` / `importantForAccessibility` do nothing on
  web** â€” react-native-svg forwards them straight to the DOM as invalid
  attributes (React warns on the boolean) and the element stays fully announced.
  Use `aria-hidden` on web, the native pair elsewhere: `ui/home/evo-emblem.tsx`
  exports `DECORATIVE` for exactly this.
- **Never put `aria-hidden` on an `<Svg>` â€” put it on a wrapping `<View>`.**
  `initSceneJanitor` (version-guard.ts) `display:none`s aria-hidden nodes under
  an absolute parent unless they are short, and its size test read
  `offsetHeight`, which **does not exist on SVGElement** â€” so `undefined < half`
  was false and the guard failed OPEN. Home's Evo Rating crest vanished the
  moment it was correctly marked decorative. The janitor is fixed (`?? 0`), but
  a View keeps any future SVG correct regardless.

### Storage / caches
- **Sign-out must clear EVERY cache layer** (auth-context): React Query, the
  persisted query cache, every Zustand store, the set queue, the finish queue.
  Add a store â†’ clear it there. A missed one hands the last athlete's character to
  the next visitor.
- **A read that swallows every failure as an empty success is a bug.** It cached
  `[]`, deleted the optimistic finish marker, and unlocked the whole week. Only
  "the table does not exist" degrades to empty; everything else throws.
- **Never add columns to `custom_workout_plan`** â€” Streamlit reads it.

---

## 4. The map

**Screens** (`client/src/app/(main)/`): `index` Home Â· `today` **Train (hub)** Â·
`workout` **the workout page** (pushed, `href: null`) Â· `progress` Â· `avatar`
(Forge) Â· `arena` Â· overflow (routine, schedule, streak, profile, â€¦).

**The training loop:**
- `today.tsx` â€” the HUB. Week bars, plan source tabs (MY PLAN Â· AI PLAN Â·
  BUILT-IN), cardio, start-an-empty-workout. **No logging UI.**
- `workout.tsx` â€” the workout. Params `date` + `workout` + `source`.
  **Editable only when `date === today` and not finished** (the cards write to the
  date in the URL). FINISH is not gated on the clock.
- Bars â†’ `domain/week-status.ts` (`buildWeekBars`, `extraBarsForToday`).
- Plans â†’ `domain/plan-sources.ts` (`resolveDayIn` â€” **the selected source is asked
  FIRST**) wired by `data/use-day-plan.ts`.
- Deviations (skip / remove / Â±sets / ad-hoc) â†’ `domain/session-plan.ts` +
  `state/session-store.ts` (persisted, self-expiring, cleared on sign-out).
- Durability â†’ `data/set-queue.ts` and `data/finish-queue.ts` (both idempotent by
  a server unique index; both cleared on sign-out; both have a **generation
  counter** so an in-flight flush cannot resurrect a cleared queue).

**Add Exercise** (`ui/train/exercise-picker.tsx`, ~960 exercises): personalised sections
before any keystroke â†’ `domain/exercise-sections.ts`; search + ranking â†’
`domain/exercise-rank.ts`; taxonomy/aliases â†’ `domain/exercise-taxonomy.ts`;
favourites â†’ `data/exercise-prefs.ts`.

**Rule of thumb: the thinking is pure and tested in `domain/`; the screens are
surface.** If you are about to put a rule in a component, put it in `domain/` and
test it instead.

---

## 5. The loop (run this for every change)

```bash
cd client
rm -rf .eslintcache node_modules/.cache      # WARM CACHES LIE
npx tsc --noEmit
npx expo lint                                # must be 0 problems
npx vitest run src                           # 427 tests
node scripts/verify-tokens.mjs
node scripts/verify-battle-engine.mjs
node scripts/verify-motion.mjs
npx expo export -p web --clear               # the build CI will do
```

Then **tour it in a browser** (Playwright, scripts in the session scratchpad):
serve `client/dist` on a local port, sign in as a smoke account, drive the real
flow, screenshot, assert. Seed what you need in production, **and delete it
afterwards**.

**Smoke accounts** (RLS-isolated, safe):
- ALPHA `smoke-test-claude@evoforge.internal` / `SmokeTest-2026-07!x` (male)
- BRAVO `smoke-test-claude-2@evoforge.internal` / `SmokeTest-2026-07!y` (female)

**SQL against production** â€” management API via `curl` (urllib is Cloudflare-
blocked); token in `client/.env.sbtoken.local`:
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/rysbpwpvnqbngqncrfaa/database/query" \
  -H "Authorization: Bearer $SBTOKEN" -H "Content-Type: application/json" \
  -d @query.json     # {"query": "..."}
```

**Confirming a deploy actually shipped** (a green CI run is not a deploy):
grep the LIVE bundle for a marker string from the change. Two traps, both hit on
2026-07-25:
- **The code is usually NOT in `entry-*.js`.** Async routes split screens into
  chunks and shared code into `__common-*.js`, which **`index.html` references
  and the entry does not**. Get the asset list from `index.html`.
- **Cloudflare Pages answers any unknown path with `200` and the HTML shell.**
  A fetch that "succeeds" and contains no marker may never have been the file.
  Check the first bytes â€” `<!DOCTYPE html>` means you grepped the fallback.

**Commits:** one coherent change per commit, the full loop green before pushing.
`migrations/`, `data/`, `auth/`, `domain/xp*`, `.github/` and friends are
**protected paths** â€” the commit-msg hook demands `[architect]` in the message.

---

## 6. Environment gotchas

- Node 24 at `C:\Users\tyson\AppData\Local\nodejs` (add to PATH in Git Bash).
- Windows console is cp1252 â†’ `PYTHONIOENCODING=utf-8` for anything with emoji.
- `expo export` does **not** generate `expo-env.d.ts` (only `expo start` does); CI
  writes the shim itself.
- Metro **caches inlined `EXPO_PUBLIC_` values** â€” always `--clear` after an env
  change, or you ship the old values.
- Lighthouse runs fine in CI (Ubuntu) but flakes locally on Windows (Chrome
  temp/permissions). Don't chase it.

---

## 7. Known weaknesses / what's next

- **LCP**: async routes (2026-07-16) cut the entry 3.5MB â†’ 1.1MB (+1.8MB
  shared chunk); re-measure LCP in CI's Lighthouse before touching budgets.
  Budgets are **ratchets** under the measured build: raise them when the
  build clears them, **never lower one to make a red run green**. The next
  big step remains native builds.
- **Deferred deliberately:** Sentry/PostHog (they earn their weight on native, and
  the bundle is already the problem), push notifications (need a native build).
- **Asked for, not built:** a strength percentile vs population ("top x% of
  lifters").
- The picker's muscle subgroups are exactly the 17 tags that EXIST. Obliques /
  rotator cuff / lower abs were requested; no exercise carries those tags, so the
  chips would always return nothing. Adding them means re-tagging ~960 exercises
  and migrating history the append-only ledger cannot survive â€” a **data** change,
  not a UI one.
- ~~**Nothing verifies RLS any more**~~ â€” **CLOSED 2026-08-05.**
  `tools/verify-rls.mjs` + the `rls` job in `client.yml` now ask the one
  question that matters on every push: does a client holding only the
  PUBLISHABLE key, with no session, read a single row from any table? First
  run: **180 tables probed, 135 of them non-empty, zero rows returned.**
  The two ways that check could lie are both closed â€” the table list comes
  from the LIVE schema when a management token is present (so a new table
  cannot be forgotten, and a stale `contracts/rls-tables.json` is itself a
  failure), and the run refuses to pass unless it saw real rows behind the
  wall, so "green because the database was empty" is impossible. Falsified
  in both directions: a throwaway table with an `anon` SELECT policy made it
  report both the leak and the stale manifest, and dropping the table
  restored green. Also confirmed while building it: 180/180 public tables
  have RLS enabled, and the 16 with RLS but no policy (gyms, exec, command,
  `push_reminder_log`) are deny-all by design â€” those features read through
  SECURITY DEFINER RPCs, exactly as the doctrine requires.

  The original note, for the record:
  **Nothing verified RLS between 2026-07-30 and 2026-08-05** (2026-07-30).
  `.github/workflows/verify-rls.yml` was deleted because it had been unrunnable
  since `e347839` deleted the `tools/verify_rls.py` it invoked. It was not
  restored: that script wrote to **12** tables â€” including `custom_workout_plan`,
  retired by migration 062 â€” while the schema is now 132 migrations wide, so a
  green run would have certified a stale subset and ignored the entire
  Command/social/battle surface. The check worth rebuilding is the one that
  mattered: **a client holding only the publishable key, with no session, reads
  ZERO rows** from the current table list. Note the old file's own warning â€”
  `--anon-only` reads zero from an empty table too, so it must run against a
  project that HAS rows or the green means nothing.

---

## 8. Working with Tyson

He gives short, direct briefs and expects autonomous execution: read the plan,
ship it in coherent commits, verify against production, tell him what broke.

He values, in order: **the thing actually works** (falsified, not asserted) â†’
**honest reporting** (say what you didn't do) â†’ speed. He will accept "I found
three bugs you didn't ask about and fixed them". He will not accept a green test
suite over a working app.

When you find a bug in code you just wrote, **say so plainly and fix it**. Several
of the best fixes in this repo came from a tour catching what a test could not.

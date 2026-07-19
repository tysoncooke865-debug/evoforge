# TRAIN PAGE V2 — the workout as its own page, and a finish that cannot be lost

## Context

TRAIN_IMPROVEMENTS shipped the week bars, but as **inline expansion**: tapping a bar drops
the logging UI underneath it inside the same scrolling page (`WeekBarRow`'s keep-mounted
`children`). The workout should instead be **entered** — a full page pushed on top of
Train, with a back arrow. Finishing must be bulletproof in Supabase, surfaced across the
app, always reachable, and exit you back to Train where the bar soft-locks with an EDIT
hatch.

Two real bugs this fixes, beyond the UX change:

1. **There is a state where finishing becomes impossible.** The FINISH button renders only
   when `totalDone > 0 && !complete` — once all sets are done the button disappears, the
   auto-ceremony fires once, and if the athlete taps KEEP TRAINING or SKIP, `announcedRef`
   blocks it from ever re-firing. No button, no ceremony, no way to finish.
2. **A finish can silently not stick.** `finishWorkout.mutate()` is fire-and-forget:
   offline, the insert fails with only a toast, and there is no retry — unlike sets, which
   ride a persistent offline queue.

## Design decisions

- **Bar tap = navigate, not expand.** `router.push('/workout?date=…&workout=…')`. The route
  lives at `client/src/app/(main)/workout.tsx`, registered in `_layout.tsx` as
  `<Tabs.Screen name="workout" options={{ href: null }} />` — the exact pattern of
  `routine`/`schedule`/`streak` (routable, hidden from the tab bar, tab bar stays visible).
- **Locked bar: tap = view, EDIT = unlock.** Tapping a completed bar opens the workout page
  in read-only recap mode (REOPEN available inside). The **EDIT button on the bar** reopens
  immediately (deletes the marker via `useReopenWorkout`) and navigates in, unlocked — one
  tap from bar to editing, which is what "soft lock" means.
- **FINISH always visible, enabled from the first logged set.** A 0-set finish stays
  disabled — marking a day green with zero training would corrupt the COMPLETED/MISSED
  semantics in `week-status.ts` (past + no sets = MISSED is load-bearing).
- **Finish is durable, like sets.** Optimistic cache write (bar flips green instantly) + a
  persistent offline queue with retry, mirroring `set-queue.ts`. The `workout_sessions`
  unique index makes retries idempotent by construction — the queue cannot double-finish.
- **Page navigation replaces keep-mounted.** Going back mid-workout unmounts SetRows, so
  half-typed *unlogged* numbers are lost (logged sets persist; prefill returns on
  re-entry). Normal page semantics, the accepted trade for a real page. The session
  store's `activeDay` already survives cold starts and will re-route into `/workout`.

## Changes

### 1. New page — `client/src/app/(main)/workout.tsx`
Move the logging column out of `today.tsx` wholesale: day progress GlowCard, `ExerciseCard`
list (with all Stage-1 controls), ＋ ADD EXERCISE, `ExercisePicker`, substitution sheet,
`SummarySheet`, FINISH/REOPEN, and the supporting state (`subs`, `loggedFacts`,
`buildEffectivePlan`/`planTotals` wiring, PR refs, the auto-complete ceremony effect).

- Params: `date`, `workout` via `useLocalSearchParams`. **Editable only when
  `date === todayIso` and not finished**; past/future dates render the existing `DayPanel`
  recap (move `DayPanel` here or to `ui/`).
- Header: `ScreenHeader` gains an optional `onBack` prop (← chevron, 44px target, left of
  the kicker). Back = `router.canGoBack() ? router.back() : router.replace('/today')` —
  the fallback covers cold deep-links.
- Finished state: the locked banner (`✓ WORKOUT COMPLETE · REOPEN`) stays, now page-level.
- Plan-source resolution (`resolvePlanSources`/`exercisesForDay`) is needed by both screens
  → extract into a shared hook `client/src/data/use-day-plan.ts` (thin wiring over the
  existing pure domain; no logic changes).

### 2. Train page — `today.tsx` becomes the hub
Keeps: header, LIFT|CARDIO (cardio stays inline on Train), MY PLAN · AI PLAN · BUILT-IN
source tabs, CREATE/EDIT plan links, START AN EMPTY WORKOUT (and MY ROUTINES sheet),
THIS WEEK bars, EDIT MY WEEK. Loses: everything that moved to `/workout`.

- `WeekBarRow` (`ui/week-bar.tsx`): drop `expanded`/`children` entirely; `onPress`
  navigates. Right side gains an **EDIT** affordance on completed bars (its own 44px hit
  target so it doesn't collide with the bar tap).
- **Ad-hoc/off-schedule workouts get a bar too**: append an extra bar row for any workout
  logged or marked today whose name isn't the scheduled one, plus the active ad-hoc from
  the session store — otherwise finishing an ad-hoc workout leaves it with no home on
  Train. (Pure helper `extraBarsForToday(rows, sessions, adhoc, scheduledName, todayIso)`
  in `week-status.ts`, unit-tested.)
- Starting an empty workout / routine now pushes straight into `/workout` with its name.
- No-schedule users: the day-chip fallback stays on Train; tapping a chip pushes
  `/workout` — one consistent entry path.
- `_layout.tsx`'s mid-workout resume effect targets `/workout?date=…&workout=…` instead
  of `/today`.

### 3. Finish reliability — `data/sessions.ts` + new `data/finish-queue.ts`
- `useFinishWorkout` gains standard TanStack optimistic update: `onMutate` writes the
  marker into the `['workout_sessions', userId]` cache (green bar, locked UI, instantly),
  `onError` rolls back, `onSettled` invalidates.
- **New `finish-queue.ts`** (persistent, AsyncStorage key `evoforge-finish-queue-v1`,
  modeled on `set-queue.ts`): failed finish inserts land in the queue and re-flush on
  boot/online/30s; init alongside `initSetQueue()` in `_layout.tsx`; cleared on sign-out
  in `auth-context.tsx` (the every-cache-layer doctrine). Server unique index =
  idempotency.
- The FINISH button shows a pending spinner off `finishWorkout.isPending`; queued-offline
  shows an honest toast ("FINISH SAVED · will sync").
- **Displayed across the app**: Home's Quest Card (`index.tsx`) currently derives today's
  quest from logged sets only — it now also reads `useWorkoutSessions()` and shows
  `✓ COMPLETE` the moment the marker exists (covering finished-early workouts that would
  otherwise read as unfinished). Train bars already consume it. The weekly-contract dots
  on Home count marker-finished days as trained.

### 4. FINISH always available + exit-and-lock flow
- In `/workout` (today, editable): FINISH WORKOUT renders **whenever not finished** — the
  `!complete` condition is deleted (closes the no-way-to-finish trap). Disabled until 1
  valid set.
- Ceremony `onFinish`: `finishWorkout.mutate(…)` → `clearActive()` → **`router.back()` to
  Train**. The bar is already green from the optimistic write when Train re-appears.
- KEEP TRAINING / SKIP keep their current semantics (no marker, stay on page).
- REOPEN paths: EDIT on the bar (immediate unlock + navigate in) and REOPEN inside the
  locked page (unlock in place).

## Files

| File | Change |
|---|---|
| `client/src/app/(main)/workout.tsx` | NEW — the workout page (moved logging UI + back arrow) |
| `client/src/data/finish-queue.ts` | NEW — durable offline finish, set-queue pattern |
| `client/src/data/use-day-plan.ts` | NEW — shared plan-resolution hook (extraction, no new logic) |
| `client/src/app/(main)/today.tsx` | hub only: bars navigate, extra ad-hoc bars, chips push |
| `client/src/ui/week-bar.tsx` | navigate-on-tap, EDIT affordance, drop expansion |
| `client/src/domain/week-status.ts` | `extraBarsForToday` helper (pure, tested) |
| `client/src/data/sessions.ts` | optimistic finish + queue fallback |
| `client/src/ui/screen-header.tsx` | optional `onBack` ← |
| `client/src/app/(main)/_layout.tsx` | register `workout` screen; init finish queue; resume → `/workout` |
| `client/src/app/(main)/index.tsx` (+ quest card) | today ✓ COMPLETE from the marker |
| `client/src/data/auth-context.tsx` | clear finish queue on sign-out |

## Commits (each CI-green)

1. **Finish durability** — optimistic update, finish-queue, sign-out clearing, Home
   quest-card marker display. (Standalone value even before the page split.)
2. **The workout page** — `workout.tsx` extraction, `use-day-plan.ts`, ScreenHeader back
   arrow, route registration, resume-into-workout retarget.
3. **Train hub** — bars navigate, EDIT-on-bar, extra ad-hoc bars (`extraBarsForToday` +
   tests), FINISH-always-visible fix, exit-on-finish.

## Verification

- `cd client && npm test` (existing `week-status`, `session-plan`, parity suites stay
  green; new `extraBarsForToday` tests), `npx tsc --noEmit`, `npx expo lint`.
- Falsify once: re-add the `!complete` condition → the "finish after KEEP TRAINING" manual
  flow fails; remove it again.
- Manual flows:
  1. Tap a bar → full page opens with back arrow → back returns to Train with all bars.
  2. Log all sets → ceremony → KEEP TRAINING → **FINISH button still there** → tap →
     ceremony → FINISH → lands on Train, bar green + 🔒 + EDIT. **Check the Supabase table
     editor: the `workout_sessions` row exists.**
  3. Airplane mode → FINISH → "will sync" toast, bar green (optimistic) → network back →
     row appears in Supabase; reload → still green.
  4. Tap locked bar → read-only recap; tap EDIT on bar → unlocked editing; finish again.
  5. Home screen shows ✓ COMPLETE on today's quest after finishing early with sets left.
  6. Start empty workout → it appears as an extra bar → finish → bar green.
  7. Cold-start mid-workout → app reopens into `/workout`, not just Train.

## Risks

- **The extraction is the risk.** `today.tsx` is 955 lines with interleaved state; the
  split must move behavior, not change it. Run the full manual matrix (sources × ad-hoc ×
  finished × no-schedule) after commit 2 before starting commit 3.
- The optimistic marker must use a temp id and reconcile on invalidation, or REOPEN could
  try to delete a row by an id that never existed server-side (delete-by-`(date,workout)`
  for temp ids is the fix).
- Tab-press scroll-to-top (`scroll-registry`) should still work on the pushed page —
  register its ScrollView like the tab screens do.

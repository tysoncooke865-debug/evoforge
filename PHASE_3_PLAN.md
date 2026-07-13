# Stage 1 — Improve the Workout Log Experience (Expo client)

## Context

The Expo client's logging loop (`client/src/app/(main)/today.tsx`) is entirely plan-driven: exercises and set counts come from either the generated PPPPLA `ROUTINE` or the single-slot `custom_workout_plan`, and the user cannot deviate mid-workout. Stage 1 of the improvement plan makes the log flexible and personal: start an empty workout, add/remove/skip exercises mid-session, add/remove sets, a searchable exercise library with user-created custom exercises, more split presets, split selection during onboarding, user-named workouts, and saving a completed workout as a reusable routine — all with minimal taps.

**User decisions (confirmed):**
- New Supabase tables via migration `016` (`user_exercises`, `routines`), owner-only RLS, run by hand in the SQL editor.
- Remove-set affects **unlogged slots only** — logged sets are immutable (XP ledger is append-only; deleting a logged row causes XP drift).
- Onboarding gets a **light split-preset picker**; "build my own" routes to the routine builder after onboarding.

**Load-bearing constraints (from CLAUDE.md / exploration):**
- `client/src/domain/catalogs.ts` is GENERATED — never hand-edit. `domain/workouts.ts::inferMuscleGroup` / `MUSCLE_MAP` and XP numbers are pinned by the 3,323-case parity suite — untouched.
- `custom_workout_plan` is read by Streamlit — never add columns. It stays the single-slot "MY PLAN" store.
- `workout_log.workout` is the grouping key for "a workout"; a user-named workout is just a new string in that column (verified safe: `computeStreak` is date-only, `scheduled_streak()` checks `date + weight>0` name-agnostically, `inferMuscleGroup` is per-exercise).
- Sign-out must clear every new store (`auth-context.tsx` doctrine).
- Test runner is **Vitest 4** (`cd client && npm test`), Zustand 5 already a dependency.

## Architecture decisions

### Session-override layer (add/remove/skip/set-delta/ad-hoc)
One persisted Zustand store, `client/src/state/session-store.ts` (AsyncStorage via `zustand/middleware persist`, key `evoforge-session-v1`), so a mid-workout force-close doesn't lose overrides. Self-expiring: stamps `date`; any access on a different day treats state as empty. `reset()` wired into `signOut`.

```ts
interface SessionExercise { exercise: string; sets: number; reps: string }
interface DayOverrides {
  added: SessionExercise[];          // rendered after plan exercises
  removed: string[];                 // gone from today's math
  skipped: string[];                 // visible ghost row, obligation clamped to logged
  setDelta: Record<string, number>;  // exercise -> ±slots vs plan
}
interface SessionState {
  date: string;
  days: Record<string, DayOverrides>;
  adhoc: { name: string; exercises: SessionExercise[] } | null;
  // actions: addExercise, removeExercise, restoreExercise, toggleSkip,
  //          bumpSets, startAdhoc, addAdhocExercise, endAdhoc, reset
}
```

**Remove vs skip semantics:**
- **Skip** = "not today": card collapses to one ghost row (`name · SKIPPED · UNDO`); target contribution becomes `min(planSets, loggedValidCount)` so already-logged sets keep counting and `+N XP TODAY` stays honest.
- **Remove** = card disappears, contributes 0/0.
- **Guard:** removing an exercise with ≥1 valid logged set **degrades to skip** (toast: "Sets already logged — skipped instead"). Removing it outright would drop its sets from `totalDone` while the XP stays banked — the summary would lie.

**Set clamping:** `effectiveSets = clamp(planSets + setDelta, max(1, maxLoggedSetNo), 8)` — remove-set can never orphan a rendered logged row.

All the math lives in a **pure module** `client/src/domain/session-plan.ts`:
`buildEffectivePlan(basePlan, overrides, loggedValidCount, loggedMaxSetNo): EffectiveEntry[]` and `planTotals(entries, loggedValidCount)` — unit-testable without React. The existing `subs` substitution map stays as component state (shipped, working).

### Migration 016 — `migrations/016_user_exercises_routines.sql`
Follows the `012_workout_schedule.sql` pattern. Two tables, additive, Streamlit never reads them:

```sql
create table if not exists public.user_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 60),
  muscle text not null,                 -- inferMuscleGroup-compatible fine-grained tag
  created_at timestamptz not null default now()
);
create unique index ... on (user_id, lower(trim(name)));
-- enable RLS + four owner policies (select/insert/update/delete, user_id = auth.uid())

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 60),
  payload jsonb not null,               -- { version: 1, exercises: [{exercise, sets, reps}] }
  created_at timestamptz not null default now()
);
-- same unique index + RLS pattern
```
`routines.payload` is jsonb, **single-day** (a saved workout, not a multi-day split — those live in `custom_workout_plan`). Client degrades gracefully while the tables don't exist yet.

### Exercise picker (search + create custom)
- Pure search: `client/src/domain/exercise-search.ts` — `searchExercises(query, userExercises)` merges `EXERCISE_LIBRARY` + user exercises, case-insensitive substring on name/muscle, grouped by `LIBRARY_SECTIONS` (+ "MINE"), returns `hasExactMatch`.
- Component: `client/src/ui/exercise-picker.tsx` — `ExercisePicker({visible, onClose, onPick, excludeNames?})`, bottom-sheet styled like today.tsx's substitution modal: search input, section chips, result chips, and a highlighted `＋ CREATE "<query>"` row when no exact match → inline muscle-tag chips (the ~16 fine-grained tags under their 6 section headers) → creates via `useCreateUserExercise` then fires `onPick` immediately.
- Data: `client/src/data/exercises.ts` — `useUserExercises()` (`['user_exercises', userId]`), `useCreateUserExercise()` (unique-violation → friendly toast).
- Muscle resolution for custom names: `resolveMuscle(exercise, userExercises)` (exact match wins, else `inferMuscleGroup`). Threaded into `data/mutations.ts` (set save row build), `data/set-queue.ts` (`QueuedSet` gains optional `muscle`, resolved at enqueue), `domain/custom-plan.ts::flattenPlan` (optional `userExercises` param, default `[]` keeps parity byte-identical). Heat-map site (`domain/avatar-stats-calc.ts`) is a fast-follow — unresolved customs fall into the existing fallback bucket.

### Save-as-routine / start-a-routine
- Save: `SummarySheet` gains optional `onSaveRoutine?` + a ghost `SAVE AS ROUTINE` button (summary phase only) flipping to an inline name input, prefilled with the day name. today.tsx builds the performed list (exercises with ≥1 valid row, `sets = validRowsFor(e).length`).
- Data: `client/src/data/routines.ts` — `useRoutines`, `useSaveRoutine`, `useDeleteRoutine`.
- Start: `startAdhoc({name, exercises})` → navigate to `/today`. **Never touches `custom_workout_plan`.** Surfaced in the empty-workout sheet on today.tsx and a "MY ROUTINES" card at the top of routine.tsx step 0 (START TODAY / delete).

### Split presets + seeds (`client/src/domain/exercise-library.ts` — hand-edited, NOT generated)
- `DAY_PRESETS`: Chest & Back, Arms, Legs & Core, Upper, Lower, Push, Pull, Legs, Full Body — 4–6 staples each, names copied verbatim from `EXERCISE_LIBRARY` (test pins this).
- New `SPLITS` entries composed from them (e.g. `cbal3` Chest&Back/Arms/Legs&Core · 3 days) + `{key:'custom', name:'Custom · name your own days', days:[]}`.
- `seedPlanForSplit(splitKey): CustomPlan | null` (null for custom); `defaultScheduleFor(splitKey)`: weekday→day jsonb for `workout_schedule` (3-day→Mon/Wed/Fri, 4→Mon/Tue/Thu/Fri, 5→Mon–Fri, 6→Mon–Sat).
- routine.tsx: `custom` split shows "+ ADD DAY" (name input, ≤7 days); preset splits get one-tap "PREFILL WITH STAPLES" per day.

### Onboarding TRAINING section (`client/src/app/onboarding.tsx`)
New section between FUEL/SCAN and GO PUBLIC: chips for a curated subset of `SPLITS` + `BUILD MY OWN` + `SKIP FOR NOW` (default skip — onboarding stays fast). In `forge()`, after profile insert, in its own try/catch (the public_profile "never blocks" pattern):
1. Preset → `seedPlanForSplit` → `acceptPlanDirect(plan)` (extracted from `useAcceptPlan` body in `data/mutations.ts` so hook and onboarding share it) + upsert `workout_schedule` via `defaultScheduleFor`.
2. `BUILD MY OWN` → retarget the existing redirect: `<Redirect href={wantBuilder ? '/routine' : '/'} />`.

### ExerciseCard controls (`client/src/ui/exercise-logger.tsx`)
All new props optional (Battle Arena usage untouched):
`onRemove?` (✕ top-right of header), `onSkip?`, `skipped?` (ghost row + UNDO), `onAddSet?`, `onRemoveSet?` (undefined when at min).
UI: **inline footer row** under the set rows — `＋ SET   − SET        SKIP TODAY` (44px targets, muted) — one visible tap per action, no kebab/long-press. Big `＋ ADD EXERCISE` ghost NeonButton after the card list.

### Empty workout (today.tsx)
`START EMPTY WORKOUT` entry (near BUILD MY OWN ROUTINE link; prominent when the plan is empty) opens a sheet: name input (default "Workout", trimmed, ≤40 chars, rejected if it collides with an existing day-chip name — pure helper `adhocNameError(name, existingDays)`) + saved routines list. Active ad-hoc renders as an extra highlighted day chip under both plan sources; header shows the custom name; `END WORKOUT` clears after summary. Rows write to `workout_log` with `workout = name`.

## Phases (each a coherent, CI-green commit)

1. **Foundations** — `migrations/016_user_exercises_routines.sql`; `data/exercises.ts`; `data/routines.ts`; `domain/exercise-search.ts`; `domain/session-plan.ts`. Tests: `exercise-search.test.ts`, `session-plan.test.ts` (skip clamps, remove zeroes, setDelta clamps to `[max(1,loggedMaxSetNo),8]`, degrade-to-skip decision as pure `removeAction()`, totals honest).
2. **Session store + today.tsx + card controls** — `state/session-store.ts`; `auth-context.tsx` reset on sign-out; `exercise-logger.tsx` new props/footer/skipped row; today.tsx swaps lines ~107–124 for `buildEffectivePlan`/`planTotals` and wires callbacks + `＋ ADD EXERCISE`.
3. **Picker + custom exercises** — `ui/exercise-picker.tsx`; wire into today.tsx (picked → `addExercise(day, {exercise, sets:3, reps:'8-12'})`) and routine.tsx (`🔍 SEARCH / CUSTOM` chip); muscle threading (`mutations.ts`, `set-queue.ts`, `flattenPlan`).
4. **Empty workout + named workouts + save-as-routine** — today.tsx ad-hoc flow; `summary-sheet.tsx` `onSaveRoutine`; `adhocNameError` + tests.
5. **Split presets + routine-builder upgrades** — `exercise-library.ts` (`DAY_PRESETS`, new `SPLITS`, `seedPlanForSplit`, `defaultScheduleFor`); routine.tsx MY ROUTINES card, custom-day naming, prefill. Test: `exercise-library.test.ts` pins every seed name to the library, schedule shape.
6. **Onboarding TRAINING section** — onboarding.tsx; extract `acceptPlanDirect` in mutations.ts.

Phases 2+3 land as adjacent commits in one PR (the ADD EXERCISE button needs the picker).

## Verification

- `cd client && npm test` (Vitest — new suites + 3,323 parity cases stay green; `catalogs.ts`, `workouts.ts`, XP untouched).
- `npx tsc --noEmit` (run an expo command first for `expo-env.d.ts`), `npx expo lint`, `node scripts/verify-tokens.mjs`.
- **Falsify each new guard once** (repo doctrine): break a seed name → red; break the set clamp → red; restore.
- Manual flows (Expo dev build, after running migration 016 by hand in the Supabase SQL editor):
  1. Built-in day → add exercise → log a set → remove an unlogged slot → skip another exercise → day bar + XP TODAY consistent → force-close mid-workout → overrides survive.
  2. Remove an exercise with a logged set → degrade-to-skip toast; totals unchanged.
  3. Search a hit ("bulgarian") and a miss → CREATE row → pick muscle → appears under MINE → log a set → muscle stats attribute it.
  4. START EMPTY WORKOUT → name → 3 exercises → log → FINISH → SAVE AS ROUTINE → sign out/in → routine listed → START TODAY loads it.
  5. Fresh account → onboarding preset → Today shows MY PLAN + scheduled chip; another fresh account → BUILD MY OWN → lands in /routine; kill network during seed → onboarding still completes.
  6. Sign out → session store / routines / custom exercises gone from UI.

## Risks

- Zustand persist hydrates async — today.tsx tolerates one pre-hydration render (empty overrides flash) or gates on `hasHydrated()`.
- `loggedMaxSetNo` must count optimistic queued rows too (it reads the same cache — add a test).
- `flattenPlan`'s new optional param defaults to `[]` so the parity suite stays byte-identical.
- Ad-hoc day chip must render under both BUILT-IN and MY PLAN sources.
- Ad-hoc workouts extend the scheduled streak (`scheduled_streak()` is name-agnostic) — a bonus, not a bug; note in commit message.

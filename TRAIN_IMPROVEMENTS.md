# Finish-workout fix + collapsible week-bar workouts (Expo client)

## Context

Two connected problems on the Today screen (`client/src/app/(main)/today.tsx`):

1. **Bug: FINISH WORKOUT doesn't finish anything.** `finishEarly()` only opens the
   summary sheet. "Complete" is *derived* every render (`totalDone >= totalTarget`), so a
   workout finished early snaps back to "in progress" the moment the sheet closes. Nothing
   anywhere records "the athlete ended this workout."
2. **UI: workouts should be collapsible bars.** The Today page should list the week's
   workouts as individual bars (workout name + status label on the right: grey IN PROGRESS,
   red MISSED, green COMPLETED). Opening a bar drops down the set/rep logging UI; finishing
   collapses it. Completed workouts become uneditable.

**User decisions (confirmed):**
- Bars are **whole workouts/split days** (a THIS WEEK list), not exercises.
- The finished marker lives in a **new Supabase table** (`workout_sessions`, migration 017).
- Uneditable **with a REOPEN hatch** (fat-fingered FINISH must be recoverable).

## Design

### Status semantics (backwards-compatible — critical)
No historical workout has a finish marker, so status derivation must not require one:

| Status | Rule |
|---|---|
| **COMPLETED** (green) | a `workout_sessions` row exists for (date, workout), **OR** the date is past and ≥1 valid set (`weight>0 && reps>0`) was logged for it — pre-feature history stays green |
| **MISSED** (red) | scheduled date is past, no marker, zero valid sets |
| **IN PROGRESS** (grey) | the date is today and no marker (whether or not sets exist yet) |
| upcoming (dim `—`) | future date |
| REST (dim, non-interactive) | schedule says Rest |

Locking, however, keys **only on the marker** — history without markers stays editable
exactly as today; only an explicit FINISH locks.

### Migration 017 — `migrations/017_workout_sessions.sql`
Follows the 012 pattern. Streamlit never reads it.

```sql
create table if not exists public.workout_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  workout     text not null check (length(trim(workout)) between 1 and 80),
  finished_at timestamptz not null default now(),
  unique (user_id, date, workout)
);
alter table public.workout_sessions enable row level security;
-- owner-only policies: select, insert, delete (no update — REOPEN deletes the row)
```

### Data layer — `client/src/data/sessions.ts` (new)
- `useWorkoutSessions()` — key `['workout_sessions', userId]`, select `id,date,workout,finished_at`.
- `useFinishWorkout()` — insert `{date, workout}`; on unique-violation treat as already
  finished (idempotent); invalidate. Also fire the existing `workout_complete` coin claim
  (`useClaimCoin`) — the 013 server guard (10-valid-set floor + unique index) decides
  eligibility, not the client.
- `useReopenWorkout()` — delete by id; invalidate.
- If the table doesn't exist yet (migration not run), the query errors → treat as "no
  sessions": status degrades to the derived rules, FINISH shows a toast error. The app is
  correct on both sides of the migration.

### Pure domain — `client/src/domain/week-status.ts` (new, unit-tested)
```ts
export type WorkoutStatus = 'completed' | 'missed' | 'in_progress' | 'upcoming' | 'rest';
export interface WeekBar { date: string; dow: number; workout: string | null; status: WorkoutStatus; sessionId: string | null }

/** The schedule row in force on `date`: last row with effective_from <= date. */
export function scheduledDayFor(date: string, rows: ScheduleRow[]): string | null;

/** Monday-start UTC week containing todayIso -> 7 bars (rest days included, dim). 
 *  Returns null when no schedule row is in force (caller falls back to legacy chips). */
export function buildWeekBars(
  scheduleRows: ScheduleRow[],
  sessions: readonly {id: string; date: string; workout: string}[],
  hasValidSets: (date: string, workout: string) => boolean,
  todayIso: string,
): WeekBar[] | null;
```
`ScheduleRow` (`{effective_from, plan}`) already exists in `domain/scheduled-streak.ts`;
`useWorkoutSchedule` (`data/schedule.ts`) already returns rows oldest-first. All date math
UTC (`getUTCDay`), consistent with the rest of the app.

### Today screen restructure — `client/src/app/(main)/today.tsx`
Kept: ScreenHeader, LIFT|CARDIO tabs, RestTimerBar, BUILT-IN/MY PLAN source toggle, the
substitution sheet, cardio panel — all unchanged.

Replaced: the day-chip row + always-expanded logging column becomes:

- **THIS WEEK list** — one `WeekBarRow` per bar (new `client/src/ui/week-bar.tsx`):
  weekday label · workout name · status chip on the right (grey = `text-mute`,
  red = `danger`, green = `success`, from `theme/tokens`). Chevron ▸/▾.
- **Today's bar auto-expands on mount** (the "open → sets and reps drop down" ask); its
  expanded body is the existing logging UI verbatim (day progress GlowCard, `ExerciseCard`
  list, FINISH button). The body stays **mounted** and toggles via `display` — the existing
  keep-mounted pattern — so half-typed SetRow state survives collapse/expand.
  Expand/collapse animates with a `LayoutAnimation`/Reanimated layout transition.
- **Past bars** expand to a read-only recap (logged sets per exercise; MISSED shows
  "0 SETS LOGGED"). **Future bars** expand to a read-only exercise preview. Only today logs.
- **Finished today** = bar collapses (after the ceremony closes), status flips green, body
  renders locked (below), with `✓ COMPLETE · REOPEN` in the expanded header. REOPEN calls
  `useReopenWorkout` and unlocks/expands again.
- **Day override stays**: a small `SWAP DAY` affordance on today's bar opens the split-day
  chips (existing `dayChoice` state) so training off-schedule is still one tap.
- **No schedule yet** → `buildWeekBars` returns null → render the current chip layout plus
  a `SET YOUR WEEK →` link to `/schedule`. Nothing regresses for schedule-less users.
- The auto-complete ceremony effect keys off the marker too: if today is already finished,
  never re-fire the sheet (replaces the `announcedRef` guard being the only defence).

### Finish flow — the actual bug fix
`SummarySheet` (`client/src/ui/summary-sheet.tsx`) gains an optional `onFinish?: () => void`:
- When provided, the **last phase's primary button becomes `FINISH WORKOUT`** (calls
  `onFinish` then closes) and a ghost `KEEP TRAINING` (plain `onClose`) sits beside SKIP's
  slot. `onFinish` runs `useFinishWorkout` → marker row → bar green + locked + collapsed.
- Both entry points converge here: the auto-complete ceremony **and** `finishEarly()`.
  Finishing with sets left now sticks — that's the bug, fixed by the marker.
- Existing testIDs (`summary-done`, `summary-close`) keep their identities (tutorial tour
  depends on them); `summary-done` becomes the finish action.

### Locking — `client/src/ui/exercise-logger.tsx`
New optional `readOnly?: boolean` on `ExerciseCard` (default false — Battle Arena unaffected):
- SetRows render as static text rows (`SET 1 · 80 kg × 8`) — no NumberFields, no LOG/UPDATE.
- Unlogged slots render dim placeholders. Header keeps name + `✓ DONE`/count; substitution
  and (future Stage-1) controls hidden.
- Reused for past-bar recaps and the finished-today state. Client-side UX lock only (RLS
  still permits updates — this is not a security boundary, and the XP contract already makes
  edits grant nothing).

## Files

| File | Change |
|---|---|
| `migrations/017_workout_sessions.sql` | NEW — table + RLS |
| `client/src/data/sessions.ts` | NEW — useWorkoutSessions / useFinishWorkout / useReopenWorkout |
| `client/src/domain/week-status.ts` | NEW — scheduledDayFor, buildWeekBars (pure) |
| `client/src/ui/week-bar.tsx` | NEW — bar row + status chip |
| `client/src/app/(main)/today.tsx` | restructure: week list, expand/collapse, finish wiring, swap-day, no-schedule fallback |
| `client/src/ui/summary-sheet.tsx` | `onFinish` + FINISH WORKOUT / KEEP TRAINING buttons |
| `client/src/ui/exercise-logger.tsx` | `readOnly` mode |
| `client/src/domain/__tests__/week-status.test.ts` | NEW — status matrix + effective-dating |

## Commits (each CI-green)

1. **Migration + sessions data layer + week-status domain + tests.** Status matrix pinned:
   past+sets → completed; past+marker → completed; past+neither → missed; today → in_progress;
   future → upcoming; rest days; effective-from dating picks the row in force *on that date*;
   no schedule → null (and the test asserts the bar list is non-empty when a schedule exists
   — a guard that cannot fail is not a guard).
2. **SummarySheet finish actions + ExerciseCard readOnly.** Both behind optional props;
   existing consumers byte-identical.
3. **Today restructure.** Week bars, auto-expand today, collapse on finish, locked state +
   REOPEN, swap-day, read-only past/future expansion, no-schedule fallback.

## Verification

- `cd client && npm test` (new week-status suite + 3,323 parity cases stay green — no
  domain-port files touched), `npx tsc --noEmit`, `npx expo lint`.
- Falsify once: flip the past+sets rule to missed → status test red; restore.
- Manual (after running 017 in the Supabase SQL editor):
  1. Log 2 of 12 sets → FINISH WORKOUT → ceremony → FINISH → bar turns green, collapses,
     reload app → **still green/locked** (the bug: previously reverted to in progress).
  2. Expand finished workout → inputs are static text, no LOG buttons → REOPEN → editable
     again, bar back to grey.
  3. Ceremony → KEEP TRAINING → nothing locks, bar stays grey.
  4. A scheduled day last week with no sets shows MISSED red; a day with logged sets but
     no marker (pre-feature history) shows COMPLETED green.
  5. Account without a schedule → legacy chips + SET YOUR WEEK link; set a schedule →
     week bars appear.
  6. Second device / fresh install: finished-today state syncs (marker is in Supabase).
  7. Cardio tab, MY PLAN toggle, substitution, rest timer: unchanged behaviour.

## Risks / notes

- **Ordering vs PHASE_3_PLAN.md (Stage 1):** both plans restructure today.tsx. Recommend
  landing THIS plan first — it's smaller, fixes a live bug, and Stage 1's session-override
  layer then renders inside the expanded bar body with no conflict. If Stage 1 goes first,
  the week-bar work wraps its effective-plan output instead; the seams are compatible.
- **"Swap day" + marker key:** the marker is keyed (date, workout-name). Swapping days after
  finishing one workout allows a second workout the same date — each gets its own bar
  status via its own name. Intended.
- **Derived-complete but KEEP TRAINING:** the coin claim already fires on derived complete
  today; it stays, and finish also claims — the 013 unique index dedupes server-side.
- **Set-queue flush after finish:** a queued set confirming after FINISH still lands in
  `workout_log` (correct — it was logged before finishing); the locked UI simply displays it.

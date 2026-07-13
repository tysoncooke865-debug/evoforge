-- EvoForge 017 — "the athlete ended this workout"
-- (TRAIN_IMPROVEMENTS.md; Tyson, 2026-07-14).
--
-- THE BUG THIS FIXES: FINISH WORKOUT finished nothing. `complete` was DERIVED
-- every render (done >= target), so a workout finished early snapped straight
-- back to "in progress" the moment the summary closed. Nothing anywhere
-- recorded the athlete's decision to stop.
--
-- A marker row IS that decision. It is deliberately NOT a column on
-- workout_log: a workout is not a set, and the log is the XP ledger's source
-- of truth — the one table whose rows must never be rewritten.
--
-- BACKWARDS COMPATIBILITY IS THE HARD PART. No historical workout has a marker,
-- and inventing one for 646 old rows would be fiction. So STATUS derives
-- without needing a marker (past + sets logged = completed), while LOCKING keys
-- ONLY on the marker: history stays editable exactly as it is today, and only
-- an explicit FINISH locks anything. See domain/week-status.ts, which is where
-- that rule is written down and tested.
--
-- No update policy: REOPEN deletes the row. There is no such thing as
-- half-finishing a workout.
--
-- FALSIFICATION (two real signed-in users):
--   1. A finishes a workout; B sees no row.                            [RLS]
--   2. A finishes the same (date, workout) twice -> one row.        [unique]
--   3. B cannot delete A's marker.                                     [RLS]
--   4. workout name outside 1..80 chars -> rejected.                 [check]

create table if not exists public.workout_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  workout     text not null check (length(trim(workout)) between 1 and 80),
  finished_at timestamptz not null default now(),
  unique (user_id, date, workout)
);

alter table public.workout_sessions enable row level security;

drop policy if exists workout_sessions_owner_select on public.workout_sessions;
create policy workout_sessions_owner_select on public.workout_sessions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists workout_sessions_owner_insert on public.workout_sessions;
create policy workout_sessions_owner_insert on public.workout_sessions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists workout_sessions_owner_delete on public.workout_sessions;
create policy workout_sessions_owner_delete on public.workout_sessions
  for delete to authenticated using (user_id = auth.uid());

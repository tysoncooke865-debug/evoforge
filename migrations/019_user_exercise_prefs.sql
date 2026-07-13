-- EvoForge 019 — per-athlete exercise preferences (favourites, hidden)
-- for the redesigned Add Exercise menu (Tyson, 2026-07-14).
--
-- WHY A SEPARATE TABLE: the exercise LIBRARY is shipped in the bundle and is
-- the same for everyone; what an athlete FEELS about an exercise is theirs.
-- Mixing the two would mean a per-user copy of 960 rows to store one star.
--
-- Keyed by exercise NAME, not an id, because the library has no database ids —
-- it is a TypeScript constant, and workout_log has always keyed on the name
-- too. Keeping one key means favourites, history and logged rows all line up
-- without a migration of every historical row (which the XP ledger would not
-- survive: those rows are what granted the XP).
--
-- Nothing here is required for logging. If the table does not exist, the menu
-- simply has no favourites — reads degrade to empty.
--
-- FALSIFICATION (two real signed-in users):
--   1. A stars an exercise; B sees no rows.                            [RLS]
--   2. A stars the same exercise twice -> one row (upsert).         [unique]
--   3. B cannot delete A's row.                                        [RLS]
--   4. Name outside 1..80 chars -> rejected.                         [check]

create table if not exists public.user_exercise_prefs (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise     text not null check (length(trim(exercise)) between 1 and 80),
  is_favourite boolean not null default false,
  is_hidden    boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (user_id, exercise)
);

alter table public.user_exercise_prefs enable row level security;

drop policy if exists user_exercise_prefs_owner_select on public.user_exercise_prefs;
create policy user_exercise_prefs_owner_select on public.user_exercise_prefs
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_exercise_prefs_owner_insert on public.user_exercise_prefs;
create policy user_exercise_prefs_owner_insert on public.user_exercise_prefs
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists user_exercise_prefs_owner_update on public.user_exercise_prefs;
create policy user_exercise_prefs_owner_update on public.user_exercise_prefs
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_exercise_prefs_owner_delete on public.user_exercise_prefs;
create policy user_exercise_prefs_owner_delete on public.user_exercise_prefs
  for delete to authenticated using (user_id = auth.uid());

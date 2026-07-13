-- EvoForge 016 — user-created exercises + saved single-day routines
-- (PHASE_3_PLAN Stage 1). Additive; Streamlit reads NEITHER table, and
-- custom_workout_plan is untouched (it stays the single-slot "MY PLAN"
-- store that Streamlit DOES read — never add columns to it).
--
-- Both tables follow the 012 pattern: user_id defaults to auth.uid(), RLS
-- on, owner-only policies, and a case-insensitive unique name per user so
-- "Bulgarian Split Squat" and "bulgarian split squat" cannot both exist.
--
-- user_exercises.muscle is an inferMuscleGroup-compatible fine-grained tag
-- (the same vocabulary as domain/exercise-library.ts). It exists so a
-- custom lift attributes to the right muscle in the heat map instead of
-- landing in the fallback bucket.
--
-- routines.payload is jsonb and SINGLE-DAY by design:
--   { "version": 1, "exercises": [ { "exercise": "...", "sets": 3, "reps": "8-12" } ] }
-- A saved workout, not a multi-day split. Multi-day splits live in
-- custom_workout_plan. Starting a routine NEVER writes custom_workout_plan.
--
-- FALSIFICATION CHECKLIST (run as two different signed-in users):
--   1. insert a row as A; select as B  -> 0 rows.                     [RLS]
--   2. insert with an explicit user_id of B as A -> rejected.  [with check]
--   3. insert the same name twice (different case) as A -> rejected. [uniq]
--   4. delete A's row as B -> 0 rows affected.                        [RLS]
--   5. name of 1 char, or 61 chars -> rejected.                      [check]

create table if not exists public.user_exercises (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (length(trim(name)) between 2 and 60),
  muscle     text not null check (length(trim(muscle)) between 2 and 40),
  created_at timestamptz not null default now()
);

create unique index if not exists user_exercises_owner_name_uniq
  on public.user_exercises (user_id, lower(trim(name)));

alter table public.user_exercises enable row level security;

drop policy if exists user_exercises_owner_select on public.user_exercises;
create policy user_exercises_owner_select on public.user_exercises
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_exercises_owner_insert on public.user_exercises;
create policy user_exercises_owner_insert on public.user_exercises
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists user_exercises_owner_update on public.user_exercises;
create policy user_exercises_owner_update on public.user_exercises
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_exercises_owner_delete on public.user_exercises;
create policy user_exercises_owner_delete on public.user_exercises
  for delete to authenticated using (user_id = auth.uid());


create table if not exists public.routines (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (length(trim(name)) between 2 and 60),
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create unique index if not exists routines_owner_name_uniq
  on public.routines (user_id, lower(trim(name)));

alter table public.routines enable row level security;

drop policy if exists routines_owner_select on public.routines;
create policy routines_owner_select on public.routines
  for select to authenticated using (user_id = auth.uid());

drop policy if exists routines_owner_insert on public.routines;
create policy routines_owner_insert on public.routines
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists routines_owner_update on public.routines;
create policy routines_owner_update on public.routines
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists routines_owner_delete on public.routines;
create policy routines_owner_delete on public.routines
  for delete to authenticated using (user_id = auth.uid());

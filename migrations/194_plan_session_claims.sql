-- EvoForge 194 — TRAIN A PLANNED SESSION EARLY
-- (the training-system upgrade, 2026-08-10).
--
-- THE PROBLEM. Life moves training. Shift changes, travel, a gym that is shut,
-- a body that wants legs today. EvoForge's calendar did not move with it: a
-- future day rendered a card, START opened it, and `/workout` refused to log
-- because `editable = isToday && !finished`. Tomorrow's session was a wall.
--
-- WHY A CLAIM TABLE AND NOT A `completed_at` COLUMN.
--
-- There is no plan-session ROW in this schema to put a column on. A plan here
-- is `workout_schedule` (weekday -> day name) laid over `user_plans` (day name
-- -> exercises); a "session" is not stored anywhere, it is COMPUTED for a date.
-- So the planned session's stable identity is the pair
--
--     (planned_date, workout)
--
-- and that pair is what this table claims. It is the `plan_session_id` the
-- brief asks for, expressed in the architecture that already exists rather
-- than by inventing a session table and migrating a year of history into it.
--
-- WHAT IT DELIBERATELY DOES NOT DO. It does not move the sets. An early
-- session logs to TODAY, like every other set anyone has ever logged, so XP,
-- streaks, PR detection, coin claims, the Evo rating, the finish marker and
-- the week bars all run on exactly the paths they already run on. The ONLY
-- thing this table changes is whether the FUTURE day still offers the session
-- — which is the whole of "do not show the same planned session again on its
-- original scheduled date, and do not duplicate it".
--
--   planned_date    where the plan said it was
--   completed_date  where the athlete actually trained it
--
-- Both are kept, per §2. The pair is what makes the schedule able to answer
-- "this was done, on the 8th, though it was scheduled for the 11th".
--
-- REVERSIBLE BY DESIGN. A row here is created by a deliberate tap and removed
-- by PUT IT BACK or by reopening the session. Nothing else writes it, and
-- deleting one restores the scheduled day exactly — there is no derived state
-- to unwind, because the schedule was never edited.
--
-- Standard 012/016 shape: user_id defaults to auth.uid(), RLS on, owner-only
-- policies, one row per (athlete, planned day, workout).
--
-- FALSIFICATION CHECKLIST (as ALPHA and BRAVO):
--  1. insert as A, select as B                       -> 0 rows.        [RLS]
--  2. insert with an explicit user_id of B, as A     -> rejected. [with check]
--  3. the same (planned_date, workout) twice as A    -> rejected.     [uniq]
--  4. delete A's row as B                            -> 0 affected.    [RLS]
--  5. completed_date before planned_date is ALLOWED  -- that is the feature.
--  6. workout_log and workout_sessions are untouched by any of the above.

create table if not exists public.plan_session_claims (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- The scheduled day this claim releases the athlete from.
  planned_date   date not null,
  -- The workout NAME as the schedule resolved it on that date. Together with
  -- planned_date this is the planned session's identity.
  workout        text not null check (length(trim(workout)) between 1 and 80),
  -- The day they actually trained it. Usually earlier than planned_date; not
  -- constrained to be, because a make-up session is the same idea backwards.
  completed_date date not null default current_date,
  created_at     timestamptz not null default now()
);

create unique index if not exists plan_session_claims_owner_session_uniq
  on public.plan_session_claims (user_id, planned_date, workout);

-- The read is always "this athlete's claims from today forward" (Train only
-- cares about days it still might offer).
create index if not exists plan_session_claims_owner_planned_idx
  on public.plan_session_claims (user_id, planned_date);

alter table public.plan_session_claims enable row level security;

drop policy if exists plan_session_claims_owner_select on public.plan_session_claims;
create policy plan_session_claims_owner_select on public.plan_session_claims
  for select to authenticated using (user_id = auth.uid());

drop policy if exists plan_session_claims_owner_insert on public.plan_session_claims;
create policy plan_session_claims_owner_insert on public.plan_session_claims
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists plan_session_claims_owner_update on public.plan_session_claims;
create policy plan_session_claims_owner_update on public.plan_session_claims
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists plan_session_claims_owner_delete on public.plan_session_claims;
create policy plan_session_claims_owner_delete on public.plan_session_claims
  for delete to authenticated using (user_id = auth.uid());

comment on table public.plan_session_claims is
  'A planned session (planned_date, workout) that the athlete trained on a '
  'different day. Keeps the plan''s SEQUENCE intact while letting the calendar '
  'move: the claimed day stops being offered and is never duplicated. Sets are '
  'always logged against the day they were actually performed.';

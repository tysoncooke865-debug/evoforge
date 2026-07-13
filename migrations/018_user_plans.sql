-- EvoForge 018 — MY PLAN and the AI PLAN stop overwriting each other
-- (Tyson, 2026-07-14).
--
-- THE PROBLEM: custom_workout_plan is a SINGLE SLOT. The routine builder and
-- the AI both wrote it, so forging an AI plan destroyed the split you built by
-- hand, and vice versa. Train could only ever offer "BUILT-IN | MY PLAN",
-- where "MY PLAN" meant "whichever of the two wrote last".
--
-- user_plans gives each KIND its own slot, so Train can offer all three:
-- MY PLAN · AI PLAN · BUILT-IN.
--
-- custom_workout_plan is UNTOUCHED and still written by the AI path, because
-- STREAMLIT READS IT. Never add columns to it; never stop writing it from the
-- AI path without checking the Python app first.
--
-- payload jsonb is the CustomPlan shape the client already speaks:
--   { "plan_name": "...", "days": [ { "day": "...", "goal": "",
--       "exercises": [ { "exercise": "...", "sets": 3, "reps": "8-12",
--                        "reason": "" } ] } ] }
--
-- FALSIFICATION CHECKLIST (as two different signed-in users):
--   1. insert as A; select as B            -> 0 rows.                  [RLS]
--   2. insert with B's user_id as A        -> rejected.         [with check]
--   3. insert kind='custom' twice as A     -> rejected (one slot). [unique]
--   4. insert kind='chaos'                 -> rejected.              [check]
--   5. A upserts kind='custom' twice       -> one row, newest payload.

create table if not exists public.user_plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('custom', 'ai')),
  name       text not null check (length(trim(name)) between 1 and 80),
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- ONE slot per kind: saving a new hand-built split REPLACES the old one,
  -- which is what "my plan" means, and cannot touch the AI one.
  unique (user_id, kind)
);

alter table public.user_plans enable row level security;

drop policy if exists user_plans_owner_select on public.user_plans;
create policy user_plans_owner_select on public.user_plans
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_plans_owner_insert on public.user_plans;
create policy user_plans_owner_insert on public.user_plans
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists user_plans_owner_update on public.user_plans;
create policy user_plans_owner_update on public.user_plans
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_plans_owner_delete on public.user_plans;
create policy user_plans_owner_delete on public.user_plans
  for delete to authenticated using (user_id = auth.uid());

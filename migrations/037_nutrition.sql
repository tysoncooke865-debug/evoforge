-- EvoForge 037 — FUEL: the nutrition tracker (ported from the nutrition
-- branch's 020; renumbered twice — 020 was taken by weight_unit_pref and
-- 036 by friends_rivalry before this landed on mainline).
--
-- TWO TABLES, ONE RULE EACH:
--
--   nutrition_log — one row per logged intake ("lunch, 620 kcal"). `source`
--   exists from day one so the future AI food-photo flow ('photo') is a new
--   value, not a new column. kcal is bounded: a fat-fingered 50000 is data
--   entry, not dinner. `meal_no` added at port time (owner asked for meal
--   tracking): null = an absolute quick-add; 1..N = the meal slot the entry
--   belongs to. The DB allows 1..12 headroom; the client clamps at 8.
--
--   nutrition_targets — EFFECTIVE-DATED like workout_schedule: recalculating
--   the goal never rewrites what past days were judged against. `inputs` is
--   the audit trail (age/activity/weight the calc used); daily_kcal itself is
--   computed CLIENT-SIDE by domain/nutrition.ts from those inputs — the AI
--   only ever supplies fields, never the number (see the domain header).
--
-- FALSIFICATION (two real signed-in users):
--   1. A logs an entry; B sees no row.                                  [RLS]
--   2. A saves two targets on one date -> one row (upsert).          [unique]
--   3. kcal 0 or 6001 -> rejected.                                    [check]
--   4. B cannot delete A's entry.                                       [RLS]
--   5. meal_no 0 or 13 -> rejected.                                   [check]

create table if not exists public.nutrition_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  kcal        numeric not null check (kcal > 0 and kcal <= 6000),
  label       text check (label is null or length(trim(label)) <= 60),
  source      text not null default 'manual' check (source in ('manual', 'photo')),
  meal_no     smallint check (meal_no is null or meal_no between 1 and 12),
  "timestamp" timestamptz not null default now()
);

alter table public.nutrition_log enable row level security;

drop policy if exists nutrition_log_owner_select on public.nutrition_log;
create policy nutrition_log_owner_select on public.nutrition_log
  for select to authenticated using (user_id = auth.uid());

drop policy if exists nutrition_log_owner_insert on public.nutrition_log;
create policy nutrition_log_owner_insert on public.nutrition_log
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists nutrition_log_owner_update on public.nutrition_log;
create policy nutrition_log_owner_update on public.nutrition_log
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists nutrition_log_owner_delete on public.nutrition_log;
create policy nutrition_log_owner_delete on public.nutrition_log
  for delete to authenticated using (user_id = auth.uid());

create table if not exists public.nutrition_targets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  effective_from date not null,
  daily_kcal   integer not null check (daily_kcal between 1000 and 6000),
  goal         text not null check (goal in ('lose', 'maintain', 'gain')),
  inputs       jsonb not null,
  created_at   timestamptz not null default now(),
  unique (user_id, effective_from)
);

alter table public.nutrition_targets enable row level security;

drop policy if exists nutrition_targets_owner_select on public.nutrition_targets;
create policy nutrition_targets_owner_select on public.nutrition_targets
  for select to authenticated using (user_id = auth.uid());

drop policy if exists nutrition_targets_owner_insert on public.nutrition_targets;
create policy nutrition_targets_owner_insert on public.nutrition_targets
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists nutrition_targets_owner_update on public.nutrition_targets;
create policy nutrition_targets_owner_update on public.nutrition_targets
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists nutrition_targets_owner_delete on public.nutrition_targets;
create policy nutrition_targets_owner_delete on public.nutrition_targets
  for delete to authenticated using (user_id = auth.uid());

-- 081_saved_meals_and_goal_triple.sql — FUEL overhaul (NUTRITION_PLAN_2,
-- 2026-07-21): SAVED MEALS (one-tap re-log) + the GOAL TRIPLE on
-- nutrition_targets (CUT/MAINTAIN/BULK switching without an AI call).
--
-- saved_meals: a named, reusable meal. `items` is the SAME MealItem[] shape
-- as nutrition_log.items (043) — full per-ingredient provenance — so logging
-- a saved meal is exactly logging a scanned meal. kcal/macros are
-- DENORMALISED totals for instant list display; the client recomputes on log
-- via scanTotals, which stays the arbiter. unique(user_id, lower(trim(name))):
-- a one-tap list with duplicate names is ambiguous — the client surfaces
-- 23505 as "name taken". No UPDATE policy: v1 has no rename; the smallest
-- surface is the safest one.
--
-- nutrition_targets triple: kcal_lose / kcal_maintain / kcal_gain, nullable.
-- The AI never computed calories (ai-nutrition gathers fields; the client's
-- dailyTarget() does the math) — these columns store all three goals' numbers
-- at intake time so switching goals is a plain effective-dated upsert, zero
-- tokens. Columns over inputs-jsonb because they obey the same 1000..6000
-- CHECK the target itself does, need no parsing on the hot read, and NULL
-- cleanly means "not computed" (legacy / manual rows). `inputs` stays the
-- audit trail of WHAT was answered; the triple is WHAT was computed.
--
-- FALSIFICATION CHECKLIST (ALPHA/BRAVO smoke accounts, then clean up):
--  1. ALPHA inserts a saved meal → 201, reads back with totals.
--  2. Same name case-shifted/padded ("  ABS meal ") → 23505 unique violation.
--  3. items '[]' and a 13-element array → rejected by the CHECK.
--  4. kcal 0 and 6001 → rejected; protein_g 1001 → rejected.
--  5. BRAVO select → zero rows; BRAVO insert with ALPHA's user_id → rejected.
--  6. BRAVO delete of ALPHA's row → zero rows deleted.
--  7. nutrition_targets upsert with kcal_lose 999 → rejected; all-NULL triple
--     and a full valid triple → both accepted.
--  8. Delete every seeded row.

-- Items: a non-empty jsonb array, capped at the scanner's own 12-item slice.
create or replace function public.saved_meal_items_ok(j jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(j) = 'array'
     and jsonb_array_length(j) between 1 and 12;
$$;

create table if not exists public.saved_meals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 60),
  items      jsonb not null,
  kcal       numeric not null check (kcal > 0 and kcal <= 6000),
  protein_g  numeric not null default 0 check (protein_g >= 0 and protein_g <= 1000),
  carbs_g    numeric not null default 0 check (carbs_g >= 0 and carbs_g <= 1500),
  fat_g      numeric not null default 0 check (fat_g >= 0 and fat_g <= 600),
  created_at timestamptz not null default now(),
  constraint saved_meals_items_sane check (public.saved_meal_items_ok(items))
);

create unique index if not exists saved_meals_user_name
  on public.saved_meals (user_id, lower(trim(name)));

alter table public.saved_meals enable row level security;

drop policy if exists saved_meals_select on public.saved_meals;
create policy saved_meals_select on public.saved_meals
  for select using (user_id = auth.uid());

drop policy if exists saved_meals_insert on public.saved_meals;
create policy saved_meals_insert on public.saved_meals
  for insert with check (user_id = auth.uid());

drop policy if exists saved_meals_delete on public.saved_meals;
create policy saved_meals_delete on public.saved_meals
  for delete using (user_id = auth.uid());

grant select, insert, delete on public.saved_meals to authenticated;

-- The goal triple. Same bounds as daily_kcal (037); NULL = not computed.
alter table public.nutrition_targets
  add column if not exists kcal_lose integer
    check (kcal_lose is null or (kcal_lose >= 1000 and kcal_lose <= 6000));
alter table public.nutrition_targets
  add column if not exists kcal_maintain integer
    check (kcal_maintain is null or (kcal_maintain >= 1000 and kcal_maintain <= 6000));
alter table public.nutrition_targets
  add column if not exists kcal_gain integer
    check (kcal_gain is null or (kcal_gain >= 1000 and kcal_gain <= 6000));

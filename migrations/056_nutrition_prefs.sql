-- 056_nutrition_prefs.sql — per-user Fuel preferences: CUSTOM MEAL NAMES
-- (Tyson's improvement doc §8.5, 2026-07-19).
--
-- WHY A TABLE: slot names must survive cross-device (the phone and the
-- computer must agree on what "MEAL 5" is called), so device-local
-- fuel-store is the wrong home; and nutrition_targets is an effective-dated
-- HISTORY table — names are not history. One row per athlete.
--
-- THE CONTRACT: meal_names is a jsonb array of short strings, index = slot-1.
-- '[]' means "all defaults" (BREAKFAST/LUNCH/DINNER/SNACKS/MEAL N). A null
-- or empty-string element means "default for that slot". The client's
-- mealSlotName(slot, names) consults this array first.
--
-- FALSIFICATION CHECKLIST (run as ALPHA/BRAVO smoke accounts, then clean up):
--  1. upsert ['BREAKFAST','PRE-WORKOUT'] as ALPHA → 201/200, reads back.
--  2. a 13-element array → rejected by the CHECK.
--  3. an element longer than 24 chars → rejected.
--  4. a non-string element (42) → rejected.
--  5. BRAVO selects → zero rows (owner-only RLS).
--  6. raw insert with user_id = ALPHA's id AS BRAVO → rejected.

-- Elements: strings only, 1..24 chars after trim, null allowed ("default").
create or replace function public.nutrition_meal_names_ok(j jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(j) = 'array'
     and jsonb_array_length(j) <= 12
     and not exists (
       select 1
       from jsonb_array_elements(j) e
       where jsonb_typeof(e.value) not in ('string', 'null')
          or (jsonb_typeof(e.value) = 'string'
              and (char_length(e.value #>> '{}') > 24
                   or char_length(trim(e.value #>> '{}')) = 0))
     );
$$;

create table if not exists public.nutrition_prefs (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  meal_names jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint nutrition_prefs_names_sane check (public.nutrition_meal_names_ok(meal_names))
);

alter table public.nutrition_prefs enable row level security;

drop policy if exists nutrition_prefs_select on public.nutrition_prefs;
create policy nutrition_prefs_select on public.nutrition_prefs
  for select using (user_id = auth.uid());

drop policy if exists nutrition_prefs_insert on public.nutrition_prefs;
create policy nutrition_prefs_insert on public.nutrition_prefs
  for insert with check (user_id = auth.uid());

drop policy if exists nutrition_prefs_update on public.nutrition_prefs;
create policy nutrition_prefs_update on public.nutrition_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- No delete policy: prefs are overwritten, never removed by the client.

grant select, insert, update on public.nutrition_prefs to authenticated;

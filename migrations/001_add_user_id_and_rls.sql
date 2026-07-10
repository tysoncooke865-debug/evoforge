-- EvoForge 001 — per-user tenancy and row-level security
--
-- Adds `user_id` to all 11 tables, backfills the existing single-user data to
-- the owner's account, then locks every table behind RLS keyed on auth.uid().
--
-- WHY THIS ORDER
--   The column must exist and be filled BEFORE it can be NOT NULL, and RLS must
--   be enabled LAST. Enable RLS first and the backfill (step 2) sees zero rows,
--   because the SQL editor's role would be filtered by the very policy being
--   added.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor. Run STEP 0 and STEP 1. Then create the
--   owner account through the app's sign-up screen (or Authentication -> Users).
--   Paste that user's UUID into STEP 2 and run STEP 2..5.
--
--   Run this against a STAGING project first. Steps 3 and 6 are not reversible
--   without a restore.
--
-- WHY user_id IS NOT IN SUPABASE_TABLE_SCHEMAS
--   That dict is the application's *write* contract: clean_supabase_row() filters
--   every insert payload down to it. Listing `user_id` would send an explicit
--   NULL and violate the NOT NULL constraint. Postgres fills the column itself
--   from `DEFAULT auth.uid()`. The application needs no change to its inserts.


-- ===========================================================================
-- STEP 0 — safety: confirm what we are about to touch
-- ===========================================================================
select table_name, count(*) as columns
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'workout_log', 'bodyweight_log', 'cardio_log', 'bodyfat_log', 'measurements',
    'physique_ratings', 'custom_workout_plan', 'achievements', 'targets',
    'profile', 'avatar_progression'
  )
group by table_name
order by table_name;
-- Expect 11 rows. If a table is missing, stop.

-- Which tables expose an `id` primary key? views/delete_data.py deletes by `id`
-- when it is present and falls back to matching scalar identity columns when it
-- is not. Informational -- nothing here depends on the answer.
select c.relname as table_name, a.attname as pk_column
from pg_constraint k
join pg_class c on c.oid = k.conrelid
join pg_namespace n on n.oid = c.relnamespace
join unnest(k.conkey) as col(attnum) on true
join pg_attribute a on a.attrelid = c.oid and a.attnum = col.attnum
where k.contype = 'p' and n.nspname = 'public'
order by c.relname;


-- ===========================================================================
-- STEP 1 — add the column, nullable, with no default yet
-- ===========================================================================
alter table public.workout_log          add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.bodyweight_log       add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.cardio_log           add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.bodyfat_log          add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.measurements         add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.physique_ratings     add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.custom_workout_plan  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.achievements         add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.targets              add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.profile              add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.avatar_progression   add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- `on delete cascade` makes account deletion a real right-to-erasure.


-- ===========================================================================
-- STEP 2 — backfill the existing rows to the owner
--
-- Find the owner's id with:
--     select id, email from auth.users order by created_at limit 5;
--
-- There is exactly ONE line to edit, marked EDIT ME. The placeholder is `null`
-- rather than a zero-uuid on purpose: a zero-uuid would appear twice -- once as
-- the value, once in the guard checking you replaced it -- and a find-and-
-- replace would hit both, making the guard compare owner_id to itself and fire.
-- `null` cannot be matched by a search for the value you are pasting.
-- ===========================================================================
do $$
declare
  owner_id uuid := null;  -- <<< EDIT ME, e.g. := 'cd771604-31d2-43b6-...'
  t text;
begin
  if owner_id is null then
    raise exception 'Set owner_id on the line marked EDIT ME, then re-run STEP 2.';
  end if;
  if not exists (select 1 from auth.users where id = owner_id) then
    raise exception 'No auth.users row with id %. Create the account first.', owner_id;
  end if;

  foreach t in array array[
    'workout_log', 'bodyweight_log', 'cardio_log', 'bodyfat_log', 'measurements',
    'physique_ratings', 'custom_workout_plan', 'achievements', 'targets',
    'profile', 'avatar_progression'
  ] loop
    execute format('update public.%I set user_id = $1 where user_id is null', t)
      using owner_id;
  end loop;
end $$;

-- Verify: every table must report 0.
select 'workout_log' as t, count(*) as orphans from public.workout_log where user_id is null
union all select 'bodyweight_log',      count(*) from public.bodyweight_log      where user_id is null
union all select 'cardio_log',          count(*) from public.cardio_log          where user_id is null
union all select 'bodyfat_log',         count(*) from public.bodyfat_log         where user_id is null
union all select 'measurements',        count(*) from public.measurements        where user_id is null
union all select 'physique_ratings',    count(*) from public.physique_ratings    where user_id is null
union all select 'custom_workout_plan', count(*) from public.custom_workout_plan where user_id is null
union all select 'achievements',        count(*) from public.achievements        where user_id is null
union all select 'targets',             count(*) from public.targets             where user_id is null
union all select 'profile',             count(*) from public.profile             where user_id is null
union all select 'avatar_progression',  count(*) from public.avatar_progression  where user_id is null;
-- DO NOT CONTINUE until every count is 0. STEP 3 will fail otherwise.


-- ===========================================================================
-- STEP 3 — make it mandatory, and let Postgres fill it from now on
--
-- `default auth.uid()` is what lets the application keep inserting rows without
-- ever mentioning user_id. A client cannot forge it: auth.uid() reads the JWT.
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'workout_log', 'bodyweight_log', 'cardio_log', 'bodyfat_log', 'measurements',
    'physique_ratings', 'custom_workout_plan', 'achievements', 'targets',
    'profile', 'avatar_progression'
  ] loop
    execute format('alter table public.%I alter column user_id set not null', t);
    execute format('alter table public.%I alter column user_id set default auth.uid()', t);
  end loop;
end $$;


-- ===========================================================================
-- STEP 4 — deduplicate achievements, then scope the natural key
--
-- Verified against the live schema: the only constraint on `achievements` is
-- `achievements_pkey PRIMARY KEY (id)`. There is NO unique constraint on
-- `achievement_id`, so users could never have collided -- but nothing has ever
-- stopped the same achievement being inserted twice for the same person either.
-- `domain/achievements.py :: load_achievements()` calls drop_duplicates() to
-- hide exactly that at read time.
--
-- So the unique index below is NEW, and it will fail on existing duplicates.
-- Dedupe first, or STEP 4 aborts after STEP 3 has already made the schema
-- irreversible.
-- ===========================================================================

-- Look before you leap. Run this on its own and read the output.
select user_id, achievement_id, count(*) as copies
from public.achievements
group by user_id, achievement_id
having count(*) > 1
order by copies desc;

-- Keep the row the app already displays. load_achievements() sorts by
-- date_unlocked ascending and keeps the last -- i.e. the most recent unlock.
-- `id` breaks ties so exactly one row survives per (user_id, achievement_id).
-- The ::text casts make this work whether date_unlocked is text or timestamptz,
-- and coalesce stops a NULL comparison from silently keeping a duplicate.
delete from public.achievements a
using public.achievements b
where a.user_id = b.user_id
  and a.achievement_id = b.achievement_id
  and (coalesce(a.date_unlocked::text, ''), a.id::text)
    < (coalesce(b.date_unlocked::text, ''), b.id::text);

-- No-ops on this database (no such constraint). Kept because a project created
-- from an older schema dump may have one.
alter table public.achievements drop constraint if exists achievements_achievement_id_key;
drop index if exists public.achievements_achievement_id_key;

create unique index if not exists achievements_user_achievement_uidx
  on public.achievements (user_id, achievement_id);

-- avatar_progression gets NO unique constraint. It is an append-only snapshot
-- log and `timestamp` has second resolution, so (user_id, timestamp) would
-- reject two snapshots written in the same second. It is indexed in STEP 5.


-- ===========================================================================
-- STEP 5 — indexes
--
-- Every read is "this user's rows, newest first". Without these, RLS turns each
-- query into a full table scan plus a filter.
-- ===========================================================================
create index if not exists workout_log_user_date_idx         on public.workout_log (user_id, date);
create index if not exists bodyweight_log_user_date_idx      on public.bodyweight_log (user_id, date);
create index if not exists cardio_log_user_date_idx          on public.cardio_log (user_id, date);
create index if not exists bodyfat_log_user_date_idx         on public.bodyfat_log (user_id, date);
create index if not exists measurements_user_date_idx        on public.measurements (user_id, date);
create index if not exists physique_ratings_user_date_idx    on public.physique_ratings (user_id, date);
create index if not exists avatar_progression_user_date_idx  on public.avatar_progression (user_id, date);
create index if not exists custom_workout_plan_user_idx      on public.custom_workout_plan (user_id);
create index if not exists achievements_user_idx             on public.achievements (user_id);
create index if not exists targets_user_idx                  on public.targets (user_id);
create index if not exists profile_user_idx                  on public.profile (user_id);


-- ===========================================================================
-- STEP 6 — row-level security
--
-- This is the only thing standing between one user's body measurements and
-- physique photographs and another's. Everything above is preparation.
--
-- `using` governs which rows are visible to select/update/delete.
-- `with check` governs which rows may be written by insert/update.
-- Both are required: `using` alone lets a user INSERT a row owned by someone
-- else, and `with check` alone lets them READ everyone's.
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'workout_log', 'bodyweight_log', 'cardio_log', 'bodyfat_log', 'measurements',
    'physique_ratings', 'custom_workout_plan', 'achievements', 'targets',
    'profile', 'avatar_progression'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_rw', t);
    execute format($f$
      create policy %I on public.%I
        for all
        to authenticated
        using (user_id = auth.uid())
        with check (user_id = auth.uid())
    $f$, t || '_owner_rw', t);
  end loop;
end $$;

-- The `anon` role is granted no policy at all, so an unauthenticated client
-- holding the publishable key reads zero rows. tools/verify_rls.py asserts this.


-- ===========================================================================
-- STEP 7 — verify
-- ===========================================================================
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       count(p.polname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in (
    'workout_log', 'bodyweight_log', 'cardio_log', 'bodyfat_log', 'measurements',
    'physique_ratings', 'custom_workout_plan', 'achievements', 'targets',
    'profile', 'avatar_progression'
  )
group by c.relname, c.relrowsecurity
order by c.relname;
-- Expect 11 rows, rls_enabled = true, policies = 1.

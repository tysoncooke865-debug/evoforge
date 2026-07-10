-- EvoForge 004 — public display name, opt in
--
-- ###########################################################################
-- #  Run this in the Supabase SQL editor. Depends on migrations/001.        #
-- #                                                                         #
-- #  A leaderboard needs a name and a consent flag. This is a SEPARATE table #
-- #  on purpose, NOT columns on `profile`.                                  #
-- ###########################################################################
--
-- WHY A SEPARATE TABLE IS THE SECURITY DECISION
--   `profile` holds bodyweight, bench and squat 1RMs. The leaderboard reads a name
--   ACROSS users, through a `security definer` function that bypasses RLS. If the
--   name lived on `profile`, that function would have the sensitive columns one
--   `select *` away -- one careless edit from leaking body data. A dedicated table
--   makes the publishable surface PHYSICALLY minimal: the worst a bug here can leak
--   is names people chose to publish.
--
-- OPT-IN, AND OFF BY DEFAULT
--   `is_public` defaults false. Nobody is ranked until they set it AND a name. The
--   leaderboard function (migrations/005) filters on both.


-- ===========================================================================
-- STEP 1 — the table
-- ===========================================================================
create table if not exists public.public_profile (
  user_id      uuid        primary key default auth.uid()
                           references auth.users(id) on delete cascade,
  display_name text,
  is_public    boolean     not null default false,
  updated_at   timestamptz not null default now(),

  -- Bounds the UI and the XSS payload. A display name is rendered on OTHER users'
  -- screens; ui/escape.py escapes it, and this caps its length.
  constraint public_profile_name_len
    check (display_name is null or char_length(display_name) between 3 and 24)
);

-- Case-insensitive uniqueness. Partial, so users who never set a name do not all
-- collide on NULL. The app catches the unique violation and says "name is taken".
create unique index if not exists public_profile_name_uidx
  on public.public_profile (lower(display_name))
  where display_name is not null;


-- ===========================================================================
-- STEP 2 — row-level security: owner-only, like every other table
--
-- No cross-user SELECT policy. Another athlete's name is reachable ONLY through
-- public.leaderboard_top() (migrations/005), which returns four columns and nothing
-- else. A stray `select` against this table from one user's JWT sees only their own
-- row -- so even if the leaderboard function were dropped, no name leaks.
-- ===========================================================================
alter table public.public_profile enable row level security;

drop policy if exists public_profile_owner_rw on public.public_profile;
create policy public_profile_owner_rw on public.public_profile
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ===========================================================================
-- STEP 3 — verify, by hand, on STAGING first
--
--   (a) As user A: insert/update your own row, read it back. OK.
--   (b) As user B: `select * from public.public_profile` returns ONLY B's row,
--       never A's -- even after A set is_public = true. The board is the only
--       cross-user path.
--   (c) Try two users claiming the same name (case-insensitive): the second insert
--       must fail on public_profile_name_uidx.
--   (d) A 2-char or 25-char name must fail public_profile_name_len.
-- ===========================================================================

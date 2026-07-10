-- EvoForge 003 — server-side XP sum
--
-- ###########################################################################
-- #  Run this in the Supabase SQL editor. Depends on migrations/002.        #
-- #                                                                         #
-- #  Fixes a live correctness bug: domain/xp_ledger.py :: ledger_xp() sums  #
-- #  xp_events CLIENT-SIDE through a read capped at 2500 rows. A user past   #
-- #  2500 XP events is undercounted and LOSES LEVELS. This moves the sum     #
-- #  into Postgres, where row count is irrelevant.                          #
-- ###########################################################################
--
-- WHY A FUNCTION, NOT A POSTGREST AGGREGATE
--   `select=amount.sum()` over PostgREST needs `db-aggregates-enabled`, which
--   Supabase ships OFF by default. Correctness would then depend on a dashboard
--   toggle the app cannot see. A `security definer` function is unconditional.
--
-- THE ONE LOAD-BEARING LINE
--   `security definer` runs as the function's OWNER and BYPASSES row-level
--   security. So the `where user_id = auth.uid()` is not an optimisation -- it is
--   the ONLY thing stopping this function from summing the whole table for every
--   caller. Delete it and every user sees everyone's XP as their own.
--
-- `set search_path = public` closes the classic definer hijack: without it, a
-- caller could shadow `xp_events` with a table on their own search_path.


-- ===========================================================================
-- STEP 1 — the function
-- ===========================================================================
create or replace function public.xp_total()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(amount), 0)::bigint
  from public.xp_events
  where user_id = auth.uid();
$$;


-- ===========================================================================
-- STEP 2 — who may call it
--
-- Revoke the default `public`/`anon` execute, then grant only `authenticated`.
-- An unauthenticated client must not be able to call a function that reads XP,
-- even though the `auth.uid()` filter would return nothing for it -- defence in
-- depth, and it keeps the surface identical to the tables' own `anon`-locked-out
-- posture that tools/verify_rls.py asserts.
-- ===========================================================================
revoke all on function public.xp_total() from public;
revoke all on function public.xp_total() from anon;
grant execute on function public.xp_total() to authenticated;


-- ===========================================================================
-- STEP 3 — verify, by hand, on STAGING first
--
-- CI cannot run this (no database), the same boundary as verify_rls.py. Run each
-- as the stated role in the SQL editor / via the API.
--
-- (a) As user A (an authenticated session), the function equals a direct sum:
--
--       select public.xp_total();                       -- via A's JWT
--       select coalesce(sum(amount),0) from public.xp_events;  -- as A, RLS-scoped
--     -- the two numbers must match.
--
-- (b) As user B, A's number is unaffected -- B sees B's own sum, never A's.
--
-- (c) As `anon` (the publishable key, no session):
--
--       select public.xp_total();
--     -- must ERROR with "permission denied for function xp_total", NOT return 0.
--
-- Only after (a)-(c) pass on staging should this run against production.
-- ===========================================================================

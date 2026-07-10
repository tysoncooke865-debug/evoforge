-- EvoForge 005 — the leaderboard read surface
--
-- ###########################################################################
-- #  Run in the Supabase SQL editor. Depends on 002 (xp_events), 004        #
-- #  (public_profile), and the profile table (base_level).                 #
-- #                                                                         #
-- #  Every table in this app is owner-only: `using (user_id = auth.uid())`. #
-- #  So ranking -- reading OTHER users' names and XP -- needs a deliberate  #
-- #  hole. This function is that hole, and it is drilled as narrow as it     #
-- #  goes: FOUR columns leave it, and none of them is body data.           #
-- ###########################################################################
--
-- WHY A FUNCTION, NOT A VIEW
--   A Postgres 15 view is `security_invoker = false` by DEFAULT: it runs as its
--   OWNER and BYPASSES the RLS of xp_events and public_profile. That is the exact
--   footgun. A `security definer` FUNCTION also bypasses RLS -- but its RETURNS
--   TABLE signature is a hard, greppable column contract, and a reviewer can see in
--   one place precisely what may leave. A view hides that in a column list nobody
--   re-reads.
--
-- WHAT MAY LEAVE (the whole contract)
--   display_name, xp, base_level, position.  Never email. Never bodyweight. Never
--   a measurement, a body-fat number, or a physique photo. `auth.users` is never
--   joined. Adding a fifth column here is a security change and needs review.
--
-- TWO FILTERS THAT ARE NOT OPTIONAL
--   * is_public = true  -- opt-in. Nobody is ranked without choosing to be.
--   * drift = 0         -- CLAUDE.md's rule, enforced in SQL, not trusted from the
--                          client: an account whose ledger and derived totals
--                          disagree is hidden until it reconciles. Ranking an
--                          unreconciled score is ranking a guess.
--
-- LEVEL IS NOT COMPUTED HERE
--   The curve lives in domain/xp.py and nowhere else. This returns base_level and
--   xp; the app computes the display level via level_and_progress(). Duplicating
--   the curve in SQL would be a second source of truth for what a level means.


create or replace function public.leaderboard_top(n integer default 50)
returns table (
  display_name  text,
  xp            bigint,
  base_level    integer,
  rank_position bigint          -- NOT `position`: that is a SQL reserved word
)
language sql
security definer
set search_path = public
stable
as $$
  with ledger as (
    select e.user_id, sum(e.amount)::bigint as ledger_xp
    from public.xp_events e
    group by e.user_id
  ),
  -- The reconciliation oracle, server-side, mirroring 002 STEP 4 exactly. A set is
  -- 10, a cardio minute is floor(minutes*2). Diverge from those literals and honest
  -- accounts get hidden as "drift".
  derived as (
    select w.user_id, sum(10)::bigint as derived_xp
    from public.workout_log w
    where w.weight > 0 and w.reps > 0
    group by w.user_id
  ),
  derived_cardio as (
    select c.user_id, sum(floor(c.minutes * 2)::int)::bigint as derived_xp
    from public.cardio_log c
    where c.minutes is not null and floor(c.minutes * 2)::int > 0
    group by c.user_id
  ),
  totals as (
    select
      coalesce(l.user_id, d.user_id)                          as user_id,
      coalesce(l.ledger_xp, 0)                                as ledger_xp,
      coalesce(d.derived_xp, 0) + coalesce(dc.derived_xp, 0)  as derived_xp
    from ledger l
    full outer join derived d   on d.user_id  = l.user_id
    left join derived_cardio dc on dc.user_id = coalesce(l.user_id, d.user_id)
  ),
  ranked as (
    select
      pp.display_name,
      t.ledger_xp                                             as xp,
      coalesce(pr.base_level, 1)::int                         as base_level
    from totals t
    join public.public_profile pp on pp.user_id = t.user_id
    left join public.profile pr   on pr.user_id = t.user_id
    where pp.is_public = true
      and pp.display_name is not null
      and t.ledger_xp = t.derived_xp        -- drift = 0
  )
  select
    display_name,
    xp,
    base_level,
    row_number() over (order by xp desc, display_name asc) as rank_position
  from ranked
  order by xp desc, display_name asc
  limit greatest(0, least(coalesce(n, 50), 200));
$$;

revoke all on function public.leaderboard_top(integer) from public;
revoke all on function public.leaderboard_top(integer) from anon;
grant execute on function public.leaderboard_top(integer) to authenticated;


-- ===========================================================================
-- STEP 2 — verify, by hand, before trusting it
--
--   (a) As user A, opted OUT (is_public=false): A does NOT appear.
--       Set is_public=true with a display_name -> A appears exactly once.
--   (b) The result has EXACTLY four columns. `select * from leaderboard_top(50)`
--       -- confirm no email, no bodyweight, nothing else ever comes back.
--   (c) As `anon`: `select * from public.leaderboard_top(50)` -> permission denied.
--   (d) Create drift for A (insert an xp_events row with no matching workout_log,
--       e.g. kind='adjustment' -- possible until migrations/006): A DISAPPEARS
--       from the board. Remove it: A returns. This is the drift=0 refusal working.
-- ===========================================================================

-- EvoForge 014 — the leaderboard learns about server-granted XP
--
-- THE BUG (found by #13's privacy falsification, 2026-07-12): 005's
-- leaderboard_top() requires ledger_xp = derived_xp EXACTLY. Battle XP
-- (kind='battle', introduced with the 009 Battle Arena) is a legitimate
-- ledger-over-derived surplus — server-granted, guard-verified, invisible
-- to the derived recount by design. Result: every athlete who ever
-- finished a battle was silently and PERMANENTLY excluded, and the
-- leaderboard read empty.
--
-- THE FIX preserves the anti-cheat intent precisely: the integrity check
-- now reconciles the CLIENT-MINTABLE portion of the ledger (kinds 'set'
-- and 'cardio' — the only kinds an authenticated user can insert, both
-- recomputed from owned rows by the 006 guard) against the derived
-- recount. Server-only kinds ('battle', future 'achievement'/'adjustment')
-- ride on top of a reconciled base. Ranking still uses the FULL ledger.
-- Everything else is 005's body verbatim.
--
-- Falsification (run after applying):
--   (a) a battle player with reconciled set/cardio XP appears when public
--   (b) flipping them private removes them (the #13 check)
--   (c) fabricated mintable drift still hides an account (positive control
--       for the guard: service-insert a bare kind='set' row, watch the
--       account vanish, delete it, watch it return).

create or replace function public.leaderboard_top(n integer default 50)
returns table (
  display_name  text,
  xp            bigint,
  base_level    integer,
  rank_position bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with ledger as (
    select e.user_id,
           sum(e.amount)::bigint as ledger_xp,
           coalesce(sum(e.amount) filter (where e.kind in ('set', 'cardio')), 0)::bigint as mintable_xp
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
      coalesce(l.mintable_xp, 0)                              as mintable_xp,
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
      -- drift = 0 over the kinds a CLIENT can mint; server-granted kinds
      -- (battle, ...) are legitimate surplus above the reconciled base.
      and t.mintable_xp = t.derived_xp
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

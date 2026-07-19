-- EvoForge 065 — the leaderboard learns more than one metric
--
-- The board only ever ranked by legacy avatar LEVEL (005/014's
-- leaderboard_top). Athletes asked to compete on the numbers that actually
-- describe them now: their EVO RATING, their FORGE LEVEL, and their
-- CONSISTENCY (weekly momentum). This adds ONE additive, security-definer
-- RPC alongside leaderboard_top (which is left untouched) that returns every
-- metric per row and orders by the one requested.
--
-- INTEGRITY IS PRESERVED VERBATIM from 014: the same client-mintable-drift
-- reconciliation gate (mintable_xp = derived_xp) excludes unreconciled
-- accounts from EVERY metric board — a cheated XP base must not top the
-- Forge or Consistency board either. Server-granted kinds (battle, ...) ride
-- on top of the reconciled base exactly as before.
--
-- LIVE, HONEST SOURCES (the 063 doctrine):
--   forge_level  → forge_level_for_xp(user_progression.lifetime_xp), the
--                  read-time curve twin — NEVER the ratcheted forge_level
--                  column (it still holds pre-exploit inflation).
--   evo_rating   → evo_rating_current.displayed_rating, and ONLY when the
--                  owner's show_evo flag is on (else null — hidden, sorts
--                  last on the evo board). The house treats Evo Rating as a
--                  DISPLAY metric here, not yet a defended competitive
--                  authority (the server-recomputation gate is still pending
--                  — see HANDOVER §P5/P8); Forge Level + Consistency are the
--                  honest ranks.
--   momentum     → user_progression.current_momentum_weeks.
--
-- Privacy discipline is unchanged: only game stats cross the boundary
-- (display name + level/xp/forge/evo/momentum), never body data.
--
-- Falsification (run after applying, as the smoke accounts):
--   (a) ALPHA appears on every metric when public; its forge_level matches
--       forge_level_for_xp(lifetime_xp) and evo_rating matches
--       evo_rating_current.displayed_rating.
--   (b) flipping ALPHA private removes it from all metrics.
--   (c) setting show_evo=false nulls only evo_rating (still ranks elsewhere).
--   (d) fabricated mintable drift still hides the account on every metric.

create or replace function public.leaderboard_by_metric(p_metric text default 'xp', n integer default 50)
returns table (
  display_name   text,
  xp             bigint,
  base_level     integer,
  forge_level    integer,
  evo_rating     integer,
  momentum_weeks integer,
  rank_position  bigint
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
      t.ledger_xp                                                     as xp,
      coalesce(pr.base_level, 1)::int                                 as base_level,
      public.forge_level_for_xp(coalesce(up.lifetime_xp, 0))::int     as forge_level,
      case when coalesce(pp.show_evo, true) then evo.displayed_rating end::int as evo_rating,
      coalesce(up.current_momentum_weeks, 0)::int                     as momentum_weeks
    from totals t
    join public.public_profile pp        on pp.user_id  = t.user_id
    left join public.profile pr          on pr.user_id  = t.user_id
    left join public.user_progression up on up.user_id  = t.user_id
    left join public.evo_rating_current evo on evo.user_id = t.user_id
    where pp.is_public = true
      and pp.display_name is not null
      -- the 014 anti-cheat gate: client-mintable XP must reconcile.
      and t.mintable_xp = t.derived_xp
  )
  select
    display_name, xp, base_level, forge_level, evo_rating, momentum_weeks,
    row_number() over (order by
      case when p_metric = 'forge'       then forge_level    end desc nulls last,
      case when p_metric = 'evo'         then evo_rating     end desc nulls last,
      case when p_metric = 'consistency' then momentum_weeks end desc nulls last,
      xp desc, display_name asc
    ) as rank_position
  from ranked
  order by
    case when p_metric = 'forge'       then forge_level    end desc nulls last,
    case when p_metric = 'evo'         then evo_rating     end desc nulls last,
    case when p_metric = 'consistency' then momentum_weeks end desc nulls last,
    xp desc, display_name asc
  limit greatest(0, least(coalesce(n, 50), 200));
$$;

grant execute on function public.leaderboard_by_metric(text, integer) to authenticated;

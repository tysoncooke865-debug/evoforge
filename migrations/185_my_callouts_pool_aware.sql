-- EvoForge 185 - `my_workout_callouts` LEARNS THAT POOLS EXIST.
--
-- The athlete's own list computes the pool as
--
--     c.stake * 2 as pot
--
-- which is exactly right for a 1v1 and WRONG for every pot. Six friends could be in
-- for 300 coins and the badge on the set would still read 100. The number an athlete
-- lifts against would be a number nobody is playing for.
--
-- Same shape of gap as 184: 180-183 built the mechanics and each surface that has to
-- READ them was written before pools existed. This is the last of them.
--
-- Adds `mode`, `back_total`, `push_total` and `joiners`, and makes `pot` the real
-- total. A duel is unaffected — with no entries, back + push is stake + stake, which
-- is what `stake * 2` always was.

begin;

create or replace function public.my_workout_callouts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'my_workout_callouts: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select
        c.id, c.athlete_id, c.opponent_id, c.initiated_by,
        c.workout_date, c.workout_name, c.exercise, c.set_no,
        c.target_reps, c.target_load_mode, c.target_weight_kg, c.target_label,
        c.stake,
        c.mode,
        -- THE REAL POOL, not stake * 2. The athlete is always BACK, the opponent
        -- always PUSH, and joiners land on the side they chose. Identical to
        -- `callout_pool`, which stays the single definition.
        (c.stake + coalesce((select sum(e.stake)::int from public.workout_callout_entries e
                             where e.callout_id = c.id and e.side = 'back'), 0))::int
          as back_total,
        (c.stake + coalesce((select sum(e.stake)::int from public.workout_callout_entries e
                             where e.callout_id = c.id and e.side = 'push'), 0))::int
          as push_total,
        (c.stake + coalesce((select sum(e.stake)::int from public.workout_callout_entries e
                             where e.callout_id = c.id and e.side = 'back'), 0))::int
        + (c.stake + coalesce((select sum(e.stake)::int from public.workout_callout_entries e
                               where e.callout_id = c.id and e.side = 'push'), 0))::int
          as pot,
        (select count(*)::int from public.workout_callout_entries e where e.callout_id = c.id)
          as joiners,
        c.status, c.result, c.actual_reps, c.actual_weight_kg, c.actual_load_mode,
        c.dispute_reason,
        c.athlete_calloff_at, c.opponent_calloff_at,
        c.created_at, c.expires_at, c.accepted_at, c.set_logged_at,
        c.verified_at, c.settled_at,
        (c.athlete_id = me) as i_am_athlete,
        coalesce(ppa.display_name, 'Athlete') as athlete_name,
        coalesce(ppo.display_name, 'Athlete') as opponent_name
      from public.workout_callouts c
      left join public.public_profile ppa on ppa.user_id = c.athlete_id
      left join public.public_profile ppo on ppo.user_id = c.opponent_id
      where (c.athlete_id = me or c.opponent_id = me)
        -- Enough history for the hub to show what just happened, and not so much
        -- that a year of settled calls rides down the wire on every poll.
        and (c.status in ('offered', 'accepted', 'awaiting_verification', 'disputed')
             or c.created_at > now() - interval '2 days')
    ) x
  ), '[]'::jsonb);
end;
$function$;
revoke execute on function public.my_workout_callouts() from public, anon;
grant execute on function public.my_workout_callouts() to authenticated;

-- ─────────── PROVEN: a duel is unchanged, a pool tells the truth

do $$
declare
  ath uuid; opp uuid; mate uuid; cid uuid; row jsonb;
begin
  select athlete_id, opponent_id into ath, opp
  from public.workout_callouts where mode = 'duel' order by created_at desc limit 1;
  if ath is null then raise notice 'no duels - skipping'; return; end if;

  -- 1. A DUEL STILL READS stake * 2. Twenty live pledges depend on it.
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', ath), true);
  select e into row
  from jsonb_array_elements(public.my_workout_callouts()) e
  where (e ->> 'mode') = 'duel' limit 1;
  if row is null then raise exception 'the athlete cannot see their own duel'; end if;
  if (row ->> 'pot')::int <> (row ->> 'stake')::int * 2 then
    raise exception 'a duel pool changed: stake %, pot %', row ->> 'stake', row ->> 'pot';
  end if;

  -- 2. A POOL COUNTS ITS JOINERS.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select u.id into mate from auth.users u
   where u.id not in (ath, opp) and public.are_friends(ath, u.id) limit 1;
  if mate is null then raise notice 'no friend of the athlete - skipping the pool half'; return; end if;

  insert into public.workout_callouts (
    athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise,
    set_no, target_reps, target_load_mode, target_weight_kg, target_label, stake,
    status, expires_at, mode)
  values (ath, opp, ath, current_date, 'Pool Aware Probe', 'Pool Aware Lift', 8, 5,
          'external', 60, '60 x 5', 40, 'accepted', now() + interval '1 hour', 'pot')
  returning id into cid;
  insert into public.workout_callout_entries (callout_id, user_id, side, stake)
  values (cid, mate, 'push', 35);

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', ath), true);
  select e into row
  from jsonb_array_elements(public.my_workout_callouts()) e
  where (e ->> 'id') = cid::text;
  if row is null then raise exception 'the athlete cannot see their own pool'; end if;
  if (row ->> 'back_total')::int <> 40 then
    raise exception 'back_total is % not 40', row ->> 'back_total';
  end if;
  if (row ->> 'push_total')::int <> 75 then
    raise exception 'push_total is % not 75 (40 opponent + 35 joiner)', row ->> 'push_total';
  end if;
  if (row ->> 'pot')::int <> 115 then
    raise exception 'pot is % not 115 — the old stake*2 would have said 80', row ->> 'pot';
  end if;
  if (row ->> 'joiners')::int <> 1 then
    raise exception 'joiners is % not 1', row ->> 'joiners';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  delete from public.workout_callout_entries where callout_id = cid;
  delete from public.workout_callouts where id = cid;
  perform set_config('request.jwt.claims', '', true);
end $$;

commit;

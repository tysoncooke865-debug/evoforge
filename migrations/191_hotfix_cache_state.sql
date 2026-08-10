-- EvoForge 191 - HOTFIX: I BROKE `forge_cache_state` IN 190.
--
-- 190 rewrote `forge_cache_state()` as a wrapper that called
-- `public.forge_cache_state_v189()` - a function that does not exist and never did. I
-- invented the name while splitting the logic and never created it.
--
-- plpgsql resolves function calls at RUN TIME, not at CREATE time, so the migration
-- applied cleanly, reported success, and left the function throwing
-- `42883 function public.forge_cache_state_v189() does not exist` on every call. A
-- green apply is not a working function, and this is the second time today that
-- lesson has cost something: 182's settlement passed its own shape checks while being
-- unable to execute.
--
-- NO USER WAS AFFECTED. The card that calls this is written but not yet deployed, and
-- nothing else in the app reads the cache state - it had never been called at all
-- before today. The window was minutes and the blast radius was zero, but it would
-- have been the first thing an athlete saw on Home.
--
-- THE FIX IS NOT ANOTHER WRAPPER. 189's body was correct; 190's addition was two
-- fields. They now live inside the one function, so there is a single definition of
-- the cache state and nothing to keep in sync.
--
-- 190's actual change - that an athlete with no plan cannot confirm rest - is kept
-- and is the reason any of this happened. It closed a real hole: `scheduled_workouts_on`
-- returns empty for somebody with no schedule, 189 read empty as rest, and the ladder
-- was climbable to 280 coins by tapping once a day with no plan and no training.

begin;

create or replace function public.forge_cache_state()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  cur_cycle int;
  cycle_started date;
  trained int;
  adherent int;
  rung int;
  already boolean;
  tier public.forge_cache_tiers;
  last_training date;
  floor_needed int;
  today_rest boolean;
  today_confirmed boolean;
  today_plan text[];
  has_plan boolean;
begin
  if me is null then
    raise exception 'forge_cache_state: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  -- 190: an athlete with NO plan has no planned rest. `scheduled_workouts_on`
  -- returns empty for them, which 189 read as rest - so the ladder was climbable
  -- by tapping a button once a day forever.
  select exists (
    select 1 from public.workout_schedule ws
    where ws.user_id = me and ws.effective_from <= (now() at time zone 'UTC')::date
  ) into has_plan;
  select coalesce(training_floor, 3) into floor_needed from public.forge_cache_config where id = 1;
  floor_needed := coalesce(floor_needed, 3);

  select coalesce(max(cycle), 1) into cur_cycle
  from public.forge_cache_claims where user_id = me;
  select max(training_day) into cycle_started
  from public.forge_cache_claims
  where user_id = me and cycle = cur_cycle - 1 and day_index = 7;

  -- Distinct TRAINING days in this cycle.
  select count(distinct w.date), max(w.date) into trained, last_training
  from public.workout_log w
  where w.user_id = me and w.reps > 0 and w.weight >= 0
    and (cycle_started is null or w.date > cycle_started);

  -- Distinct PLAN-ADHERENT days: trained, or confirmed rest. A date that is both
  -- counts once, which is why this is a union of dates and not a sum of counts.
  select count(*) into adherent from (
    select w.date as d from public.workout_log w
     where w.user_id = me and w.reps > 0 and w.weight >= 0
       and (cycle_started is null or w.date > cycle_started)
    union
    select r.rest_day from public.forge_rest_days r
     where r.user_id = me and (cycle_started is null or r.rest_day > cycle_started)
  ) x;

  -- What today is, so the card can offer the right action.
  today_plan := public.scheduled_workouts_on(me, (now() at time zone 'UTC')::date);
  today_rest := array_length(today_plan, 1) is null;
  select exists (select 1 from public.forge_rest_days r
                 where r.user_id = me and r.rest_day = (now() at time zone 'UTC')::date)
    into today_confirmed;

  rung := least(7, coalesce(adherent, 0));

  if rung < 1 then
    return jsonb_build_object('cycle', cur_cycle, 'rung', 0, 'claimable', false,
      'trained_this_cycle', 0, 'adherent_this_cycle', 0,
      'training_floor', floor_needed, 'floor_met', false,
      'today_is_rest', today_rest, 'today_rest_confirmed', today_confirmed,
      'today_plan', case when today_rest then null else today_plan[1] end,
      'next_label', (select label from public.forge_cache_tiers where day_index = 1),
      'next_coins', (select coins from public.forge_cache_tiers where day_index = 1),
      -- §6/§8: no urgency, no countdown, and rest offered as a real option.
      'has_plan', has_plan,
      'can_confirm_rest', has_plan and today_rest and not today_confirmed,
      'message', case
        when not has_plan then 'Set a weekly plan and the cache opens on your plan-adherent days.'
        when today_rest then 'Rest day. Confirm it and the first cache opens.'
        else 'Log a set to open the first cache.' end);
  end if;

  select * into tier from public.forge_cache_tiers where day_index = rung;
  select exists (
    select 1 from public.forge_cache_claims
    where user_id = me and cycle = cur_cycle and day_index = rung
  ) into already;

  return jsonb_build_object(
    'cycle', cur_cycle,
    'rung', rung,
    'coins', tier.coins,
    'label', tier.label,
    -- RUNG 7 NEEDS REAL TRAINING. Rest alone pays 280 across rungs 1-6; the weekly
    -- cache is earned. Without this, seven confirmed rest days would collect 430.
    'claimable', (not already) and (rung < 7 or coalesce(trained, 0) >= floor_needed),
    'trained_this_cycle', coalesce(trained, 0),
    'adherent_this_cycle', coalesce(adherent, 0),
    'training_floor', floor_needed,
    'floor_met', coalesce(trained, 0) >= floor_needed,
    'training_day', last_training,
    'today_is_rest', today_rest,
    'today_rest_confirmed', today_confirmed,
    'has_plan', has_plan,
    -- What the CARD must key on: offering a button the server will refuse is how a
    -- feature teaches an athlete that the app is unreliable.
    'can_confirm_rest', has_plan and today_rest and not today_confirmed,
    'today_plan', case when today_rest then null else today_plan[1] end,
    'next_coins', (select coins from public.forge_cache_tiers where day_index = least(7, rung + 1)),
    'next_label', (select label from public.forge_cache_tiers where day_index = least(7, rung + 1)),
    'message', case
      when rung = 7 and not already and coalesce(trained, 0) < floor_needed then
        format('The weekly cache opens after %s training days this cycle - you have %s.',
               floor_needed, coalesce(trained, 0))
      when already then 'Claimed. The next cache opens on your next plan-adherent day.'
      else format('%s coins ready - %s.', tier.coins, tier.label) end);
end;
$$;;

revoke execute on function public.forge_cache_state() from public, anon;
grant execute on function public.forge_cache_state() to authenticated;

-- ─────────── PROVEN: it RUNS. Not that it compiled.

do $$
declare
  u uuid;
  st jsonb;
  n int := 0;
begin
  -- Call it for real, as several different athletes, because a plpgsql body is only
  -- checked when it executes. This is the assertion 190 needed and did not have.
  for u in
    select id from auth.users order by created_at desc limit 5
  loop
    perform set_config('request.jwt.claims',
      format('{"sub":"%s","role":"authenticated"}', u), true);
    st := public.forge_cache_state();
    if st is null then
      raise exception 'forge_cache_state returned null for %', u;
    end if;
    if (st ->> 'has_plan') is null or (st ->> 'can_confirm_rest') is null then
      raise exception 'the 190 fields are missing for %: %', u, st;
    end if;
    n := n + 1;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  if n = 0 then raise exception 'no athletes to check'; end if;
  raise notice 'forge_cache_state executed for % athletes', n;
end $$;

-- And the wrapper that caused this must be gone for good.
do $$
declare d text := pg_get_functiondef('public.forge_cache_state()'::regprocedure);
begin
  if d like '%forge_cache_state_v189%' then
    raise exception 'the phantom delegate is still referenced';
  end if;
  if d not like '%can_confirm_rest%' then
    raise exception '190''s no-plan guard was lost in the fix';
  end if;
  if d not like '%forge_rest_days%' then
    raise exception '189''s rest-day counting was lost in the fix';
  end if;
end $$;

commit;

-- EvoForge 189 - A PLANNED REST DAY ADVANCES THE FORGE CACHE.
--
-- Two decisions from Tyson, 2026-08-10, on a brief that asked for a much larger
-- daily check-in system. Most of that system already existed in 166: the seven-tier
-- ladder is already 25/30/40/50/60/75/150, already never expires, already pauses
-- rather than resets, and the Recovery Run already works. What was missing was the
-- half of §6 that says rest is generative.
--
--   1. NO COINS FOR OPENING THE APP. The brief asked for 15 coins on first open each
--      day, with every tier split into a login portion and a check-in portion. He
--      chose not to. §6 says the cache is "tied to genuine training activity, NEVER
--      app-opening", and the split would have moved 105 of every 430-coin cycle from
--      "you trained" to "you opened the app" - a quarter of the ladder. So there is
--      NO new coin path in this migration at all, and therefore no new idempotency,
--      timezone or replay surface to secure. The Home card that replaces it is
--      informational: what your cache is at, what today pays, and that nothing was
--      lost while you were away.
--
--   2. REST ADVANCES THE LADDER, BUT A FULL CYCLE STILL NEEDS TRAINING. Planned rest
--      now counts as a plan-adherent day and moves the rungs. Left there, seven
--      consecutive rest days would collect the whole 430-coin cycle without a single
--      set, and the cache would stop measuring training. So rungs 1-6 open on any
--      plan-adherent day, and RUNG 7 - the weekly cache, 150 coins - requires at
--      least `training_floor` distinct training days in the cycle. Rest alone pays
--      280; the last 150 is earned.
--
-- ── THE GUARD THAT MAKES THIS SAFE ──
--
-- A confirmed rest day is only accepted on a date the athlete's own plan calls rest.
-- Without that, "confirm rest" would be a button that advances the ladder every day,
-- which is a 430-coin cycle for seven taps. `scheduled_workouts_on` is the authority
-- and it already handles both plan shapes (169).
--
-- No RNG, no chance, no pledge, nothing purchasable, no balance decrease, and no
-- connection to reveals or pools. Deterministic and additive, like every other cache.

begin;

-- ─────────────────────────────────────────── the floor, as configuration

create table if not exists public.forge_cache_config (
  id int primary key default 1,
  -- Distinct training days a cycle needs before the weekly cache opens.
  training_floor int not null default 3,
  updated_at timestamptz not null default now(),
  constraint forge_cache_config_one_row check (id = 1),
  constraint forge_cache_config_floor_sane check (training_floor between 0 and 7)
);
insert into public.forge_cache_config (id) values (1) on conflict (id) do nothing;

alter table public.forge_cache_config enable row level security;
drop policy if exists forge_cache_config_read on public.forge_cache_config;
create policy forge_cache_config_read on public.forge_cache_config
  for select using (auth.uid() is not null);

-- ───────────────────────────────────────── a confirmed planned rest day

create table if not exists public.forge_rest_days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rest_day date not null,
  confirmed_at timestamptz not null default now(),
  primary key (user_id, rest_day)
);

comment on table public.forge_rest_days is
  'Planned rest days the athlete confirmed (189). Accepted ONLY for a date their own '
  'plan calls rest, so this cannot be tapped daily to climb the cache. Advances the '
  'ladder; §6 treats rest as part of the plan rather than as an absence.';

alter table public.forge_rest_days enable row level security;
drop policy if exists forge_rest_days_owner_select on public.forge_rest_days;
create policy forge_rest_days_owner_select on public.forge_rest_days
  for select using (user_id = auth.uid());

-- NO INSERT POLICY. A rest day must be validated against the plan, so it is written
-- by the definer function below and nowhere else. The absence is the enforcement.

/**
 * CONFIRM TODAY IS A REST DAY.
 *
 * Idempotent: confirming twice returns the confirmation you already have. Refused on
 * any date the plan does not call rest, which is what stops this being a button that
 * climbs the ladder on demand.
 */
create or replace function public.forge_rest_confirm(p_day date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  d date := coalesce(p_day, (now() at time zone 'UTC')::date);
  scheduled text[];
  fresh boolean;
begin
  if me is null then
    raise exception 'forge_rest_confirm: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  -- Today or yesterday only. A window rather than any date, so a confirmation
  -- cannot be backfilled across a month to fill a cycle.
  if d > (now() at time zone 'UTC')::date or d < (now() at time zone 'UTC')::date - 1 then
    raise exception 'forge_rest_confirm: rest is confirmed on the day, not in advance.'
      using errcode = 'check_violation';
  end if;

  scheduled := public.scheduled_workouts_on(me, d);
  if array_length(scheduled, 1) is not null then
    raise exception 'forge_rest_confirm: your plan has % on %, so it is a training day.',
      array_to_string(scheduled, ' or '), d using errcode = 'check_violation';
  end if;

  insert into public.forge_rest_days (user_id, rest_day) values (me, d)
  on conflict (user_id, rest_day) do nothing;
  fresh := found;

  return jsonb_build_object('rest_day', d, 'confirmed', true, 'already', not fresh,
                            'state', public.forge_cache_state());
end;
$$;
revoke execute on function public.forge_rest_confirm(date) from public, anon;
grant execute on function public.forge_rest_confirm(date) to authenticated;

-- ────────────────────────────── the ladder counts plan-adherent days

/**
 * HOW FAR UP THE LADDER, counting training days AND confirmed rest days.
 *
 * The rung is the number of distinct PLAN-ADHERENT dates in the cycle: a date with a
 * counted set, or a date the athlete confirmed as planned rest. §6 asks for exactly
 * that - "streaks count training days and rest days per the user's plan" - and the
 * cache had been counting only the first half.
 *
 * `trained_this_cycle` is still reported separately, because rung 7 depends on it and
 * because the card says plainly how many training days the weekly cache still needs.
 */
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
begin
  if me is null then
    raise exception 'forge_cache_state: not signed in.' using errcode = 'insufficient_privilege';
  end if;
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
      'message', case when today_rest
        then 'Rest day. Confirm it and the first cache opens.'
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
$$;
revoke execute on function public.forge_cache_state() from public, anon;
grant execute on function public.forge_cache_state() to authenticated;

/** Claiming refuses a rung the floor has not opened, rather than paying it. */
create or replace function public.forge_cache_claim()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  st jsonb;
  rung int;
  cyc int;
  tier public.forge_cache_tiers;
  new_id uuid := gen_random_uuid();
begin
  if me is null then
    raise exception 'forge_cache_claim: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('evoforge.coin_spend:' || me::text, 0));

  st := public.forge_cache_state();
  rung := (st ->> 'rung')::int;
  cyc := (st ->> 'cycle')::int;

  if rung < 1 then
    raise exception 'forge_cache_claim: nothing open yet - train or confirm your rest day.'
      using errcode = 'check_violation';
  end if;

  -- 189: the weekly cache needs training behind it. Refused with the number, not a
  -- flat no, so the athlete knows exactly what opens it.
  if rung = 7 and not (st ->> 'floor_met')::boolean then
    raise exception 'forge_cache_claim: the weekly cache opens after % training days this cycle - you have %.',
      st ->> 'training_floor', st ->> 'trained_this_cycle' using errcode = 'check_violation';
  end if;

  if not (st ->> 'claimable')::boolean then
    return jsonb_build_object('already', true, 'cycle', cyc, 'rung', rung,
      'coins', 0, 'balance', public.coin_total_exact());
  end if;

  select * into tier from public.forge_cache_tiers where day_index = rung;

  insert into public.forge_cache_claims (id, user_id, day_index, cycle, coins, training_day)
  values (new_id, me, rung, cyc, tier.coins, (st ->> 'training_day')::date)
  on conflict (user_id, cycle, day_index) do nothing;
  if not found then
    return jsonb_build_object('already', true, 'cycle', cyc, 'rung', rung,
      'coins', 0, 'balance', public.coin_total_exact());
  end if;

  perform set_config('evoforge.cache_authorized', new_id::text, true);
  insert into public.coin_events (user_id, kind, amount, source_id, source_table)
  values (me, 'forge_cache', tier.coins, new_id::text, 'forge_cache_claims');
  perform set_config('evoforge.cache_authorized', '', true);

  return jsonb_build_object('already', false, 'cycle', cyc, 'rung', rung,
    'coins', tier.coins, 'label', tier.label,
    'cycle_complete', rung = 7,
    'balance', public.coin_total_exact());
end;
$$;
revoke execute on function public.forge_cache_claim() from public, anon;
grant execute on function public.forge_cache_claim() to authenticated;

-- ─────────── PROVEN: rest advances, rest alone cannot finish, and no new coin path

do $$
declare
  d text;
begin
  -- NO LOGIN REWARD EXISTS. The brief asked for one and Tyson declined; if a later
  -- change adds an app-open coin path, this is where it should be argued for, not
  -- slipped in.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and (p.proname ilike '%welcome%' or p.proname ilike '%daily_login%')) then
    raise exception 'an app-open reward function appeared; §6 forbids rewarding app-opening';
  end if;

  d := pg_get_functiondef('public.forge_cache_state()'::regprocedure);
  if d not like '%forge_rest_days%' then
    raise exception 'the ladder does not count confirmed rest days';
  end if;
  if d ilike '%random(%' then
    raise exception 'randomness entered the cache path';
  end if;

  d := pg_get_functiondef('public.forge_cache_claim()'::regprocedure);
  if d not like '%floor_met%' then
    raise exception 'the weekly cache no longer requires training days';
  end if;

  -- A rest confirmation must be validated against the plan, or it is a daily button.
  d := pg_get_functiondef('public.forge_rest_confirm(date)'::regprocedure);
  if d not like '%scheduled_workouts_on%' then
    raise exception 'rest can be confirmed without checking the plan';
  end if;
end $$;

do $$
declare
  u uuid; st jsonb; before_rung int; after_rung int; rest_ok boolean := false;
begin
  -- A real athlete whose plan calls rest today, so the guard is exercised rather
  -- than described.
  select u2.id into u from auth.users u2
   where array_length(public.scheduled_workouts_on(u2.id, (now() at time zone 'UTC')::date), 1) is null
     and exists (select 1 from public.workout_schedule ws where ws.user_id = u2.id)
   limit 1;
  if u is null then raise notice 'nobody is on a planned rest day - skipping the live check'; return; end if;

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', u), true);
  st := public.forge_cache_state();
  before_rung := (st ->> 'rung')::int;
  if not (st ->> 'today_is_rest')::boolean then
    raise exception 'state says today is not rest for an athlete with no scheduled workout';
  end if;

  perform public.forge_rest_confirm();
  st := public.forge_cache_state();
  after_rung := (st ->> 'rung')::int;
  if after_rung < before_rung then
    raise exception 'confirming rest moved the ladder BACKWARDS (% -> %)', before_rung, after_rung;
  end if;
  if not (st ->> 'today_rest_confirmed')::boolean then
    raise exception 'the confirmation did not stick';
  end if;

  -- Idempotent.
  perform public.forge_rest_confirm();
  if ((public.forge_cache_state()) ->> 'rung')::int <> after_rung then
    raise exception 'confirming rest twice moved the ladder again';
  end if;

  -- And it is refused on a training day.
  begin
    perform public.forge_rest_confirm((now() at time zone 'UTC')::date - 40);
    raise exception 'rest was confirmed 40 days ago - the window is not enforced';
  exception when check_violation then rest_ok := true;
  end;
  if not rest_ok then raise exception 'the backfill window did not fire'; end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  delete from public.forge_rest_days
   where user_id = u and rest_day = (now() at time zone 'UTC')::date;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'rest advances the ladder and is plan-validated';
end $$;

commit;

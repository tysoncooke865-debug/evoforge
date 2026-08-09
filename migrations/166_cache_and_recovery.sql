-- EvoForge 166 — THE DAILY FORGE CACHE AND THE RECOVERY RUN (Spec v5 §6).
--
-- Two deterministic rewards. Neither contains a grain of randomness, which is the
-- point: §6 is where the economy proves it does not need the forge.
--
-- ── THE CACHE IS TIED TO TRAINING, NOT TO OPENING THE APP ────────────────────
--
-- "Tie the cache to genuine training activity, not opening the app… rewards never
-- expire at midnight and can be claimed late."
--
-- So the ladder advances on TRAINING DAYS, not calendar days. Day 4 of the schedule
-- is your fourth training day of the cycle, whenever it happens — a week off does
-- not cost it, and neither does a midnight boundary. This is the whole difference
-- between a reward for showing up and a login streak with a countdown, and it is
-- what makes "nothing decays" (§6) true rather than aspirational.
--
-- 25 / 30 / 40 / 50 / 60 / 75 / 150, then the cycle rolls and the seventh is the
-- Weekly Cache. Fixed, published, no random component.
--
-- ── THE RECOVERY RUN IS A FLOOR, NOT A BONUS ─────────────────────────────────
--
-- "Below 5 coins: complete 3 legitimate sets to receive a guaranteed 50-coin
-- Recovery Cache… A player can never be locked out of the economy."
--
-- Guaranteed, fixed, free, and re-armable only after the athlete has climbed back
-- out and fallen again. It is not farmable because it requires being genuinely
-- broke, and being broke costs more than 50 coins to arrange.
--
-- NOTHING HERE IS CLAIMABLE BY WRITING A LEDGER ROW. Both kinds are guard-admitted
-- only inside their own function, like every server-decided reward since 013.

begin;

-- ────────────────────────────────────────────────── the published ladder

create table if not exists public.forge_cache_tiers (
  day_index int primary key check (day_index between 1 and 7),
  coins int not null check (coins > 0),
  label text not null
);

insert into public.forge_cache_tiers (day_index, coins, label) values
  (1,  25, 'Kindling'),
  (2,  30, 'Steady heat'),
  (3,  40, 'Coals banked'),
  (4,  50, 'Bellows up'),
  (5,  60, 'White heat'),
  (6,  75, 'Quenched'),
  (7, 150, 'Weekly Cache')
on conflict (day_index) do update
  set coins = excluded.coins, label = excluded.label;

alter table public.forge_cache_tiers enable row level security;
drop policy if exists forge_cache_tiers_read on public.forge_cache_tiers;
-- Published: §7 wants every reward connected to a visible goal.
create policy forge_cache_tiers_read on public.forge_cache_tiers
  for select using (auth.uid() is not null);

-- ───────────────────────────────────────────────────── what has been claimed

create table if not exists public.forge_cache_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  /** Which rung, and which pass through the ladder. */
  day_index int not null references public.forge_cache_tiers(day_index),
  cycle int not null check (cycle >= 1),
  coins int not null check (coins > 0),
  /** The training day that earned it — proof, and what makes it un-farmable. */
  training_day date not null,
  claimed_at timestamptz not null default now(),
  /** One rung per cycle. A doubled tap is the same claim, decided by the index. */
  constraint forge_cache_once unique (user_id, cycle, day_index)
);
create index if not exists forge_cache_claims_user on public.forge_cache_claims (user_id, cycle);

alter table public.forge_cache_claims enable row level security;
drop policy if exists forge_cache_claims_own on public.forge_cache_claims;
create policy forge_cache_claims_own on public.forge_cache_claims
  for select using (user_id = auth.uid());

create table if not exists public.recovery_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  coins int not null check (coins > 0),
  /** The balance that qualified. Kept so "were they really broke?" is answerable. */
  balance_at_grant numeric(12,2) not null,
  sets_at_grant int not null,
  granted_at timestamptz not null default now()
);
create index if not exists recovery_runs_user on public.recovery_runs (user_id, granted_at desc);

alter table public.recovery_runs enable row level security;
drop policy if exists recovery_runs_own on public.recovery_runs;
create policy recovery_runs_own on public.recovery_runs
  for select using (user_id = auth.uid());

-- ─────────────────────────────────────────── how far up the ladder they are

/**
 * TRAINING DAYS SINCE THE CURRENT CYCLE BEGAN.
 *
 * A training day is a DISTINCT DATE with at least one counted set — the app's
 * existing definition (`reps > 0 and weight >= 0`, widened by 061 for bodyweight).
 * Counting distinct dates rather than sets is what stops twenty sets in one evening
 * from climbing the whole ladder.
 *
 * The cycle begins at the last completed rung 7, or at the athlete's first ever
 * training day. There is deliberately no time window: §6 says nothing expires, so a
 * three-week gap leaves the ladder exactly where it was.
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
  rung int;
  already boolean;
  tier public.forge_cache_tiers;
  last_training date;
begin
  if me is null then
    raise exception 'forge_cache_state: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  -- The cycle we are in, and the day the previous one closed.
  select coalesce(max(cycle), 1) into cur_cycle
  from public.forge_cache_claims where user_id = me;
  select max(training_day) into cycle_started
  from public.forge_cache_claims
  where user_id = me and cycle = cur_cycle - 1 and day_index = 7;

  -- Distinct training days in this cycle.
  select count(distinct w.date), max(w.date) into trained, last_training
  from public.workout_log w
  where w.user_id = me and w.reps > 0 and w.weight >= 0
    and (cycle_started is null or w.date > cycle_started);

  rung := least(7, coalesce(trained, 0));
  if rung < 1 then
    return jsonb_build_object('cycle', cur_cycle, 'rung', 0, 'claimable', false,
      'trained_this_cycle', 0,
      'next_label', (select label from public.forge_cache_tiers where day_index = 1),
      'next_coins', (select coins from public.forge_cache_tiers where day_index = 1),
      'message', 'Log a set to open the first cache.');
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
    'claimable', not already,
    'trained_this_cycle', trained,
    'training_day', last_training,
    -- §7: every reward connected to a visible goal, and no urgency anywhere.
    'next_coins', (select coins from public.forge_cache_tiers where day_index = least(7, rung + 1)),
    'next_label', (select label from public.forge_cache_tiers where day_index = least(7, rung + 1)),
    'message', case when already
      then 'Claimed. The next cache opens on your next training day.'
      else format('%s coins ready — %s.', tier.coins, tier.label) end);
end;
$$;
revoke execute on function public.forge_cache_state() from public, anon;
grant execute on function public.forge_cache_state() to authenticated;

/**
 * CLAIM THE CURRENT RUNG. Idempotent by unique index; never expires.
 *
 * Rolling the cycle happens HERE, on claiming rung 7, rather than on a clock. A
 * cycle that rolled at midnight would be a deadline, and §8 treats a fabricated
 * deadline as a compliance defect rather than a style choice.
 */
create or replace function public.forge_cache_claim()
returns jsonb
language plpgsql
volatile
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
    raise exception 'forge_cache_claim: train first — the cache opens on a training day.'
      using errcode = 'check_violation';
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

-- ──────────────────────────────────────────────────────── the floor

/**
 * RECOVERY RUN — the promise that nobody is ever locked out (§6).
 *
 * Below 5 coins, three counted sets pay a flat 50. Free, fixed, no pledge, no
 * spend, no randomness.
 *
 * RE-ARMED ONLY BY A GENUINE CYCLE. A second Recovery Run needs the athlete to have
 * been back ABOVE the floor since the last one — otherwise a broke athlete could
 * claim it every three sets forever, which is a farm rather than a floor. "Above
 * the floor" is checked against the ledger's own history rather than a flag, so it
 * cannot drift.
 */
create or replace function public.recovery_run_state()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  bal numeric;
  last_grant timestamptz;
  sets_since int;
  recovered boolean;
begin
  if me is null then
    raise exception 'recovery_run_state: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  bal := public.coin_total_exact();
  select max(granted_at) into last_grant from public.recovery_runs where user_id = me;

  -- Counted sets since the last grant (or ever, if none).
  select count(*) into sets_since
  from public.workout_log w
  where w.user_id = me and w.reps > 0 and w.weight >= 0
    and (last_grant is null or w."timestamp" > last_grant);

  -- Did they climb back out since the last one? Any ledger row after the grant
  -- that took them to 5 or more would do; the simplest honest proxy is that they
  -- earned at least 50 more coins since, which is one cache or two workouts.
  recovered := last_grant is null or coalesce((
    select sum(amount) from public.coin_events
    where user_id = me and created_at > last_grant and amount > 0), 0) >= 50;

  return jsonb_build_object(
    'balance', bal,
    'eligible', bal < 5 and sets_since >= 3 and recovered,
    'armed', bal < 5 and recovered,
    'sets_done', least(sets_since, 3),
    'sets_needed', 3,
    'coins', 50,
    'message', case
      when bal >= 5 then 'Your balance is healthy.'
      when not recovered then 'Recovery Run returns once you have earned your way back.'
      when sets_since >= 3 then '50 coins ready. Guaranteed — no pledge, nothing to spend.'
      else format('%s of 3 sets logged. Finish them for a guaranteed 50 coins.', sets_since)
    end);
end;
$$;
revoke execute on function public.recovery_run_state() from public, anon;
grant execute on function public.recovery_run_state() to authenticated;

create or replace function public.recovery_run_claim()
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  st jsonb;
  new_id uuid := gen_random_uuid();
begin
  if me is null then
    raise exception 'recovery_run_claim: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('evoforge.coin_spend:' || me::text, 0));

  st := public.recovery_run_state();
  if not (st ->> 'eligible')::boolean then
    raise exception 'recovery_run_claim: %', st ->> 'message' using errcode = 'check_violation';
  end if;

  insert into public.recovery_runs (id, user_id, coins, balance_at_grant, sets_at_grant)
  values (new_id, me, 50, (st ->> 'balance')::numeric, (st ->> 'sets_done')::int);

  perform set_config('evoforge.recovery_authorized', new_id::text, true);
  insert into public.coin_events (user_id, kind, amount, source_id, source_table)
  values (me, 'recovery_cache', 50, new_id::text, 'recovery_runs');
  perform set_config('evoforge.recovery_authorized', '', true);

  return jsonb_build_object('coins', 50, 'balance', public.coin_total_exact());
end;
$$;
revoke execute on function public.recovery_run_claim() from public, anon;
grant execute on function public.recovery_run_claim() to authenticated;

-- ─────────────────────────── the ledger learns two more kinds (4 edits)

alter table public.coin_events drop constraint if exists coin_events_kind_check;
alter table public.coin_events add constraint coin_events_kind_check
  check (kind = any (array[
    'workout_complete', 'pr', 'streak_milestone', 'starting_bonus',
    'adjustment', 'spend', 'battle_reward',
    'challenge_stake', 'challenge_payout',
    'callout_stake', 'callout_payout',
    'forge_drop_stake', 'forge_drop_payout', 'forge_drop_unlock',
    'set_reward', 'reveal_bonus',
    -- 166 — §6's deterministic floor and ladder.
    'forge_cache', 'recovery_cache'
  ]));

-- Both are additive by constraint, for the same reason `reveal_bonus` is: they are
-- the economy's floor, and a floor that could subtract is not one.
alter table public.coin_events drop constraint if exists coin_events_cache_adds_only;
alter table public.coin_events add constraint coin_events_cache_adds_only
  check (kind not in ('forge_cache', 'recovery_cache') or amount > 0);

/** Two new branches on 164's guard. Amounts recomputed from the claim row, never
 *  taken from the caller — the same repricing every server-decided kind gets. */
create or replace function public.coin_events_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  valid_sets int;
  row_e1rm numeric;
  prior_best numeric;
  w record;
  m int;
  claimed_start date;
  s record;
  paid_today int;
  drawn int;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.kind in ('forge_drop_stake', 'forge_drop_payout', 'forge_drop_unlock') then
    raise exception
      'coin_events: the staked board was retired. Chance is additive now (see forge_reveal_claim).'
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind = 'forge_cache' then
    if current_setting('evoforge.cache_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      select coins into drawn from public.forge_cache_claims
       where id = new.source_id::uuid and user_id = new.user_id;
      if drawn is null then
        raise exception 'coin_events: no cache claim matches %.', new.source_id
          using errcode = 'check_violation';
      end if;
      new.amount := drawn;
      new.source_table := 'forge_cache_claims';
      return new;
    end if;
    raise exception 'coin_events: forge_cache may only be written by a cache claim.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind = 'recovery_cache' then
    if current_setting('evoforge.recovery_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      select coins into drawn from public.recovery_runs
       where id = new.source_id::uuid and user_id = new.user_id;
      if drawn is null then
        raise exception 'coin_events: no recovery run matches %.', new.source_id
          using errcode = 'check_violation';
      end if;
      new.amount := drawn;
      new.source_table := 'recovery_runs';
      return new;
    end if;
    raise exception 'coin_events: recovery_cache may only be written by a Recovery Run.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind = 'reveal_bonus' then
    if current_setting('evoforge.reveal_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      select coins into drawn from public.forge_reveals
       where id = new.source_id::uuid and user_id = new.user_id;
      if drawn is null then
        raise exception 'coin_events: no drawn reveal matches %.', new.source_id
          using errcode = 'check_violation';
      end if;
      new.amount := drawn;
      new.source_table := 'forge_reveals';
      return new;
    end if;
    raise exception 'coin_events: reveal_bonus may only be written by a reveal claim.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind in ('challenge_stake', 'challenge_payout') then
    if current_setting('evoforge.challenge_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      new.source_table := 'forge_challenges';
      return new;
    end if;
    raise exception 'coin_events: % may only be written by duel settlement.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind in ('callout_stake', 'callout_payout') then
    if current_setting('evoforge.callout_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      new.source_table := 'workout_callouts';
      return new;
    end if;
    raise exception 'coin_events: % may only be written by call out settlement.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind in ('spend', 'battle_reward') then
    if current_setting('evoforge.spend_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      return new;
    end if;
    raise exception 'coin_events: % may only be written by a server grant.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind = 'set_reward' then
    if new.source_id is null then
      raise exception 'coin_events: set_reward needs the set it is for.'
        using errcode = 'check_violation';
    end if;
    if not public.is_rewardable_set(new.source_id::uuid, auth.uid()) then
      raise exception 'coin_events: that is not a set you logged, or not a plausible one.'
        using errcode = 'check_violation';
    end if;
    paid_today := public.set_rewards_paid_today(auth.uid());
    if paid_today >= 30 then
      raise exception 'coin_events: today''s set rewards are all paid (% of 30).', paid_today
        using errcode = 'check_violation';
    end if;
    new.amount := 12;
    new.source_table := 'workout_log';
    return new;
  end if;

  if new.kind = 'workout_complete' then
    if new.source_id is null or new.source_id !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'coin_events: workout_complete needs a date source.' using errcode = 'check_violation';
    end if;
    select count(*) into valid_sets
    from public.workout_log w2
    where w2.user_id = auth.uid() and w2.date = new.source_id::date and w2.weight >= 0 and w2.reps > 0;
    if valid_sets < 10 then
      raise exception 'coin_events: not enough training on % (% sets).', new.source_id, valid_sets
        using errcode = 'check_violation';
    end if;
    new.amount := 20;
    new.source_table := 'workout_log';
    perform public.forge_reveal_grant(
      auth.uid(), 'workout_complete', new.source_id, new.source_id::date, null);
    return new;

  elsif new.kind = 'pr' then
    select w2.exercise, w2.weight, w2.reps, w2."timestamp" into w
    from public.workout_log w2
    where w2.id = new.source_id::uuid and w2.user_id = auth.uid() and w2.weight > 0 and w2.reps > 0;
    if not found then
      raise exception 'coin_events: no matching owned set (%).', new.source_id using errcode = 'check_violation';
    end if;
    row_e1rm := w.weight * (1 + w.reps / 30.0);
    select max(w3.weight * (1 + w3.reps / 30.0)) into prior_best
    from public.workout_log w3
    where w3.user_id = auth.uid() and w3.exercise = w.exercise
      and w3.weight > 0 and w3.reps > 0 and w3."timestamp" < w."timestamp";
    if prior_best is null or row_e1rm <= prior_best then
      raise exception 'coin_events: that set is not a PR.' using errcode = 'check_violation';
    end if;
    new.amount := 25;
    new.source_table := 'workout_log';
    if public.is_qualifying_pr(new.source_id::uuid, auth.uid()) then
      perform public.forge_reveal_grant(
        auth.uid(), 'pr', new.source_id, w."timestamp"::date, w.exercise);
    end if;
    return new;

  elsif new.kind = 'streak_milestone' then
    if new.source_id is null or new.source_id !~ '^\d+:\d{4}-\d{2}-\d{2}$' then
      raise exception 'coin_events: bad milestone key.' using errcode = 'check_violation';
    end if;
    m := split_part(new.source_id, ':', 1)::int;
    claimed_start := split_part(new.source_id, ':', 2)::date;
    if m not in (3, 7, 14, 30, 60, 100) then
      raise exception 'coin_events: % is not a milestone.', m using errcode = 'check_violation';
    end if;
    select * into s from public.scheduled_streak(auth.uid(), current_date);
    if s.length is null or s.length < m or s.run_start is distinct from claimed_start then
      select * into s from public.scheduled_streak(auth.uid(), current_date + 1);
      if s.length is null or s.length < m or s.run_start is distinct from claimed_start then
        raise exception 'coin_events: streak milestone % not proven (server sees % from %).',
          m, coalesce(s.length, 0), s.run_start using errcode = 'check_violation';
      end if;
    end if;
    new.amount := 10 * m;
    new.source_table := 'workout_schedule';
    return new;

  elsif new.kind = 'starting_bonus' then
    if new.source_id is distinct from 'onboarding' then
      raise exception 'coin_events: starting_bonus source must be onboarding.' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.profile p where p.user_id = auth.uid()) then
      raise exception 'coin_events: no profile yet.' using errcode = 'check_violation';
    end if;
    new.amount := 100;
    new.source_table := 'profile';
    return new;

  else
    raise exception 'coin_events: kind % may only be written by the server.', new.kind
      using errcode = 'insufficient_privilege';
  end if;
end;
$function$;

-- ──────────────────────── PROVEN NOT ASSUMED

do $$
declare total int;
begin
  select sum(coins) into total from public.forge_cache_tiers;
  if total <> 430 then
    raise exception 'the cache ladder sums to % coins, not the 430 §6 specifies', total;
  end if;
  if exists (select 1 from public.forge_cache_tiers t1 join public.forge_cache_tiers t2
             on t2.day_index = t1.day_index + 1 where t2.coins <= t1.coins) then
    raise exception 'the cache ladder does not escalate';
  end if;
  -- Additive by constraint, both kinds.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    insert into public.coin_events (user_id, kind, amount, source_id, source_table)
    values ((select id from auth.users limit 1), 'recovery_cache', -1, 'probe-166', 'recovery_runs');
    raise exception 'a NEGATIVE recovery_cache was stored — the floor can subtract';
  exception when check_violation then null;
  end;
  perform set_config('request.jwt.claims', '', true);
end $$;

commit;

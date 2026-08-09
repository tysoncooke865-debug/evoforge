-- EvoForge 160 — THE DETERMINISTIC BACKBONE (Spec v5 §2).
--
-- v5's fourth invariant: predictable, effort-linked rewards must be the clear
-- majority (~70–80%) of expected daily income, and the economy must still feel
-- complete with the chance feature deleted. Today it is nowhere near that, for
-- two reasons this migration fixes.
--
--   1. A LOGGED SET PAYS NOTHING. The whole deterministic side is a 25-coin
--      workout_complete and a 50-coin PR. There is no per-set income at all, so
--      the backbone the invariant is measured against does not exist.
--   2. BATTLES PAY UP TO 120 A DAY, and a battle outcome turns on a server random
--      seed. That is variable income large enough to swamp everything else: at
--      120 the worst cohort sits at 43.7% deterministic against a 70% floor.
--
-- WHAT CHANGES, ALL FORWARD ONLY. No balance is recalculated and nothing is
-- clawed back — an athlete keeps every coin they have already earned, and the new
-- rates apply from here.
--
--   set_reward        NEW, 12 coins per legitimate qualifying set
--   workout_complete  25 -> 20
--   pr                50 -> 25   (fixed, never randomised — §2)
--   battle cap       120 -> 25   (tools/simulate-economy.mjs sets this number)
--
-- WHY 25 AND NOT 30. The sweep puts the highest passing cap at 30, but 30 only
-- passes if the daily mission pays at least 10 coins — a value §2 calls "fixed"
-- and never states. 25 holds at every mission value including zero. The invariant
-- should not rest on a number nobody has decided yet.

begin;

-- ───────────────────────────────────────────── a set is worth something now

alter table public.coin_events drop constraint if exists coin_events_kind_check;
alter table public.coin_events add constraint coin_events_kind_check
  check (kind = any (array[
    'workout_complete', 'pr', 'streak_milestone', 'starting_bonus',
    'adjustment', 'spend', 'battle_reward',
    'challenge_stake', 'challenge_payout',
    'duel_support_stake', 'duel_support_payout',
    'callout_stake', 'callout_payout',
    'forge_drop_stake', 'forge_drop_payout', 'forge_drop_unlock',
    -- 160 — v5 §2: the per-set income the deterministic majority rests on.
    'set_reward'
  ]));

/**
 * HOW MUCH OF A DAY MAY BE PAID PER SET.
 *
 * The unique index `coin_events_source_uidx (user_id, kind, source_id)` already
 * makes one reward per `workout_log` row a database fact rather than a code path,
 * so a doubled tap, a refresh and an offline retry are all the same payment. What
 * it cannot stop is VOLUME: nothing prevents inserting a thousand plausible rows
 * and claiming twelve coins against each.
 *
 * So the cap counts LEDGER ROWS WRITTEN TODAY, not sets logged today. Backdating a
 * workout moves the set's date; it cannot move when it was paid for.
 *
 * 30 is deliberately generous — a very large session is around 20 sets, and the
 * cost of being wrong here is asymmetric. Too low silently stops paying a real
 * athlete mid-workout, which reads as the app being broken; too high just means a
 * determined farmer needs more plausible rows for a worse rate than training.
 */
create or replace function public.set_rewards_paid_today(p_user uuid)
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int
  from public.coin_events
  where user_id = p_user and kind = 'set_reward'
    and created_at::date = current_date;
$$;
revoke execute on function public.set_rewards_paid_today(uuid) from public, anon;
grant execute on function public.set_rewards_paid_today(uuid) to authenticated;

/**
 * IS THIS A SET A HUMAN ACTUALLY DID?
 *
 * §2: "No rewards for empty, duplicated, edited, or implausible sets."
 *
 * `reps > 0 and weight >= 0` is the app's existing definition of a counted set —
 * the same one `coin_events_guard` uses for workout_complete and 061 widened to
 * `>= 0` for bodyweight work. The ceilings are the new part, and they are set
 * where physiology stops rather than where suspicion starts: the heaviest lift
 * ever recorded is around 500 kg and the highest meaningful rep sets run to a few
 * hundred, so 1000 kg and 300 reps refuse data entry accidents and fabrications
 * without ever arguing with a real athlete.
 */
create or replace function public.is_rewardable_set(p_set_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.workout_log w
    where w.id = p_set_id
      and w.user_id = p_user
      and w.reps > 0   and w.reps   <= 300
      and w.weight >= 0 and w.weight <= 1000
  );
$$;
revoke execute on function public.is_rewardable_set(uuid, uuid) from public, anon;
grant execute on function public.is_rewardable_set(uuid, uuid) to authenticated;

-- ──────────────────────────────────────────────────── the guard, extended

/**
 * 159's body with three edits: a `set_reward` branch, and the two amounts §2
 * retunes. Everything else is untouched.
 *
 * The amount is still never the caller's — every branch overwrites `new.amount`
 * from the server's own arithmetic, which is why a claim of 999 becomes what the
 * rule says it is.
 */
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
  price numeric;
  paid_today int;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.kind in ('challenge_stake', 'challenge_payout',
                  'duel_support_stake', 'duel_support_payout') then
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

  if new.kind in ('forge_drop_stake', 'forge_drop_payout') then
    if current_setting('evoforge.forge_drop_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      new.source_table := 'forge_drops';
      return new;
    end if;
    raise exception 'coin_events: % may only be written by a Forge Drop settlement.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind = 'forge_drop_unlock' then
    if current_setting('evoforge.forge_drop_unlock_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      select t.unlock_coins into price
      from public.forge_drop_unlocks u
      join public.forge_drop_tiers t on t.tier = u.tier
      where u.id = new.source_id::uuid and u.user_id = new.user_id;
      if price is null then
        raise exception 'coin_events: no board purchase matches %.', new.source_id
          using errcode = 'check_violation';
      end if;
      new.amount := -price;
      new.source_table := 'forge_drop_unlocks';
      return new;
    end if;
    raise exception 'coin_events: forge_drop_unlock may only be written by a board purchase.'
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

  -- ── 160: A LOGGED SET ──────────────────────────────────────────────────
  --
  -- Claimable by the athlete, unlike the server-only kinds above, because it is
  -- earned by the ordinary act of logging. Everything that makes it safe is
  -- checked here: the row is theirs, it is plausible, and the day is not
  -- already paid out. The once-ness is the unique index, not this branch.
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
    new.amount := 20;                     -- 160: was 25 (§2)
    new.source_table := 'workout_log';
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
    new.amount := 25;                     -- 160: was 50 (§2)
    new.source_table := 'workout_log';
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

-- ─────────────────────────────────────────────── the battle ceiling comes down

/**
 * 033's body with one number changed: the daily coin ceiling from battles, 120 -> 25.
 *
 * NOT BECAUSE BATTLES ARE UNSAFE. Entry is free and the grant is additive, so a
 * battle can never reduce a balance — invariant 1 is untouched, and there is no
 * stake to combine with the seed, so invariant 2 is untouched too. The problem is
 * arithmetic: invariant 4 wants randomness to be garnish, and 120 coins a day from
 * a seeded outcome is a main course beside a ~200-coin deterministic day.
 *
 * The XP ceiling is deliberately left at 200. XP is not the currency the invariant
 * is about, and cutting a progression rate nobody asked me to cut would be a
 * product change smuggled in beside a compliance one.
 */
-- PARAMETER ORDER IS PRODUCTION'S, NOT THE REPO'S. 033 records
-- `(p_mode, p_result_key, p_won)`; the live function is
-- `(p_result_key, p_mode, p_won)`, and `create or replace` refuses to rename an
-- input parameter — which is how this was found. The client calls with named
-- arguments so nothing ever noticed the drift. Matching live keeps every caller
-- working; "fixing" the order here would need a DROP and would break them.
-- Another repo/DB divergence, alongside migration 159.
create or replace function public.grant_battle_reward(
  p_result_key text, p_mode text, p_won boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_xp int := 0;
  v_coins int := 0;
  v_xp_today int;
  v_coins_today int;
  v_xp_cap int := 200;
  v_coins_cap int := 25;   -- 160: was 120 (invariant 4; see tools/simulate-economy.mjs)
  v_src text;
begin
  if uid is null then
    return jsonb_build_object('granted', false, 'reason', 'not_signed_in');
  end if;
  if p_mode not in ('training', 'rival', 'gym') then
    raise exception 'grant_battle_reward: bad mode %', p_mode using errcode = 'check_violation';
  end if;

  if p_mode = 'training' then
    v_xp := 5; v_coins := 0;
  elsif p_mode = 'rival' then
    v_xp := case when p_won then 25 else 8 end;
    v_coins := case when p_won then 20 else 5 end;
  else
    v_xp := case when p_won then 45 else 6 end;
    v_coins := case when p_won then 30 else 0 end;
  end if;

  select coalesce(sum(xp_awarded), 0) into v_xp_today
  from public.xp_ledger
  where user_id = uid and event_type = 'battle_win' and created_at::date = current_date;
  select coalesce(sum(amount), 0) into v_coins_today
  from public.coin_events
  where user_id = uid and kind = 'battle_reward' and created_at::date = current_date;

  v_xp := greatest(0, least(v_xp, v_xp_cap - v_xp_today));
  v_coins := greatest(0, least(v_coins, v_coins_cap - v_coins_today));

  v_src := 'battle:' || p_result_key;

  if v_xp > 0 then
    perform set_config('evoforge.xp_authorized', 'server', true);
    insert into public.xp_ledger (user_id, event_key, event_type, source_id, xp_awarded, metadata)
    values (uid, v_src, 'battle_win', p_result_key, v_xp, jsonb_build_object('mode', p_mode, 'won', p_won))
    on conflict (user_id, event_key) do nothing;
    if not found then
      return jsonb_build_object('granted', false, 'reason', 'already_claimed');
    end if;
  end if;

  if v_coins > 0 then
    perform set_config('evoforge.spend_authorized', v_src, true);
    insert into public.coin_events (user_id, kind, amount, source_table, source_id)
    values (uid, 'battle_reward', v_coins, 'battle_results', v_src);
  end if;

  return jsonb_build_object('granted', true, 'xp', v_xp, 'coins', v_coins);
end;
$$;
revoke all on function public.grant_battle_reward(text, text, boolean) from public, anon;
grant execute on function public.grant_battle_reward(text, text, boolean) to authenticated;

-- ─────────────────────────────────────── THE AMOUNTS, PROVEN NOT ASSUMED

-- Three edits again (constraint, guard, client label). The constraint half is
-- checked here so a kind cannot be admitted without being spellable.
do $$
begin
  if pg_get_constraintdef(
       (select oid from pg_constraint where conname = 'coin_events_kind_check')
     ) not like '%set_reward%' then
    raise exception 'coin_events_kind_check does not admit set_reward';
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- begin;
--   -- restore 159's guard body with workout_complete 25 / pr 50 and no
--   -- set_reward branch, restore 033's v_coins_cap := 120, then:
--   drop function if exists public.is_rewardable_set(uuid, uuid);
--   drop function if exists public.set_rewards_paid_today(uuid);
--   delete from public.coin_events where kind = 'set_reward';
--   -- and drop 'set_reward' from coin_events_kind_check.
-- commit;

-- EvoForge 033 — CRITICAL xp_ledger guard fix + secure battle rewards.
--
-- SECURITY FIX (found 2026-07-16 while building battle rewards): the
-- xp_ledger_guard used `current_user not in ('authenticated','anon')` to
-- detect a security-definer grant. But inside a SECURITY DEFINER trigger
-- current_user is ALWAYS the owner, so the bypass fired for EVERY insert —
-- a raw client POST of {event_type:'anything', xp_awarded:99999} landed
-- verbatim. Any authenticated user could mint arbitrary Forge XP. (Same
-- class of bug as the coin guard, fixed in 030.)
--
-- FIX: a transaction-local GUC (evoforge.xp_authorized = 'server') that ONLY
-- security-definer grant functions set. A client POST is its own single-
-- statement transaction and can never set it, so client inserts fall through
-- to the allowlist (which forces xp_awarded and rejects unknown kinds — this
-- also fixes a latent correctness bug where client rows stored xp_awarded 0).
--
-- Plus: grant_battle_reward — a definer RPC that mints real coins + Forge XP
-- for a battle win, server-decided, idempotent per result, with a DAILY CAP
-- so it can't be farmed. Rides the same GUC pattern (030 + this migration).

-- ---- 1. The fixed xp_ledger guard --------------------------------------
create or replace function public.xp_ledger_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') = 'service_role' then
    return new;
  end if;
  -- The ONLY server bypass: a definer grant function set this txn-local flag.
  -- current_user is NOT usable here (it is always the owner in a definer
  -- trigger); a client PostgREST insert cannot set a GUC in its own txn.
  if current_setting('evoforge.xp_authorized', true) = 'server' then
    return new;
  end if;

  if new.user_id is distinct from auth.uid() then
    raise exception 'xp_ledger: cannot write another user''s ledger';
  end if;

  case new.event_type
    when 'workout_completed' then
      if not exists (
        select 1 from public.workout_sessions ws
        where ws.user_id = auth.uid() and ws.id::text = new.source_id
      ) then
        raise exception 'xp_ledger: workout_completed needs a real finish marker';
      end if;
      new.xp_awarded := 100;
    when 'weekly_checkin' then
      new.xp_awarded := 20;
    when 'cardio_test_completed' then
      new.xp_awarded := 50;
    when 'evo_scan_completed' then
      new.xp_awarded := 40;
    else
      raise exception 'xp_ledger: kind % is server-granted only', new.event_type;
  end case;

  return new;
end;
$$;

-- ---- 2. Definer inserters must now set the flag -------------------------
create or replace function public.forge_claim_weekly(p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_target integer;
  v_days integer;
  v_ratio numeric;
  v_xp integer := 0;
  v_key text;
begin
  if uid is null then
    return jsonb_build_object('granted', 0, 'reason', 'not_signed_in');
  end if;
  if p_week_start + 7 > current_date then
    return jsonb_build_object('granted', 0, 'reason', 'week_not_finished');
  end if;

  select coalesce(weekly_target, 3) into v_target
  from public.user_progression where user_id = uid;
  if v_target is null then v_target := 3; end if;

  select count(distinct date) into v_days
  from public.workout_log
  where user_id = uid
    and date >= p_week_start and date < p_week_start + 7
    and coalesce(weight, 0) > 0 and coalesce(reps, 0) > 0;

  v_ratio := v_days::numeric / v_target;
  if v_ratio >= 1 then v_xp := 250;
  elsif v_ratio >= 0.8 then v_xp := 150;
  end if;

  insert into public.weekly_momentum (user_id, week_start, target_sessions, completed_sessions, completion_ratio, status)
  values (uid, p_week_start, v_target, v_days, least(v_ratio, 9.999),
          case when v_ratio >= 1 then 'success' when v_ratio >= 0.8 then 'partial' else 'missed' end)
  on conflict (user_id, week_start) do update
    set completed_sessions = excluded.completed_sessions,
        completion_ratio = excluded.completion_ratio,
        status = excluded.status,
        updated_at = now();

  if v_xp = 0 then
    return jsonb_build_object('granted', 0, 'reason', 'not_met', 'days', v_days, 'target', v_target);
  end if;

  v_key := 'weekly_target:' || p_week_start::text;
  perform set_config('evoforge.xp_authorized', 'server', true);
  insert into public.xp_ledger (user_id, event_key, event_type, source_id, xp_awarded)
  values (uid, v_key, 'weekly_target', p_week_start::text, v_xp)
  on conflict (user_id, event_key) do nothing;
  if not found then
    return jsonb_build_object('granted', 0, 'reason', 'already_claimed');
  end if;
  return jsonb_build_object('granted', v_xp, 'reason', 'granted', 'days', v_days, 'target', v_target);
end;
$$;

create or replace function public.forge_migrate_history()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_new integer := 0;
  v_legacy_xp bigint;
begin
  if uid is null then
    return jsonb_build_object('migrated', 0, 'reason', 'not_signed_in');
  end if;

  perform set_config('evoforge.xp_authorized', 'server', true);
  with sessions as (
    select distinct date, workout
    from public.workout_log
    where user_id = uid
      and coalesce(weight, 0) > 0 and coalesce(reps, 0) > 0
  ), ins as (
    insert into public.xp_ledger (user_id, event_key, event_type, source_id, xp_awarded)
    select uid,
           'migration:v1:workout:' || date::text || ':' || workout,
           'workout_completed_migrated',
           date::text,
           100
    from sessions
    on conflict (user_id, event_key) do nothing
    returning 1
  )
  select count(*) into v_new from ins;

  select coalesce(sum(amount), 0) into v_legacy_xp
  from public.xp_events where user_id = uid;

  update public.user_progression
  set legacy_xp = coalesce(legacy_xp, v_legacy_xp),
      migration_version = coalesce(migration_version, 'v1'),
      updated_at = now()
  where user_id = uid;
  if not found then
    insert into public.user_progression (user_id, legacy_xp, migration_version)
    values (uid, v_legacy_xp, 'v1')
    on conflict (user_id) do nothing;
  end if;

  return jsonb_build_object('migrated', v_new, 'legacy_xp', v_legacy_xp, 'reason', 'ok');
end;
$$;

-- ---- 3. The coin guard learns a 'battle_reward' kind --------------------
-- Positive coin grants for battle wins, admitted ONLY when purchase-style
-- authorised (the 030 spend GUC), so a client can never forge them.
alter table public.coin_events drop constraint if exists coin_events_kind_check;
alter table public.coin_events add constraint coin_events_kind_check
  check (kind in ('workout_complete','pr','streak_milestone','starting_bonus','adjustment','spend','battle_reward'));

create or replace function public.coin_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  valid_sets int;
  row_e1rm numeric;
  prior_best numeric;
  w record;
  m int;
  claimed_start date;
  s record;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- spend + battle_reward are server-only, admitted when this txn carries the
  -- authorisation flag matching the row's source_id (purchase_skin /
  -- purchase_character / grant_battle_reward).
  if new.kind in ('spend', 'battle_reward') then
    if current_setting('evoforge.spend_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      return new;
    end if;
    raise exception 'coin_events: % may only be written by a server grant.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind = 'workout_complete' then
    if new.source_id is null or new.source_id !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'coin_events: workout_complete needs a date source.' using errcode = 'check_violation';
    end if;
    select count(*) into valid_sets
    from public.workout_log w2
    where w2.user_id = auth.uid() and w2.date = new.source_id::date and w2.weight > 0 and w2.reps > 0;
    if valid_sets < 10 then
      raise exception 'coin_events: not enough training on % (% sets).', new.source_id, valid_sets
        using errcode = 'check_violation';
    end if;
    new.amount := 25;
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
    new.amount := 50;
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
$$;

-- ---- 4. grant_battle_reward — secure, capped battle payouts -------------
create or replace function public.grant_battle_reward(p_result_key text, p_mode text, p_won boolean)
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
  v_xp_cap int := 200;    -- Forge XP from battles per day
  v_coins_cap int := 120; -- coins from battles per day
  v_src text;
begin
  if uid is null then
    return jsonb_build_object('granted', false, 'reason', 'not_signed_in');
  end if;
  if p_mode not in ('training', 'rival', 'gym') then
    raise exception 'grant_battle_reward: bad mode %', p_mode using errcode = 'check_violation';
  end if;

  -- Server-decided amounts (mirrors domain/battle-rpg/rewards, but the
  -- SERVER is authoritative). Training never pays farmable currency.
  if p_mode = 'training' then
    v_xp := 5; v_coins := 0;
  elsif p_mode = 'rival' then
    v_xp := case when p_won then 25 else 8 end;
    v_coins := case when p_won then 20 else 5 end;
  else -- gym
    v_xp := case when p_won then 45 else 6 end;
    v_coins := case when p_won then 30 else 0 end;
  end if;

  -- DAILY CAP (anti-farm): clamp to what's left today.
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

revoke all on function public.grant_battle_reward(text, text, boolean) from public;
grant execute on function public.grant_battle_reward(text, text, boolean) to authenticated;

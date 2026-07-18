-- EvoForge 061 — BODYWEIGHT SETS: 0 kg is a valid set
-- (Tyson's improvement doc §3.1, 2026-07-19).
--
-- THE RULE, everywhere at once: a COUNTED set is `weight >= 0 (non-null)
-- AND reps > 0`; a PR/e1RM-RELEVANT set keeps `weight > 0` — a 0 kg set
-- earns its flat 10 XP (push-ups are training) but can never be a PR, and
-- it contributes nothing to lift battles (battle_events_guard unchanged ON
-- PURPOSE). The six functions below are recreated from their LIVE
-- definitions (pg_get_functiondef, 2026-07-19) with ONLY the predicate
-- edited — the XP mint and its reconciliation oracle change in the same
-- transaction or honest accounts read as drift:
--
--   xp_events_guard      set branch          weight > 0  →  weight >= 0
--   coin_events_guard    workout_complete    weight > 0  →  weight >= 0
--                        (both PR sites STAY weight > 0)
--   leaderboard_top      derived oracle CTE  weight > 0  →  weight >= 0
--   forge_claim_weekly   week day-count      coalesce>0  →  weight >= 0
--   scheduled_streak     trained-day test    weight > 0  →  weight >= 0
--   claim_free_reforge   has-training test   weight > 0  →  weight >= 0
--
-- NO BACKFILL NEEDED: `select count(*) from workout_log where weight = 0
-- and reps > 0` returned 0 on 2026-07-19 — client and server both refused
-- 0 kg until now, so the ledger and the widened oracle agree from row one.
--
-- FALSIFICATION CHECKLIST (as ALPHA, seed → assert → delete):
--  1. a 0 kg × 8 set inserts and its 10-XP mint LANDS.
--  2. a 0 kg × 0 set still cannot mint (reps rule intact).
--  3. a 0 kg set REJECTED as a 'pr' coin source.
--  4. leaderboard drift unchanged by the 0 kg set + its mint (oracle and
--     guard moved together).
--  5. weekly day-count sees a bodyweight-only day.

begin;

CREATE OR REPLACE FUNCTION public.xp_events_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ok   boolean;
  mins numeric;
  battle_xp integer;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.kind = 'set' then
    select exists (
      select 1 from public.workout_log w
      where w.id = new.source_id
        and w.user_id = auth.uid()
        and w.weight >= 0 and w.reps > 0
    ) into ok;
    if not ok then
      raise exception 'xp_events: no matching workout_log row for this set (%).', new.source_id
        using errcode = 'check_violation';
    end if;
    new.amount := 10;               -- domain/xp.py XP_PER_SET
    new.source_table := 'workout_log';
    return new;

  elsif new.kind = 'cardio' then
    select c.minutes into mins
    from public.cardio_log c
    where c.id = new.source_id and c.user_id = auth.uid();
    if not found then
      raise exception 'xp_events: no matching cardio_log row (%).', new.source_id
        using errcode = 'check_violation';
    end if;
    new.amount := floor(coalesce(mins, 0) * 2)::int;
    new.source_table := 'cardio_log';
    if new.amount <= 0 then
      raise exception 'xp_events: cardio session is worth no XP.'
        using errcode = 'check_violation';
    end if;
    return new;

  elsif new.kind = 'battle' then
    select p.xp_awarded into battle_xp
    from public.battle_participants p
    join public.battle_matches m on m.id = p.match_id
    where p.match_id = new.source_id
      and p.user_id = auth.uid()
      and m.status = 'settled';
    if not found or coalesce(battle_xp, 0) <= 0 then
      raise exception 'xp_events: no settled battle award for this match (%).', new.source_id
        using errcode = 'check_violation';
    end if;
    new.amount := battle_xp;
    new.source_table := 'battle_matches';
    return new;

  else
    raise exception 'xp_events: kind % may only be written by the server.', new.kind
      using errcode = 'insufficient_privilege';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.coin_events_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    where w2.user_id = auth.uid() and w2.date = new.source_id::date and w2.weight >= 0 and w2.reps > 0;
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
$function$;

CREATE OR REPLACE FUNCTION public.leaderboard_top(n integer DEFAULT 50)
 RETURNS TABLE(display_name text, xp bigint, base_level integer, rank_position bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    where w.weight >= 0 and w.reps > 0
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
$function$;

CREATE OR REPLACE FUNCTION public.forge_claim_weekly(p_week_start date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    and weight >= 0 and coalesce(reps, 0) > 0;

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
$function$;

CREATE OR REPLACE FUNCTION public.scheduled_streak(p_user uuid, p_asof date)
 RETURNS TABLE(length integer, run_start date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d date := p_asof;
  n int := 0;
  first_completed date := null;
  planned text;
  trained boolean;
  steps int := 0;
begin
  loop
    exit when steps >= 1000;
    steps := steps + 1;

    select ws.plan ->> extract(dow from d)::int::text into planned
    from public.workout_schedule ws
    where ws.user_id = p_user and ws.effective_from <= d
    order by ws.effective_from desc
    limit 1;

    if planned is null or planned = 'Rest' then
      -- rest / unscheduled: bridges, never breaks. But if the athlete has
      -- NO schedule at all ever, stop immediately (streak undefined).
      if not exists (select 1 from public.workout_schedule ws where ws.user_id = p_user and ws.effective_from <= d) then
        exit;
      end if;
      d := d - 1;
      continue;
    end if;

    select exists (
      select 1 from public.workout_log w
      where w.user_id = p_user and w.date = d and w.weight >= 0 and w.reps > 0
    ) into trained;

    if trained then
      n := n + 1;
      first_completed := d;
      d := d - 1;
    elsif d = p_asof then
      -- today still pending: skip, don't break
      d := d - 1;
    else
      exit;
    end if;
  end loop;

  return query select n, first_completed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_free_reforge()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  v_origin text; v_assigned timestamptz; v_granted timestamptz; v_used timestamptz;
  v_days int;
begin
  if me is null then
    raise exception 'claim_free_reforge: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtext(me::text));

  select origin_path, origin_assigned_at, reforge_granted_at, reforge_used_at
    into v_origin, v_assigned, v_granted, v_used
    from profile where user_id = me limit 1;
  if v_origin is null then
    return jsonb_build_object('ok', false, 'reason', 'no_origin');
  end if;
  if v_granted is not null then
    return jsonb_build_object('ok', true, 'already_granted', true,
                              'granted_at', v_granted, 'used', v_used is not null);
  end if;

  -- Server-proved: distinct workout days with Ã¢â€°Â¥1 valid set, strictly after
  -- the binding moment. Never client-counted.
  select count(distinct w.date) into v_days
    from workout_log w
    where w.user_id = me and w.weight >= 0 and w.reps > 0
      and w."timestamp" > v_assigned;

  if v_days >= 3 then
    update profile set reforge_granted_at = now() where user_id = me;
    return jsonb_build_object('ok', true, 'granted', true, 'days', v_days);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'not_eligible',
                            'days', v_days, 'days_remaining', 3 - v_days);
end;
$function$;

commit;

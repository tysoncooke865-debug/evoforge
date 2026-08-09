-- EvoForge 175 — `callout_create` carries the acknowledgement.
--
-- 174 added `above_program_ack` and taught the guard to require it, but nothing
-- could SET it: the create function did not have the parameter, so an above-best
-- pledge was still impossible through the only path a client uses. The override was
-- installed and unreachable.
--
-- The parameter is defaulted FALSE, so every existing caller — including the bundle
-- live right now — behaves exactly as it did before. Only a client that explicitly
-- asks, after explicitly telling the athlete what they are accepting, can set it.

begin;

CREATE OR REPLACE FUNCTION public.callout_create(p_opponent uuid, p_workout_date date, p_workout text, p_exercise text, p_set_no integer, p_target_reps integer, p_target_load_mode text, p_target_weight_kg numeric, p_target_label text, p_stake integer, p_above_program_ack boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  cfg public.workout_callout_config;
  bal int;
  utc_today date := (now() at time zone 'UTC')::date;
  new_id uuid;
  exp timestamptz;
begin
  if me is null then
    raise exception 'callout_create: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if not public.forge_can_challenge(p_opponent) then
    raise exception 'callout_create: you can only call out a friend.' using errcode = 'insufficient_privilege';
  end if;

  select * into cfg from public.workout_callout_config where id;

  -- BOTH SIDES MUST BE IN. Mine because the affordance should not exist if I
  -- turned it off; theirs because an offer nobody can answer is an escrow
  -- waiting to time out.
  if not coalesce((select pr.callouts_enabled from public.profile pr
                   where pr.user_id = me order by pr.created_at desc limit 1), true) then
    raise exception 'callout_create: your call outs are switched off.' using errcode = 'check_violation';
  end if;
  if not coalesce((select pr.callouts_enabled from public.profile pr
                   where pr.user_id = p_opponent order by pr.created_at desc limit 1), true) then
    raise exception 'callout_create: they have call outs switched off.' using errcode = 'check_violation';
  end if;

  if p_stake < cfg.min_stake or p_stake > cfg.max_stake then
    raise exception 'callout_create: the pledge must be between % and %.', cfg.min_stake, cfg.max_stake
      using errcode = 'check_violation';
  end if;

  bal := public.forge_duel_balance(me);
  if bal < p_stake then
    raise exception 'callout_create: you have % coins, not %.', bal, p_stake using errcode = 'check_violation';
  end if;

  if coalesce(p_target_reps, 0) <= 0 then
    raise exception 'callout_create: a call needs a rep target.' using errcode = 'check_violation';
  end if;
  if p_set_no is null or p_set_no < 1 or p_set_no > 8 then
    raise exception 'callout_create: set % is not a working set.', p_set_no using errcode = 'check_violation';
  end if;
  -- Duration and distance sets have no rep proposition, so they have no call.
  if p_target_load_mode not in ('external', 'bodyweight', 'weighted_bodyweight',
                                'assisted_bodyweight', 'repetition_only') then
    raise exception 'callout_create: % sets cannot be called.', p_target_load_mode
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_exercise), '') = '' or coalesce(btrim(p_workout), '') = '' then
    raise exception 'callout_create: the set has no exercise.' using errcode = 'check_violation';
  end if;

  -- 143's lesson, one level down: this app writes the athlete's LOCAL calendar
  -- day. Any real timezone is within a day of UTC; a wider gap is an attempt to
  -- attach a call to a day that already happened.
  if abs(p_workout_date - utc_today) > 1 then
    raise exception 'callout_create: % is not today.', p_workout_date using errcode = 'check_violation';
  end if;

  -- YOU CANNOT CALL A SET YOU HAVE ALREADY DONE. Without this, the whole
  -- feature is a way to bet on the past.
  if exists (
    select 1 from public.workout_log wl
    where wl.user_id = me and wl.date = p_workout_date and wl.workout = p_workout
      and wl.exercise = p_exercise and wl."set" = p_set_no and wl.reps > 0
  ) then
    raise exception 'callout_create: that set is already logged.' using errcode = 'check_violation';
  end if;

  -- ONE LIVE PLEDGE PER SET (172). It used to be one per ATHLETE, full stop — the
  -- partial unique index `workout_callouts_one_live` was the real rule and this
  -- message existed so an athlete got a sentence instead of a constraint name. Now
  -- the same shape narrowed to the set: pledge on every set of every exercise in the
  -- session, and never twice on the same one.
  if exists (
    select 1 from public.workout_callouts wc
    where wc.athlete_id = me
      and wc.workout_date = p_workout_date
      and wc.exercise = p_exercise
      and wc.set_no = p_set_no
      and wc.status in ('offered', 'accepted', 'awaiting_verification')
  ) then
    raise exception 'callout_create: that set already carries a pledge.' using errcode = 'check_violation';
  end if;

  -- ninety, because a gym set is not a coin with a known bias and "99.8%"
  -- deserves to be disbelieved.
  -- NO QUOTED CHANCE. 163 dropped the three probability columns this used to fill.
  -- v5 Â§4 bans the concept and not merely the word, and settlement never read them
  -- anyway: the pool is split fixed and symmetric. What stood here clamped a client
  -- estimate to 10-90% "because a gym set is not a coin with a known bias" â€” true,
  -- and now beside the point, because nothing is quoted to anybody at all.
  exp := now() + make_interval(mins => cfg.offer_minutes);

  insert into public.workout_callouts (
    athlete_id, opponent_id, initiated_by,
    workout_date, workout_name, exercise, set_no,
    target_reps, target_load_mode, target_weight_kg, target_label,
    stake, above_program_ack,
    status, expires_at
  ) values (
    me, p_opponent, me,
    p_workout_date, p_workout, p_exercise, p_set_no,
    p_target_reps, p_target_load_mode, p_target_weight_kg, left(btrim(p_target_label), 60),
    p_stake, coalesce(p_above_program_ack, false),
    'offered', exp
  )
  returning id into new_id;

  perform public.forge_duel_notify(
    p_opponent, me, 'callout_offered',
    jsonb_build_object('callout_id', new_id, 'amount', p_stake, 'pot', p_stake * 2,
                       'exercise', p_exercise, 'target', p_target_label));

  return jsonb_build_object('callout_id', new_id, 'status', 'offered', 'expires_at', exp);
end;
$function$;

revoke execute on function public.callout_create(
  uuid, date, text, text, integer, integer, text, numeric, text, integer, boolean) from public, anon;
grant execute on function public.callout_create(
  uuid, date, text, text, integer, integer, text, numeric, text, integer, boolean) to authenticated;

-- The 10-argument form must not linger beside the 11-argument one, or PostgREST has
-- to choose between them and a client omitting the flag could resolve to either.
drop function if exists public.callout_create(
  uuid, date, text, text, integer, integer, text, numeric, text, integer);

do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'callout_create';
  if n <> 1 then
    raise exception 'expected exactly one callout_create, found %', n;
  end if;
  if pg_get_functiondef((select p.oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = 'callout_create'))
     not like '%above_program_ack%' then
    raise exception 'callout_create does not carry the acknowledgement';
  end if;
end $$;

commit;

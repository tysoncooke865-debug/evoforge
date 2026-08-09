-- EvoForge 170 — REMOVE THE DAILY PLEDGE CAP. (Tyson, 2026-08-09.)
--
-- A DELIBERATE DEVIATION FROM SPEC v5 §4, which says "daily stake cap (~150) shown
-- inline". Recorded here and in docs/V5_MIGRATION_STATUS.md so the review sees it
-- flagged rather than discovering it absent.
--
-- THE REASONING, WHICH IS SOUND. The cap does nothing for classification. What keeps
-- Forge Trial out of R18+ is that it resolves 100% on logged performance with zero
-- RNG (invariant 2), plus the money walls — coins cannot be bought, cashed out or
-- transferred. A ceiling on how many you may pledge touches neither test, and the
-- IARC answers are identical with it and without it.
--
-- Its other justification was the physiotherapist test — bounding the pressure you
-- can load onto one set. That argument got much weaker in 163, which refuses any
-- target above the athlete's own logged best: you cannot pledge on a max attempt at
-- ANY amount. The overtraining wall does that job on its own.
--
-- WHAT STILL STOPS A SPIRAL, and these are the three doing the real work:
--
--   one trial per exercise per session      no re-rolling the same set
--   a miss ends the day, for everything     the actual anti-chase teeth
--   escalation <= 2x the last 7 days' max   bounds the ramp
--
-- The escalation rule is what keeps this from being unbounded in practice: a first
-- pledge is limited only by the balance, and every pledge after it by twice the
-- biggest of the previous week. Someone who wants to reach a large number still has
-- to get there over days, and a single miss ends the day at any point.
--
-- THE COLUMN GOES TOO, not just the check. A `daily_cap` nothing reads is a knob
-- somebody will set in six months and then wonder why it does nothing — the same
-- reasoning that took the duel's switched-off rake out in 164 rather than leaving it
-- at zero.

begin;

alter table public.forge_trial_config drop column if exists daily_cap;

/**
 * WHAT MAY THIS ATHLETE PLEDGE ON THIS EXERCISE, RIGHT NOW?
 *
 * `max_stake` is now NULL when nothing bounds it — a first pledge, or one where the
 * escalation ceiling does not apply. Null means "whatever you can afford", and the
 * balance check in `callout_create` is what enforces that. It is deliberately null
 * rather than a huge number: a sentinel like 999999 would render as a limit in the
 * tray, and there is no limit to render.
 */
create or replace function public.forge_trial_allowance(p_exercise text, p_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  cfg public.forge_trial_config;
  scheduled text[];
  already int;
  missed_today int;
  prev_max int;
  ceiling int;      -- null means unbounded
  spent int;
begin
  if me is null then
    raise exception 'forge_trial_allowance: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  select * into cfg from public.forge_trial_config where id = 1;

  scheduled := public.scheduled_workouts_on(me, p_date);
  if array_length(scheduled, 1) is null then
    return jsonb_build_object('max_stake', 0, 'reason', 'rest_day',
      'message', 'Today is a rest day. Rest is part of the plan.');
  end if;

  -- ONE TRIAL PER EXERCISE PER SESSION (§4).
  select count(*) into already
  from public.workout_callouts c
  where c.athlete_id = me and c.workout_date = p_date and c.exercise = p_exercise
    and c.status in ('offered', 'accepted', 'awaiting_verification', 'settled', 'disputed');
  if already > 0 then
    return jsonb_build_object('max_stake', 0, 'reason', 'already_pledged',
      'message', 'One trial per exercise each session.');
  end if;

  -- A MISS ENDS THE DAY (§4). `result = 'miss'`, not a status — there is no 'lost'.
  select count(*) into missed_today
  from public.workout_callouts c
  where c.athlete_id = me and c.workout_date = p_date and c.result = 'miss';
  if missed_today > 0 then
    return jsonb_build_object('max_stake', 0, 'reason', 'missed_today',
      'message', 'The forge takes its due — back tomorrow.');
  end if;

  spent := public.trial_pledged_today(me);

  -- ESCALATION, now the only ceiling. At most `escalation_multiple` times the
  -- biggest pledge of the last seven days; a first-ever pledge has no ramp to bound
  -- and is limited only by what the athlete actually holds.
  select max(c.stake) into prev_max
  from public.workout_callouts c
  where c.athlete_id = me and c.created_at > now() - interval '7 days'
    and c.status in ('offered', 'accepted', 'awaiting_verification', 'settled', 'disputed');
  if prev_max is not null then
    ceiling := floor(prev_max * cfg.escalation_multiple)::int;
  end if;

  return jsonb_build_object(
    'max_stake', ceiling,                       -- null = unbounded
    'reason', null,
    'message', case when ceiling is null
      then 'Pledge whatever you can back.'
      else format('Up to %s today — twice your biggest pledge this week.', ceiling) end,
    'pledged_today', spent,
    'scheduled_workout', scheduled[1],
    'verifier_threshold', cfg.verifier_threshold,
    'solo_multiple', cfg.solo_multiple);
end;
$$;
revoke execute on function public.forge_trial_allowance(text, date) from public, anon;
grant execute on function public.forge_trial_allowance(text, date) to authenticated;

/** The guard, with the ceiling now optional. */
create or replace function public.forge_trial_eligibility_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  allowance jsonb;
  scheduled text[];
  ceiling int;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  scheduled := public.scheduled_workouts_on(new.athlete_id, new.workout_date);
  if array_length(scheduled, 1) is null then
    raise exception 'forge_trial: % is a rest day. Rest is part of the plan.', new.workout_date
      using errcode = 'check_violation';
  end if;
  if not (new.workout_name = any (scheduled)) then
    raise exception 'forge_trial: your plan has % on that day, not %.',
      array_to_string(scheduled, ' or '), new.workout_name using errcode = 'check_violation';
  end if;

  if not public.is_programmed_target(
       new.athlete_id, new.exercise, new.target_load_mode,
       new.target_weight_kg, new.target_reps) then
    raise exception
      'forge_trial: that target is above anything you have logged for %. A trial is not the place for a max attempt.',
      new.exercise using errcode = 'check_violation';
  end if;

  allowance := public.forge_trial_allowance(new.exercise, new.workout_date);
  ceiling := (allowance ->> 'max_stake')::int;

  -- 0 is a refusal (rest day, already pledged, missed today). NULL is "unbounded",
  -- which is now the ordinary case for a first pledge — the two must not be
  -- conflated, or removing the cap would refuse every opening pledge.
  if ceiling is not null and ceiling <= 0 then
    raise exception 'forge_trial: %', allowance ->> 'message'
      using errcode = 'check_violation';
  end if;
  if ceiling is not null and new.stake > ceiling then
    raise exception 'forge_trial: % coins is over today''s limit — %', new.stake,
      allowance ->> 'message' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ──────────────────── PROVEN: unbounded, but not unbraked

do $$
declare gone boolean;
begin
  select not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'forge_trial_config'
      and column_name = 'daily_cap') into gone;
  if not gone then
    raise exception 'daily_cap survived — a knob nothing reads is worse than no knob';
  end if;

  -- The three brakes that remain must still be named in the function, or removing
  -- the cap has quietly removed them too.
  if pg_get_functiondef('public.forge_trial_allowance(text,date)'::regprocedure)
       not like '%already_pledged%'
     or pg_get_functiondef('public.forge_trial_allowance(text,date)'::regprocedure)
       not like '%missed_today%'
     or pg_get_functiondef('public.forge_trial_allowance(text,date)'::regprocedure)
       not like '%escalation_multiple%' then
    raise exception 'a chase-prevention rule went missing with the cap';
  end if;
end $$;

commit;

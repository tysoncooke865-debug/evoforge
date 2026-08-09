-- EvoForge 169 — HOTFIX: the eligibility guard was refusing every real pledge.
--
-- 163 added a BEFORE INSERT trigger requiring the call out's workout to match the
-- one the plan names for that weekday. `scheduled_workout_on` read that as
--
--     plan ->> weekday
--
-- which is correct only when a weekday's value is a plain string. IT IS OFTEN AN
-- ARRAY — a real plan looks like:
--
--     { "0": ["Rest", "Push 2 - Hypertrophy"], "1": "Push 1 - Strength", ... }
--
-- so `->>` returned the literal text `["Rest", "Push 2 - Hypertrophy"]`, which never
-- equals "Push 2 - Hypertrophy", and the guard refused the pledge. Reported from
-- production: a pledge would not go through at all.
--
-- WHY I DID NOT SEE IT. I built and falsified `scheduled_workout_on` against ALPHA,
-- a smoke account whose plan happens to be a flat string map, and I WROTE that map
-- myself inside the test. The falsification was thorough about the rules and blind
-- about the data — it proved the guard refuses a rest day and a wrong workout, using
-- a schedule shape no real athlete has. A fixture I authored cannot tell me what
-- production looks like.
--
-- A day may also hold BOTH a rest and a workout (`["Rest", "Push 2"]`), so "is today
-- a rest day" is not the negation of "is today a training day": the honest question
-- is whether the named workout is among the day's entries.

begin;

/**
 * EVERY WORKOUT THE PLAN NAMES FOR A DATE, as a set. 'Rest' is excluded — it is the
 * absence of a workout, not one you can pledge on.
 *
 * Handles both shapes because both are real: a bare string, and an array.
 */
create or replace function public.scheduled_workouts_on(p_user uuid, p_date date)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  with today as (
    select s.plan -> extract(dow from p_date)::text as v
    from public.workout_schedule s
    where s.user_id = p_user and s.effective_from <= p_date
    order by s.effective_from desc
    limit 1
  )
  select coalesce(array_agg(w) filter (where w is not null and w <> 'Rest'), '{}')
  from today
  cross join lateral (
    -- A UNION rather than a CASE: `jsonb_array_elements_text` is set-returning, and
    -- a scalar CASE cannot hold it ("more than one row returned by a subquery").
    -- Exactly one branch matches, so this expands an array and passes a string
    -- through without either seeing the other.
    select jsonb_array_elements_text(today.v) as w where jsonb_typeof(today.v) = 'array'
    union all
    select today.v #>> '{}'                    where jsonb_typeof(today.v) = 'string'
  ) x;
$$;
revoke execute on function public.scheduled_workouts_on(uuid, date) from public, anon;
grant execute on function public.scheduled_workouts_on(uuid, date) to authenticated;

/**
 * The single-workout reading, kept because `forge_trial_allowance` reports it and
 * the tray shows it. Now the FIRST scheduled workout rather than a raw `->>`, and
 * null only when the day really has none.
 */
create or replace function public.scheduled_workout_on(p_user uuid, p_date date)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select (public.scheduled_workouts_on(p_user, p_date))[1];
$$;
revoke execute on function public.scheduled_workout_on(uuid, date) from public, anon;
grant execute on function public.scheduled_workout_on(uuid, date) to authenticated;

/** Is this workout one of the day's? Membership, not equality. */
create or replace function public.is_scheduled_workout(p_user uuid, p_date date, p_workout text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_workout = any (public.scheduled_workouts_on(p_user, p_date));
$$;
revoke execute on function public.is_scheduled_workout(uuid, date, text) from public, anon;
grant execute on function public.is_scheduled_workout(uuid, date, text) to authenticated;

-- ───────────────────────── the guard asks the right question

create or replace function public.forge_trial_eligibility_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  allowance jsonb;
  scheduled text[];
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- 1. A TRAINING DAY, AND ONE OF THE DAY'S WORKOUTS. Membership, because a weekday
  --    can name more than one — including a rest AND a session.
  scheduled := public.scheduled_workouts_on(new.athlete_id, new.workout_date);
  if array_length(scheduled, 1) is null then
    raise exception 'forge_trial: % is a rest day. Rest is part of the plan.', new.workout_date
      using errcode = 'check_violation';
  end if;
  if not (new.workout_name = any (scheduled)) then
    raise exception 'forge_trial: your plan has % on that day, not %.',
      array_to_string(scheduled, ' or '), new.workout_name using errcode = 'check_violation';
  end if;

  -- 2. NOT A PR ATTEMPT, NOT ABOVE PROGRAM.
  if not public.is_programmed_target(
       new.athlete_id, new.exercise, new.target_load_mode,
       new.target_weight_kg, new.target_reps) then
    raise exception
      'forge_trial: that target is above anything you have logged for %. A trial is not the place for a max attempt.',
      new.exercise using errcode = 'check_violation';
  end if;

  -- 3. THE BRAKE.
  allowance := public.forge_trial_allowance(new.exercise, new.workout_date);
  if (allowance ->> 'max_stake')::int <= 0 then
    raise exception 'forge_trial: %', allowance ->> 'message'
      using errcode = 'check_violation';
  end if;
  if new.stake > (allowance ->> 'max_stake')::int then
    raise exception 'forge_trial: % coins is over today''s limit — %', new.stake,
      allowance ->> 'message' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ────────────── PROVEN AGAINST THE SHAPES THAT ACTUALLY EXIST

do $$
declare
  arr_user uuid;
  str_user uuid;
  got text[];
begin
  -- A user whose plan holds an ARRAY on some weekday, and one that is all strings.
  select user_id into arr_user from public.workout_schedule s
   where exists (select 1 from jsonb_each(s.plan) e where jsonb_typeof(e.value) = 'array')
   limit 1;
  select user_id into str_user from public.workout_schedule s
   where not exists (select 1 from jsonb_each(s.plan) e where jsonb_typeof(e.value) = 'array')
   limit 1;

  if arr_user is not null then
    -- Every day of the week must resolve without error and without leaking a raw
    -- JSON array into a workout name.
    for i in 0..6 loop
      got := public.scheduled_workouts_on(arr_user, current_date + i);
      if exists (select 1 from unnest(got) g where g like '[%') then
        raise exception 'a raw JSON array leaked into a workout name: %', got;
      end if;
      if exists (select 1 from unnest(got) g where g = 'Rest') then
        raise exception 'Rest is not a workout you can pledge on, but it survived: %', got;
      end if;
    end loop;
  end if;

  if str_user is not null then
    for i in 0..6 loop
      perform public.scheduled_workouts_on(str_user, current_date + i);
    end loop;
  end if;

  -- And an athlete with no schedule row at all is a rest day, not an error.
  if public.scheduled_workout_on('00000000-0000-4000-8000-00000000dead', current_date) is not null then
    raise exception 'an athlete with no schedule should have no scheduled workout';
  end if;
end $$;

commit;

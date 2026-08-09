-- EvoForge 176 — TELL THE CLIENT *WHICH* REFUSAL THIS IS.
--
-- 174 made an above-best target a choice; 175 gave `callout_create` the parameter.
-- The remaining question is HOW THE ATHLETE IS ASKED, and it decides whether the
-- v5.1 solicitation ban survives the override.
--
-- THE ASK MUST NOT COME FIRST. A badge, a hint, or an "unlock a bigger target"
-- affordance in the tray would be the app suggesting a PR attempt — the half of v5.1
-- Tyson did NOT override. So the tray says nothing until the athlete has typed an
-- above-best target of their own accord and pressed pledge. The refusal is the prompt;
-- the athlete's own decision is what triggers it.
--
-- That design needs the client to distinguish THIS refusal from the other four the
-- same trigger raises (rest day, wrong workout, over the ramp, missed today) — the
-- others must stay flat refusals with no way through. Matching on message text would
-- do it and would break the first time anybody rewords a sentence, which is exactly
-- the sort of coupling that rots quietly.
--
-- `hint` is the structured field for this. PostgREST forwards it verbatim, so
-- supabase-js sees `error.hint === 'above_program_ack'` and nothing else does.
-- One branch carries it. A refusal without the hint is not confirmable, by
-- construction rather than by the client's good manners.

begin;

CREATE OR REPLACE FUNCTION public.forge_trial_eligibility_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 174: ABOVE YOUR BEST IS NOW A CHOICE, NOT A WALL — but it has to be made, and
  -- it is made per pledge. The message says what is being accepted rather than
  -- simply refusing, because an athlete who meant it needs to know how to proceed
  -- and one who did not needs to know what they nearly did.
  if not public.is_programmed_target(
       new.athlete_id, new.exercise, new.target_load_mode,
       new.target_weight_kg, new.target_reps)
     and not coalesce(new.above_program_ack, false) then
    raise exception
      'forge_trial: that target is above anything you have logged for %. Pledge on it only if you have decided to attempt it — the coins pay the same either way.',
      new.exercise using errcode = 'check_violation', hint = 'above_program_ack';
  end if;

  allowance := public.forge_trial_allowance(new.exercise, new.workout_date);
  ceiling := (allowance ->> 'max_stake')::int;
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
$function$;

do $$
declare d text := pg_get_functiondef('public.forge_trial_eligibility_guard()'::regprocedure);
begin
  -- Exactly one branch may be confirmable. If a later edit copies the hint onto the
  -- rest-day or over-the-ramp branch, the client would offer a way through a wall
  -- that has no way through.
  if (length(d) - length(replace(d, 'above_program_ack', ''))) / length('above_program_ack') <> 2 then
    raise exception 'expected the ack to appear exactly twice (the check and the hint), found %',
      (length(d) - length(replace(d, 'above_program_ack', ''))) / length('above_program_ack');
  end if;
  if d not like '%hint = ''above_program_ack''%' then
    raise exception 'the hint is not on the consent branch';
  end if;
end $$;

-- ─────────── PROVEN: the hint arrives on that refusal, and on no other

do $$
declare
  u uuid; o uuid; sched text[]; ex text; best numeric; h text;
begin
  select athlete_id, opponent_id into u, o
    from public.workout_callouts order by created_at desc limit 1;
  sched := public.scheduled_workouts_on(u, current_date);
  if u is null or array_length(sched, 1) is null then
    raise notice 'nobody training today — skipping the live check'; return;
  end if;
  select w.exercise, max(w.weight) into ex, best
    from public.workout_log w
    where w.user_id = u and w.weight > 0 and w.reps > 0 and w.date >= current_date - 30
    group by w.exercise order by max(w.weight) desc limit 1;

  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u), true);

  -- 1. Above best -> refused WITH the hint.
  h := null;
  begin
    insert into public.workout_callouts (
      athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise,
      set_no, target_reps, target_load_mode, target_weight_kg, target_label, stake,
      status, expires_at)
    values (u, o, u, current_date, sched[1], ex, 21, 3, 'external', best + 10,
            'probe176'::text, 10, 'offered', now() + interval '1 hour');
    raise exception 'an above-best pledge was allowed with no acknowledgement';
  exception when check_violation then
    get stacked diagnostics h = pg_exception_hint;
  end;
  if h is distinct from 'above_program_ack' then
    raise exception 'the consent refusal carried hint % — the tray cannot recognise it', coalesce(h, '(none)');
  end if;

  -- 2. A REST DAY is not confirmable, and must not carry the hint.
  h := null;
  begin
    insert into public.workout_callouts (
      athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise,
      set_no, target_reps, target_load_mode, target_weight_kg, target_label, stake,
      status, expires_at, above_program_ack)
    values (u, o, u, current_date, 'Not A Real Workout Name', ex, 22, 3, 'external',
            best, 'probe176'::text, 10, 'offered', now() + interval '1 hour', true);
    raise exception 'a pledge on a workout that is not scheduled was allowed';
  exception when check_violation then
    get stacked diagnostics h = pg_exception_hint;
  end;
  if h = 'above_program_ack' then
    raise exception 'the wrong-workout refusal is offering a way through';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  delete from public.workout_callouts where athlete_id = u and target_label = 'probe176';
  perform set_config('request.jwt.claims', '', true);
end $$;

commit;

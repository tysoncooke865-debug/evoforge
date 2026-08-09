-- EvoForge 177 - SAY WHY THE PLEDGE BUTTON IS CLOSED.
--
-- Reported by Tyson, 2026-08-09: "it says the forge has its due, what does this
-- mean". A fair question, and the answer was nowhere on the screen.
--
-- He had pledged 65 on Pushups at BW x 35+ and missed it. Spec v5 §4's brake then
-- ends pledging for the rest of the day, on EVERY exercise - and the only thing the
-- app said was:
--
--     "The forge takes its due - back tomorrow."
--
-- Which states a consequence and hides all three facts an athlete needs: that a
-- MISS caused it, that it covers every exercise rather than the one that was
-- missed, and that TRAINING is unaffected. Read cold, in a tray that had just
-- stopped offering chips, the likeliest reading is "something is broken" or
-- "I have been penalised somehow". Flavour text in place of a reason.
--
-- It got more visible today, not less: before this morning the tray never called
-- `forge_trial_allowance` at all, so this sentence only ever appeared as an error
-- toast after a refused pledge. Now it is captioned inline the moment the tray
-- opens, which is the right place for it and exactly why it has to be legible.
--
-- THE RULE IS NOT CHANGING, and it should not. A miss ending the day is the brake
-- that made 170 and 171 safe: it is why removing the daily cap and the
-- one-trial-per-exercise limit did not open a chasing loop, because extra trials
-- can only ever happen while an athlete is SUCCEEDING. Take this out and the
-- justification for both of those goes with it. Only the words change.
--
-- The exercise name comes from the missed row, so the sentence points at the thing
-- that actually happened rather than at a rule in the abstract.

begin;

CREATE OR REPLACE FUNCTION public.forge_trial_allowance(p_exercise text, p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  cfg public.forge_trial_config;
  scheduled text[];
  missed_today int;
  missed_exercise text;
  prev_max int;
  ceiling int;      -- null means unbounded
  spent int;
  today_count int;
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

  -- 171: NO per-exercise limit. An exercise may carry a pledge on every set.

  -- A MISS ENDS THE DAY (§4) — the one brake that does the real work, untouched.
  select count(*), min(c.exercise) into missed_today, missed_exercise
  from public.workout_callouts c
  where c.athlete_id = me and c.workout_date = p_date and c.result = 'miss';
  if missed_today > 0 then
    return jsonb_build_object('max_stake', 0, 'reason', 'missed_today',
      'message', format(
        'That %s pledge did not land. One miss ends pledging for the day, on every exercise - your training carries on as normal. Back tomorrow.',
        coalesce(missed_exercise, 'earlier')),
      'missed_exercise', missed_exercise);
  end if;

  select count(*), coalesce(sum(c.stake), 0) into today_count, spent
  from public.workout_callouts c
  where c.athlete_id = me and c.workout_date = p_date
    and c.status in ('offered', 'accepted', 'awaiting_verification', 'settled', 'disputed');

  -- ESCALATION, FROM PREVIOUS DAYS ONLY.
  --
  -- `workout_date < p_date` is the whole change. Reading today's pledges too would
  -- let the ceiling double with each one inside a single session, which is exactly
  -- what removing the per-exercise limit would otherwise have unlocked.
  select max(c.stake) into prev_max
  from public.workout_callouts c
  where c.athlete_id = me
    and c.created_at > now() - interval '7 days'
    and c.workout_date < p_date
    and c.status in ('offered', 'accepted', 'awaiting_verification', 'settled', 'disputed');
  if prev_max is not null then
    ceiling := floor(prev_max * cfg.escalation_multiple)::int;
  end if;

  return jsonb_build_object(
    'max_stake', ceiling,                       -- null = unbounded
    'reason', null,
    'message', case when ceiling is null
      then 'Pledge whatever you can back.'
      else format('Up to %s per pledge today — twice your biggest of the past week.', ceiling) end,
    'pledged_today', spent,
    'trials_today', today_count,
    'scheduled_workout', scheduled[1],
    'verifier_threshold', cfg.verifier_threshold,
    'solo_multiple', cfg.solo_multiple);
end;
$function$;

revoke execute on function public.forge_trial_allowance(text, date) from public, anon;
grant execute on function public.forge_trial_allowance(text, date) to authenticated;

-- The guard raises its own copy of this on insert, and it must not now disagree
-- with the tray. It interpolates `allowance ->> 'message'`, so it inherits the new
-- sentence for free - asserted rather than assumed.
do $$
declare g text := pg_get_functiondef('public.forge_trial_eligibility_guard()'::regprocedure);
begin
  if g not like '%allowance ->> ''message''%' then
    raise exception 'the guard no longer quotes the allowance message; the two copies can drift';
  end if;
  if pg_get_functiondef('public.forge_trial_allowance(text,date)'::regprocedure)
       like '%takes its due%' then
    raise exception 'the opaque sentence survived';
  end if;
end $$;

-- ----------- PROVEN against the athlete who actually hit it today

do $$
declare
  u uuid; a jsonb; ex text;
begin
  -- Somebody with a miss on the board today; skip cleanly if nobody does.
  select c.athlete_id, c.exercise into u, ex
  from public.workout_callouts c
  where c.workout_date = current_date and c.result = 'miss'
  order by c.created_at desc limit 1;
  if u is null then
    raise notice 'no miss today - skipping the live check'; return;
  end if;

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', u), true);
  a := public.forge_trial_allowance('Any Exercise At All', current_date);
  perform set_config('request.jwt.claims', '', true);

  -- Still closed for the day: the rule is untouched.
  if (a ->> 'max_stake')::int <> 0 or a ->> 'reason' is distinct from 'missed_today' then
    raise exception 'the miss brake stopped working: %', a;
  end if;
  -- And now it says why, names the exercise, and says training is unaffected.
  if a ->> 'message' not like '%' || ex || '%' then
    raise exception 'the message does not name the missed exercise (%): %', ex, a ->> 'message';
  end if;
  if a ->> 'message' not like '%every exercise%'
     or a ->> 'message' not like '%training carries on%' then
    raise exception 'the message still does not explain the scope: %', a ->> 'message';
  end if;
  raise notice 'now reads: %', a ->> 'message';
end $$;

commit;

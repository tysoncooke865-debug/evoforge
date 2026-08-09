-- EvoForge 178 - A MISS NO LONGER ENDS THE DAY. (Tyson, 2026-08-09.)
--
-- THE FOURTH DELIBERATE DEVIATION FROM SPEC v5 §4 today, and the largest. Asked
-- for after he asked whether the rule was a legal requirement and I said plainly
-- that it is not, and after I set out what it was actually holding up. He chose to
-- remove it. Recorded here so the review reads a decision rather than a drift.
--
-- IT IS NOT A LEGAL OR POLICY RULE, and that part of my answer stands. Three things
-- carry the classification weight and this is none of them:
--
--   1. zero RNG in a pledge - settlement is 100% logged performance, which is what
--      keeps Forge Trial outside "simulated gambling" as a MECHANICS test
--   2. the money walls - coins cannot be bought, cashed out or transferred
--   3. a balance never falls after a random event
--
-- Removing a chase brake changes no IARC answer and no R18+/16+ analysis. Nothing
-- here claims the app is legally cleared; the external check before first
-- submission with Trials live is still open.
--
-- WHAT IT WAS ACTUALLY HOLDING UP, stated because it is my own argument and it is
-- now spent. In 170 I justified removing the daily cap, and in 171 the
-- one-trial-per-exercise limit, on the grounds that a miss ends the day - so extra
-- trials could only ever happen while an athlete was SUCCEEDING. That reasoning
-- does not survive this migration. All three are now gone, and the honest statement
-- of what remains is below rather than an implication a later reader has to derive.
--
-- WHAT STILL BOUNDS A SESSION, in full:
--
--   escalation ramp      at most `escalation_multiple` x the biggest pledge of the
--                        previous seven days, read from `workout_date < today` so
--                        nothing inside a session can raise its own ceiling
--   per-pledge config    `workout_callout_config.max_stake`, currently 500
--   the balance          checked in `callout_create`; coins are earned-only
--   one live per set     `workout_callouts_one_live_per_set` (172)
--   a scheduled day      the workout must be on the plan for that date
--   above your best      allowed since 174, but only with an explicit per-pledge
--                        acknowledgement, and it pays no more
--
-- THE EXPOSURE, PLAINLY. An athlete may now pledge after losing, repeatedly, in the
-- same session. Someone with no pledge history has no ramp to bound at all, so
-- their first day is limited only by their balance and by 500 per pledge - several
-- hundred coins, and now with no event that stops it. That is a real change in
-- shape and it is the reason this header is long. The floor holds: coins cannot be
-- purchased, so the worst case is a balance near zero, and the Recovery Run (166)
-- puts 50 back for three legitimate sets.
--
-- `result = 'miss'` is untouched as a settlement outcome. It still decides who is
-- paid. It simply no longer gates tomorrow's - or rather today's - next pledge.

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
-- 178: THE MISS RULE IS GONE. A miss no longer closes the day, for this
  -- exercise or any other. The escalation ramp below is now the only day-level
  -- bound, and it is deliberately read from PREVIOUS days so nothing inside a
  -- session can raise it.

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

-- ----------- PROVEN: the athlete who was closed out today can pledge again

do $$
declare
  u uuid; ex text; a jsonb; d text;
begin
  d := pg_get_functiondef('public.forge_trial_allowance(text,date)'::regprocedure);
  if d like '%missed_today%' then
    raise exception 'the miss branch survived';
  end if;
  -- The ramp must NOT have gone with it. Removing the last brake by accident while
  -- removing one on purpose is exactly the failure this asserts against.
  if d not like '%escalation_multiple%' or d not like '%workout_date < p_date%' then
    raise exception 'the escalation ramp went missing with the miss rule';
  end if;
  if d not like '%rest_day%' then
    raise exception 'the rest-day refusal went missing with the miss rule';
  end if;

  select c.athlete_id, c.exercise into u, ex
  from public.workout_callouts c
  where c.workout_date = current_date and c.result = 'miss'
  order by c.created_at desc limit 1;
  if u is null then
    raise notice 'no miss today - skipping the live check'; return;
  end if;

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', u), true);
  a := public.forge_trial_allowance(ex, current_date);
  perform set_config('request.jwt.claims', '', true);

  -- Was 0 / missed_today before this migration. Must now be open.
  if a ->> 'reason' = 'missed_today' then
    raise exception 'still closed for the day: %', a;
  end if;
  if (a ->> 'max_stake') is not null and (a ->> 'max_stake')::int <= 0 then
    raise exception 'the day is still closed for another reason: %', a;
  end if;
  raise notice 'now open on %: max_stake=%, message=%',
    ex, coalesce(a ->> 'max_stake', 'unbounded'), a ->> 'message';
end $$;

commit;

-- EvoForge 171 — UNLIMITED TRIALS PER EXERCISE, AND A RAMP THAT HOLDS STILL.
--
-- Two deliberate deviations from Spec v5 §4 (Tyson, 2026-08-09), recorded here and
-- in docs/V5_MIGRATION_STATUS.md so the review sees them flagged.
--
--   1. "one trial per exercise per session"  -> REMOVED
--   2. escalation re-read after every pledge -> computed from PREVIOUS DAYS only
--
-- NEITHER TOUCHES CLASSIFICATION. A Forge Trial resolves 100% on logged performance
-- with zero RNG, and coins cannot be bought, cashed out or transferred. How many
-- trials a session allows changes neither the chance/skill test nor the money walls;
-- the IARC answers are the same at one per exercise and at unlimited.
--
-- WHAT STILL PREVENTS CHASING, and it is the rule that always did the work:
-- A MISS ENDS THE DAY, for every exercise, not just the one that was missed. Extra
-- trials therefore only ever happen while an athlete is SUCCEEDING, which is not the
-- behaviour the rule existed to stop. The per-exercise limit was bounding the wrong
-- thing — it stopped a second pledge on a four-set exercise you were about to do
-- anyway, and stopped nothing at all after a loss.
--
-- WHY THE RAMP HAD TO CHANGE AT THE SAME TIME. The escalation ceiling was "twice the
-- biggest pledge of the last seven days", re-read before every pledge — which was
-- harmless at one trial per exercise and compounds badly without it: 400 makes the
-- next 800, which makes the next 1600, all inside one workout. It now reads only
-- pledges from BEFORE today, so today's ceiling is fixed when the day starts and
-- nothing an athlete does during a session can raise it.
--
-- THE CONSEQUENCE, STATED PLAINLY BECAUSE IT IS REAL: an athlete with no pledge
-- history has no ramp to bound, so their FIRST day is limited only by their balance
-- and by `workout_callout_config.max_stake` (500 per pledge). With unlimited trials
-- that is several hundred coins of exposure on day one, ended by the first miss.
-- Coins are earned-only and the Recovery Run guarantees nobody is locked out, so the
-- floor holds — but it is a real change in shape and should not be discovered later.

begin;

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
  missed_today int;
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
  select count(*) into missed_today
  from public.workout_callouts c
  where c.athlete_id = me and c.workout_date = p_date and c.result = 'miss';
  if missed_today > 0 then
    return jsonb_build_object('max_stake', 0, 'reason', 'missed_today',
      'message', 'The forge takes its due — back tomorrow.');
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
$$;
revoke execute on function public.forge_trial_allowance(text, date) from public, anon;
grant execute on function public.forge_trial_allowance(text, date) to authenticated;

-- VERIFICATION LIVES IN 172, not here. This half and that one are a pair: the
-- per-exercise rule below is not the binding constraint — `callout_create`'s
-- one-live-call index is — so a check here could only ever fail. Splitting the
-- proof from the change is a smell; splitting it across an inseparable pair is
-- the honest alternative to a single migration nobody can read.

commit;

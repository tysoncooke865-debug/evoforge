-- EvoForge 188 - THE ESCALATION RAMP OPENS UP: 2x -> 5x. (Tyson, 2026-08-10.)
--
-- The ramp is the only structural bound left on a session after 170 (daily cap), 171
-- (one trial per exercise) and 178 (a miss ends the day). Tyson asked to keep it and
-- widen it rather than remove it, which is the option I recommended.
--
-- WHAT CHANGES: an established athlete's per-pledge ceiling goes from twice their
-- biggest pledge of the previous seven days to five times it. Pledge 100 last week
-- and today's ceiling is 500 rather than 200 - which is the `workout_callout_config`
-- per-pledge maximum anyway, so at that point the ramp stops being the binding
-- constraint at all and the 500 limit takes over.
--
-- WHAT DOES NOT CHANGE, and this is the part worth keeping straight:
--
--   * IT STILL READS PREVIOUS DAYS ONLY (`workout_date < p_date`). That is the
--     anti-compounding rule, and it matters MORE at 5x, not less: if today's pledges
--     counted, 100 would authorise 500, which would authorise 2500, inside one
--     session. Widening the multiple without that clause would be a different and
--     much worse change.
--   * A FIRST-EVER PLEDGE IS STILL UNBOUNDED by the ramp. `prev_max` is null, so
--     `ceiling` stays null, so a new athlete is limited only by their balance and by
--     500 per pledge. The ramp has never protected new athletes and does not now.
--   * Classification is untouched. Zero RNG, skill-resolved, money walls intact.
--     A ceiling on a pledge is not a chance mechanic at any multiple.
--
-- ── AND THE SENTENCE HAD THE NUMBER BAKED INTO IT ──
--
-- `forge_trial_allowance` returned:
--
--     'Up to %s per pledge today - twice your biggest of the past week.'
--
-- with "twice" as a literal, while the multiple came from config. At 5x that message
-- would have told every athlete something false, and nothing would have failed. Same
-- shape as the 'COINS BANKED +50' toast that overstated a PR by 25 coins for two
-- migrations: a second copy of a number that no test compares to the first.
--
-- The sentence now derives the word from `cfg.escalation_multiple`, so the config is
-- the only place the number lives. The trailing-zero trim keeps it reading "5" rather
-- than "5.0" - it is a numeric column, and "5.0 times" reads like a spreadsheet.

begin;

-- The value, and the default, so a fresh environment matches production.
alter table public.forge_trial_config alter column escalation_multiple set default 5;
update public.forge_trial_config set escalation_multiple = 5, updated_at = now() where id = 1;

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
      else format('Up to %s per pledge today - %s times your biggest of the past week.',
                  ceiling, trim(trailing '.' from trim(trailing '0' from cfg.escalation_multiple::text)))
      end,
    'pledged_today', spent,
    'trials_today', today_count,
    'scheduled_workout', scheduled[1],
    'verifier_threshold', cfg.verifier_threshold,
    'solo_multiple', cfg.solo_multiple);
end;
$function$;

revoke execute on function public.forge_trial_allowance(text, date) from public, anon;
grant execute on function public.forge_trial_allowance(text, date) to authenticated;

-- ─────────── PROVEN: the ceiling moved, the sentence agrees, the brake held

do $$
declare
  d text;
  m numeric;
begin
  select escalation_multiple into m from public.forge_trial_config where id = 1;
  if m <> 5 then raise exception 'escalation_multiple is % not 5', m; end if;

  d := pg_get_functiondef('public.forge_trial_allowance(text,date)'::regprocedure);

  -- NO HARDCODED MULTIPLIER WORD may survive. This is the assertion that would have
  -- caught the original bug.
  if d like '%twice your biggest%' then
    raise exception 'the message still says "twice" while the config says %', m;
  end if;
  if d not like '%cfg.escalation_multiple::text%' then
    raise exception 'the message no longer derives the multiple from config';
  end if;

  -- THE ANTI-COMPOUNDING CLAUSE MUST SURVIVE. At 5x, losing it would let 100
  -- authorise 500 authorise 2500 inside one session.
  if d not like '%workout_date < p_date%' then
    raise exception 'the ramp now reads today''s own pledges - it will compound';
  end if;

  -- And a first pledge is still unbounded rather than accidentally zero.
  if d not like '%null = unbounded%' then
    raise exception 'the unbounded-first-pledge case lost its meaning';
  end if;
end $$;

-- The live arithmetic, on a real athlete with pledge history.
do $$
declare
  u uuid; prev int; a jsonb;
begin
  -- MIRROR THE FUNCTION'S OWN FILTER, status included. The first version of this
  -- probe omitted it, picked up a cancelled pledge of 200, and reported "ceiling is
  -- 400 for a previous best of 200 - expected 1000". The ceiling was right (80 x 5);
  -- the probe was comparing against a pledge the ramp does not count. A check that
  -- does not reproduce the rule it is checking measures its own assumptions.
  select c.athlete_id, max(c.stake) into u, prev
  from public.workout_callouts c
  where c.workout_date < current_date
    and c.created_at > now() - interval '7 days'
    and c.status in ('offered', 'accepted', 'awaiting_verification', 'settled', 'disputed')
  group by c.athlete_id order by max(c.stake) desc limit 1;
  if u is null then raise notice 'nobody has prior-week pledges - skipping'; return; end if;

  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', u), true);
  a := public.forge_trial_allowance('Any Exercise', current_date);
  perform set_config('request.jwt.claims', '', true);

  -- Only meaningful when the day is actually open; a rest day answers 0.
  if (a ->> 'reason') is null and (a ->> 'max_stake') is not null then
    if (a ->> 'max_stake')::int <> prev * 5 then
      raise exception 'ceiling is % for a previous best of % - expected %',
        a ->> 'max_stake', prev, prev * 5;
    end if;
    raise notice 'ceiling now % from a previous best of %', a ->> 'max_stake', prev;
  else
    raise notice 'day closed for that athlete (%) - arithmetic not exercised', a ->> 'reason';
  end if;
end $$;

commit;

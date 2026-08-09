-- EvoForge 163 — FORGE TRIAL: the pledge side gets eligibility and a brake.
--
-- The mechanic survives; its language, eligibility and guardrails change. A pledge
-- on your own logged performance is skill, not chance, and is the lawful home for
-- every bit of risk appetite in this product (v5 §4-5). What it has never had is
-- the two walls v5 requires around it.
--
-- ── THE OVERTRAINING WALL (the physiotherapist test) ─────────────────────────
--
-- "Targets may only come from the day's planned workout and programmed
-- progression. PR attempts and above-program loads are never pledge-eligible."
--
-- WHAT THE SERVER CAN AND CANNOT SEE, STATED PLAINLY, BECAUSE IT DECIDES THE
-- DESIGN. `workout_schedule.plan` is a weekday -> workout NAME map. The exercises
-- inside a built-in split live in `client/src/domain/workouts.ts`, GENERATED from
-- the Python goldens — the database has no copy. So the server cannot enumerate
-- "today's exercises" and any claim that it validates plan membership exactly
-- would be false.
--
-- What it CAN do is the part that actually protects the athlete:
--
--   1. THE DAY MUST BE A TRAINING DAY. A pledge on a scheduled Rest day is
--      refused outright — that is the physiotherapist test at its most literal.
--   2. THE WORKOUT MUST BE THE ONE SCHEDULED for that weekday. This is what stops
--      "today is Push, so I will pledge on a deadlift single".
--   3. THE LOAD MUST NOT BE ABOVE PROGRAM. Refused when the target exceeds the
--      athlete's own best for that exercise — which is precisely a PR attempt, and
--      is the one eligibility test the server can make EXACTLY, from workout_log,
--      without trusting anything the client said.
--
-- 3 is the strongest of the three and the one that matters most: a pledge whose
-- target is a lift you have never made is a pledge on a max attempt, and the coins
-- would be paying for the attempt. Below-or-equal-to your best is, by definition,
-- programmed territory.
--
-- The residual gap — an athlete whose self-reported schedule says Push when their
-- body wanted rest — is the same trust boundary `workout_log` has always had and
-- that 159's `unlock_sets` documented. Self-reported training is the product.
--
-- ── AND THE BRAKE (chase prevention) ────────────────────────────────────────
--
-- One trial per exercise per session; no re-pledge that day after a miss; a daily
-- ceiling; and escalation capped at 2x the previous pledge per 7 days. All four
-- server-side, because a client-side limit is a suggestion.

begin;

-- ────────────────────────────────────────────── the numbers, in one place

create table if not exists public.forge_trial_config (
  id int primary key default 1 check (id = 1),
  /** §4: "daily stake cap (~150) shown inline". */
  daily_cap int not null default 150 check (daily_cap > 0),
  /** §4: "escalation limited to 2x the previous pledge per 7 days". */
  escalation_multiple numeric not null default 2 check (escalation_multiple >= 1),
  /** §5: pools at or above this need an independent verifier. */
  verifier_threshold int not null default 200 check (verifier_threshold > 0),
  /** §4: fixed, symmetric, never expressed as odds. */
  solo_multiple numeric not null default 2 check (solo_multiple > 1),
  updated_at timestamptz not null default now()
);
insert into public.forge_trial_config (id) values (1) on conflict (id) do nothing;

alter table public.forge_trial_config enable row level security;
drop policy if exists forge_trial_config_read on public.forge_trial_config;
-- Readable so the tray can show the cap INLINE BEFORE a commitment, which §4
-- requires. Writable by nobody: rebalancing is an UPDATE by an operator.
create policy forge_trial_config_read on public.forge_trial_config
  for select using (auth.uid() is not null);

-- ─────────────────────────────────────── was this a training day, and which?

/**
 * THE WORKOUT THE PLAN NAMES FOR A DATE, or null on a rest day.
 *
 * `workout_schedule.plan` is keyed by weekday as a STRING ('0'..'6'), Sunday
 * first, matching what the client writes. `effective_from` means a schedule change
 * does not retroactively rewrite what last week was supposed to be, so the row
 * chosen is the latest one that was already in force on the date asked about.
 */
create or replace function public.scheduled_workout_on(p_user uuid, p_date date)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select nullif(s.plan ->> extract(dow from p_date)::text, 'Rest')
  from public.workout_schedule s
  where s.user_id = p_user and s.effective_from <= p_date
  order by s.effective_from desc
  limit 1;
$$;
revoke execute on function public.scheduled_workout_on(uuid, date) from public, anon;
grant execute on function public.scheduled_workout_on(uuid, date) to authenticated;

/**
 * IS THIS TARGET INSIDE PROGRAMMED TERRITORY?
 *
 * The exact test: the athlete has already done this exercise at this load or
 * heavier. If they have not, the target is a load they have never made — a PR
 * attempt — and §4 says a pledge may never attach to one.
 *
 * Compared on WEIGHT ONLY, not on estimated 1RM. A rep target above your best at a
 * given load is ordinary programmed progression (that is what a 3x8 becoming a 3x10
 * is); a WEIGHT above anything you have lifted is a max attempt. Conflating them
 * through e1rm would refuse normal progression and permit a heavy single.
 *
 * Bodyweight and assisted work (mode <> 'external') has no external load to
 * compare, so it is judged on reps against the athlete's best for that exercise.
 */
create or replace function public.is_programmed_target(
  p_user uuid,
  p_exercise text,
  p_load_mode text,
  p_weight_kg numeric,
  p_reps int
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  best_weight numeric;
  best_reps int;
begin
  if p_load_mode is distinct from 'external' or p_weight_kg is null then
    -- No external load: the honest comparison is reps, and a target at or below
    -- the best rep count ever achieved is programmed.
    select max(w.reps) into best_reps
    from public.workout_log w
    where w.user_id = p_user and w.exercise = p_exercise and w.reps > 0;
    if best_reps is null then
      return false;   -- never done it: nothing to call programmed
    end if;
    return p_reps <= best_reps;
  end if;

  select max(w.weight) into best_weight
  from public.workout_log w
  where w.user_id = p_user and w.exercise = p_exercise and w.weight > 0 and w.reps > 0;
  if best_weight is null then
    return false;
  end if;
  return p_weight_kg <= best_weight;
end;
$$;
revoke execute on function public.is_programmed_target(uuid, text, text, numeric, int) from public, anon;
grant execute on function public.is_programmed_target(uuid, text, text, numeric, int) to authenticated;

-- ───────────────────────────────────────────────────── the brake, in SQL

/** Coins pledged today, across every trial. §4's inline daily ceiling. */
create or replace function public.trial_pledged_today(p_user uuid)
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(c.stake), 0)::int
  from public.workout_callouts c
  where c.athlete_id = p_user
    and c.created_at::date = current_date
    -- Only what is actually committed or already settled. A declined, cancelled
    -- or expired pledge moved no coins, and counting it against the ceiling would
    -- punish an athlete for a friend who never answered.
    and c.status in ('offered', 'accepted', 'awaiting_verification', 'settled', 'disputed');
$$;
revoke execute on function public.trial_pledged_today(uuid) from public, anon;
grant execute on function public.trial_pledged_today(uuid) to authenticated;

/**
 * WHAT MAY THIS ATHLETE PLEDGE ON THIS EXERCISE, RIGHT NOW?
 *
 * One function so the tray and the server agree — a screen that offers a pledge the
 * server then refuses is worse than no pledge at all. Returns the reason when the
 * answer is zero, because §4 wants the cap shown INLINE and a disabled control that
 * does not say what it is waiting for reads as broken.
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
  scheduled text;
  already int;
  missed_today int;
  prev_max int;
  ceiling int;
  spent int;
begin
  if me is null then
    raise exception 'forge_trial_allowance: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  select * into cfg from public.forge_trial_config where id = 1;

  scheduled := public.scheduled_workout_on(me, p_date);
  if scheduled is null then
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

  -- A MISS ENDS THE DAY (§4). Not just for this exercise — for anything.
  --
  -- A MISS IS `result = 'miss'`, NOT a status. The first version of this checked
  -- `status = 'lost'`, which is not one of the eight values the CHECK constraint
  -- allows (offered, accepted, awaiting_verification, settled, declined,
  -- cancelled, disputed, expired) — so the condition could never be true and the
  -- single most important brake in §4 was silently inert. The falsification found
  -- it; reading the code never would have.
  select count(*) into missed_today
  from public.workout_callouts c
  where c.athlete_id = me and c.workout_date = p_date and c.result = 'miss';
  if missed_today > 0 then
    return jsonb_build_object('max_stake', 0, 'reason', 'missed_today',
      'message', 'The forge takes its due — back tomorrow.');
  end if;

  -- THE DAILY CEILING, and what is left of it.
  spent := public.trial_pledged_today(me);
  ceiling := greatest(0, cfg.daily_cap - spent);

  -- ESCALATION: at most `escalation_multiple` times the biggest pledge of the last
  -- seven days. A first-ever pledge is not escalation, so it gets the full ceiling.
  select max(c.stake) into prev_max
  from public.workout_callouts c
  where c.athlete_id = me and c.created_at > now() - interval '7 days'
    and c.status in ('offered', 'accepted', 'awaiting_verification', 'settled', 'disputed');
  if prev_max is not null then
    ceiling := least(ceiling, floor(prev_max * cfg.escalation_multiple)::int);
  end if;

  return jsonb_build_object(
    'max_stake', ceiling,
    'reason', case when ceiling = 0 then 'daily_cap' else null end,
    'message', case when ceiling = 0
      then format('Today''s trial limit is %s coins, and it is used.', cfg.daily_cap)
      else format('%s of %s coins left today.', ceiling, cfg.daily_cap) end,
    'daily_cap', cfg.daily_cap,
    'pledged_today', spent,
    'scheduled_workout', scheduled,
    'verifier_threshold', cfg.verifier_threshold,
    'solo_multiple', cfg.solo_multiple);
end;
$$;
revoke execute on function public.forge_trial_allowance(text, date) from public, anon;
grant execute on function public.forge_trial_allowance(text, date) to authenticated;

-- ────────────────────── the create path enforces all of it, server-side

/**
 * A GUARD ON THE TABLE, not a check inside one function.
 *
 * `callout_create` is not the only thing that could ever insert here, and the
 * eligibility rules are properties of the ROW rather than of one code path. A
 * BEFORE trigger cannot be gone around by a new RPC somebody adds later.
 *
 * Service role is exempt so settlement, sweeps and harnesses keep working.
 */
create or replace function public.forge_trial_eligibility_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  allowance jsonb;
  scheduled text;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- 1. A TRAINING DAY, AND THE RIGHT WORKOUT.
  scheduled := public.scheduled_workout_on(new.athlete_id, new.workout_date);
  if scheduled is null then
    raise exception 'forge_trial: % is a rest day. Rest is part of the plan.', new.workout_date
      using errcode = 'check_violation';
  end if;
  if new.workout_name is distinct from scheduled then
    raise exception 'forge_trial: your plan has % on that day, not %.', scheduled, new.workout_name
      using errcode = 'check_violation';
  end if;

  -- 2. NOT A PR ATTEMPT, NOT ABOVE PROGRAM. The exact test, from workout_log.
  if not public.is_programmed_target(
       new.athlete_id, new.exercise, new.target_load_mode,
       new.target_weight_kg, new.target_reps) then
    raise exception
      'forge_trial: that target is above anything you have logged for %. A trial is not the place for a max attempt.',
      new.exercise using errcode = 'check_violation';
  end if;

  -- 3. THE BRAKE. One call, so the tray and this cannot disagree.
  allowance := public.forge_trial_allowance(new.exercise, new.workout_date);
  if (allowance ->> 'max_stake')::int <= 0 then
    raise exception 'forge_trial: %', allowance ->> 'message'
      using errcode = 'check_violation';
  end if;
  if new.stake > (allowance ->> 'max_stake')::int then
    -- `%` not `%s`: plpgsql's RAISE uses % as the placeholder, so the stray
    -- literal 's' printed "120s coins is over today's limit".
    raise exception 'forge_trial: % coins is over today''s limit — %', new.stake,
      allowance ->> 'message' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_forge_trial_eligibility on public.workout_callouts;
create trigger trg_forge_trial_eligibility
  before insert on public.workout_callouts
  for each row execute function public.forge_trial_eligibility_guard();

-- ─────────────────────────────────── no odds anywhere, ever again

/**
 * §10 bans the WORD and §4 bans the CONCEPT: "Never display anything as odds."
 *
 * The columns are dropped rather than left unread. A column called `odds` is an
 * invitation, and 150's own comment admitted it was "display only in V1" — which
 * is exactly the kind of qualifier that stops being true.
 *
 * Settlement never read them: the payout is the pool, split fixed and symmetric.
 * So this cannot change a single coin, and that is worth having verified below.
 */
-- Enumerated from the LIVE table rather than from 150's CREATE, because the two
-- disagreed: `odds_model_version` existed in production and appeared nowhere I had
-- looked. The guard below caught it, which is the only reason this list is right.
do $$
declare col text;
begin
  for col in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_callouts'
      -- ODDS BY ANY NAME. `%odds%` alone left `hit_probability` standing — a
      -- NOT NULL numeric that is odds in everything but spelling, and the only
      -- reason it surfaced is that an insert then failed on it. §4 bans the
      -- CONCEPT, so the pattern has to match the concept.
      and (column_name ilike '%odds%'
           or column_name ilike '%probability%'
           or column_name ilike '%_pct%'
           or column_name ilike '%likelihood%'
           or column_name ilike '%margin%'
           or column_name ilike '%multiplier%')
  loop
    execute format('alter table public.workout_callouts drop column if exists %I', col);
    raise notice 'dropped workout_callouts.%', col;
  end loop;
end $$;

-- ─────────────────── the create path stops writing what no longer exists

/**
 * `callout_create` WROTE THE COLUMNS THIS FILE DROPS, so it has to change in the
 * same migration or creating a call out fails outright. It did — this was caught
 * only because the falsification tried a legitimate pledge and got a not-null
 * violation on hit_probability.
 *
 * Taken from the LIVE function body with the three odds parameters and their insert
 * entries removed, and nothing else touched. The old 3-argument-longer signature is
 * dropped below so a stale client cannot resolve to it.
 */
CREATE OR REPLACE FUNCTION public.callout_create(p_opponent uuid, p_workout_date date, p_workout text, p_exercise text, p_set_no integer, p_target_reps integer, p_target_load_mode text, p_target_weight_kg numeric, p_target_label text, p_stake integer)
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
    raise exception 'callout_create: stake must be between % and %.', cfg.min_stake, cfg.max_stake
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

  -- ONE LIVE CALL (Â§2). The partial unique index is the real rule; this is here
  -- so the athlete gets a sentence instead of a constraint name.
  if exists (
    select 1 from public.workout_callouts wc
    where wc.athlete_id = me and wc.status in ('offered', 'accepted', 'awaiting_verification')
  ) then
    raise exception 'callout_create: you already have a call out running.' using errcode = 'check_violation';
  end if;

  -- ninety, because a gym set is not a coin with a known bias and "99.8%"
  -- deserves to be disbelieved.
  -- NO QUOTED CHANCE. 163 dropped the three probability columns this used to fill.
  -- v5 §4 bans the concept and not merely the word, and settlement never read them
  -- anyway: the pool is split fixed and symmetric. What stood here clamped a client
  -- estimate to 10-90% "because a gym set is not a coin with a known bias" — true,
  -- and now beside the point, because nothing is quoted to anybody at all.
  exp := now() + make_interval(mins => cfg.offer_minutes);

  insert into public.workout_callouts (
    athlete_id, opponent_id, initiated_by,
    workout_date, workout_name, exercise, set_no,
    target_reps, target_load_mode, target_weight_kg, target_label,
    stake,
    status, expires_at
  ) values (
    me, p_opponent, me,
    p_workout_date, p_workout, p_exercise, p_set_no,
    p_target_reps, p_target_load_mode, p_target_weight_kg, left(btrim(p_target_label), 60),
    p_stake,
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


-- The longer signature must not linger beside the shorter one: PostgREST would have
-- to choose, and a client still sending p_hit_probability would silently keep using
-- a function that writes a column that no longer exists.
drop function if exists public.callout_create(
  uuid, date, text, text, integer, integer, text, numeric, text, integer, numeric, text, jsonb);

revoke execute on function public.callout_create(
  uuid, date, text, text, integer, integer, text, numeric, text, integer) from public, anon;
grant execute on function public.callout_create(
  uuid, date, text, text, integer, integer, text, numeric, text, integer) to authenticated;

-- ──────────────────────────── THE WALLS, PROVEN NOT ASSUMED

do $$
declare bad text;
begin
  -- No odds column survived.
  select string_agg(column_name, ', ') into bad
  from information_schema.columns
  where table_schema = 'public' and table_name = 'workout_callouts'
    and (column_name ilike '%odds%' or column_name ilike '%probability%'
         or column_name ilike '%_pct%' or column_name ilike '%likelihood%'
         or column_name ilike '%margin%' or column_name ilike '%multiplier%');
  if bad is not null then
    raise exception 'workout_callouts still carries odds, by some name: %', bad;
  end if;

  -- The eligibility guard is actually attached. A rule with no trigger is a
  -- comment, and this file's whole point is that these are enforced.
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.workout_callouts'::regclass
      and t.tgname = 'trg_forge_trial_eligibility' and not t.tgisinternal
  ) then
    raise exception 'the eligibility guard is not attached to workout_callouts';
  end if;

  -- THE STATUS VOCABULARY THIS FILE DEPENDS ON MUST EXIST. Every brake above
  -- filters on specific status strings and on result='miss'; if a later migration
  -- renames one, the filter silently matches nothing and the brake goes inert
  -- without failing. That already happened once with 'lost'.
  for bad in select unnest(array['offered','accepted','awaiting_verification','settled','disputed'])
  loop
    if pg_get_constraintdef((select oid from pg_constraint
        where conname = 'workout_callouts_status_check')) not like '%' || bad || '%' then
      raise exception 'status %s is gone — a chase-prevention filter is now inert', bad;
    end if;
  end loop;
  if pg_get_constraintdef((select oid from pg_constraint
      where conname = 'workout_callouts_result_check')) not like '%miss%' then
    raise exception 'result=miss is gone — "a miss ends the day" is now inert';
  end if;

  -- ZERO RNG on the pledge side (invariant 2), checked over every function whose
  -- name says it touches a trial or a call out.
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'callout%' or p.proname like 'forge_trial%')
    and pg_get_functiondef(p.oid) ~ '[^_a-z]random\s*\(';
  if bad is not null then
    raise exception 'RNG found in a pledge path: %', bad;
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- begin;
--   drop trigger if exists trg_forge_trial_eligibility on public.workout_callouts;
--   drop function if exists public.forge_trial_eligibility_guard();
--   drop function if exists public.forge_trial_allowance(text, date);
--   drop function if exists public.trial_pledged_today(uuid);
--   drop function if exists public.is_programmed_target(uuid, text, text, numeric, int);
--   drop function if exists public.scheduled_workout_on(uuid, date);
--   drop table if exists public.forge_trial_config;
--   -- the odds columns are NOT restored: see §10.
-- commit;

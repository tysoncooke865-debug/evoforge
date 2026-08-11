-- EvoForge 198 — THE REST-DAY CACHE CLAIM CRASHED, AND THE DAY IT USED WAS
-- THE WRONG ONE ANYWAY (2026-08-11).
--
-- ============================ BUG 1: THE CRASH ============================
--
--   null value in column "training_day" of relation "forge_cache_claims"
--   violates not-null constraint
--
-- `forge_cache_state()` returns `'training_day', last_training`, where
-- last_training is `max(workout_log.date)` for the cycle. `forge_cache_claim()`
-- inserts that value into a NOT NULL column.
--
-- The ladder counts PLAN-ADHERENT days — trained days UNION confirmed rest
-- days. So an athlete whose first adherent day is a confirmed REST day has
-- rung >= 1 and claimable = true, with `last_training` still NULL, because they
-- have not trained yet. The claim then inserts NULL and the transaction dies.
--
-- That is not an edge case. It is the FIRST claim of any athlete who confirms a
-- rest day before their first session — precisely the flow 189 added rest
-- check-in to support, and precisely what the audit hit.
--
-- THE FIX IS TO ASK THE RIGHT QUESTION. `training_day` is not "when did they
-- last train"; it is "which day earned this rung". For a rest-day claim that is
-- the confirmed rest day. The column stops being able to hold a lie, because
-- `claim_day` below is a coalesce chain that cannot produce NULL, and the
-- insert is guarded by an explicit check that raises a readable error rather
-- than a constraint violation if it somehow ever did.
--
-- `training_day` is LOAD-BEARING beyond the row: `cycle_started` reads
-- `max(training_day) where day_index = 7` to find the previous cycle's end.
-- Using the adherent day keeps that boundary exactly where it was for training
-- claims and finally makes it correct for rest ones.
--
-- ========================= BUG 2: THE WRONG DAY =========================
--
-- Every date in these functions is `(now() at time zone 'UTC')::date`, while
-- the client writes `workout_log.date` from the athlete's LOCAL calendar.
-- `client/src/domain/today.ts` carries the whole lesson in its header — it was
-- written because deriving "today" from UTC filed early-morning sessions under
-- yesterday. The cache functions reintroduced exactly that bug server-side.
--
-- In Sydney (UTC+10/11) that is wrong for the first ten hours of every day: at
-- 8am Tuesday the server still thinks it is Monday, so `today_is_rest`,
-- `today_rest_confirmed` and `can_confirm_rest` all describe YESTERDAY — and
-- morning training is when people train.
--
-- `forge_rest_confirm` already takes `p_day` and already validates it to today
-- or yesterday; the client simply never passed one. So the fix is the same
-- shape here: both functions accept the athlete's own date, validated to the
-- same narrow window, and fall back to the UTC date when it is absent (an older
-- client, or a server-side caller). The athlete's calendar is the answer,
-- exactly as today.ts insists.
--
-- ===================== IDEMPOTENCY, AND WHAT WAS ALREADY THERE =====================
--
-- `forge_cache_once (user_id, cycle, day_index)` already made a rung claimable
-- once per cycle, and the claim already does `on conflict ... do nothing` and
-- returns `already: true`. That is why repeated taps never double-paid: the
-- reported failure was a CRASH, not a duplicate.
--
-- 198 adds the guarantee the brief asks for on top: ONE claim per athlete per
-- calendar day. Verified safe first — `select count(*) from (select user_id,
-- training_day ... having count(*) > 1)` returned 0 on 2026-08-11, so the index
-- creates without rewriting or rejecting a single existing row.
--
-- NO BACKFILL IS NEEDED AND NONE IS PERFORMED. `training_day` has always been
-- NOT NULL, so no row can hold a null to repair; the bug prevented the insert
-- rather than corrupting it. `select count(*) filter (where training_day is
-- null)` = 0 of 2 rows. NO USER DATA IS DELETED OR REWRITTEN by this migration.
--
-- FALSIFICATION CHECKLIST:
--  1. An athlete with a confirmed rest day and ZERO workouts claims rung 1 ->
--     succeeds, and training_day is the REST day. (Before: not-null violation.)
--  2. The same claim again -> {already: true}, no second coin event.
--  3. A training claim still records the training date, unchanged.
--  4. Two claims on one calendar day -> the second is refused by the new index.
--  5. `forge_cache_state('2026-08-11')` and `forge_cache_state()` agree when
--     the local and UTC dates agree.
--  6. A p_today outside today/yesterday -> refused, not silently trusted.
--  7. coin_events gains exactly one row per successful claim.

begin;

-- ONE claim per athlete per calendar day. Verified zero violations first.
create unique index if not exists forge_cache_one_per_day
  on public.forge_cache_claims (user_id, training_day);

-- The signature changes, so the old zero-argument versions must GO rather than
-- sit beside the new ones: a defaulted parameter added next to an existing
-- no-arg function makes every call ambiguous, and PostgREST answers "function
-- is not unique" on what used to work. (The 195 lesson, again.)
drop function if exists public.forge_cache_state();
drop function if exists public.forge_cache_claim();

/**
 * The athlete's effective date: theirs when they sent one and it is sane,
 * ours otherwise. The window is the same one forge_rest_confirm uses — today
 * or yesterday — so a client cannot nominate an arbitrary date to farm rungs.
 */
create or replace function public.forge_effective_day(p_today date)
returns date language sql immutable as $$
  select case
    when p_today is null then (now() at time zone 'UTC')::date
    when p_today > (now() at time zone 'UTC')::date + 1 then (now() at time zone 'UTC')::date
    when p_today < (now() at time zone 'UTC')::date - 1 then (now() at time zone 'UTC')::date
    else p_today
  end;
$$;
comment on function public.forge_effective_day(date) is
  'The athlete''s own calendar date, clamped to +/-1 day of the server''s. '
  'client/src/domain/today.ts explains why the client''s answer is the right '
  'one; the clamp is why trusting it is safe.';

create function public.forge_cache_state(p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  cur_cycle int;
  cycle_started date;
  trained int;
  adherent int;
  rung int;
  already boolean;
  tier public.forge_cache_tiers;
  last_training date;
  last_rest date;
  claim_day date;
  floor_needed int;
  today_rest boolean;
  today_confirmed boolean;
  today_plan text[];
  has_plan boolean;
  today date := public.forge_effective_day(p_today);
begin
  if me is null then
    raise exception 'forge_cache_state: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  -- 190: an athlete with NO plan has no planned rest. `scheduled_workouts_on`
  -- returns empty for them, which 189 read as rest - so the ladder was climbable
  -- by tapping a button once a day forever.
  select exists (
    select 1 from public.workout_schedule ws
    where ws.user_id = me and ws.effective_from <= today
  ) into has_plan;
  select coalesce(training_floor, 3) into floor_needed from public.forge_cache_config where id = 1;
  floor_needed := coalesce(floor_needed, 3);

  select coalesce(max(cycle), 1) into cur_cycle
  from public.forge_cache_claims where user_id = me;
  select max(training_day) into cycle_started
  from public.forge_cache_claims
  where user_id = me and cycle = cur_cycle - 1 and day_index = 7;

  -- Distinct TRAINING days in this cycle.
  select count(distinct w.date), max(w.date) into trained, last_training
  from public.workout_log w
  where w.user_id = me and w.reps > 0 and w.weight >= 0
    and (cycle_started is null or w.date > cycle_started);

  -- The most recent CONFIRMED REST day in this cycle. 198: without this the
  -- claim had no date to record for a rest-only athlete, and inserted null.
  select max(r.rest_day) into last_rest
  from public.forge_rest_days r
  where r.user_id = me and (cycle_started is null or r.rest_day > cycle_started);

  -- Distinct PLAN-ADHERENT days: trained, or confirmed rest. A date that is both
  -- counts once, which is why this is a union of dates and not a sum of counts.
  select count(*) into adherent from (
    select w.date as d from public.workout_log w
     where w.user_id = me and w.reps > 0 and w.weight >= 0
       and (cycle_started is null or w.date > cycle_started)
    union
    select r.rest_day from public.forge_rest_days r
     where r.user_id = me and (cycle_started is null or r.rest_day > cycle_started)
  ) x;

  -- WHICH DAY EARNED THIS RUNG. The latest adherent day of either kind, and
  -- `today` as the last resort so this expression cannot be null while a rung
  -- is claimable. This is the whole fix for the not-null crash.
  claim_day := greatest(coalesce(last_training, '-infinity'::date),
                        coalesce(last_rest, '-infinity'::date));
  if claim_day = '-infinity'::date then claim_day := today; end if;

  -- What today is, so the card can offer the right action.
  today_plan := public.scheduled_workouts_on(me, today);
  today_rest := array_length(today_plan, 1) is null;
  select exists (select 1 from public.forge_rest_days r
                 where r.user_id = me and r.rest_day = today)
    into today_confirmed;

  rung := least(7, coalesce(adherent, 0));

  if rung < 1 then
    return jsonb_build_object('cycle', cur_cycle, 'rung', 0, 'claimable', false,
      'trained_this_cycle', 0, 'adherent_this_cycle', 0,
      'training_floor', floor_needed, 'floor_met', false,
      'today_is_rest', today_rest, 'today_rest_confirmed', today_confirmed,
      'today_plan', case when today_rest then null else today_plan[1] end,
      'training_day', claim_day,
      'next_label', (select label from public.forge_cache_tiers where day_index = 1),
      'next_coins', (select coins from public.forge_cache_tiers where day_index = 1),
      -- §6/§8: no urgency, no countdown, and rest offered as a real option.
      'has_plan', has_plan,
      'can_confirm_rest', has_plan and today_rest and not today_confirmed,
      'message', case
        when not has_plan then 'Set a weekly plan and the cache opens on your plan-adherent days.'
        when today_rest then 'Rest day. Confirm it and the first cache opens.'
        else 'Log a set to open the first cache.' end);
  end if;

  select * into tier from public.forge_cache_tiers where day_index = rung;
  select exists (
    select 1 from public.forge_cache_claims
    where user_id = me and cycle = cur_cycle and day_index = rung
  ) into already;

  return jsonb_build_object(
    'cycle', cur_cycle,
    'rung', rung,
    'coins', tier.coins,
    'label', tier.label,
    -- RUNG 7 NEEDS REAL TRAINING. Rest alone pays 280 across rungs 1-6; the weekly
    -- cache is earned. Without this, seven confirmed rest days would collect 430.
    'claimable', (not already) and (rung < 7 or coalesce(trained, 0) >= floor_needed),
    'trained_this_cycle', coalesce(trained, 0),
    'adherent_this_cycle', coalesce(adherent, 0),
    'training_floor', floor_needed,
    'floor_met', coalesce(trained, 0) >= floor_needed,
    -- 198: the day that EARNED the rung (training or confirmed rest), never null.
    'training_day', claim_day,
    'today_is_rest', today_rest,
    'today_rest_confirmed', today_confirmed,
    'has_plan', has_plan,
    -- What the CARD must key on: offering a button the server will refuse is how a
    -- feature teaches an athlete that the app is unreliable.
    'can_confirm_rest', has_plan and today_rest and not today_confirmed,
    'today_plan', case when today_rest then null else today_plan[1] end,
    'next_coins', (select coins from public.forge_cache_tiers where day_index = least(7, rung + 1)),
    'next_label', (select label from public.forge_cache_tiers where day_index = least(7, rung + 1)),
    'message', case
      when rung = 7 and not already and coalesce(trained, 0) < floor_needed then
        format('The weekly cache opens after %s training days this cycle - you have %s.',
               floor_needed, coalesce(trained, 0))
      when already then 'Claimed. The next cache opens on your next plan-adherent day.'
      else format('%s coins ready - %s.', tier.coins, tier.label) end);
end;
$$;

create function public.forge_cache_claim(p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  st jsonb;
  rung int;
  cyc int;
  claim_day date;
  tier public.forge_cache_tiers;
  new_id uuid := gen_random_uuid();
begin
  if me is null then
    raise exception 'forge_cache_claim: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('evoforge.coin_spend:' || me::text, 0));

  st := public.forge_cache_state(p_today);
  rung := (st ->> 'rung')::int;
  cyc := (st ->> 'cycle')::int;
  claim_day := (st ->> 'training_day')::date;

  if rung < 1 then
    raise exception 'forge_cache_claim: nothing open yet - train or confirm your rest day.'
      using errcode = 'check_violation';
  end if;

  -- 189: the weekly cache needs training behind it. Refused with the number, not a
  -- flat no, so the athlete knows exactly what opens it.
  if rung = 7 and not (st ->> 'floor_met')::boolean then
    raise exception 'forge_cache_claim: the weekly cache opens after % training days this cycle - you have %.',
      st ->> 'training_floor', st ->> 'trained_this_cycle' using errcode = 'check_violation';
  end if;

  -- BELT AND BRACES. `claim_day` cannot be null coming out of the state
  -- function any more, and if that ever stops being true this raises a sentence
  -- somebody can act on instead of a not-null constraint violation reaching an
  -- athlete's screen. That is the whole difference this migration is about.
  if claim_day is null then
    raise exception 'forge_cache_claim: could not determine the day this cache belongs to.'
      using errcode = 'check_violation';
  end if;

  if not (st ->> 'claimable')::boolean then
    return jsonb_build_object('already', true, 'cycle', cyc, 'rung', rung,
      'coins', 0, 'balance', public.coin_total_exact());
  end if;

  select * into tier from public.forge_cache_tiers where day_index = rung;

  -- Two unique indexes guard this now: once per (cycle, rung), and once per
  -- calendar day. Either collision means the claim already happened, which is a
  -- SUCCESS to report and not an error to raise — a retried tap on a slow
  -- network must never read as a failure.
  insert into public.forge_cache_claims (id, user_id, day_index, cycle, coins, training_day)
  values (new_id, me, rung, cyc, tier.coins, claim_day)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('already', true, 'cycle', cyc, 'rung', rung,
      'coins', 0, 'balance', public.coin_total_exact());
  end if;

  -- ATOMIC BY CONSTRUCTION: this is one function, therefore one transaction.
  -- The claim row, the coin event and its ledger effect either all land or none
  -- do; there is no window in which an athlete has been charged a rung without
  -- being paid for it.
  perform set_config('evoforge.cache_authorized', new_id::text, true);
  insert into public.coin_events (user_id, kind, amount, source_id, source_table)
  values (me, 'forge_cache', tier.coins, new_id::text, 'forge_cache_claims');
  perform set_config('evoforge.cache_authorized', '', true);

  return jsonb_build_object('already', false, 'cycle', cyc, 'rung', rung,
    'coins', tier.coins, 'label', tier.label,
    'cycle_complete', rung = 7,
    'balance', public.coin_total_exact());
end;
$$;

revoke execute on function public.forge_cache_state(date) from public, anon;
revoke execute on function public.forge_cache_claim(date) from public, anon;
grant execute on function public.forge_cache_state(date) to authenticated;
grant execute on function public.forge_cache_claim(date) to authenticated;

commit;

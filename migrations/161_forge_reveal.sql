-- EvoForge 161 — THE FORGE REVEAL: chance that can only add (Spec v5 §3 + v5.1).
--
-- The replacement for the staked board. The forge produces a bonus; the player
-- feeds nothing in.
--
-- INVARIANT 1 IS ENFORCED BY THE SHAPE OF THIS FILE, NOT BY A CHECK ON A NUMBER.
-- "A balance must never be lower after an RNG event than immediately before it."
-- The way to guarantee that is to make a staked reveal UNCONSTRUCTIBLE:
--
--   * `forge_reveal_claim(p_reveal_id uuid)` takes ONE argument, and it is an
--     identifier. There is no stake parameter, no amount parameter, no lane and no
--     tier. A caller has nothing to pass that could debit anything.
--   * the outcome comes from `forge_reveal_table`, whose every row is `coins > 0`
--     by CHECK, so there is no zero and no negative outcome to draw.
--   * `coin_events` gains `reveal_bonus`, and a CHECK refuses it outright when
--     `amount <= 0`. Even a hand-written insert cannot make a reveal take a coin.
--
-- That is three independent layers, and the last one holds even if the other two
-- are rewritten by someone who has not read this comment.
--
-- EXACTLY TWO PRODUCERS, AND THE SET IS CLOSED BY A CHECK CONSTRAINT rather than
-- by a convention. v5.1: a completed qualifying workout, and a qualifying PR. Any
-- future migration adding a third must alter the constraint, which is visible in a
-- diff in a way that a new call site is not.

begin;

-- ─────────────────────────────────────────────── the published drop table

/**
 * THE TABLE, AS DATA. §3 requires it viewable before every reveal, so it lives in
 * a row the client can read rather than in a function body it cannot.
 *
 * `coins > 0` on every row is invariant 1's first layer: there is no losing
 * outcome to draw because no losing outcome can be stored.
 */
create table if not exists public.forge_reveal_table (
  version int not null,
  coins int not null check (coins > 0),
  weight int not null check (weight > 0),   -- relative, normalised at draw time
  label text not null,
  primary key (version, coins)
);

alter table public.forge_reveal_table enable row level security;
drop policy if exists forge_reveal_table_read on public.forge_reveal_table;
-- Readable by anyone signed in: it is a published table, and hiding it would
-- defeat the point of publishing it.
create policy forge_reveal_table_read on public.forge_reveal_table
  for select using (auth.uid() is not null);

-- v5 §3's sample table. Weights are per-mille so the arithmetic is exact integers
-- rather than a float that has to sum to 1.000.
insert into public.forge_reveal_table (version, coins, weight, label) values
  (1,  20, 450, 'A steady pour'),
  (1,  28, 300, 'Clean billet'),
  (1,  40, 150, 'Well tempered'),
  (1,  60,  80, 'Fine steel'),
  (1, 150,  20, 'Masterwork')
on conflict (version, coins) do update
  set weight = excluded.weight, label = excluded.label;

/**
 * IS THIS PR BIG ENOUGH TO EARN A REVEAL?
 *
 * v5.1: "exceeds the user's previous best by at least the meaningful-increment
 * threshold for that lift (e.g. >= 2.5 kg or >= 1 rep at equal load)."
 *
 * DELIBERATELY NOT THE `pr` COIN KIND'S RULE. That one (013, restated in 159 and
 * 160) fires on ANY e1rm improvement, which is right for a 25-coin acknowledgement
 * and wrong for a reveal: half a kilo on a dumbbell press should not mint a chance
 * event, and v5.1 caps PR reveals precisely to stop micro-increment farming.
 *
 * Two ways to qualify, both measured at equal-or-better on the other axis, so
 * neither can be gamed by trading one off against the other:
 *
 *   heavier — at least 2.5 kg above the best weight ever lifted for these reps
 *   longer  — at least 1 rep above the best reps ever done at this weight
 *
 * `p_min_kg` is a parameter rather than a constant because §"configure per
 * exercise class" asks for it; 2.5 is the barbell default and the only value used
 * today. When exercise classes arrive this becomes a lookup, and the signature
 * does not have to change.
 */
create or replace function public.is_qualifying_pr(
  p_set_id uuid,
  p_user uuid,
  p_min_kg numeric default 2.5
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  s record;
  best_weight_at_reps numeric;
  best_reps_at_weight int;
begin
  select w.exercise, w.weight, w.reps, w."timestamp" into s
  from public.workout_log w
  where w.id = p_set_id and w.user_id = p_user and w.reps > 0 and w.weight > 0;
  if not found then
    return false;   -- bodyweight and empty sets cannot qualify: there is no load
  end if;

  -- Heaviest this exercise has ever been done for AT LEAST these reps, before now.
  select max(w.weight) into best_weight_at_reps
  from public.workout_log w
  where w.user_id = p_user and w.exercise = s.exercise
    and w.reps >= s.reps and w.weight > 0 and w."timestamp" < s."timestamp";

  -- Most reps ever done at AT LEAST this weight, before now.
  select max(w.reps) into best_reps_at_weight
  from public.workout_log w
  where w.user_id = p_user and w.exercise = s.exercise
    and w.weight >= s.weight and w.reps > 0 and w."timestamp" < s."timestamp";

  -- A FIRST-EVER SET IS NOT A PR. Nothing has been exceeded, and rewarding it
  -- would hand a reveal to every new exercise somebody tries — which is exactly
  -- the "reward training the program did not call for" the physiotherapist test
  -- forbids.
  if best_weight_at_reps is null and best_reps_at_weight is null then
    return false;
  end if;

  return (best_weight_at_reps is not null and s.weight >= best_weight_at_reps + p_min_kg)
      or (best_reps_at_weight  is not null and s.reps   >= best_reps_at_weight + 1);
end;
$$;
revoke execute on function public.is_qualifying_pr(uuid, uuid, numeric) from public, anon;
grant execute on function public.is_qualifying_pr(uuid, uuid, numeric) to authenticated;

-- ─────────────────────────────────────────────────────── banked reveals

create table if not exists public.forge_reveals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  /**
   * EXACTLY TWO PRODUCERS. This CHECK is the rule, not a comment about the rule:
   * a third producer cannot be added by writing a new call site, only by altering
   * a constraint — which shows up in a diff.
   */
  producer text not null check (producer in ('workout_complete', 'pr')),
  /** A date for a completed workout, a workout_log id for a PR. */
  source_id text not null,
  /** The training day it belongs to, for the two-per-day ceiling. */
  training_day date not null,
  /** Set for PR reveals only — the per-exercise-per-7-days ceiling reads it. */
  exercise text,
  granted_at timestamptz not null default now(),

  /** Null until claimed. NEVER EXPIRES — there is deliberately no expiry column
   *  and no sweep; §3 says banked reveals remain available until claimed. */
  claimed_at timestamptz,
  /** The outcome, decided by the server AT CLAIM TIME and then animated. */
  coins int check (coins is null or coins > 0),
  table_version int,

  /** One reveal per producing event. A doubled grant from a retried trigger is
   *  the same reveal, decided by the database rather than by a code path. */
  constraint forge_reveals_once unique (user_id, producer, source_id),
  /** An unclaimed reveal has no outcome; a claimed one has both. */
  constraint forge_reveals_claim_complete check (
    (claimed_at is null and coins is null and table_version is null)
    or (claimed_at is not null and coins is not null and table_version is not null)
  )
);

create index if not exists forge_reveals_user_unclaimed
  on public.forge_reveals (user_id, granted_at) where claimed_at is null;
create index if not exists forge_reveals_pr_window
  on public.forge_reveals (user_id, exercise, granted_at) where producer = 'pr';

alter table public.forge_reveals enable row level security;

-- READ YOUR OWN, WRITE NOTHING. Granting and claiming are definer functions.
-- No insert, update or delete policy exists — deliberately. Do not add one.
drop policy if exists forge_reveals_own_select on public.forge_reveals;
create policy forge_reveals_own_select on public.forge_reveals
  for select using (user_id = auth.uid());

-- ────────────────────────────────── the ledger learns an ADD-ONLY kind

-- THREE EDITS (constraint, guard, client label) — and this kind gets a fourth:
-- a CHECK that refuses a non-positive amount. Every other kind is signed by
-- convention; this one is signed by the database, because it is the kind an RNG
-- event writes and invariant 1 is the thing most worth making unbreakable.
alter table public.coin_events drop constraint if exists coin_events_kind_check;
alter table public.coin_events add constraint coin_events_kind_check
  check (kind = any (array[
    'workout_complete', 'pr', 'streak_milestone', 'starting_bonus',
    'adjustment', 'spend', 'battle_reward',
    'challenge_stake', 'challenge_payout',
    'duel_support_stake', 'duel_support_payout',
    'callout_stake', 'callout_payout',
    'forge_drop_stake', 'forge_drop_payout', 'forge_drop_unlock',
    'set_reward',
    -- 161 — the reveal. Additive by constraint; see below.
    'reveal_bonus'
  ]));

alter table public.coin_events drop constraint if exists coin_events_reveal_adds_only;
alter table public.coin_events add constraint coin_events_reveal_adds_only
  check (kind <> 'reveal_bonus' or amount > 0);

comment on constraint coin_events_reveal_adds_only on public.coin_events is
  'Spec v5 invariant 1: randomness may only add. A reveal that took a coin cannot be stored.';

-- ────────────────────────────────────────────────── granting, silently

/**
 * GRANT A REVEAL. Server-side, silent, and idempotent.
 *
 * Called by the workout-completion path and the set trigger. Returns the reveal id
 * when one was created and null when a ceiling refused it — never an exception,
 * because a ceiling is a normal outcome and a logged set must not fail because the
 * athlete already has two reveals banked.
 *
 * THE CEILINGS, ALL SERVER-SIDE (v5.1):
 *   two reveals per training day, whatever produced them
 *   one PR reveal per training day
 *   one PR reveal per exercise per rolling 7 days
 */
create or replace function public.forge_reveal_grant(
  p_user uuid,
  p_producer text,
  p_source_id text,
  p_day date default current_date,
  p_exercise text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  new_id uuid;
  today_total int;
  today_pr int;
  recent_pr int;
begin
  if p_user is null or p_producer is null or p_source_id is null then
    return null;
  end if;
  if p_producer not in ('workout_complete', 'pr') then
    raise exception 'forge_reveal_grant: % is not a producer. Exactly two exist.', p_producer
      using errcode = 'check_violation';
  end if;

  -- Serialise per athlete so two concurrent grants cannot both pass the ceiling.
  perform pg_advisory_xact_lock(hashtextextended('evoforge.reveal_grant:' || p_user::text, 0));

  select count(*) into today_total
  from public.forge_reveals where user_id = p_user and training_day = p_day;
  if today_total >= 2 then
    return null;
  end if;

  if p_producer = 'pr' then
    select count(*) into today_pr
    from public.forge_reveals
    where user_id = p_user and training_day = p_day and producer = 'pr';
    if today_pr >= 1 then
      return null;
    end if;
    -- A ROLLING SEVEN DAYS, not a calendar week: a calendar boundary would let
    -- two reveals for the same lift land a day apart, which is the micro-increment
    -- farming the cap exists to stop.
    if p_exercise is not null then
      select count(*) into recent_pr
      from public.forge_reveals
      where user_id = p_user and producer = 'pr' and exercise = p_exercise
        and granted_at > now() - interval '7 days';
      if recent_pr >= 1 then
        return null;
      end if;
    end if;
  end if;

  insert into public.forge_reveals (user_id, producer, source_id, training_day, exercise)
  values (p_user, p_producer, p_source_id, p_day, p_exercise)
  on conflict (user_id, producer, source_id) do nothing
  returning id into new_id;

  return new_id;   -- null when the same event already granted one
end;
$$;
revoke execute on function public.forge_reveal_grant(uuid, text, text, date, text) from public, anon;
-- SERVER ONLY. An athlete cannot grant themselves a reveal; the workout paths do.
revoke execute on function public.forge_reveal_grant(uuid, text, text, date, text) from authenticated;

-- ─────────────────────────────────────────────────────── claiming

/**
 * CLAIM A REVEAL.
 *
 * ONE ARGUMENT, AND IT IS AN IDENTIFIER. This signature is invariant 1's strongest
 * layer: there is no stake, amount, lane, tier or multiplier to pass, so a caller
 * has nothing with which to construct a wager. Compare `forge_drop_play(key, stake,
 * lane, tier)`, which took a stake because it had to.
 *
 * The server draws the outcome and stores it BEFORE returning, so the animation is
 * replaying a decided fact. Idempotent: a second call returns the same outcome and
 * writes no second ledger row.
 */
create or replace function public.forge_reveal_claim(p_reveal_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  r public.forge_reveals;
  roll int;
  running int := 0;
  pick record;
  total int;
begin
  if me is null then
    raise exception 'forge_reveal_claim: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('evoforge.coin_spend:' || me::text, 0));

  select * into r from public.forge_reveals where id = p_reveal_id and user_id = me;
  if not found then
    raise exception 'forge_reveal_claim: no reveal of yours matches %.', p_reveal_id
      using errcode = 'no_data_found';
  end if;

  -- ALREADY CLAIMED: hand back what it was, charge nothing, write nothing.
  if r.claimed_at is not null then
    return jsonb_build_object(
      'reveal_id', r.id, 'replayed', true, 'producer', r.producer,
      'coins', r.coins, 'table_version', r.table_version,
      'balance', public.coin_total_exact());
  end if;

  -- THE DRAW. Weighted over the published table, and nothing about it reads the
  -- athlete's history, balance, streak or churn risk: §3 forbids adaptive odds and
  -- the only inputs here are the table and random().
  select coalesce(sum(weight), 0) into total from public.forge_reveal_table where version = 1;
  if total <= 0 then
    raise exception 'forge_reveal_claim: the drop table is empty.' using errcode = 'no_data_found';
  end if;
  roll := floor(random() * total)::int;
  for pick in
    select coins, weight from public.forge_reveal_table where version = 1 order by coins
  loop
    running := running + pick.weight;
    if roll < running then
      exit;
    end if;
  end loop;

  update public.forge_reveals
     set claimed_at = now(), coins = pick.coins, table_version = 1
   where id = r.id;

  perform set_config('evoforge.reveal_authorized', r.id::text, true);
  insert into public.coin_events (user_id, kind, amount, source_id, source_table)
  values (me, 'reveal_bonus', pick.coins, r.id::text, 'forge_reveals');
  perform set_config('evoforge.reveal_authorized', '', true);

  return jsonb_build_object(
    'reveal_id', r.id, 'replayed', false, 'producer', r.producer,
    'coins', pick.coins, 'table_version', 1,
    'balance', public.coin_total_exact());
end;
$$;
revoke execute on function public.forge_reveal_claim(uuid) from public, anon;
grant execute on function public.forge_reveal_claim(uuid) to authenticated;

/** What is banked, and the table it will be drawn from. One round trip for the
 *  Home chip and the summary card. */
create or replace function public.my_forge_reveals()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'banked', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'producer', producer, 'granted_at', granted_at,
        'training_day', training_day, 'exercise', exercise) order by granted_at)
      from public.forge_reveals
      where user_id = auth.uid() and claimed_at is null), '[]'::jsonb),
    'table', coalesce((
      select jsonb_agg(jsonb_build_object('coins', coins, 'weight', weight, 'label', label)
             order by coins)
      from public.forge_reveal_table where version = 1), '[]'::jsonb),
    'table_total', (select coalesce(sum(weight), 0) from public.forge_reveal_table where version = 1),
    'balance', public.coin_total_exact());
$$;
revoke execute on function public.my_forge_reveals() from public, anon;
grant execute on function public.my_forge_reveals() to authenticated;

-- ──────────────────────────────────── the guard admits the new kind

/**
 * One new branch on 160's guard. The amount is RECOMPUTED from the reveal row, so
 * a hand-written claim of 9999 becomes what the server actually drew — the same
 * repricing the XP guard and the board-purchase guard do.
 */
create or replace function public.coin_events_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  valid_sets int;
  row_e1rm numeric;
  prior_best numeric;
  w record;
  m int;
  claimed_start date;
  s record;
  price numeric;
  paid_today int;
  drawn int;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- ── 161: THE REVEAL ────────────────────────────────────────────────────
  if new.kind = 'reveal_bonus' then
    if current_setting('evoforge.reveal_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      select coins into drawn from public.forge_reveals
       where id = new.source_id::uuid and user_id = new.user_id;
      if drawn is null then
        raise exception 'coin_events: no drawn reveal matches %.', new.source_id
          using errcode = 'check_violation';
      end if;
      new.amount := drawn;      -- the server's draw, never the caller's number
      new.source_table := 'forge_reveals';
      return new;
    end if;
    raise exception 'coin_events: reveal_bonus may only be written by a reveal claim.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind in ('challenge_stake', 'challenge_payout',
                  'duel_support_stake', 'duel_support_payout') then
    if current_setting('evoforge.challenge_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      new.source_table := 'forge_challenges';
      return new;
    end if;
    raise exception 'coin_events: % may only be written by duel settlement.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind in ('callout_stake', 'callout_payout') then
    if current_setting('evoforge.callout_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      new.source_table := 'workout_callouts';
      return new;
    end if;
    raise exception 'coin_events: % may only be written by call out settlement.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind in ('forge_drop_stake', 'forge_drop_payout') then
    if current_setting('evoforge.forge_drop_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      new.source_table := 'forge_drops';
      return new;
    end if;
    raise exception 'coin_events: % may only be written by a Forge Drop settlement.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind = 'forge_drop_unlock' then
    if current_setting('evoforge.forge_drop_unlock_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      select t.unlock_coins into price
      from public.forge_drop_unlocks u
      join public.forge_drop_tiers t on t.tier = u.tier
      where u.id = new.source_id::uuid and u.user_id = new.user_id;
      if price is null then
        raise exception 'coin_events: no board purchase matches %.', new.source_id
          using errcode = 'check_violation';
      end if;
      new.amount := -price;
      new.source_table := 'forge_drop_unlocks';
      return new;
    end if;
    raise exception 'coin_events: forge_drop_unlock may only be written by a board purchase.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind in ('spend', 'battle_reward') then
    if current_setting('evoforge.spend_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      return new;
    end if;
    raise exception 'coin_events: % may only be written by a server grant.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind = 'set_reward' then
    if new.source_id is null then
      raise exception 'coin_events: set_reward needs the set it is for.'
        using errcode = 'check_violation';
    end if;
    if not public.is_rewardable_set(new.source_id::uuid, auth.uid()) then
      raise exception 'coin_events: that is not a set you logged, or not a plausible one.'
        using errcode = 'check_violation';
    end if;
    paid_today := public.set_rewards_paid_today(auth.uid());
    if paid_today >= 30 then
      raise exception 'coin_events: today''s set rewards are all paid (% of 30).', paid_today
        using errcode = 'check_violation';
    end if;
    new.amount := 12;
    new.source_table := 'workout_log';
    return new;
  end if;

  if new.kind = 'workout_complete' then
    if new.source_id is null or new.source_id !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'coin_events: workout_complete needs a date source.' using errcode = 'check_violation';
    end if;
    select count(*) into valid_sets
    from public.workout_log w2
    where w2.user_id = auth.uid() and w2.date = new.source_id::date and w2.weight >= 0 and w2.reps > 0;
    if valid_sets < 10 then
      raise exception 'coin_events: not enough training on % (% sets).', new.source_id, valid_sets
        using errcode = 'check_violation';
    end if;
    new.amount := 20;
    new.source_table := 'workout_log';
    -- 161: a completed qualifying workout is a producer. Silent, and never fatal —
    -- a reveal that a ceiling refuses must not fail the workout that earned it.
    perform public.forge_reveal_grant(
      auth.uid(), 'workout_complete', new.source_id, new.source_id::date, null);
    return new;

  elsif new.kind = 'pr' then
    select w2.exercise, w2.weight, w2.reps, w2."timestamp" into w
    from public.workout_log w2
    where w2.id = new.source_id::uuid and w2.user_id = auth.uid() and w2.weight > 0 and w2.reps > 0;
    if not found then
      raise exception 'coin_events: no matching owned set (%).', new.source_id using errcode = 'check_violation';
    end if;
    row_e1rm := w.weight * (1 + w.reps / 30.0);
    select max(w3.weight * (1 + w3.reps / 30.0)) into prior_best
    from public.workout_log w3
    where w3.user_id = auth.uid() and w3.exercise = w.exercise
      and w3.weight > 0 and w3.reps > 0 and w3."timestamp" < w."timestamp";
    if prior_best is null or row_e1rm <= prior_best then
      raise exception 'coin_events: that set is not a PR.' using errcode = 'check_violation';
    end if;
    new.amount := 25;
    new.source_table := 'workout_log';
    -- 161: a QUALIFYING PR is the second producer — a stricter test than the one
    -- that pays these 25 coins. Any e1rm gain banks the coins; only a real
    -- increment banks a reveal.
    if public.is_qualifying_pr(new.source_id::uuid, auth.uid()) then
      perform public.forge_reveal_grant(
        auth.uid(), 'pr', new.source_id, w."timestamp"::date, w.exercise);
    end if;
    return new;

  elsif new.kind = 'streak_milestone' then
    if new.source_id is null or new.source_id !~ '^\d+:\d{4}-\d{2}-\d{2}$' then
      raise exception 'coin_events: bad milestone key.' using errcode = 'check_violation';
    end if;
    m := split_part(new.source_id, ':', 1)::int;
    claimed_start := split_part(new.source_id, ':', 2)::date;
    if m not in (3, 7, 14, 30, 60, 100) then
      raise exception 'coin_events: % is not a milestone.', m using errcode = 'check_violation';
    end if;
    select * into s from public.scheduled_streak(auth.uid(), current_date);
    if s.length is null or s.length < m or s.run_start is distinct from claimed_start then
      select * into s from public.scheduled_streak(auth.uid(), current_date + 1);
      if s.length is null or s.length < m or s.run_start is distinct from claimed_start then
        raise exception 'coin_events: streak milestone % not proven (server sees % from %).',
          m, coalesce(s.length, 0), s.run_start using errcode = 'check_violation';
      end if;
    end if;
    new.amount := 10 * m;
    new.source_table := 'workout_schedule';
    return new;

  elsif new.kind = 'starting_bonus' then
    if new.source_id is distinct from 'onboarding' then
      raise exception 'coin_events: starting_bonus source must be onboarding.' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.profile p where p.user_id = auth.uid()) then
      raise exception 'coin_events: no profile yet.' using errcode = 'check_violation';
    end if;
    new.amount := 100;
    new.source_table := 'profile';
    return new;

  else
    raise exception 'coin_events: kind % may only be written by the server.', new.kind
      using errcode = 'insufficient_privilege';
  end if;
end;
$function$;

-- ────────────────────────────── THE INVARIANTS, PROVEN NOT ASSUMED

-- Invariant 1, layer by layer.
do $$
begin
  if exists (select 1 from public.forge_reveal_table where coins <= 0) then
    raise exception 'forge_reveal_table holds a non-positive outcome';
  end if;
  -- FUNCTIONALLY, NOT BY READING THE CONSTRAINT'S TEXT.
  --
  -- Two earlier versions of this check were wrong, and both are worth recording.
  -- The first matched `pg_get_constraintdef` against '%amount > 0%' and refused to
  -- commit — `amount` is numeric since 158, so Postgres renders the clause as
  -- `amount > (0)::numeric`. String-matching a normalised definition proves
  -- nothing about behaviour.
  --
  -- The second tried the insert as the migration's own role and was refused by the
  -- GUARD, not the constraint: coin_events_guard is a BEFORE trigger, so it runs
  -- first and answers "may only be written by a reveal claim". The insert was
  -- refused, but by the wrong layer — and a probe that cannot tell which layer
  -- stopped it cannot prove the constraint exists at all.
  --
  -- So the probe runs as service_role, which the guard deliberately waves through
  -- (its first branch), leaving the CHECK as the only thing standing. That is
  -- exactly the layer invariant 1 depends on when everything above it is wrong.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    insert into public.coin_events (user_id, kind, amount, source_id, source_table)
    values ((select id from auth.users limit 1), 'reveal_bonus', -1,
            'invariant-1-probe', 'forge_reveals');
    raise exception 'A NEGATIVE reveal_bonus WAS STORED — invariant 1 is not enforced';
  exception
    when check_violation then
      null;   -- refused by the constraint, which is the point
  end;
  perform set_config('request.jwt.claims', '', true);
  -- THE CLAIM SIGNATURE, WHICH IS THE WHOLE ARGUMENT. Exactly one parameter, of
  -- type uuid: an identifier and nothing else. If a future edit adds a stake, an
  -- amount, a lane or a tier, this refuses to commit.
  --
  -- Checked as (count of arguments, argument type) rather than by comparing the
  -- rendered signature to a string. `pg_get_function_identity_arguments` includes
  -- parameter NAMES in this Postgres — it returns 'p_reveal_id uuid', not 'uuid' —
  -- so the string comparison this replaces failed on a function that was perfectly
  -- correct. A guard that trips on its own formatting assumption teaches people to
  -- delete guards.
  if (select p.pronargs from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'forge_reveal_claim') <> 1
     or (select p.proargtypes[0] from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'forge_reveal_claim') <> 'uuid'::regtype then
    raise exception 'forge_reveal_claim no longer takes exactly one uuid — a stake may have crept in';
  end if;
end $$;

-- The published table must be a real distribution, and its average must sit where
-- §3 says it does (~30, "ceiling one workout's base income, never a fortune").
do $$
declare ev numeric; total int;
begin
  select sum(weight), sum(coins * weight)::numeric / sum(weight)
    into total, ev from public.forge_reveal_table where version = 1;
  if total <> 1000 then
    raise exception 'forge_reveal_table weights sum to % per-mille, not 1000', total;
  end if;
  if ev < 25 or ev > 40 then
    raise exception 'the reveal averages % coins, outside the 25-40 §3 intends', round(ev, 2);
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- begin;
--   drop function if exists public.forge_reveal_claim(uuid);
--   drop function if exists public.my_forge_reveals();
--   drop function if exists public.forge_reveal_grant(uuid, text, text, date, text);
--   drop function if exists public.is_qualifying_pr(uuid, uuid, numeric);
--   drop table if exists public.forge_reveals;
--   drop table if exists public.forge_reveal_table;
--   alter table public.coin_events drop constraint coin_events_reveal_adds_only;
--   -- then re-apply 160's guard body and kind list.
-- commit;

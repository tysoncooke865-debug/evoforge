-- EvoForge 164 — RETIRE THIRD-PARTY STAKING, AND THE HOUSE MARGIN WITH IT.
--
-- `144_forge_duel_economy` implemented a pari-mutuel book: supporters escrowed
-- coins on SOMEBODY ELSE'S duel, the market closed partway through the window
-- (`support_close_pct`), and the config carried
--
--     "The platform's cut of the LOSING supporter pool, in basis points"
--
-- which is a house rake — with "house" itself on §10's banned word list. Neither
-- briefing named this feature; it was found in the Phase 1 audit
-- (docs/V5_MIGRATION_AUDIT.md §4) and the reasoning for retiring it is recorded
-- there.
--
-- WHY RETIRE RATHER THAN FOLD INTO GOLDEN DOT. v5 §4-5 sanction a pledge on the
-- athlete's OWN planned performance. BACK/PUSH is a response to that pledge.
-- Re-pointing it at a third party's duel would smuggle the same mechanic back
-- under a sanctioned name, which is precisely the "do not reintroduce under any
-- renaming" clause. It is also skill-resolved and therefore clears invariant 2 —
-- but clearing one invariant is not the same as being in the spec.
--
-- NOBODY LOSES A COIN. Checked before writing this, and re-checked below: zero
-- rows in `forge_duel_support`, zero `duel_support_*` ledger entries. The feature
-- shipped and was never used, so there is no escrow to refund and no history to
-- preserve — which is the only reason the table and the coin kinds can go rather
-- than being kept spellable the way 162 kept the retired board's.
--
-- SPECTATING SURVIVES. `forge_duel_watch` and `forge_duels_watchable` stay: they
-- carry no coins, and watching a friend's duel is not the mechanic that was
-- rejected.

begin;

-- ─────────────────────── refuse to run if anybody actually used it

/**
 * THE PRECONDITION THIS WHOLE MIGRATION RESTS ON, CHECKED RATHER THAN ASSUMED.
 *
 * Every "drop it, nobody used it" decision below is only safe while that is true.
 * If a supporter position or a settled ledger row exists by the time this runs, the
 * right answer stops being "drop" and becomes "refund, then drop" — so it refuses
 * to commit rather than quietly deleting somebody's coins.
 */
do $$
declare n_rows int; n_ledger int;
begin
  select count(*) into n_rows from public.forge_duel_support;
  select count(*) into n_ledger from public.coin_events where kind like 'duel_support%';
  if n_rows > 0 or n_ledger > 0 then
    raise exception
      'third-party staking HAS been used (% positions, % ledger rows) — write the refund path before dropping anything',
      n_rows, n_ledger;
  end if;
end $$;

-- ────────────────────────────────────── the book, and its rake

drop function if exists public.forge_duel_settle_support(uuid, uuid);
drop function if exists public.forge_duel_support(uuid, uuid, integer);
drop table if exists public.forge_duel_support;

-- THE HOUSE MARGIN. Set to 0 today, which is not the point: the column exists, the
-- CHECK permits up to 2000 basis points, and settlement read it. A rake that is
-- switched off is a rake that can be switched on with an UPDATE and no deploy.
-- Enumerated from the LIVE table, because guessing the names left `max_support`
-- standing on the first run — the guard caught it, as it is meant to.
do $$
declare col text;
begin
  for col in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'forge_duel_config'
      and (column_name ilike '%rake%' or column_name ilike '%margin%'
           or column_name ilike '%_bp' or column_name ilike '%commission%'
           or column_name ilike '%support%')
  loop
    execute format('alter table public.forge_duel_config drop column if exists %I', col);
    raise notice 'dropped forge_duel_config.%', col;
  end loop;
end $$;

-- ────────────────────────── the ledger forgets a kind it never used

alter table public.coin_events drop constraint if exists coin_events_kind_check;
alter table public.coin_events add constraint coin_events_kind_check
  check (kind = any (array[
    'workout_complete', 'pr', 'streak_milestone', 'starting_bonus',
    'adjustment', 'spend', 'battle_reward',
    'challenge_stake', 'challenge_payout',
    'callout_stake', 'callout_payout',
    -- retired, kept spellable because real rows exist (162)
    'forge_drop_stake', 'forge_drop_payout', 'forge_drop_unlock',
    'set_reward', 'reveal_bonus'
    -- 164: duel_support_stake and duel_support_payout are GONE, not kept. Zero
    -- rows were ever written, so there is no past to keep readable.
  ]));

alter table public.coin_events drop constraint if exists coin_events_reveal_adds_only;
alter table public.coin_events add constraint coin_events_reveal_adds_only
  check (kind <> 'reveal_bonus' or amount > 0);

-- The guard branch that authorised them goes too.
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
  paid_today int;
  drawn int;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.kind in ('forge_drop_stake', 'forge_drop_payout', 'forge_drop_unlock') then
    raise exception
      'coin_events: the staked board was retired. Chance is additive now (see forge_reveal_claim).'
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind = 'reveal_bonus' then
    if current_setting('evoforge.reveal_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      select coins into drawn from public.forge_reveals
       where id = new.source_id::uuid and user_id = new.user_id;
      if drawn is null then
        raise exception 'coin_events: no drawn reveal matches %.', new.source_id
          using errcode = 'check_violation';
      end if;
      new.amount := drawn;
      new.source_table := 'forge_reveals';
      return new;
    end if;
    raise exception 'coin_events: reveal_bonus may only be written by a reveal claim.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 164: duel_support_* are no longer members of this branch. Backing a third
  -- party's duel is retired; the kinds are not in the CHECK any more either.
  if new.kind in ('challenge_stake', 'challenge_payout') then
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

-- ─────────────────────── THE RETIREMENT, PROVEN NOT ASSUMED

do $$
declare bad text;
begin
  -- No margin anywhere in the duel config, by any spelling.
  select string_agg(column_name, ', ') into bad
  from information_schema.columns
  where table_schema = 'public' and table_name = 'forge_duel_config'
    and (column_name ilike '%rake%' or column_name ilike '%margin%'
         or column_name ilike '%_bp' or column_name ilike '%commission%'
         or column_name ilike '%support%');
  if bad is not null then
    raise exception 'the duel config still carries a margin or a supporter knob: %', bad;
  end if;

  -- No function can take a position on somebody else's duel.
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('forge_duel_support', 'forge_duel_settle_support');
  if bad is not null then
    raise exception 'third-party staking is still callable: %', bad;
  end if;

  -- Spectating survived. Retiring the coins must not have retired the watching.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'forge_duel_watch'
  ) then
    raise exception 'forge_duel_watch was dropped — spectating is not the mechanic that was rejected';
  end if;

  -- And the ledger cannot spell the retired kinds.
  if pg_get_constraintdef((select oid from pg_constraint
      where conname = 'coin_events_kind_check')) like '%duel_support%' then
    raise exception 'duel_support_* is still an admissible coin kind';
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- None, deliberately — as with 162. Restoring this restores a pari-mutuel book
-- with a house rake, and if that is ever the intent it should be written on
-- purpose rather than pasted from a comment. 144 is in git.

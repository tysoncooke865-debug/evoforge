-- EvoForge 162 — RETIRE THE STAKED BOARD.
--
-- The client no longer references any of this: the route, the board, the chip
-- rack, the payout table, the rest-timer panel and the four entry points are all
-- deleted in the same commit that applies this. Nothing calls what is dropped
-- below, which is why it can go now and could not go in 161.
--
-- WHAT IS DROPPED, AND WHAT IS DELIBERATELY KEPT.
--
-- DROPPED — the playable surface. Every function that could take a coin in
-- exchange for a random outcome. After this there is no way to construct a staked
-- chance event against this database, which is invariant 1 as a property of the
-- schema rather than of the client.
--
-- KEPT — the history. `forge_drops`, `forge_drop_tiers`, `forge_drop_unlocks` and
-- the `forge_drop_*` coin kinds all stay:
--
--   * AN ATHLETE'S LEDGER MUST STILL RENDER. There are real `forge_drop_stake` and
--     `forge_drop_payout` rows in coin_events. Dropping the kinds from the CHECK
--     would leave rows the constraint no longer admits — invisible until some
--     later migration tried to validate it — and dropping `forge_drops` would
--     orphan every one of them. A retired mechanic is not the same as a rewritten
--     past, and the coins were really earned and really spent.
--   * `config_version` on a settled drop points at `forge_drop_tiers`. The audit
--     trail is only readable while the table it references exists.
--
-- So the record stands and the mechanism goes. That is the honest shape of a
-- retirement, and it is also what lets anybody later answer "what did this pay?"

begin;

-- ───────────────────────────────────────────── the playable surface goes

-- 159 replaced the 3-argument form with a 4-argument one; drop both spellings so
-- a stale client cannot resolve to a lingering overload.
drop function if exists public.forge_drop_play(uuid, numeric, int, int);
drop function if exists public.forge_drop_play(uuid, numeric, int);

-- Buying a board early: the only other path that ever debited for chance.
drop function if exists public.forge_drop_unlock(int);

-- The board selector's read model, and the two gates it was built on. Nothing
-- else calls them once the selector is gone.
drop function if exists public.my_forge_drop_boards();
drop function if exists public.forge_drop_board_unlocked(uuid, int);
drop function if exists public.forge_drop_counted_sets(uuid);

-- The resolver and its XP award. `forge_drop_walk`/`forge_drop_slot` were the RNG
-- service; the reveal has its own draw in 161 and does not use them.
drop function if exists public.forge_drop_award_xp(uuid, uuid);
drop function if exists public.forge_drop_restore(uuid[]);
drop function if exists public.forge_drop_slot(int, smallint[]);
drop function if exists public.forge_drop_walk(int, int);
drop function if exists public.forge_drop_tier_for(uuid);

-- ────────────────────────────── nothing may write a stake row again

/**
 * THE KINDS STAY SPELLABLE FOR HISTORY, AND BECOME UNWRITABLE IN PRACTICE.
 *
 * The CHECK still admits `forge_drop_stake`, `forge_drop_payout` and
 * `forge_drop_unlock` so existing rows remain valid. What changes is the guard: the
 * branches that used to authorise them required a transaction-local GUC set by
 * `forge_drop_play` / `forge_drop_unlock`, and those functions no longer exist.
 * Nothing can set the GUC, so nothing can pass the branch.
 *
 * They are therefore replaced with an unconditional refusal that says why. A
 * lingering "may only be written by a Forge Drop settlement" would be misleading
 * once no settlement exists — it reads as "you called it wrong" rather than "this
 * mechanic is gone".
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
  paid_today int;
  drawn int;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- 162 — THE RETIRED BOARD. Kept spellable for the ledger's past, refused for
  -- its future. There is no function left that could authorise these.
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

-- ────────────────────────── THE RETIREMENT, PROVEN NOT ASSUMED

do $$
declare survivor text;
begin
  -- No function remains whose name says it plays or prices a board.
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
    into survivor
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('forge_drop_play', 'forge_drop_unlock', 'my_forge_drop_boards',
                      'forge_drop_board_unlocked', 'forge_drop_counted_sets',
                      'forge_drop_award_xp', 'forge_drop_restore', 'forge_drop_walk',
                      'forge_drop_slot', 'forge_drop_tier_for');
  if survivor is not null then
    raise exception 'the staked board is still playable: %', survivor;
  end if;

  -- The history is still there. A retirement that quietly deleted an athlete's
  -- ledger would be a worse defect than the mechanic it removed.
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'forge_drops') then
    raise exception 'forge_drops was dropped — settled drops in coin_events are now orphans';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint
      where conname = 'coin_events_kind_check')) not like '%forge_drop_stake%' then
    raise exception 'forge_drop_stake is no longer spellable — existing ledger rows are invalid';
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- There is deliberately no rollback for this one. Restoring it means restoring a
-- mechanic a compliance review rejected, and if that is ever the intent it should
-- be a new migration written on purpose rather than a commented block pasted from
-- here. 154-159 are in git if the bodies are needed.

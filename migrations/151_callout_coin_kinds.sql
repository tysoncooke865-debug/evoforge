-- EvoForge 151 — the ledger and the inbox learn the call out words.
--
-- THREE EDITS, ALWAYS. 142's header says it and it is worth repeating because
-- it will happen again: a coin kind lives in THREE places —
--   the CHECK constraint   decides whether the word may exist,
--   the guard trigger      decides who may write it,
--   the client's labels    decide what it means to a human.
-- 139 taught the guard and not the constraint, and the first real accept died
-- one layer BELOW the guard that had just approved it. All three are here (the
-- client half lands in the same release, in data/coins.ts).
--
--   callout_stake   NEGATIVE. Both athletes' coins leave their balances at
--                   ACCEPTANCE. coin_total() is sum(amount), so a staked coin
--                   genuinely cannot be staked anywhere else.
--   callout_payout  POSITIVE. The winner takes the pot, or both sides are
--                   refunded on a timeout, a mutual call-off or a repair.
--
-- A SEPARATE GUC FROM THE DUEL'S, on purpose. `evoforge.challenge_authorized`
-- unlocks duel escrow and supporter money; `evoforge.callout_authorized` unlocks
-- these two and nothing else. Learning one must not unlock the other — the same
-- reasoning that kept `spend` apart from the challenge kinds in 144.

begin;

-- ────────────────────────────────────── the domain of a coin kind widens

alter table public.coin_events drop constraint if exists coin_events_kind_check;
alter table public.coin_events add constraint coin_events_kind_check
  check (kind = any (array[
    'workout_complete', 'pr', 'streak_milestone', 'starting_bonus',
    'adjustment', 'spend', 'battle_reward',
    'challenge_stake', 'challenge_payout',
    'duel_support_stake', 'duel_support_payout',
    -- 151 — LIVE WORKOUT CALL OUTS.
    'callout_stake',
    'callout_payout'
  ]));

/**
 * The guard, extended once more. Everything below is 144's body unchanged; the
 * only new thing is the call-out branch, which is the duel branch's twin with
 * its own GUC and its own source table.
 *
 * PostgREST cannot reach set_config (pg_catalog is not an exposed schema), which
 * is what makes a transaction-local GUC unforgeable from a client. And the gate
 * is never `current_user` — that was the 030/033 lesson, and it is why this
 * short-circuits on `auth.role()` and then asks about the GUC.
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
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- 139/144: CHALLENGE ESCROW and SUPPORTER MONEY.
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

  -- 151: CALL OUT ESCROW. Same shape, different key. Written only inside the
  -- callout functions, which set `evoforge.callout_authorized` to the event's
  -- source_id for the transaction.
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
    new.amount := 25;
    new.source_table := 'workout_log';
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
    new.amount := 50;
    new.source_table := 'workout_log';
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

-- ─────────────────────────────────── the inbox learns six more words

-- Widened FIRST, before anything can try to write one (145's rule): an unlisted
-- type raises, and a raise inside a transaction that just moved coins would roll
-- the coins back.
alter table public.social_notifications drop constraint if exists social_notifications_type_check;
alter table public.social_notifications
  add constraint social_notifications_type_check
  check (type in ('reaction','comment','friend_request','friend_accepted','mention',
                  'comment_reaction','comment_reply','pr_beaten',
                  'duel_invite','duel_accepted','duel_declined',
                  'duel_raise','duel_raise_accepted','duel_raise_declined',
                  'duel_lead_change','duel_support','duel_ending','duel_settled',
                  -- 151 — LIVE WORKOUT CALL OUTS. Six, and no more: an offer,
                  -- its two answers, the set landing, the verification, and the
                  -- payout. Nothing here nudges anybody to wager.
                  'callout_offered','callout_accepted','callout_declined',
                  'callout_logged','callout_verified','callout_settled'));

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- Re-apply 144's coin_events_guard() body and 145's type check, then:
--   alter table public.coin_events drop constraint coin_events_kind_check;
--   alter table public.coin_events add constraint coin_events_kind_check
--     check (kind = any (array['workout_complete','pr','streak_milestone',
--       'starting_bonus','adjustment','spend','battle_reward','challenge_stake',
--       'challenge_payout','duel_support_stake','duel_support_payout']));
-- Rolling the constraint back while callout rows exist would orphan them, so
-- delete any callout coin_events first.

-- EvoForge 030 — THE SKIN SHOP (Tyson, 2026-07-16: "make the colours
-- locked by forge coins, price ascending, cheaper on aesthetics").
-- MUST RUN AFTER 013 (extends the coin guard; spends reference coin_events).
--
-- Colour skins (red/green/yellow/orange/white/black) are bought PER LINE
-- with forge coins. Prices live HERE (skin_price) — the client's table is
-- a display twin; the server charges what it computes, never what the
-- client sends. 'standard' is free and 'adam' is the level-100 reward:
-- neither is purchasable, so neither appears in the price table.
--
-- Ownership rows are written ONLY inside purchase_skin (security definer):
-- user_skin_unlocks has select-only RLS, and the coin guard admits 'spend'
-- rows solely from definer context (the proven 026 current_user pattern) —
-- a raw PostgREST insert of either row still fails.
--
-- Falsification checklist (run before trusting):
--   (a) client JWT insert into user_skin_unlocks          -> RLS rejection
--   (b) client JWT insert coin_events kind='spend'        -> guard rejection
--   (c) purchase_skin('aesthetic','red') with balance>=50 -> unlock row +
--       spend row of exactly -50, balance drops by 50
--   (d) repeat (c)                                        -> 'already owned'
--   (e) purchase_skin with balance < price                -> 'not enough coins'
--   (f) purchase_skin('aesthetic','adam')                 -> 'unknown skin'
--   (g) cross-user SELECT on user_skin_unlocks            -> zero rows with
--       a populated positive control on the owner

create table if not exists public.user_skin_unlocks (
  user_id       uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  line          text        not null check (line in ('aesthetic', 'mass', 'titan', 'cardio', 'shredder')),
  skin          text        not null check (skin in ('red', 'green', 'yellow', 'orange', 'white', 'black')),
  coin_event_id uuid        references public.coin_events(id),
  created_at    timestamptz not null default now(),
  primary key (user_id, line, skin)
);

alter table public.user_skin_unlocks enable row level security;

drop policy if exists skin_unlocks_owner_select on public.user_skin_unlocks;
create policy skin_unlocks_owner_select on public.user_skin_unlocks
  for select to authenticated using (user_id = auth.uid());

-- Deliberately absent: insert/update/delete policies. purchase_skin
-- (security definer) is the only writer.

-- The price list. Ascending within a line; the aesthetic line is the
-- cheapest (Tyson). IMMUTABLE: prices change only by migration.
create or replace function public.skin_price(p_line text, p_skin text)
returns integer
language sql
immutable
as $$
  select case
    when p_line = 'aesthetic' then
      case p_skin
        when 'red' then 50 when 'green' then 75 when 'yellow' then 100
        when 'orange' then 150 when 'white' then 200 when 'black' then 250
      end
    when p_line in ('mass', 'titan', 'cardio', 'shredder') then
      case p_skin
        when 'red' then 100 when 'green' then 150 when 'yellow' then 200
        when 'orange' then 300 when 'white' then 400 when 'black' then 500
      end
  end;
$$;

create or replace function public.purchase_skin(p_line text, p_skin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price   int;
  v_balance int;
  v_event   uuid;
begin
  if auth.uid() is null then
    raise exception 'purchase_skin: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  v_price := public.skin_price(p_line, p_skin);
  if v_price is null then
    raise exception 'purchase_skin: unknown skin %:%.', p_line, p_skin using errcode = 'check_violation';
  end if;

  -- Serialize per athlete: two concurrent purchases must not both pass
  -- the balance check and overdraw the wallet.
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));

  -- Authorize the ONE spend row this function is about to write. The flag
  -- is transaction-local (is_local = true) so it dies with this call; a
  -- client POST to /coin_events is its own single-statement transaction
  -- and can never set it (see the guard).
  perform set_config('evoforge.spend_authorized', p_line || ':' || p_skin, true);

  if exists (
    select 1 from public.user_skin_unlocks u
    where u.user_id = auth.uid() and u.line = p_line and u.skin = p_skin
  ) then
    raise exception 'purchase_skin: already owned.' using errcode = 'unique_violation';
  end if;

  select coalesce(sum(amount), 0) into v_balance
  from public.coin_events where user_id = auth.uid();
  if v_balance < v_price then
    raise exception 'purchase_skin: not enough coins (% < %).', v_balance, v_price
      using errcode = 'check_violation';
  end if;

  insert into public.coin_events (user_id, kind, amount, source_table, source_id)
  values (auth.uid(), 'spend', -v_price, 'user_skin_unlocks', p_line || ':' || p_skin)
  returning id into v_event;

  insert into public.user_skin_unlocks (user_id, line, skin, coin_event_id)
  values (auth.uid(), p_line, p_skin, v_event);

  return jsonb_build_object('price', v_price, 'balance', v_balance - v_price);
end;
$$;

revoke all on function public.purchase_skin(text, text) from public;
grant execute on function public.purchase_skin(text, text) to authenticated;

-- The 013 guard, replayed verbatim with ONE addition: a 'spend' row is
-- admitted ONLY when this transaction carries the evoforge.spend_authorized
-- flag matching the row's source_id. purchase_skin (security definer) is
-- the sole setter, and it sets it transaction-local. A raw client POST to
-- /coin_events runs as its own single-statement transaction with the flag
-- unset, so it can never mint a spend. (current_user is NOT usable here:
-- inside a SECURITY DEFINER trigger it is always the owner, so it cannot
-- tell the definer function apart from a direct client insert.)
create or replace function public.coin_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  -- The ONLY path that may write a 'spend': purchase_skin set the
  -- transaction-local flag to this exact source_id. Nothing else can.
  if new.kind = 'spend' then
    if current_setting('evoforge.spend_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      return new;
    end if;
    raise exception 'coin_events: spend may only be written by purchase_skin.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind = 'workout_complete' then
    if new.source_id is null or new.source_id !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'coin_events: workout_complete needs a date source.' using errcode = 'check_violation';
    end if;
    select count(*) into valid_sets
    from public.workout_log w2
    where w2.user_id = auth.uid() and w2.date = new.source_id::date and w2.weight > 0 and w2.reps > 0;
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
$$;

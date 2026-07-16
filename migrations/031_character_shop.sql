-- EvoForge 031 — PREMIUM CHARACTERS (Tyson, 2026-07-16: "add Captain
-- Gymerica, two stages, unlocked by a single 10000 forge-coin purchase").
-- MUST RUN AFTER 030 (reuses the evoforge.spend_authorized GUC + coin guard).
--
-- A premium character is bought ONCE with forge coins and equipped as an
-- avatar OVERLAY (the player's real training branch/stats are untouched).
-- One purchase unlocks the whole character (all its stages + bundled
-- looks). Same server-authority posture as the skin shop (030): prices in
-- character_price(), the atomic spend + unlock only inside purchase_character
-- (security definer), append-only unlocks with select-only RLS.
--
-- Falsification checklist (smoke JWT unless noted):
--   (a) client insert into user_character_unlocks        -> RLS rejection
--   (b) purchase_character('gymerica') with balance<10000 -> not enough
--   (c) service-role top-up to >=10000, then purchase      -> unlock row +
--       spend row of exactly -10000, balance drops 10000
--   (d) repeat (c)                                          -> already owned
--   (e) purchase_character('nobody')                        -> unknown
--   (f) cross-user SELECT                                   -> zero rows,
--       positive control on the owner

create table if not exists public.user_character_unlocks (
  user_id       uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  character     text        not null check (character in ('gymerica')),
  coin_event_id uuid        references public.coin_events(id),
  created_at    timestamptz not null default now(),
  primary key (user_id, character)
);

alter table public.user_character_unlocks enable row level security;

drop policy if exists character_unlocks_owner_select on public.user_character_unlocks;
create policy character_unlocks_owner_select on public.user_character_unlocks
  for select to authenticated using (user_id = auth.uid());

-- Deliberately absent: insert/update/delete policies. purchase_character
-- (security definer) is the only writer.

create or replace function public.character_price(p_character text)
returns integer
language sql
immutable
as $$
  select case p_character when 'gymerica' then 10000 end;
$$;

create or replace function public.purchase_character(p_character text)
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
    raise exception 'purchase_character: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  v_price := public.character_price(p_character);
  if v_price is null then
    raise exception 'purchase_character: unknown character %.', p_character using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));

  if exists (
    select 1 from public.user_character_unlocks u
    where u.user_id = auth.uid() and u.character = p_character
  ) then
    raise exception 'purchase_character: already owned.' using errcode = 'unique_violation';
  end if;

  select coalesce(sum(amount), 0) into v_balance
  from public.coin_events where user_id = auth.uid();
  if v_balance < v_price then
    raise exception 'purchase_character: not enough coins (% < %).', v_balance, v_price
      using errcode = 'check_violation';
  end if;

  -- Authorize the one spend row (the coin guard admits a 'spend' only when
  -- this transaction-local flag matches its source_id; 030 pattern).
  perform set_config('evoforge.spend_authorized', 'character:' || p_character, true);

  insert into public.coin_events (user_id, kind, amount, source_table, source_id)
  values (auth.uid(), 'spend', -v_price, 'user_character_unlocks', 'character:' || p_character)
  returning id into v_event;

  insert into public.user_character_unlocks (user_id, character, coin_event_id)
  values (auth.uid(), p_character, v_event);

  return jsonb_build_object('price', v_price, 'balance', v_balance - v_price);
end;
$$;

revoke all on function public.purchase_character(text) from public;
grant execute on function public.purchase_character(text) to authenticated;

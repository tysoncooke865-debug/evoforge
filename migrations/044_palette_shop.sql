-- EvoForge 044 — THE PALETTE SHOP (Tyson, 2026-07-17: "sell reskins of the
-- entire website — colour palettes bought with forge coins, own for life,
-- equip or remove whenever").
-- MUST RUN AFTER 033 (reuses the evoforge.spend_authorized GUC: the current
-- coin guard admits a 'spend' row only when that transaction-local flag
-- matches the row's source_id — this migration touches NO guard code).
--
-- A palette recolours the whole app CHROME for the buyer (backgrounds,
-- surfaces, borders, text tints, accent family). It is bought ONCE and owned
-- forever; equipping is free and client-side (the loadout). 'standard' is
-- the free default and is never a row here, never priced. Same server-
-- authority posture as 030/031: prices in palette_price(), the atomic
-- spend + unlock only inside purchase_palette (security definer), append-
-- only unlocks with select-only RLS.
--
-- Falsification checklist (smoke JWT unless noted):
--   (a) client insert into user_palette_unlocks            -> RLS rejection
--   (b) client POST coin_events kind='spend'
--       source_id='palette:emerald'                        -> guard rejection
--   (c) purchase_palette('emerald') with balance < 500     -> not enough
--   (d) funded purchase_palette('emerald')                 -> unlock row +
--       spend row of exactly -500, balance drops 500
--   (e) repeat (d)                                         -> already owned
--   (f) purchase_palette('standard') / ('nope')            -> unknown palette
--   (g) cross-user SELECT on user_palette_unlocks          -> zero rows,
--       positive control on the owner

create table if not exists public.user_palette_unlocks (
  user_id       uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  palette       text        not null check (palette in ('emerald', 'crimson', 'synthwave', 'solar', 'arctic', 'void')),
  coin_event_id uuid        references public.coin_events(id),
  created_at    timestamptz not null default now(),
  primary key (user_id, palette)
);

alter table public.user_palette_unlocks enable row level security;

drop policy if exists palette_unlocks_owner_select on public.user_palette_unlocks;
create policy palette_unlocks_owner_select on public.user_palette_unlocks
  for select to authenticated using (user_id = auth.uid());

-- Deliberately absent: insert/update/delete policies. purchase_palette
-- (security definer) is the only writer.

-- The price list. Ascending; a whole-app reskin outranks a single sprite
-- skin (50-500) and sits well under a premium character (10000).
-- IMMUTABLE: prices change only by migration. The client's PALETTE_PRICES
-- is a display twin — the server charges what it computes here.
create or replace function public.palette_price(p_palette text)
returns integer
language sql
immutable
as $$
  select case p_palette
    when 'emerald'   then 500
    when 'crimson'   then 750
    when 'synthwave' then 1000
    when 'solar'     then 1250
    when 'arctic'    then 1500
    when 'void'      then 2000
  end;
$$;

create or replace function public.purchase_palette(p_palette text)
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
    raise exception 'purchase_palette: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  v_price := public.palette_price(p_palette);
  if v_price is null then
    raise exception 'purchase_palette: unknown palette %.', p_palette using errcode = 'check_violation';
  end if;

  -- Serialize per athlete: two concurrent purchases must not both pass the
  -- balance check and overdraw the wallet.
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));

  if exists (
    select 1 from public.user_palette_unlocks u
    where u.user_id = auth.uid() and u.palette = p_palette
  ) then
    raise exception 'purchase_palette: already owned.' using errcode = 'unique_violation';
  end if;

  select coalesce(sum(amount), 0) into v_balance
  from public.coin_events where user_id = auth.uid();
  if v_balance < v_price then
    raise exception 'purchase_palette: not enough coins (% < %).', v_balance, v_price
      using errcode = 'check_violation';
  end if;

  -- Authorize the one spend row (the coin guard admits a 'spend' only when
  -- this transaction-local flag matches its source_id; 030/033 pattern).
  perform set_config('evoforge.spend_authorized', 'palette:' || p_palette, true);

  insert into public.coin_events (user_id, kind, amount, source_table, source_id)
  values (auth.uid(), 'spend', -v_price, 'user_palette_unlocks', 'palette:' || p_palette)
  returning id into v_event;

  insert into public.user_palette_unlocks (user_id, palette, coin_event_id)
  values (auth.uid(), p_palette, v_event);

  return jsonb_build_object('price', v_price, 'balance', v_balance - v_price);
end;
$$;

revoke all on function public.purchase_palette(text) from public;
grant execute on function public.purchase_palette(text) to authenticated;

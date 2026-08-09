-- EvoForge 167 — FINISH THE BOARD RETIREMENT.
--
-- 162 dropped everything that could take or pay a coin, and its guard confirmed
-- that by checking a LIST of ten function names. Five survived, because they were
-- not on the list:
--
--   forge_drop_fetch(uuid)              read a settled drop
--   forge_drop_fetch_many(uuid[])       read several
--   forge_drop_settings()               read the board config
--   forge_drop_xp_for(numeric,          a pure XP calculator, which takes a
--                     numeric, numeric)   MULTIPLIER as an argument
--   forge_drop_xp_today(uuid)           read today's drop XP
--
-- NONE OF THEM CAN MOVE A COIN — 162 removed every path that could, so the
-- balance-decrease invariant was never in question. What they are is dead surface
-- still granted to `authenticated`, and one of them takes a multiplier, which is
-- precisely the shape that should not be callable in a product that has just
-- retired multipliers.
--
-- THE LESSON IS THE GUARD, NOT THE FUNCTIONS. A check written as a list passes as
-- soon as the list is complete, which is not the same as the property being true.
-- The check below matches the PATTERN instead, so anything named for the board has
-- to be deliberately exempted rather than merely forgotten.

begin;

drop function if exists public.forge_drop_fetch(uuid);
drop function if exists public.forge_drop_fetch_many(uuid[]);
drop function if exists public.forge_drop_settings();
drop function if exists public.forge_drop_xp_for(numeric, numeric, numeric);
drop function if exists public.forge_drop_xp_today(uuid);

-- ─────────────────────── PROVEN BY PATTERN, NOT BY LIST

do $$
declare survivor text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
    into survivor
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'forge\_drop%';
  if survivor is not null then
    raise exception 'the retired board still exposes: %', survivor;
  end if;

  -- The history is still readable. Retiring a mechanic must not erase what it did.
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'forge_drops') then
    raise exception 'forge_drops was dropped — settled drops in coin_events are orphans';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint
      where conname = 'coin_events_kind_check')) not like '%forge_drop_stake%' then
    raise exception 'forge_drop_stake is no longer spellable — existing ledger rows are invalid';
  end if;
end $$;

commit;

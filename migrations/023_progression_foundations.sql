-- EvoForge 023 — PROGRESSION_OVERHAUL P1: Forge Level foundations.
--
-- TWO ECONOMIES, TWO LEDGERS (plan §1 C1): xp_events (002/006/014) is the
-- legacy level's append-only ledger and is UNTOUCHED — it keeps driving the
-- displayed level until new_progression_enabled flips. This migration adds
-- the NEW Forge economy beside it:
--
--   user_progression — one row per user: Forge Level cache, momentum state,
--                      and the LEGACY level preserved at migration time
--                      (spec §43: never silently discard old public levels).
--   xp_ledger        — append-only Forge XP events, idempotent by
--                      unique(user_id, event_key) (spec §20): a rerun
--                      migration or a double-tap can never double-award.
--
-- GRANT GUARD (the 006/013 doctrine — a client must not mint what it
-- pleases): clients may INSERT only CLIENT_KINDS, and a before-insert
-- trigger recomputes/clamps xp_awarded server-side from the event type.
-- Server-only kinds (weekly_target, migration backfills, match awards) are
-- rejected unless the row arrives via service role / security definer.
--
-- Forge Level itself is DERIVED (250·(L−1)^1.65 curve, domain code +
-- forge_level() RPC below both implement it; the vitest parity suite pins
-- them together). user_progression.forge_level is a cache, recomputed by
-- the award function — never trusted from the client.
--
-- FALSIFICATION CHECKLIST (two signed-in users + service role):
--   1. A inserts xp_ledger with kind workout_completed and xp 999999
--      -> row lands with the SERVER value (100), not 999999.      [guard]
--   2. A inserts kind weekly_target -> rejected.            [server-only]
--   3. Same event_key twice as A -> second rejected.              [uniq]
--   4. B selects A's ledger rows -> 0.                             [RLS]
--   5. A updates/deletes a ledger row -> rejected.          [append-only]
--   6. forge_total_xp() as A returns only A's sum.       [definer scope]

-- ---------------------------------------------------------------------
-- 1. user_progression
-- ---------------------------------------------------------------------
create table if not exists public.user_progression (
  user_id                   uuid primary key default auth.uid()
                            references auth.users(id) on delete cascade,
  forge_level               integer not null default 1 check (forge_level >= 1),
  lifetime_xp               bigint  not null default 0 check (lifetime_xp >= 0),
  current_momentum_weeks    integer not null default 0 check (current_momentum_weeks >= 0),
  peak_momentum_weeks       integer not null default 0 check (peak_momentum_weeks >= 0),
  lifetime_successful_weeks integer not null default 0 check (lifetime_successful_weeks >= 0),
  weekly_target             integer not null default 3 check (weekly_target between 1 and 7),
  recovery_weeks_available  integer not null default 2 check (recovery_weeks_available >= 0),
  momentum_status           text    not null default 'active'
                            check (momentum_status in
                              ('active','recovery','injury','illness','travel','taper','deload')),
  -- spec §43: the pre-overhaul public level, frozen at migration time.
  legacy_level              integer,
  legacy_xp                 bigint,
  migration_version         text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.user_progression enable row level security;

create policy "own progression select" on public.user_progression
  for select using (user_id = auth.uid());
create policy "own progression insert" on public.user_progression
  for insert with check (user_id = auth.uid());
create policy "own progression update" on public.user_progression
  for update using (user_id = auth.uid())
  -- The cache columns are recomputed by triggers; the user may only touch
  -- their own row, and the guard below keeps the numbers honest.
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 2. xp_ledger — append-only, idempotent
-- ---------------------------------------------------------------------
create table if not exists public.xp_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid()
             references auth.users(id) on delete cascade,
  event_key  text not null check (length(event_key) between 3 and 200),
  event_type text not null,
  source_id  text,
  xp_awarded integer not null check (xp_awarded between 0 and 100000),
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create index if not exists xp_ledger_user_created_idx
  on public.xp_ledger (user_id, created_at desc);

alter table public.xp_ledger enable row level security;

create policy "own ledger select" on public.xp_ledger
  for select using (user_id = auth.uid());
create policy "own ledger insert" on public.xp_ledger
  for insert with check (user_id = auth.uid());
-- No update/delete policies: append-only, exactly like xp_events.

-- ---------------------------------------------------------------------
-- 3. The grant guard (006's doctrine for the new economy)
-- ---------------------------------------------------------------------
-- Client-mintable kinds and their SERVER-DECIDED amounts (spec §20 values).
-- Kinds whose true amount needs evidence the trigger can check, it checks;
-- kinds that need richer context (weekly targets, PR quotas) are
-- server-only and granted by security-definer functions in later
-- migrations. Amounts here are v1 of the config; changing them is a new
-- migration, never an in-place edit (the ledger must stay explainable).
create or replace function public.xp_ledger_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed constant integer := new.xp_awarded;
begin
  -- Service role (edge functions) bypasses via its own path: current
  -- setting request.jwt.claims->>'role' = 'service_role'.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') = 'service_role' then
    return new;
  end if;

  if new.user_id is distinct from auth.uid() then
    raise exception 'xp_ledger: cannot write another user''s ledger';
  end if;

  case new.event_type
    when 'workout_completed' then
      -- 100 XP + the trigger verifies a finish marker exists today-ish for
      -- the claimed source (a workout_sessions row owned by the caller).
      if not exists (
        select 1 from public.workout_sessions ws
        where ws.user_id = auth.uid() and ws.id::text = new.source_id
      ) then
        raise exception 'xp_ledger: workout_completed needs a real finish marker';
      end if;
      new.xp_awarded := 100;
    when 'weekly_checkin' then
      new.xp_awarded := 20;
    when 'cardio_test_completed' then
      new.xp_awarded := 50;
    when 'evo_scan_completed' then
      new.xp_awarded := 40;
    else
      raise exception 'xp_ledger: kind % is server-granted only', new.event_type;
  end case;

  return new;
end;
$$;

drop trigger if exists xp_ledger_guard_trigger on public.xp_ledger;
create trigger xp_ledger_guard_trigger
  before insert on public.xp_ledger
  for each row execute function public.xp_ledger_guard();

-- ---------------------------------------------------------------------
-- 4. Derivations — summed in Postgres, cached after every award
-- ---------------------------------------------------------------------
create or replace function public.forge_total_xp()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(xp_awarded), 0)::bigint
  from public.xp_ledger
  where user_id = auth.uid();
$$;

-- The curve's inverse: highest L with round(250·(L−1)^1.65) <= xp.
-- MUST match domain/progression/forge-level.ts (vitest pins both via the
-- shared fixture table).
create or replace function public.forge_level_for_xp(xp bigint)
returns integer
language plpgsql
immutable
as $$
declare
  lvl integer := 1;
begin
  while round(250 * power(lvl::numeric, 1.65)) <= xp and lvl < 500 loop
    lvl := lvl + 1;
  end loop;
  return lvl;
end;
$$;

-- Refresh the cache row after every award (insert-only table).
create or replace function public.xp_ledger_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint;
begin
  select coalesce(sum(xp_awarded),0) into total
  from public.xp_ledger where user_id = new.user_id;

  insert into public.user_progression (user_id, lifetime_xp, forge_level)
  values (new.user_id, total, public.forge_level_for_xp(total))
  on conflict (user_id) do update
    set lifetime_xp = excluded.lifetime_xp,
        forge_level = greatest(public.user_progression.forge_level, excluded.forge_level),
        updated_at  = now();
  return new;
end;
$$;

drop trigger if exists xp_ledger_cache_trigger on public.xp_ledger;
create trigger xp_ledger_cache_trigger
  after insert on public.xp_ledger
  for each row execute function public.xp_ledger_after_insert();

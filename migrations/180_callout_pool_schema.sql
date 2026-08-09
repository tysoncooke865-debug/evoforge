-- EvoForge 180 - THE POOL, PART 1: SCHEMA ONLY. (Spec v5 §4/§5.)
--
-- "50 says I hit this." Today exactly one person can answer that. This is the
-- schema for letting others in: the athlete pledges on their own planned set, and
-- friends BACK them or PUSH against them, unequal amounts, proportional split.
--
-- Tyson chose this on 2026-08-09 after I put the alternative to him. Recorded as a
-- product decision and named plainly for review: it is skill-resolved with zero RNG
-- and the money walls hold, so it trips NEITHER governing invariant - but it is
-- third parties putting coins on another person's athletic performance, and that is
-- the closest thing in this app to a book. It should be reviewed as such rather
-- than discovered.
--
-- ── WHY THIS IS A REWRITE AND NOT THE FILES THAT ALREADY EXISTED ──
--
-- Five migrations for this were written in the `hitdoubt-pot` worktree, 2,803
-- lines, never applied. They cannot be. They reference `hit_probability` (dropped
-- by 163 - §10 bans odds), `workout_callouts_one_live` (replaced by
-- `..._one_live_per_set` in 172), and `forge_drop_play` (dropped by 162/167 with
-- the staked board). Applying them would fail partway through a five-file sequence,
-- which is the worst state a live pledge table can be in. They are left where they
-- are as design notes.
--
-- ── THE ONE DECISION THAT SHAPES EVERYTHING: `opponent_id` STAYS NOT NULL ──
--
-- A pot is not a new kind of row. It is an ordinary call out that others may join.
-- The athlete still names one opponent, both still stake, and every function
-- written since 150 keeps working untouched because `mode` defaults to 'duel'.
--
-- So `workout_callout_entries` holds ONLY the additional joiners - never the two
-- principals. Their stakes already live on the callout row, and copying them into a
-- second table would create two places that must agree about money. The pools are
-- therefore:
--
--     BACK  = callout.stake + sum(entries where side = 'back')
--     PUSH  = callout.stake + sum(entries where side = 'push')
--
-- With no entries that is exactly today's 1v1, arithmetic unchanged. That property
-- is asserted at the bottom of this file, because it is what makes this migration
-- safe to apply to a table with live rows in it.
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ──
--
-- No joining, no escrow, no settlement. There is NO INSERT POLICY on the entries
-- table, so nothing can put a row in it from a client: joining moves coins, and a
-- direct insert would let somebody join a pool without paying for it. That belongs
-- to `callout_pool_join` in 181, as one atomic definer function.
--
-- The table is inert until then, and that is intentional rather than a half-build:
-- the structural rules are provable now, on their own, without money in play.

begin;

-- ─────────────────────────────────────────────────────────────── mode

alter table public.workout_callouts
  add column if not exists mode text not null default 'duel';

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.workout_callouts'::regclass
                   and conname = 'workout_callouts_mode_check') then
    alter table public.workout_callouts
      add constraint workout_callouts_mode_check check (mode in ('duel', 'pot'));
  end if;
end $$;

comment on column public.workout_callouts.mode is
  '''duel'' (150s, athlete + one opponent) or ''pot'' (180, others may join via '
  'workout_callout_entries). Defaults to ''duel'' so every pre-180 row and every '
  'function written against it behaves identically.';

-- ───────────────────────────────────────────────────────────── the entries

create table if not exists public.workout_callout_entries (
  id uuid primary key default gen_random_uuid(),
  callout_id uuid not null references public.workout_callouts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- BACK: with the athlete, they make the target. PUSH: against it.
  -- The words are §10's sanctioned pair; HIT/DOUBT is banned vocabulary.
  side text not null check (side in ('back', 'push')),
  stake integer not null check (stake > 0),
  joined_at timestamptz not null default now(),
  -- Written by settlement (183), never by a client. NULL until then.
  payout integer,
  settled_at timestamptz,
  -- ONE POSITION PER PERSON PER POOL. Not one per side: letting somebody hold
  -- both sides makes them whole whatever happens, which is not a position at
  -- all - it is a way to move coins between two accounts you control.
  constraint workout_callout_entries_one_per_user unique (callout_id, user_id),
  constraint workout_callout_entries_payout_sane check (payout is null or payout >= 0)
);

comment on table public.workout_callout_entries is
  'Additional participants in a ''pot'' call out (180). The athlete and the primary '
  'opponent are NEVER in here - their stakes live on the callout row, and the pools '
  'are callout.stake plus the entries on each side.';

create index if not exists workout_callout_entries_callout
  on public.workout_callout_entries (callout_id);
create index if not exists workout_callout_entries_user
  on public.workout_callout_entries (user_id, joined_at desc);

-- ─────────────────────────────────────────────── who may see what

/**
 * IS THIS PERSON IN THIS POOL AT ALL?
 *
 * SECURITY DEFINER on purpose, and it is what keeps the two policies below from
 * recursing: `workout_callouts`'s policy needs to ask about entries, and the
 * entries policy needs to ask about the callout. Inside a definer function RLS
 * does not re-enter, so each question is answered once.
 */
create or replace function public.is_callout_participant(p_callout uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.workout_callouts c
    where c.id = p_callout and (c.athlete_id = p_user or c.opponent_id = p_user)
  ) or exists (
    select 1 from public.workout_callout_entries e
    where e.callout_id = p_callout and e.user_id = p_user
  );
$$;
revoke execute on function public.is_callout_participant(uuid, uuid) from public, anon;
grant execute on function public.is_callout_participant(uuid, uuid) to authenticated;

alter table public.workout_callout_entries enable row level security;

-- READ: everybody in the pool sees every position in it. A pool whose sides are
-- hidden cannot be rendered as two pans, and §5 requires every ingot to carry
-- owner identification - an anonymous pool is explicitly not the design.
drop policy if exists workout_callout_entries_participant_select on public.workout_callout_entries;
create policy workout_callout_entries_participant_select on public.workout_callout_entries
  for select using (public.is_callout_participant(callout_id, auth.uid()));

-- NO INSERT, UPDATE OR DELETE POLICY. Joining moves coins; leaving would move
-- them back. Both belong to a definer function (181), and the absence of these
-- policies is the enforcement, not an omission.

-- THE CALLOUT ITSELF becomes readable by a joiner. Without this a joiner could
-- see their own entry and not the proposition it is attached to.
drop policy if exists workout_callouts_participant_select on public.workout_callouts;
create policy workout_callouts_participant_select on public.workout_callouts
  for select using (
    athlete_id = auth.uid()
    or opponent_id = auth.uid()
    or exists (
      select 1 from public.workout_callout_entries e
      where e.callout_id = workout_callouts.id and e.user_id = auth.uid()
    )
  );

-- ────────────────────────────────────── the rules, as a trigger

/**
 * EVERY STRUCTURAL RULE ABOUT AN ENTRY, IN ONE PLACE.
 *
 * NO service_role BYPASS, unlike the guards that have one. Those exist because
 * settlement has to write rows a client may not. Nothing here is about who is
 * asking - a pot entry on a 'duel' row, or on a settled set, or belonging to the
 * athlete themselves, is malformed no matter which role wrote it. A bypass would
 * only ever let a bug through.
 */
create or replace function public.callout_entry_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.workout_callouts;
  n int;
begin
  select * into c from public.workout_callouts where id = new.callout_id;
  if c.id is null then
    raise exception 'callout_entry: that call out does not exist.' using errcode = 'foreign_key_violation';
  end if;

  -- 1. POOLS ARE OPT-IN, PER CALL OUT. A 'duel' is a matched pair and stays one.
  if c.mode <> 'pot' then
    raise exception 'callout_entry: this call out is one-on-one, not a pool.'
      using errcode = 'check_violation';
  end if;

  -- 2. THE PRINCIPALS ARE NOT ENTRIES. Their stakes are on the callout row, and
  --    a second copy is a second source of truth about money.
  if new.user_id = c.athlete_id then
    raise exception 'callout_entry: you are the athlete - your pledge is the call out itself.'
      using errcode = 'check_violation';
  end if;
  if new.user_id = c.opponent_id then
    raise exception 'callout_entry: you already answered this call out.'
      using errcode = 'check_violation';
  end if;

  -- 3. ONLY WHILE IT IS STILL OPEN. Joining a set that is already logged is
  --    backing a result you can read, which is not a prediction.
  if c.status not in ('offered', 'accepted') then
    raise exception 'callout_entry: this call out is % - too late to join.', c.status
      using errcode = 'check_violation';
  end if;
  if c.set_logged_at is not null or c.result is not null then
    raise exception 'callout_entry: that set is already done.' using errcode = 'check_violation';
  end if;

  -- 4. EIGHT PEOPLE MAXIMUM (§4): the athlete, the opponent, and six others.
  select count(*) into n from public.workout_callout_entries e where e.callout_id = new.callout_id;
  if n >= 6 then
    raise exception 'callout_entry: this pool is full.' using errcode = 'check_violation';
  end if;

  -- 5. THE SAME PER-PLEDGE CEILING EVERY OTHER PLEDGE HAS. `max_stake` from
  --    config, so a joiner cannot exceed what the athlete themselves could.
  if new.stake > (select max_stake from public.workout_callout_config where id) then
    raise exception 'callout_entry: % is over the limit for a single pledge.', new.stake
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists callout_entry_guard_bi on public.workout_callout_entries;
create trigger callout_entry_guard_bi
  before insert on public.workout_callout_entries
  for each row execute function public.callout_entry_guard();

-- ────────────────────────────────────────────── the pools, read once

/**
 * WHAT IS ON EACH SIDE, INCLUDING THE PRINCIPALS.
 *
 * The single definition of the pool arithmetic. Settlement (183), the tray and the
 * balance-scale renderer all read this, so there is one place that knows a pool is
 * "the callout stake plus the entries on that side" - and no second implementation
 * to disagree with it.
 *
 * A 'duel' answers honestly too: stake on each side, no entries, total stake * 2,
 * which is exactly what 1v1 settlement already pays.
 */
create or replace function public.callout_pool(p_callout uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c public.workout_callouts;
  back_extra int;
  push_extra int;
begin
  select * into c from public.workout_callouts where id = p_callout;
  if c.id is null then
    return null;
  end if;
  if auth.uid() is not null and not public.is_callout_participant(p_callout, auth.uid()) then
    raise exception 'callout_pool: that is not your call out.' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(e.stake) filter (where e.side = 'back'), 0),
         coalesce(sum(e.stake) filter (where e.side = 'push'), 0)
    into back_extra, push_extra
  from public.workout_callout_entries e where e.callout_id = p_callout;

  return jsonb_build_object(
    'mode', c.mode,
    -- The athlete is always on BACK; they said they would do it.
    'back', c.stake + back_extra,
    'push', c.stake + push_extra,
    'total', (c.stake + back_extra) + (c.stake + push_extra),
    'joiners', (select count(*) from public.workout_callout_entries e where e.callout_id = p_callout));
end;
$$;
revoke execute on function public.callout_pool(uuid) from public, anon;
grant execute on function public.callout_pool(uuid) to authenticated;

-- ─────────── PROVEN: live rows unchanged, and every rule refuses

do $$
declare
  live_id uuid;
  live_stake int;
  pool jsonb;
  ath uuid; opp uuid; other uuid;
  ok boolean;
  n int;
begin
  -- 1. EVERY EXISTING ROW IS STILL A DUEL. This is the property that makes the
  --    migration safe on a table with real pledges in it.
  select count(*) into n from public.workout_callouts where mode <> 'duel';
  if n <> 0 then raise exception '% existing rows are not duels', n; end if;

  select id, stake, athlete_id, opponent_id into live_id, live_stake, ath, opp
  from public.workout_callouts order by created_at desc limit 1;
  if live_id is null then raise notice 'no call outs yet - skipping the live checks'; return; end if;

  -- 2. A DUEL'S ARITHMETIC IS UNTOUCHED: stake each side, total twice the stake.
  pool := public.callout_pool(live_id);
  if (pool ->> 'back')::int <> live_stake
     or (pool ->> 'push')::int <> live_stake
     or (pool ->> 'total')::int <> live_stake * 2 then
    raise exception 'a duel pool no longer reads as a matched pair: %', pool;
  end if;

  -- 3. NO ENTRY MAY ATTACH TO A DUEL.
  select u.id into other from auth.users u where u.id not in (ath, opp) limit 1;
  ok := false;
  begin
    insert into public.workout_callout_entries (callout_id, user_id, side, stake)
    values (live_id, other, 'back', 10);
    raise exception 'an entry attached to a duel';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'the duel-only rule did not fire'; end if;

  -- 4. AND ON A POT, THE PRINCIPALS ARE STILL REFUSED.
  update public.workout_callouts set mode = 'pot' where id = live_id;
  begin
    ok := false;
    begin
      insert into public.workout_callout_entries (callout_id, user_id, side, stake)
      values (live_id, ath, 'back', 10);
      raise exception 'the athlete was allowed to double up as an entry';
    exception when check_violation then ok := true;
    end;
    if not ok then raise exception 'the athlete rule did not fire'; end if;

    ok := false;
    begin
      insert into public.workout_callout_entries (callout_id, user_id, side, stake)
      values (live_id, opp, 'push', 10);
      raise exception 'the opponent was allowed a second position';
    exception when check_violation then ok := true;
    end;
    if not ok then raise exception 'the opponent rule did not fire'; end if;

    -- 5. A REAL JOINER CHANGES ONE SIDE AND ONLY ONE SIDE.
    if other is not null and (select status from public.workout_callouts where id = live_id)
         in ('offered', 'accepted') then
      insert into public.workout_callout_entries (callout_id, user_id, side, stake)
      values (live_id, other, 'push', 25);
      pool := public.callout_pool(live_id);
      if (pool ->> 'back')::int <> live_stake then
        raise exception 'a PUSH joiner moved the BACK pool: %', pool;
      end if;
      if (pool ->> 'push')::int <> live_stake + 25 then
        raise exception 'a PUSH joiner did not land on the PUSH pool: %', pool;
      end if;

      -- 6. AND THEY CANNOT HOLD BOTH SIDES.
      ok := false;
      begin
        insert into public.workout_callout_entries (callout_id, user_id, side, stake)
        values (live_id, other, 'back', 25);
        raise exception 'one person took both sides of the same pool';
      exception when unique_violation then ok := true;
      end;
      if not ok then raise exception 'the one-position rule did not fire'; end if;

      delete from public.workout_callout_entries where callout_id = live_id;
    end if;
  exception when others then
    -- Never leave a real row flipped to 'pot' because a probe failed.
    update public.workout_callouts set mode = 'duel' where id = live_id;
    delete from public.workout_callout_entries where callout_id = live_id;
    raise;
  end;

  update public.workout_callouts set mode = 'duel' where id = live_id;
  delete from public.workout_callout_entries where callout_id = live_id;
  raise notice 'pool schema proven; live rows left as duels';
end $$;

commit;

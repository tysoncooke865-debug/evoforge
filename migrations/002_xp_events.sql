-- EvoForge 002 — the append-only XP ledger
--
-- ###########################################################################
-- #  NOT APPLIED. NOT READ BY THE APP.                                      #
-- #                                                                         #
-- #  XP is still DERIVED from workout_log + cardio_log on every render, by  #
-- #  domain/xp.py. That is correct and idempotent, but it has no timestamps #
-- #  and no anti-cheat: the score is a pure function of rows the user can   #
-- #  insert at will, with any `date` they like.                             #
-- #                                                                         #
-- #  Apply this BEFORE building leaderboards, seasons or PvP. Not before.   #
-- #  Depends on migrations/001 (user_id + RLS).                             #
-- ###########################################################################
--
-- WHY A LEDGER
--   Derived XP answers "how much?" but never "when?" or "from what?". Streaks
--   need timestamps. Anti-cheat needs to know an event was granted once, by the
--   server, for a specific source row. A recomputed aggregate can be inflated by
--   back-dating a workout; an append-only ledger cannot be edited at all.
--
-- THE INVARIANT, which tools/verify_xp.py already asserts against domain/xp.py:
--   sum(xp_events.amount) for a user == the XP that domain/xp.py's curve says
--   they need to reach their level, plus their progress into it.


-- ===========================================================================
-- STEP 1 — the table
-- ===========================================================================
create table if not exists public.xp_events (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null default auth.uid() references auth.users(id) on delete cascade,

  -- 'set' | 'cardio' | 'achievement' | 'adjustment'
  kind         text        not null,

  -- Signed. An 'adjustment' may be negative; nothing else should be.
  amount       integer     not null check (amount <> 0),

  -- What produced this event, so it can be granted exactly once.
  source_table text,
  source_id    uuid,

  created_at   timestamptz not null default now()
);

-- Reads are always "this user's events, in time order".
create index if not exists xp_events_user_created_idx
  on public.xp_events (user_id, created_at);

-- IDEMPOTENCE. The same workout_log row must never mint XP twice, however many
-- times a backfill is re-run or a render recomputes. Partial, because
-- 'adjustment' events have no source row.
create unique index if not exists xp_events_source_uidx
  on public.xp_events (user_id, source_table, source_id)
  where source_id is not null;


-- ===========================================================================
-- STEP 2 — row-level security, and append-only by construction
--
-- A user gets SELECT and INSERT policies. They get NO update policy and NO
-- delete policy, so RLS refuses both: the ledger is append-only for users
-- without needing a trigger. `service_role` bypasses RLS and can still correct
-- a mistake.
--
-- `with check (user_id = auth.uid())` is what stops a user inserting XP events
-- owned by someone else. Without it, `using` alone would let them.
-- ===========================================================================
alter table public.xp_events enable row level security;

drop policy if exists xp_events_owner_select on public.xp_events;
create policy xp_events_owner_select on public.xp_events
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists xp_events_owner_insert on public.xp_events;
create policy xp_events_owner_insert on public.xp_events
  for insert to authenticated
  with check (user_id = auth.uid());

-- Deliberately absent: xp_events_owner_update, xp_events_owner_delete.


-- ===========================================================================
-- STEP 3 — backfill from the derived model
--
-- Mirrors domain/xp.py exactly: a set is XP_PER_SET (10), a cardio minute is
-- XP_PER_CARDIO_MINUTE (2). If those constants change, this backfill is wrong.
-- Re-runnable: the unique index on (user_id, source_table, source_id) makes a
-- second run a no-op rather than a doubling.
--
-- `workout_summary()` counts only sets with weight > 0 AND reps > 0. Same here.
-- ===========================================================================
insert into public.xp_events (user_id, kind, amount, source_table, source_id, created_at)
select w.user_id, 'set', 10, 'workout_log', w.id, w."timestamp"
from public.workout_log w
where w.weight > 0 and w.reps > 0
on conflict do nothing;

-- Cardio is minutes * 2, rounded down, and skipped when it would be 0.
insert into public.xp_events (user_id, kind, amount, source_table, source_id, created_at)
select c.user_id, 'cardio', floor(c.minutes * 2)::int, 'cardio_log', c.id, c."timestamp"
from public.cardio_log c
where c.minutes is not null and floor(c.minutes * 2)::int > 0
on conflict do nothing;


-- ===========================================================================
-- STEP 4 — reconcile against the derived model before trusting the ledger
--
-- These two numbers must match, per user. If they do not, STOP: the ledger and
-- domain/xp.py disagree, and shipping a leaderboard on either would be a guess.
-- ===========================================================================
with ledger as (
  select user_id, sum(amount) as ledger_xp
  from public.xp_events
  group by user_id
),
derived as (
  select user_id, sum(10) as derived_xp
  from public.workout_log
  where weight > 0 and reps > 0
  group by user_id
),
derived_cardio as (
  select user_id, sum(floor(minutes * 2)::int) as derived_xp
  from public.cardio_log
  where minutes is not null and floor(minutes * 2)::int > 0
  group by user_id
)
select coalesce(l.user_id, d.user_id)                          as user_id,
       l.ledger_xp,
       coalesce(d.derived_xp, 0) + coalesce(dc.derived_xp, 0)  as derived_xp,
       l.ledger_xp = coalesce(d.derived_xp, 0) + coalesce(dc.derived_xp, 0) as reconciles
from ledger l
full outer join derived d          on d.user_id  = l.user_id
left join derived_cardio dc        on dc.user_id = coalesce(l.user_id, d.user_id)
order by 1;
-- Every row must show reconciles = true.


-- ===========================================================================
-- AFTER THIS RUNS
--
-- The application still ignores xp_events. Switching it over is a code change,
-- not a migration:
--
--   1. `domain/workouts.py :: save_set_auto()` inserts an xp_event alongside the
--      workout_log row. The unique index makes a retry safe.
--   2. `domain/xp.py` grows `level_from_ledger(base_level, ledger_sum)` — the
--      same curve, a different input.
--   3. `workout_summary()` reads the ledger sum instead of counting rows.
--   4. tools/verify_xp.py grows a check that the two agree.
--
-- Keep the derived path as the reconciliation oracle. It is the only thing that
-- can tell you the ledger has drifted.
-- ===========================================================================

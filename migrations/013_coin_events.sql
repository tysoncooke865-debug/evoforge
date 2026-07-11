-- EvoForge 013 — the coin ledger (IMPROVEMENT_PLAN #12). MUST RUN AFTER 012
-- (the guard calls scheduled_streak()).
--
-- A SEPARATE ledger from xp_events on purpose: xp_total() sums its whole
-- table (mixing currencies would corrupt levels), and coins will one day
-- need spend semantics XP never has. Same construction as 002/006:
-- append-only by policy absence, dedupe by partial unique index, amounts
-- ALWAYS recomputed server-side in a BEFORE INSERT guard — the client's
-- amount is ignored. NO CLAWBACK on edits/deletes, mirroring XP: the guard
-- proves every row against data as it existed at claim time.
--
-- Trust posture (identical to 006): workout_log is user-writable, so
-- fabricated sets earn coins as they earn XP. The guard stops free MINTING,
-- not fabricated training (CLAUDE.md problem #7 remains the pre-PvP task).
--
-- Falsification checklist (smoke JWT):
--   (a) insert kind='adjustment'                     -> rejected
--   (b) insert kind='spend'                          -> rejected
--   (c) insert kind='pr' on a non-PR row             -> rejected
--   (d) insert kind='pr' amount=999999 on a real PR  -> stored amount = 50
--   (e) insert kind='workout_complete' with < 10 valid sets that date -> rejected
--   (f) duplicate any accepted claim                 -> unique violation
--   (g) kind='starting_bonus' twice                  -> second is unique violation
--   (h) cross-user SELECT (other JWT)                -> zero rows, with a
--       populated positive control on the owner

create table if not exists public.coin_events (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  kind         text        not null check (kind in
                 ('workout_complete', 'pr', 'streak_milestone', 'starting_bonus', 'adjustment', 'spend')),
  amount       integer     not null check (amount <> 0),
  source_table text,
  -- text, not uuid: dates ('2026-07-12') and composite milestone keys
  -- ('7:2026-07-06') are legitimate sources.
  source_id    text,
  created_at   timestamptz not null default now()
);

create index if not exists coin_events_user_created_idx
  on public.coin_events (user_id, created_at);

create unique index if not exists coin_events_source_uidx
  on public.coin_events (user_id, kind, source_id)
  where source_id is not null;

alter table public.coin_events enable row level security;

drop policy if exists coin_events_owner_select on public.coin_events;
create policy coin_events_owner_select on public.coin_events
  for select to authenticated using (user_id = auth.uid());

drop policy if exists coin_events_owner_insert on public.coin_events;
create policy coin_events_owner_insert on public.coin_events
  for insert to authenticated with check (user_id = auth.uid());

-- Deliberately absent: update/delete policies. Append-only.

create or replace function public.coin_total()
returns integer
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)::int from public.coin_events where user_id = auth.uid();
$$;

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

  if new.kind = 'workout_complete' then
    -- source_id is the local date string. Server floor: >= 10 valid sets.
    -- Deliberately NOT "all planned sets": encoding the pinned ROUTINE
    -- catalog into a trigger would create a second parity surface.
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
    -- A PRIOR BEST MUST EXIST: the first-ever set of a new exercise never
    -- pays (blocks farming the ~70-exercise catalog for free PRs).
    if prior_best is null or row_e1rm <= prior_best then
      raise exception 'coin_events: that set is not a PR.' using errcode = 'check_violation';
    end if;
    new.amount := 50;
    new.source_table := 'workout_log';
    return new;

  elsif new.kind = 'streak_milestone' then
    -- source_id = '{M}:{run_start}', M in the milestone set. Recompute
    -- server-side as-of today AND tomorrow (client tz skew tolerance).
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

drop trigger if exists coin_events_guard_bi on public.coin_events;
create trigger coin_events_guard_bi
  before insert on public.coin_events
  for each row execute function public.coin_events_guard();

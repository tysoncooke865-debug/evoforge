-- EvoForge 009 — Battle Arena: tables, RLS, guards, realtime
--
-- Plan of record: BATTLE_ARENA_DESIGN.md (§3 schema, §10 anti-cheat).
-- ADDITIVE ONLY: no existing table changes shape. Streamlit never sees any
-- of this. The one existing object touched is xp_events_guard() (006),
-- which gains a 'battle' branch — the set/cardio branches are reproduced
-- VERBATIM below; if 006 changes, this file must be regenerated with it.
--
-- Trust model, same doctrine as 001–006:
--   * Owner-only by default. Cross-user visibility exists ONLY between the
--     two participants of a match, ONLY via is_battle_participant(), and
--     exposes ONLY arena data (snapshot/events/scores) — never body data.
--   * Authoritative tables (matches, participants, rounds, scores, media,
--     ratings) have NO authenticated write policies at all: only edge
--     functions holding the service key can write them. The client never
--     decides scores, winners or ratings — RLS enforces it even against a
--     buggy function.
--   * battle_events is the ONE thing athletes write, append-only, and a
--     BEFORE INSERT trigger (the 006 pattern) rebuilds each event payload
--     from a real owned log row inside the round window — the client's
--     payload is discarded entirely.

-- ===========================================================================
-- STEP 1 — the participant test (breaks RLS recursion, feeds storage policy)
-- ===========================================================================
create or replace function public.is_battle_participant(m uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.battle_participants p
    where p.match_id = m and p.user_id = auth.uid()
  );
$$;

revoke all on function public.is_battle_participant(uuid) from anon;

-- ===========================================================================
-- STEP 2 — tables
-- ===========================================================================
create table if not exists public.battle_seasons (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  is_active  boolean     not null default false
);

create table if not exists public.battle_ratings (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  season_id  uuid        not null references public.battle_seasons(id),
  rating     integer     not null default 1000 check (rating >= 0),
  wins       integer     not null default 0,
  losses     integer     not null default 0,
  streak     integer     not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, season_id)
);

create table if not exists public.battle_queue (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  mode        text        not null check (mode in ('quick', 'ranked')),
  level       integer     not null default 1,
  power       integer     not null default 0,
  rating      integer     not null default 1000,
  status      text        not null default 'waiting' check (status in ('waiting', 'matched', 'cancelled')),
  enqueued_at timestamptz not null default now(),
  unique (user_id, mode)          -- one live queue entry per mode
);

create index if not exists battle_queue_matchmaker_idx
  on public.battle_queue (mode, status, rating);

create table if not exists public.battle_matches (
  id             uuid        primary key default gen_random_uuid(),
  season_id      uuid        references public.battle_seasons(id),
  mode           text        not null check (mode in ('friendly', 'quick', 'ranked', 'ghost')),
  format         text        not null default 'blitz' check (format in ('blitz', 'full')),
  status         text        not null default 'inviting' check (status in
                   ('inviting', 'matched', 'active', 'judging', 'settled', 'abandoned')),
  invite_code    text        unique,       -- friendly only
  current_round  integer     not null default 0,
  winner_user_id uuid        references auth.users(id),
  settled_at     timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.battle_participants (
  match_id     uuid        not null references public.battle_matches(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  seat         integer     not null check (seat in (1, 2)),
  -- level / power / class / branch / rating / win_rate AT MATCH TIME.
  -- This snapshot is the ONLY cross-user data the arena exposes.
  snapshot     jsonb       not null,
  ready_at     timestamptz,
  total_score  integer,
  rating_delta integer,
  xp_awarded   integer,
  created_at   timestamptz not null default now(),
  primary key (match_id, user_id),
  unique (match_id, seat)
);

create table if not exists public.battle_rounds (
  match_id   uuid        not null references public.battle_matches(id) on delete cascade,
  round_no   integer     not null check (round_no in (1, 2, 3)),
  kind       text        not null check (kind in ('strength', 'cardio', 'physique')),
  -- Rolled by the server: object/challenge, targets (format-scaled), scale
  -- multiplier, pose, coefficient-table VERSION and RNG seed for audit.
  spec       jsonb       not null,
  starts_at  timestamptz,
  ends_at    timestamptz,
  status     text        not null default 'pending' check (status in
               ('pending', 'open', 'judging', 'scored')),
  primary key (match_id, round_no)
);

create table if not exists public.battle_events (
  id           uuid        primary key default gen_random_uuid(),
  match_id     uuid        not null references public.battle_matches(id) on delete cascade,
  user_id      uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  round_no     integer     not null,
  kind         text        not null check (kind in
                 ('volume', 'cardio', 'photo_hash', 'ready', 'forfeit', 'flag')),
  source_table text,
  source_id    uuid,
  payload      jsonb       not null default '{}'::jsonb,
  server_ts    timestamptz not null default now()
);

create index if not exists battle_events_replay_idx
  on public.battle_events (match_id, round_no, server_ts);

-- One log row counts once per match, however many times the client retries.
create unique index if not exists battle_events_source_uidx
  on public.battle_events (match_id, user_id, source_table, source_id)
  where source_id is not null;

create table if not exists public.battle_round_scores (
  match_id   uuid        not null references public.battle_matches(id) on delete cascade,
  round_no   integer     not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  components jsonb       not null,   -- completion/speed/variety/... breakdown
  points     integer     not null default 0,
  judged_at  timestamptz not null default now(),
  primary key (match_id, round_no, user_id)
);

create table if not exists public.battle_media (
  id           uuid        primary key default gen_random_uuid(),
  match_id     uuid        not null references public.battle_matches(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  round_no     integer     not null,
  sha256       text        not null,
  phash        text,
  pose         text,
  storage_path text,       -- battle-media/{match_id}/{user_id}/{round_no}.jpg
  verdict      jsonb,
  confidence   text,
  compliant    boolean,
  created_at   timestamptz not null default now()
);

-- Photo-reuse detection: the same image may never be entered twice by the
-- same athlete, in any match, ever.
create unique index if not exists battle_media_reuse_uidx
  on public.battle_media (user_id, sha256);

-- ===========================================================================
-- STEP 3 — RLS. Authoritative tables get NO authenticated write policies.
-- ===========================================================================
alter table public.battle_seasons      enable row level security;
alter table public.battle_ratings      enable row level security;
alter table public.battle_queue        enable row level security;
alter table public.battle_matches      enable row level security;
alter table public.battle_participants enable row level security;
alter table public.battle_rounds       enable row level security;
alter table public.battle_events       enable row level security;
alter table public.battle_round_scores enable row level security;
alter table public.battle_media        enable row level security;

drop policy if exists battle_seasons_read on public.battle_seasons;
create policy battle_seasons_read on public.battle_seasons
  for select to authenticated using (true);

drop policy if exists battle_ratings_owner_select on public.battle_ratings;
create policy battle_ratings_owner_select on public.battle_ratings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists battle_queue_owner_select on public.battle_queue;
create policy battle_queue_owner_select on public.battle_queue
  for select to authenticated using (user_id = auth.uid());
drop policy if exists battle_queue_owner_insert on public.battle_queue;
create policy battle_queue_owner_insert on public.battle_queue
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists battle_queue_owner_delete on public.battle_queue;
create policy battle_queue_owner_delete on public.battle_queue
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists battle_matches_participant_select on public.battle_matches;
create policy battle_matches_participant_select on public.battle_matches
  for select to authenticated using (public.is_battle_participant(id));

drop policy if exists battle_participants_participant_select on public.battle_participants;
create policy battle_participants_participant_select on public.battle_participants
  for select to authenticated using (public.is_battle_participant(match_id));

drop policy if exists battle_rounds_participant_select on public.battle_rounds;
create policy battle_rounds_participant_select on public.battle_rounds
  for select to authenticated using (public.is_battle_participant(match_id));

drop policy if exists battle_events_participant_select on public.battle_events;
create policy battle_events_participant_select on public.battle_events
  for select to authenticated using (public.is_battle_participant(match_id));
drop policy if exists battle_events_owner_insert on public.battle_events;
create policy battle_events_owner_insert on public.battle_events
  for insert to authenticated with check (user_id = auth.uid());
-- Deliberately absent: update/delete on battle_events — append-only, like
-- xp_events.

drop policy if exists battle_round_scores_participant_select on public.battle_round_scores;
create policy battle_round_scores_participant_select on public.battle_round_scores
  for select to authenticated using (public.is_battle_participant(match_id));

drop policy if exists battle_media_participant_select on public.battle_media;
create policy battle_media_participant_select on public.battle_media
  for select to authenticated using (public.is_battle_participant(match_id));

-- ===========================================================================
-- STEP 4 — the battle_events guard (006 pattern, applied to battles)
--
-- The client's payload is DISCARDED and rebuilt from the owned source row,
-- which must fall inside the open round's window. What settle later scores
-- is therefore what the athlete actually logged, when they logged it.
-- ===========================================================================
create or replace function public.battle_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r_starts timestamptz;
  r_ends   timestamptz;
  w record;
  c record;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if not public.is_battle_participant(new.match_id) then
    raise exception 'battle_events: not a participant of this match.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 'flag' and 'photo_hash' are written by the server only.
  if new.kind in ('flag', 'photo_hash') then
    raise exception 'battle_events: kind % may only be written by the server.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

  -- 'ready' and 'forfeit' need no source row; match must not be finished.
  if new.kind in ('ready', 'forfeit') then
    if not exists (
      select 1 from public.battle_matches m
      where m.id = new.match_id and m.status in ('matched', 'active')
    ) then
      raise exception 'battle_events: match is not accepting events.'
        using errcode = 'check_violation';
    end if;
    new.payload := '{}'::jsonb;
    new.source_table := null;
    new.source_id := null;
    return new;
  end if;

  -- volume / cardio: the round must be OPEN and inside its window.
  select r.starts_at, r.ends_at into r_starts, r_ends
  from public.battle_rounds r
  join public.battle_matches m on m.id = r.match_id
  where r.match_id = new.match_id and r.round_no = new.round_no
    and r.status = 'open' and m.status = 'active'
    and now() between r.starts_at and r.ends_at;
  if not found then
    raise exception 'battle_events: round % is not open.', new.round_no
      using errcode = 'check_violation';
  end if;

  if new.kind = 'volume' then
    select ww.exercise, ww.weight, ww.reps, ww."timestamp"
      into w
    from public.workout_log ww
    where ww.id = new.source_id and ww.user_id = auth.uid()
      and ww.weight > 0 and ww.reps > 0;
    if not found then
      raise exception 'battle_events: no matching owned workout_log row (%).', new.source_id
        using errcode = 'check_violation';
    end if;
    if w."timestamp" < r_starts or w."timestamp" > r_ends then
      raise exception 'battle_events: set was logged outside the round window.'
        using errcode = 'check_violation';
    end if;
    new.source_table := 'workout_log';
    new.payload := jsonb_build_object(
      'exercise', w.exercise, 'weight', w.weight, 'reps', w.reps,
      'logged_at', w."timestamp");
    return new;

  elsif new.kind = 'cardio' then
    select cc.type, cc.minutes, cc.distance_km, cc.incline, cc."timestamp"
      into c
    from public.cardio_log cc
    where cc.id = new.source_id and cc.user_id = auth.uid()
      and cc.minutes > 0;
    if not found then
      raise exception 'battle_events: no matching owned cardio_log row (%).', new.source_id
        using errcode = 'check_violation';
    end if;
    if c."timestamp" < r_starts or c."timestamp" > r_ends then
      raise exception 'battle_events: session was logged outside the round window.'
        using errcode = 'check_violation';
    end if;
    new.source_table := 'cardio_log';
    new.payload := jsonb_build_object(
      'type', c.type, 'minutes', c.minutes, 'distance_km', c.distance_km,
      'incline', c.incline, 'logged_at', c."timestamp");
    return new;
  end if;

  raise exception 'battle_events: unsupported kind %.', new.kind
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists battle_events_guard_bi on public.battle_events;
create trigger battle_events_guard_bi
  before insert on public.battle_events
  for each row execute function public.battle_events_guard();

-- ===========================================================================
-- STEP 5 — xp_events_guard gains the 'battle' kind
--
-- Full replacement of 006's function: set/cardio branches VERBATIM from 006,
-- plus 'battle' — amount recomputed from the caller's own participant row of
-- a SETTLED match, never taken from the client. The 002 unique index
-- (user_id, source_table, source_id) already makes the grant idempotent.
-- Normal path: battle-settle grants with the service key (early return);
-- this branch exists so a client can SELF-HEAL a missed grant and still
-- cannot mint.
-- ===========================================================================
create or replace function public.xp_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ok   boolean;
  mins numeric;
  battle_xp integer;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.kind = 'set' then
    select exists (
      select 1 from public.workout_log w
      where w.id = new.source_id
        and w.user_id = auth.uid()
        and w.weight > 0 and w.reps > 0
    ) into ok;
    if not ok then
      raise exception 'xp_events: no matching workout_log row for this set (%).', new.source_id
        using errcode = 'check_violation';
    end if;
    new.amount := 10;               -- domain/xp.py XP_PER_SET
    new.source_table := 'workout_log';
    return new;

  elsif new.kind = 'cardio' then
    select c.minutes into mins
    from public.cardio_log c
    where c.id = new.source_id and c.user_id = auth.uid();
    if not found then
      raise exception 'xp_events: no matching cardio_log row (%).', new.source_id
        using errcode = 'check_violation';
    end if;
    new.amount := floor(coalesce(mins, 0) * 2)::int;
    new.source_table := 'cardio_log';
    if new.amount <= 0 then
      raise exception 'xp_events: cardio session is worth no XP.'
        using errcode = 'check_violation';
    end if;
    return new;

  elsif new.kind = 'battle' then
    select p.xp_awarded into battle_xp
    from public.battle_participants p
    join public.battle_matches m on m.id = p.match_id
    where p.match_id = new.source_id
      and p.user_id = auth.uid()
      and m.status = 'settled';
    if not found or coalesce(battle_xp, 0) <= 0 then
      raise exception 'xp_events: no settled battle award for this match (%).', new.source_id
        using errcode = 'check_violation';
    end if;
    new.amount := battle_xp;
    new.source_table := 'battle_matches';
    return new;

  else
    raise exception 'xp_events: kind % may only be written by the server.', new.kind
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- ===========================================================================
-- STEP 6 — private storage bucket for round-3 photos (D2)
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('battle-media', 'battle-media', false)
on conflict (id) do nothing;

-- Read: participants of the match named by the first path segment.
-- Write/delete: service key only (no authenticated policies).
drop policy if exists battle_media_participant_read on storage.objects;
create policy battle_media_participant_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'battle-media'
    and public.is_battle_participant(((storage.foldername(name))[1])::uuid)
  );

-- ===========================================================================
-- STEP 7 — realtime publication (idempotent)
-- ===========================================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.battle_events;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.battle_rounds;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.battle_round_scores;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.battle_matches;
  exception when duplicate_object then null; end;
end $$;

-- ===========================================================================
-- STEP 8 — season 0
-- ===========================================================================
insert into public.battle_seasons (name, is_active)
select 'SEASON 0 — PREVIEW', true
where not exists (select 1 from public.battle_seasons);

-- ===========================================================================
-- STEP 9 — THE FALSIFICATION CHECKLIST (run as the smoke user's JWT)
--
--   (a) SELECT battle_matches            -> zero rows (not an error)
--   (b) INSERT battle_matches            -> RLS violation
--   (c) INSERT battle_round_scores       -> RLS violation (no write policy)
--   (d) INSERT battle_events kind='flag' -> trigger: server-only kind
--   (e) INSERT battle_events kind='volume' with a real owned set id but no
--       match                            -> trigger: not a participant
--   (f) INSERT xp_events kind='battle' amount=999999 with a random uuid
--       -> trigger: no settled battle award
--   (g) Log a set through the APP       -> still grants 10 XP (006 intact)
--   Positive control (service key): create a match+participants row, re-run
--   (a) -> the participant sees exactly that match and its snapshot.
-- ===========================================================================

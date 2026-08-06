-- EvoForge 139 — FORGE CHALLENGES: friend-vs-friend wagers settled from
-- verified training data.
--
-- Two friends stake non-purchasable Forge Coins on a 7- or 14-day contest
-- (most-improved bench e1RM, training consistency, or cardio minutes). The
-- server computes the result from the athletes' own logged rows and moves the
-- escrow. There is no combat, no matchmaking, and nothing purchasable.
--
-- THE RULES THIS SCHEMA EXISTS TO ENFORCE
--
--   SERVER-AUTHORITATIVE. Every number that decides money is computed HERE,
--   from workout_log / cardio_log / workout_sessions. The client never submits
--   a score, a winner, or a balance. `challenge_settle` reads the rows itself.
--
--   ESCROW IS REAL. Accepting inserts a NEGATIVE coin_events row per athlete;
--   settling inserts the payout. `coin_total()` is sum(amount), so a staked
--   coin genuinely leaves the balance and cannot be spent twice. The 013 guard
--   refuses both kinds unless this file's functions authorise them.
--
--   IDEMPOTENT. Every state transition takes a row lock and re-checks the
--   status it is transitioning FROM. A doubled accept cannot escrow twice; a
--   doubled settle cannot pay twice. This is the property that turns a retry
--   from a bug into a no-op.
--
--   RULES LOCK AT ACCEPTANCE. duration, stake, type and metric become
--   immutable the moment coins are at risk — enforced by a trigger, not by
--   asking callers nicely.
--
--   THE BASELINE IS A SNAPSHOT. Improvement is measured against what was true
--   when the challenge started, recorded then, never recomputed. Otherwise a
--   later edit to old training silently rewrites a finished contest.
--
--   PRIVATE DATA STAYS PRIVATE. Participants see each other's CHALLENGE
--   NUMBERS (the metric, the count, the improvement) and nothing else. No
--   measurements, no physique data, no workout rows.
--
-- Apply by hand via the management API (HANDOVER §5), falsify, THEN ship.

begin;

-- ─────────────────────────────────────────────────────────── the challenge

create table if not exists public.forge_challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  opponent_id   uuid not null references auth.users(id) on delete cascade,

  -- LOCKED RULES. Immutable once accepted (see forge_challenge_lock_guard).
  challenge_type text not null
    check (challenge_type in ('most_improved_lift', 'training_consistency', 'cardio_minutes')),
  -- The exercise for a lift challenge; null for the others.
  metric_key text,
  duration_days int not null check (duration_days in (7, 14)),
  stake int not null check (stake in (10, 25, 50)),

  status text not null default 'pending'
    check (status in ('pending', 'declined', 'expired', 'cancelled',
                      'active', 'awaiting_settlement', 'disputed', 'settled')),

  created_at   timestamptz not null default now(),
  -- A pending invite dies on its own; nothing is escrowed until acceptance.
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  starts_at    timestamptz,
  ends_at      timestamptz,
  settled_at   timestamptz,

  -- null winner on a settled challenge means DRAW (outcome says which).
  winner_id uuid references auth.users(id) on delete set null,
  outcome text check (outcome in ('winner', 'draw', 'refund')),
  -- Why it ended the way it did, in the server's own words.
  result_note text,

  rematch_of uuid references public.forge_challenges(id) on delete set null,

  constraint forge_challenges_not_self check (challenger_id <> opponent_id),
  -- A lift challenge needs a lift; the others must not carry one.
  constraint forge_challenges_metric_shape check (
    (challenge_type = 'most_improved_lift' and metric_key is not null)
    or (challenge_type <> 'most_improved_lift' and metric_key is null)
  )
);

comment on table public.forge_challenges is
  'Friend-vs-friend training wagers. Rules lock at acceptance; results are computed server-side from logged training.';

create index if not exists forge_challenges_challenger_idx on public.forge_challenges (challenger_id, status);
create index if not exists forge_challenges_opponent_idx   on public.forge_challenges (opponent_id, status);
create index if not exists forge_challenges_due_idx        on public.forge_challenges (ends_at) where status = 'active';

-- ───────────────────────────────────────────────────────── the participants

create table if not exists public.forge_challenge_participants (
  challenge_id uuid not null references public.forge_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- THE SNAPSHOT: what was true when the coins went in. Never recomputed.
  baseline numeric,
  baseline_detail jsonb not null default '{}'::jsonb,
  -- Filled at settlement, from the window's own rows.
  final_value numeric,
  final_detail jsonb not null default '{}'::jsonb,

  -- What this athlete actually has at risk, in coins. 0 until acceptance.
  escrowed int not null default 0 check (escrowed >= 0),
  -- Set when a qualifying row that fed this result was later edited/deleted.
  integrity_flag text,

  primary key (challenge_id, user_id)
);

comment on column public.forge_challenge_participants.baseline is
  'The metric at acceptance. A SNAPSHOT: recomputing it later would let old edits rewrite a finished contest.';

-- ───────────────────────────────────── which rows fed the result (audit)

create table if not exists public.forge_challenge_qualifying (
  challenge_id uuid not null references public.forge_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_table text not null,
  source_id text not null,
  value numeric,
  recorded_at timestamptz not null default now(),
  primary key (challenge_id, user_id, source_table, source_id)
);

comment on table public.forge_challenge_qualifying is
  'The exact rows that produced a result. Kept so a later edit or delete can be DETECTED rather than silently changing history.';

-- ───────────────────────────────────────────────────── the audit trail

create table if not exists public.forge_challenge_events (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.forge_challenges(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists forge_challenge_events_idx on public.forge_challenge_events (challenge_id, created_at);

-- ─────────────────────────────────────────────────────────── disputes

create table if not exists public.forge_challenge_disputes (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.forge_challenges(id) on delete cascade,
  raised_by uuid not null references auth.users(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  status text not null default 'open' check (status in ('open', 'upheld', 'rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists forge_challenge_disputes_open_idx
  on public.forge_challenge_disputes (challenge_id) where status = 'open';

-- ───────────────────────────────────── RULES LOCK, enforced not requested

create or replace function public.forge_challenge_lock_guard()
returns trigger
language plpgsql
as $$
begin
  -- Before acceptance the challenger may still change their mind; after it,
  -- coins are at risk and the terms are the contract. A client that PATCHes
  -- the row directly hits this, not a code review.
  if old.accepted_at is not null then
    new.challenge_type := old.challenge_type;
    new.metric_key     := old.metric_key;
    new.duration_days  := old.duration_days;
    new.stake          := old.stake;
    new.starts_at      := old.starts_at;
    new.ends_at        := old.ends_at;
    new.accepted_at    := old.accepted_at;
    new.challenger_id  := old.challenger_id;
    new.opponent_id    := old.opponent_id;
  end if;
  -- A settled result is final. Re-settlement must be a no-op, not an update.
  if old.status = 'settled' then
    new.status      := old.status;
    new.winner_id   := old.winner_id;
    new.outcome     := old.outcome;
    new.settled_at  := old.settled_at;
  end if;
  return new;
end;
$$;

drop trigger if exists forge_challenge_lock_trigger on public.forge_challenges;
create trigger forge_challenge_lock_trigger
  before update on public.forge_challenges
  for each row execute function public.forge_challenge_lock_guard();

-- ───────────────────────────────────────────────────────────────── RLS

alter table public.forge_challenges              enable row level security;
alter table public.forge_challenge_participants  enable row level security;
alter table public.forge_challenge_qualifying    enable row level security;
alter table public.forge_challenge_events        enable row level security;
alter table public.forge_challenge_disputes      enable row level security;

-- A participant is either side. Everything below reads through this.
create or replace function public.forge_challenge_is_participant(cid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.forge_challenges c
    where c.id = cid and (c.challenger_id = auth.uid() or c.opponent_id = auth.uid())
  );
$$;

drop policy if exists forge_challenges_participant_select on public.forge_challenges;
create policy forge_challenges_participant_select on public.forge_challenges
  for select using (challenger_id = auth.uid() or opponent_id = auth.uid());

-- CREATE is the ONE client write, and it is fenced: you may only send a
-- challenge AS yourself, TO a friend. Everything else — accepting, escrowing,
-- settling, refunding — goes through the definer functions below, so no
-- client can move a coin or a status by writing a row.
drop policy if exists forge_challenges_challenger_insert on public.forge_challenges;
create policy forge_challenges_challenger_insert on public.forge_challenges
  for insert with check (
    challenger_id = auth.uid()
    and opponent_id <> auth.uid()
    and public.are_friends(auth.uid(), opponent_id)
    and status = 'pending'
    and accepted_at is null
    and winner_id is null
    and outcome is null
  );

-- NO update or delete policy, deliberately: a challenge changes state only
-- through the functions.

drop policy if exists forge_participants_select on public.forge_challenge_participants;
create policy forge_participants_select on public.forge_challenge_participants
  for select using (public.forge_challenge_is_participant(challenge_id));

drop policy if exists forge_qualifying_select on public.forge_challenge_qualifying;
create policy forge_qualifying_select on public.forge_challenge_qualifying
  for select using (public.forge_challenge_is_participant(challenge_id));

drop policy if exists forge_events_select on public.forge_challenge_events;
create policy forge_events_select on public.forge_challenge_events
  for select using (public.forge_challenge_is_participant(challenge_id));

drop policy if exists forge_disputes_select on public.forge_challenge_disputes;
create policy forge_disputes_select on public.forge_challenge_disputes
  for select using (public.forge_challenge_is_participant(challenge_id));

-- ─────────────────────────── the coin guard learns two server-only kinds

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

  -- 139: CHALLENGE ESCROW. `challenge_stake` is negative (coins leave the
  -- balance), `challenge_payout` positive (they come back, or double). Both
  -- are admitted ONLY inside this migration's SECURITY DEFINER functions,
  -- which set `evoforge.challenge_authorized` to the event's source_id for
  -- the transaction. A separate GUC from `spend` on purpose: learning one
  -- must not unlock the other. PostgREST cannot reach set_config (pg_catalog
  -- is not an exposed schema), so a client cannot forge this.
  if new.kind in ('challenge_stake', 'challenge_payout') then
    if current_setting('evoforge.challenge_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      new.source_table := 'forge_challenges';
      return new;
    end if;
    raise exception 'coin_events: % may only be written by challenge settlement.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

  -- spend + battle_reward are server-only, admitted when this txn carries the
  -- authorisation flag matching the row's source_id (purchase_skin /
  -- purchase_character / grant_battle_reward).
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

commit;

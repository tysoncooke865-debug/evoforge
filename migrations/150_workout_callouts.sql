-- EvoForge 150 — LIVE WORKOUT CALL OUTS: the table, the knobs, the fences.
--
-- "50 says you can't hit this." / "You're on."
--
-- The Forge Duel (139–149) is a FORTNIGHT. This is thirty seconds: one athlete,
-- one upcoming working set, one friend who doubts it. It reuses that feature's
-- entire economy — coin_events escrow, the balance reader, the friendship gate,
-- the notification seam, the chip table — and adds only what a single set needs.
--
-- THE ONE IDEA WORTH STATING TWICE: a call out attaches to a set the athlete was
-- ALREADY GOING TO PERFORM. There is no planned-set row in this product (a plan
-- entry is [exercise, setCount, repScheme] and the weight is a prefill), so a
-- callout is keyed by the same composite workout_log itself uses —
-- (user, date, workout, exercise, set). That is also why 153 can adjudicate it
-- from a trigger on workout_log without the client sending a result.
--
-- WHAT DOES NOT HAPPEN HERE: no coins move in this file, and nothing in the
-- lifecycle can be driven by a client write. There is exactly ONE policy on the
-- table and it is a SELECT.

begin;

-- ────────────────────────────────────────────────────────── the knobs

/**
 * ONE ROW, EVERY LIMIT — the forge_duel_config pattern (144), for the same
 * reason: the client reads it so the tray states the REAL bound, and tuning is
 * an UPDATE rather than a deploy.
 *
 * The three timeouts are the whole answer to "what if nobody does anything",
 * and all three refund BOTH SIDES. Never a payout on silence: an opponent who
 * stops responding must not hand the athlete a pot, and an athlete who never
 * attempts must not hand the opponent one either. Nobody wins a set that did
 * not happen.
 */
create table if not exists public.workout_callout_config (
  id boolean primary key default true check (id),
  min_stake int not null default 5 check (min_stake > 0),
  max_stake int not null default 500 check (max_stake >= min_stake),
  -- An offer that outlives the workout is noise. Half an hour is long enough
  -- for a friend who is under a bar and short enough to die with the session.
  offer_minutes int not null default 30 check (offer_minutes between 1 and 720),
  -- Accepted, but the set never got logged.
  attempt_hours int not null default 6 check (attempt_hours between 1 and 72),
  -- Logged, but never verified.
  verify_hours int not null default 48 check (verify_hours between 1 and 336),
  -- Disputed, and neither side called it off.
  dispute_hours int not null default 72 check (dispute_hours between 1 and 720),
  -- THE REVEAL (not a gate): the affordance appears once the athlete has enough
  -- training for the proposition to mean anything. It never disappears again,
  -- and no progression can take it away.
  reveal_min_sets int not null default 20 check (reveal_min_sets >= 0),
  updated_at timestamptz not null default now()
);

insert into public.workout_callout_config (id) values (true) on conflict (id) do nothing;

alter table public.workout_callout_config enable row level security;

-- Readable by everyone signed in, writable by nobody: the economy is not a
-- client setting.
drop policy if exists workout_callout_config_read on public.workout_callout_config;
create policy workout_callout_config_read on public.workout_callout_config
  for select to authenticated using (true);

/** The knobs, for a client that wants to state the real limit. */
create or replace function public.workout_callout_settings()
returns public.workout_callout_config
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from public.workout_callout_config where id;
$$;
grant execute on function public.workout_callout_settings() to authenticated;

-- ─────────────────────────────────────────────────────────── the callout

create table if not exists public.workout_callouts (
  id uuid primary key default gen_random_uuid(),

  -- WHO. The athlete performs the set; the opponent doubts it. `initiated_by`
  -- is one of the two and exists so the mirror direction ("50 says Tyson misses
  -- 5", opened by the friend) is a later function rather than a later schema.
  athlete_id   uuid not null references auth.users(id) on delete cascade,
  opponent_id  uuid not null references auth.users(id) on delete cascade,
  initiated_by uuid not null references auth.users(id) on delete cascade,

  -- WHICH SET. Exactly workout_log's composite. No id, because an upcoming set
  -- does not have one — on either side of the wire.
  workout_date date not null,
  workout_name text not null,
  exercise     text not null,
  set_no       smallint not null check (set_no between 1 and 8),

  -- THE PROPOSITION, SNAPSHOTTED. The athlete cannot accept a call on 100 × 5
  -- and then quietly perform 90 × 3: this row is what 153 adjudicates against,
  -- and the lock guard below freezes it the moment coins are at risk.
  --
  -- The load is stored as 133 stores it — a MODE and its PART, never a
  -- pre-computed total — so a weighted pull-up calls "+10 kg", an assisted one
  -- calls "−30 kg", and a bodyweight one calls no kilogram at all.
  target_reps      smallint not null check (target_reps > 0),
  target_load_mode text not null default 'external',
  target_weight_kg numeric,
  -- Rendered ONCE, by the athlete's client, from the athlete's own units. Both
  -- sides read the same string, so an opponent on pounds and an athlete on
  -- kilograms can never be looking at two different bets.
  target_label     text not null check (length(target_label) between 1 and 60),

  -- MONEY. Equal stakes, matched: pot = stake * 2. Deliberately not a column —
  -- a stored total is a second place for the truth to live.
  stake int not null check (stake > 0),

  -- THE ODDS. Computed by the ATHLETE's client (only it can read the athlete's
  -- log) and snapshotted here, clamped by callout_create. Display only in V1:
  -- the payout is the pot, so a tampered client can distort hype and nothing
  -- else. `odds_evidence` carries the handful of numbers "WHY THESE ODDS?"
  -- prints, which is how the opponent sees the reasoning without being handed a
  -- window into somebody else's training history.
  hit_probability    numeric not null check (hit_probability >= 0.10 and hit_probability <= 0.90),
  odds_model_version text not null,
  odds_evidence      jsonb not null default '{}'::jsonb,

  -- THE LIFECYCLE.
  --   offered               nothing has moved
  --   accepted              both stakes are in escrow (coin_events)
  --   awaiting_verification the set was LOGGED; 153 filled in the result
  --   settled               verified, and the pot has been paid
  --   declined/cancelled    it never started; nothing moved
  --   disputed              frozen; pays nobody until both sides or the clock
  --   expired               a timeout; both sides refunded if anything moved
  status text not null default 'offered' check (status in (
    'offered', 'accepted', 'awaiting_verification', 'settled',
    'declined', 'cancelled', 'disputed', 'expired'
  )),

  -- WHAT ACTUALLY HAPPENED — written by the trigger from the logged row, never
  -- by a client. The athlete cannot type their own wager result.
  result           text check (result in ('hit', 'miss')),
  actual_reps      smallint,
  actual_weight_kg numeric,
  actual_load_mode text,
  workout_log_id   uuid,

  verified_by    uuid references auth.users(id) on delete set null,
  dispute_reason text check (dispute_reason is null or length(dispute_reason) between 3 and 500),

  -- MUTUAL CALL-OFF. A unilateral escape after acceptance would make every miss
  -- free, so one side asking is a request and both asking is a refund.
  athlete_calloff_at  timestamptz,
  opponent_calloff_at timestamptz,

  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  set_logged_at timestamptz,
  verified_at   timestamptz,
  settled_at    timestamptz,

  constraint workout_callout_not_self check (athlete_id <> opponent_id),
  constraint workout_callout_initiator check (initiated_by in (athlete_id, opponent_id))
);

/**
 * ONE LIVE CALL PER ATHLETE — an INDEX, not a convention.
 *
 * The duel learned this the expensive way (144's one-pending-offer index): a
 * rule the body checks is a rule a race can walk past, and a rule the storage
 * layer holds is a rule that cannot be represented wrongly. It is also the
 * whole of the spam control — "one wager per exercise" would be an arbitrary
 * rule about the wrong noun.
 *
 * `disputed` is deliberately OUT of the set. A frozen pot waiting on a human
 * must not lock the athlete out of the feature for three days.
 */
create unique index if not exists workout_callouts_one_live
  on public.workout_callouts (athlete_id)
  where status in ('offered', 'accepted', 'awaiting_verification');

create index if not exists workout_callouts_opponent_idx
  on public.workout_callouts (opponent_id, status);
create index if not exists workout_callouts_athlete_day_idx
  on public.workout_callouts (athlete_id, workout_date desc);
-- The trigger's lookup in 153: one row per (athlete, set) at most.
create index if not exists workout_callouts_set_idx
  on public.workout_callouts (athlete_id, workout_date, workout_name, exercise, set_no);
-- What the sweep scans.
create index if not exists workout_callouts_expiry_idx
  on public.workout_callouts (expires_at)
  where status in ('offered', 'accepted', 'awaiting_verification', 'disputed');

-- ──────────────────────────────────── the terms freeze when coins are in

/**
 * §34, enforced rather than requested. Once accepted, the proposition, the
 * stake, the participants and the odds shown at acceptance are the contract.
 * A client that PATCHes the row directly meets this, not a code review.
 *
 * There is no UPDATE policy at all (see RLS below), so this is the second lock
 * on a door with no handle — which is exactly where a guard belongs.
 */
create or replace function public.workout_callout_lock_guard()
returns trigger
language plpgsql
as $$
begin
  if old.accepted_at is not null then
    new.athlete_id         := old.athlete_id;
    new.opponent_id        := old.opponent_id;
    new.workout_date       := old.workout_date;
    new.workout_name       := old.workout_name;
    new.exercise           := old.exercise;
    new.set_no             := old.set_no;
    new.target_reps        := old.target_reps;
    new.target_load_mode   := old.target_load_mode;
    new.target_weight_kg   := old.target_weight_kg;
    new.target_label       := old.target_label;
    new.stake              := old.stake;
    new.hit_probability    := old.hit_probability;
    new.odds_model_version := old.odds_model_version;
    new.odds_evidence      := old.odds_evidence;
    new.accepted_at        := old.accepted_at;
  end if;
  -- A paid result is final. Re-settlement must be a no-op, not an update — and
  -- an edit to the underlying set hours later must not rewrite what was paid.
  if old.status = 'settled' then
    new.status     := old.status;
    new.result     := old.result;
    new.settled_at := old.settled_at;
    new.actual_reps      := old.actual_reps;
    new.actual_weight_kg := old.actual_weight_kg;
    new.actual_load_mode := old.actual_load_mode;
  end if;
  return new;
end;
$$;

drop trigger if exists workout_callout_lock_trigger on public.workout_callouts;
create trigger workout_callout_lock_trigger
  before update on public.workout_callouts
  for each row execute function public.workout_callout_lock_guard();

-- ───────────────────────────────────────────────────────────────── RLS

alter table public.workout_callouts enable row level security;

/**
 * READ ONLY, AND ONLY YOUR OWN.
 *
 * Stricter than forge_challenges, which permits one fenced client INSERT. There
 * is no reason to repeat that here: creating a call out has to check a wallet, a
 * friendship, an opt-out, a config range and whether the set is already logged,
 * and none of those are expressible as a WITH CHECK. So every transition —
 * create included — is a SECURITY DEFINER function, and this table has exactly
 * one policy.
 */
drop policy if exists workout_callouts_participant_select on public.workout_callouts;
create policy workout_callouts_participant_select on public.workout_callouts
  for select using (athlete_id = auth.uid() or opponent_id = auth.uid());

-- No insert, update or delete policy. Deliberate. Do not add one.

-- ───────────────────────────────────────────────────────────── realtime

-- Both phones need to see the other's move NOW — a doubt, a logged set, a
-- verification. RLS decides delivery, so a client only ever receives rows it
-- could already have read. The client keeps a short poll as well: realtime is
-- the accelerator, the poll is the guarantee.
do $$ begin
  alter publication supabase_realtime add table public.workout_callouts;
exception when duplicate_object then null; end $$;

-- ──────────────────────────────────────────────────────── the opt-out

-- §30. Server-side rather than device-local BECAUSE it is not only about your
-- own screen: callout_create refuses to target an athlete who has turned this
-- off, so a serious logger never receives an offer they cannot answer, and no
-- friend ever wonders why their coins are sitting in a dead invite.
--
-- Default TRUE: this is an opt-out, and the reveal rule above is what keeps it
-- from appearing before it means anything.
alter table public.profile add column if not exists callouts_enabled boolean not null default true;

comment on column public.profile.callouts_enabled is
  'WORKOUT CALL OUTS on/off. False also stops other athletes being able to call you out.';

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- begin;
--   drop trigger if exists workout_callout_lock_trigger on public.workout_callouts;
--   drop function if exists public.workout_callout_lock_guard();
--   do $$ begin
--     alter publication supabase_realtime drop table public.workout_callouts;
--   exception when others then null; end $$;
--   drop table if exists public.workout_callouts;
--   drop function if exists public.workout_callout_settings();
--   drop table if exists public.workout_callout_config;
--   alter table public.profile drop column if exists callouts_enabled;
-- commit;

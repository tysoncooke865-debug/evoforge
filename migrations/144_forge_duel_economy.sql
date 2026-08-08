-- EvoForge 144 — THE FORGE DUEL: an economy around the challenge that already
-- works.
--
-- 139–143 built a friend-vs-friend wager settled from verified training. This
-- migration turns it into a table two people sit at: chips with real
-- denominations, a pot that GROWS during the contest, spectators who can back a
-- side, and a timeline of what happened. Everything below is ADDITIVE — no
-- column is dropped, no row is deleted, and every existing duel keeps working
-- with `current_stake` defaulted from the stake it already had.
--
-- THE RULES THIS SCHEMA EXISTS TO ENFORCE
--
--   FORGE COINS ARE FICTIONAL AND STAY THAT WAY. They are earned by training,
--   never purchased, never withdrawn, never converted. Nothing here creates a
--   path to real-world value, and nothing here mints coins: every payout is
--   funded by coins that were escrowed first. The supporter pool is
--   PARI-MUTUEL, which is the only distribution that provably cannot pay out
--   more than it took in.
--
--   ONLY STAKED COINS ARE AT RISK. A duel touches `coin_events` and nothing
--   else. XP, Evo Rating, Forge Level, Training Arc and physique scoring are
--   computed from logged training and are untouched by any outcome. There is
--   deliberately no code path from this file to any of them.
--
--   PARTICIPANT ESCROW AND SUPPORTER MONEY NEVER MIX. Two tables, two coin
--   kinds, two settlement paths. A supporter's coins can never pay a
--   participant and a participant's escrow can never pay a supporter.
--
--   ONE PENDING OFFER PER DUEL, ENFORCED BY AN INDEX. A partial unique index
--   on (challenge_id) where status = 'pending' makes "two conflicting raises"
--   unrepresentable rather than merely discouraged. A counteroffer supersedes
--   the offer it answers in the same transaction, so the old one can never be
--   accepted afterwards.
--
--   NOTHING MOVES ON A PROPOSAL. Coins leave a wallet only when the OTHER
--   athlete accepts — at acceptance of the duel, and at acceptance of a raise.
--   Declining a raise leaves the existing escrow exactly where it was.
--
-- Apply by hand via the management API (HANDOVER §5), falsify, THEN ship.

begin;

-- ───────────────────────────────────────────────── the tunable economy

/**
 * ONE ROW, every knob. The brief's rule: "Do not scatter constants throughout
 * the code." Readable by any signed-in athlete so the client shows the REAL
 * limits rather than a copy that can drift; writable by service_role only.
 */
create table if not exists public.forge_duel_config (
  id boolean primary key default true check (id),

  -- The smallest and largest per-athlete stake a duel may carry.
  min_stake int not null default 5 check (min_stake > 0),
  max_stake int not null default 2000 check (max_stake >= min_stake),
  -- A single opening stake may not exceed this share of the proposer's wallet.
  -- 100 = no cap; lower it to stop a first-week athlete betting everything.
  max_wallet_pct int not null default 100 check (max_wallet_pct between 1 and 100),

  -- How many ACCEPTED raises a duel may carry. All-ins count.
  max_raises int not null default 6 check (max_raises >= 0),
  -- The largest single raise, per athlete. All-in ignores this by design.
  max_raise int not null default 1000 check (max_raise > 0),

  -- Supporter limits. One position per supporter per duel, this big at most.
  max_support int not null default 500 check (max_support > 0),
  -- How far through the window supporter staking stays open, as a percentage.
  -- 50 = the halfway point. Late money cannot buy a result it already saw.
  support_close_pct int not null default 50 check (support_close_pct between 1 and 100),
  -- The platform's cut of the LOSING supporter pool, in basis points. 0 for
  -- beta: the purpose is retention, not extracting currency. It exists as a
  -- parameter so an economy that needs a sink has one without a code change.
  support_rake_bp int not null default 0 check (support_rake_bp between 0 and 2000),

  -- A pending invite dies on its own after this long.
  invite_expiry_hours int not null default 48 check (invite_expiry_hours between 1 and 336),
  -- A raise/all-in offer that is never answered dies after this long.
  offer_expiry_hours int not null default 24 check (offer_expiry_hours between 1 and 168),
  -- How many duels one athlete may have proposed or running at once.
  max_open_duels int not null default 12 check (max_open_duels > 0),

  updated_at timestamptz not null default now()
);

insert into public.forge_duel_config (id) values (true) on conflict (id) do nothing;

comment on table public.forge_duel_config is
  'Every tunable in the duel economy, in one row. Read by the client so the UI states the real limit; written by service_role only.';

alter table public.forge_duel_config enable row level security;
drop policy if exists forge_duel_config_read on public.forge_duel_config;
create policy forge_duel_config_read on public.forge_duel_config
  for select to authenticated using (true);
-- No insert/update/delete policy: the economy is not a client setting.

/** The config, as one row. Every function below reads through this. */
create or replace function public.forge_duel_settings()
returns public.forge_duel_config
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from public.forge_duel_config where id;
$$;

-- ─────────────────────────────────────── the challenge grows a live stake

-- CHIPS, NOT THREE BUTTONS. 139 pinned the stake to (10, 25, 50) because there
-- were three buttons; the wager table has seven denominations and a running
-- total, so the server checks a RANGE and the config owns the bounds.
alter table public.forge_challenges drop constraint if exists forge_challenges_stake_check;
alter table public.forge_challenges
  add constraint forge_challenges_stake_check check (stake > 0);

-- Short duels make the loop testable and the long ones remain. Widening a
-- CHECK cannot invalidate a stored row.
alter table public.forge_challenges drop constraint if exists forge_challenges_duration_days_check;
alter table public.forge_challenges
  add constraint forge_challenges_duration_days_check
  check (duration_days between 1 and 30);

alter table public.forge_challenges
  -- THE LIVE PER-ATHLETE STAKE. `stake` stays the OPENING one (locked at
  -- acceptance, the contract both athletes agreed to); this one grows with
  -- every accepted raise. The pot is always current_stake * 2.
  add column if not exists current_stake int,
  -- Raise bookkeeping. `last_raise_at` is what makes eligibility statable:
  -- a new raise needs a qualifying session from BOTH athletes after it.
  add column if not exists raises_accepted int not null default 0,
  add column if not exists last_raise_at timestamptz,
  -- Who leads right now, as of the last activity. Stored, not derived, so a
  -- LEAD CHANGE is an event with a moment rather than a diff nobody saw.
  add column if not exists leader_id uuid references auth.users(id) on delete set null,
  -- When supporter staking closes. Set at acceptance from support_close_pct.
  add column if not exists support_closes_at timestamptz,
  -- The participants' choice: may friends watch and back this duel?
  add column if not exists spectators_enabled boolean not null default true,
  -- Settlement bookkeeping for the supporter pool, kept beside the result so
  -- an athlete can see exactly how their share was computed.
  add column if not exists support_settled_at timestamptz;

-- Every duel that already exists carries its opening stake as its live one.
update public.forge_challenges set current_stake = stake where current_stake is null;
alter table public.forge_challenges alter column current_stake set default 0;

comment on column public.forge_challenges.current_stake is
  'The LIVE per-athlete stake, grown by accepted raises. pot = current_stake * 2. `stake` remains the opening contract.';
comment on column public.forge_challenges.leader_id is
  'Who is ahead as of the last qualifying session. Stored so a lead CHANGE can be an event with a timestamp.';

create index if not exists forge_challenges_support_idx
  on public.forge_challenges (support_closes_at) where status = 'active';

-- ─────────────────────────────────────── participants grow duel bookkeeping

alter table public.forge_challenge_participants
  -- The last qualifying session this athlete logged inside the window. Raise
  -- eligibility is "both of these are after the last accepted raise", which is
  -- a rule the UI can state in one sentence.
  add column if not exists last_qualifying_at timestamptz,
  add column if not exists qualifying_sessions int not null default 0,
  -- The metric value at that moment, so the timeline can say what changed.
  add column if not exists last_qualifying_value numeric;

-- ──────────────────────────────────────────────────────── raise offers

/**
 * A FORMAL NEGOTIATION. Every change to the stakes after acceptance is one of
 * these rows, and every row is answered by the OTHER athlete before a coin
 * moves.
 *
 *   raise          — both athletes add `amount` each.
 *   all_in         — the same movement, dramatised: `amount` is the proposer's
 *                    entire available balance, and the responder must be able
 *                    to match it. A separate kind because the UI treats it
 *                    differently and the history should say which it was.
 *   counter_stake  — sent against a PENDING invite (before acceptance): "I'll
 *                    do 50 instead of 25". Accepting it rewrites the opening
 *                    stake, which is the one moment `stake` may change.
 */
create table if not exists public.forge_duel_offers (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.forge_challenges(id) on delete cascade,
  proposer_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('raise', 'all_in', 'counter_stake')),

  -- raise / all_in: the ADDITIONAL coins each athlete puts in.
  -- counter_stake: the NEW opening stake per athlete (not a delta).
  amount int not null check (amount > 0),

  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'superseded', 'expired', 'withdrawn')),

  -- A counteroffer names the offer it replaces, so the history reads as a
  -- conversation rather than a pile of unrelated numbers.
  counter_of uuid references public.forge_duel_offers(id) on delete set null,

  responded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  responded_at timestamptz
);

comment on table public.forge_duel_offers is
  'Raise / all-in / counter-stake proposals. Nothing moves until the OTHER athlete accepts. One pending offer per duel, enforced by a partial unique index.';

-- THE RULE THAT MAKES CONFLICTING PROPOSALS UNREPRESENTABLE. Two athletes
-- raising at once, or a stale offer accepted after a counter, are the same bug;
-- this index is the fix for both. A counteroffer supersedes in the SAME
-- transaction, so there is never a moment with two live proposals.
create unique index if not exists forge_duel_offers_one_pending
  on public.forge_duel_offers (challenge_id) where status = 'pending';

create index if not exists forge_duel_offers_challenge_idx
  on public.forge_duel_offers (challenge_id, created_at desc);

-- ────────────────────────────────────────────────────── supporter stakes

/**
 * FRIENDS BACKING A SIDE. A SEPARATE POOL, in a separate table, funded by
 * separate coin kinds and settled by a separate function. The brief's rule,
 * and the reason is not tidiness: if the two ever shared a pot, a supporter
 * could be paid out of a participant's escrow, and a duel could pay more than
 * it took in.
 *
 * ONE POSITION PER SUPPORTER PER DUEL. No top-ups, no hedging both sides.
 * Hedging is a no-op in a pari-mutuel pool and reads as a bug; a single
 * decision keeps the sentiment meter honest.
 */
create table if not exists public.forge_duel_support (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.forge_challenges(id) on delete cascade,
  supporter_id uuid not null references auth.users(id) on delete cascade,
  -- Which participant they are behind. Constrained to a participant by the
  -- function that writes it; a foreign key cannot express "one of these two".
  backed_id uuid not null references auth.users(id) on delete cascade,
  amount int not null check (amount > 0),

  created_at timestamptz not null default now(),
  settled_at timestamptz,
  -- What they received. 0 is a real answer (their side lost); null means the
  -- duel has not settled.
  payout int,

  constraint forge_duel_support_one_position unique (challenge_id, supporter_id)
);

comment on table public.forge_duel_support is
  'Spectator support stakes. PARI-MUTUEL: winners divide the losing pool in proportion to their own. Never mixed with participant escrow.';

create index if not exists forge_duel_support_challenge_idx
  on public.forge_duel_support (challenge_id, backed_id);
create index if not exists forge_duel_support_mine_idx
  on public.forge_duel_support (supporter_id, created_at desc);

-- ──────────────────────────────────────────────────────────── reactions

/**
 * A BOUNDED SET, WHICH IS ITS OWN RATE LIMIT. Five emoji, one row each per
 * athlete per duel, toggled on and off. There is no throttle to tune because
 * the unique index caps a single user at five rows however fast they tap —
 * a cheaper guarantee than a counter, and one that cannot drift.
 */
create table if not exists public.forge_duel_reactions (
  challenge_id uuid not null references public.forge_challenges(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('fire', 'skull', 'swords', 'eyes', 'flex')),
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id, emoji)
);

comment on table public.forge_duel_reactions is
  'Lightweight duel reactions. Five names, never free text — a fixed vocabulary needs no moderation and cannot carry a message.';

-- ─────────────────────────────────────── the events table learns its kinds

-- 139 left `kind` free text. The duel timeline is now a product surface, so
-- pin the vocabulary: an unknown kind would render as a blank row.
alter table public.forge_challenge_events drop constraint if exists forge_challenge_events_kind_check;
alter table public.forge_challenge_events
  add constraint forge_challenge_events_kind_check check (kind in (
    'created', 'accepted', 'declined', 'cancelled', 'expired', 'disputed', 'settled',
    'counter_stake_proposed', 'counter_stake_accepted', 'counter_stake_declined',
    'raise_proposed', 'raise_accepted', 'raise_declined', 'raise_withdrawn', 'raise_expired',
    'all_in_proposed', 'all_in_accepted', 'all_in_declined',
    'workout_logged', 'lead_change', 'personal_record',
    'support_placed', 'support_closed', 'support_settled',
    'reaction'
  ));

-- ─────────────────────────────────────────── the ledger learns two kinds

-- THREE EDITS, ALWAYS (the 139/142 lesson): the CHECK constraint decides
-- whether the word may exist, the guard decides who may write it, the client's
-- union decides what it means. 139 taught the guard and not the constraint,
-- and the first real accept died one layer below the guard that approved it.
alter table public.coin_events drop constraint if exists coin_events_kind_check;
alter table public.coin_events add constraint coin_events_kind_check
  check (kind = any (array[
    'workout_complete', 'pr', 'streak_milestone', 'starting_bonus',
    'adjustment', 'spend', 'battle_reward',
    'challenge_stake', 'challenge_payout',
    -- NEGATIVE. A supporter's coins leave their balance when they back a side.
    'duel_support_stake',
    -- POSITIVE. Their stake back plus their share of the losing pool, or a
    -- refund on a draw / cancellation / a side nobody backed.
    'duel_support_payout'
  ]));

/**
 * The guard, extended. Both new kinds are server-only and ride the SAME
 * transaction-local GUC the challenge kinds use: PostgREST cannot reach
 * set_config (pg_catalog is not an exposed schema), so a client cannot forge
 * it. Everything else in this function is 139's body, unchanged.
 */
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

  -- 139/144: CHALLENGE ESCROW and SUPPORTER MONEY. Negative rows take coins out
  -- of the balance (coin_total() is sum(amount), so a staked coin genuinely
  -- cannot be staked twice); positive rows bring them back. Admitted ONLY
  -- inside the duel functions, which set `evoforge.challenge_authorized` to the
  -- event's source_id for the transaction. A SEPARATE GUC from `spend` on
  -- purpose: learning one must not unlock the other.
  if new.kind in ('challenge_stake', 'challenge_payout',
                  'duel_support_stake', 'duel_support_payout') then
    if current_setting('evoforge.challenge_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      new.source_table := 'forge_challenges';
      return new;
    end if;
    raise exception 'coin_events: % may only be written by duel settlement.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

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

-- ─────────────────────────── the invite is validated where it is written

/**
 * THE ONE CLIENT WRITE, VALIDATED BY THE SERVER.
 *
 * Creating a duel stays a plain INSERT fenced by RLS (139's model: "as myself,
 * to a friend, status pending"), because that policy is proven and an RPC would
 * be a second door to the same room. What RLS cannot express is arithmetic —
 * "this stake is within the configured range and you can actually cover it" —
 * so a BEFORE INSERT trigger says it. A trigger, not a check in the client:
 * the client's copy of a limit is a suggestion, this one is the limit.
 */
create or replace function public.forge_duel_invite_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cfg public.forge_duel_config;
  bal int;
  open_count int;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  select * into cfg from public.forge_duel_config where id;

  if new.stake < cfg.min_stake or new.stake > cfg.max_stake then
    raise exception 'A duel stake must be between % and % coins.', cfg.min_stake, cfg.max_stake
      using errcode = 'check_violation';
  end if;

  -- YOU CANNOT PROPOSE WHAT YOU DO NOT HAVE. Checked again at acceptance
  -- against the live ledger, because a balance can fall in between — but
  -- refusing here is the difference between an honest form and an invite that
  -- can never be accepted.
  select coalesce(sum(amount), 0)::int into bal from public.coin_events where user_id = new.challenger_id;
  if bal < new.stake then
    raise exception 'You have % coins and this duel stakes %.', bal, new.stake
      using errcode = 'check_violation';
  end if;
  if cfg.max_wallet_pct < 100 and new.stake > (bal * cfg.max_wallet_pct) / 100 then
    raise exception 'A single duel may stake at most %%% of your coins.', cfg.max_wallet_pct
      using errcode = 'check_violation';
  end if;

  select count(*) into open_count from public.forge_challenges c
  where (c.challenger_id = new.challenger_id or c.opponent_id = new.challenger_id)
    and c.status in ('pending', 'active', 'awaiting_settlement', 'disputed');
  if open_count >= cfg.max_open_duels then
    raise exception 'You already have % duels open. Finish one first.', open_count
      using errcode = 'check_violation';
  end if;

  -- The invite's own clock comes from the config, never from the client.
  new.expires_at := now() + make_interval(hours => cfg.invite_expiry_hours);
  new.current_stake := new.stake;
  return new;
end;
$$;

drop trigger if exists forge_duel_invite_guard_bi on public.forge_challenges;
create trigger forge_duel_invite_guard_bi
  before insert on public.forge_challenges
  for each row execute function public.forge_duel_invite_guard();

-- ────────────────────────── the lock guard learns the columns that move

/**
 * 139's rules lock, extended for the columns a duel now grows.
 *
 * FROZEN once accepted: the contract (type, metric, duration, the OPENING
 * stake, the window, who is playing) and the support window.
 * FREE to move: current_stake and raises_accepted (raises are the point),
 * leader_id (activity decides it), and the settlement columns until settled.
 */
create or replace function public.forge_challenge_lock_guard()
returns trigger
language plpgsql
as $$
begin
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
    -- 144: the support window is part of the contract. Moving it after the
    -- fact would let a participant reopen backing once they knew the score.
    new.support_closes_at := old.support_closes_at;
    new.spectators_enabled := old.spectators_enabled;
  end if;
  if old.status = 'settled' then
    new.status      := old.status;
    new.winner_id   := old.winner_id;
    new.outcome     := old.outcome;
    new.settled_at  := old.settled_at;
    -- A settled pot is final. The supporter pool may still be marked as paid
    -- (support_settled_at), which is why that column is NOT frozen here.
    new.current_stake := old.current_stake;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────── RLS

alter table public.forge_duel_offers    enable row level security;
alter table public.forge_duel_support   enable row level security;
alter table public.forge_duel_reactions enable row level security;

-- Offers are visible to the two athletes. Every write is a definer function:
-- there is deliberately no insert/update/delete policy, so a client cannot
-- propose, accept or supersede by writing a row.
drop policy if exists forge_duel_offers_participant on public.forge_duel_offers;
create policy forge_duel_offers_participant on public.forge_duel_offers
  for select to authenticated using (public.forge_challenge_is_participant(challenge_id));

-- A supporter always sees their OWN position; the aggregate distribution is
-- served by the spectator RPC, which returns percentages rather than a list of
-- who backed whom. Participants see their duel's rows so settlement is
-- auditable by the people it paid.
drop policy if exists forge_duel_support_mine on public.forge_duel_support;
create policy forge_duel_support_mine on public.forge_duel_support
  for select to authenticated using (
    supporter_id = auth.uid() or public.forge_challenge_is_participant(challenge_id)
  );

-- Reactions are readable by anyone who can see the duel; writing one is an
-- RPC (it must check the caller may watch this duel at all).
drop policy if exists forge_duel_reactions_read on public.forge_duel_reactions;
create policy forge_duel_reactions_read on public.forge_duel_reactions
  for select to authenticated using (
    user_id = auth.uid() or public.forge_challenge_is_participant(challenge_id)
  );

grant select on public.forge_duel_config to authenticated;
grant execute on function public.forge_duel_settings() to authenticated;

commit;

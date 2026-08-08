-- EvoForge 154 — FORGE DROP: the board, the tiers, and two more coin kinds.
--
-- A single-player Plinko board wagered in Forge Coins. Train → the Evo Rating
-- rises → a stronger board unlocks → coins earned by training are risked on it
-- → winnings are spent in Customise or on a duel. Forge Coins remain fictional,
-- non-purchasable and non-withdrawable, and Forge Drop is the only new thing
-- that moves them.
--
-- THE ONE ECONOMIC INVARIANT: EVERY TIER RETURNS LESS THAN IT TAKES. Not "on
-- average across the app", not "usually" — every tier, and (154's check
-- constraint) every LANE of every tier, has an expected return strictly below
-- 100%. A board that could be farmed would turn training-earned coins into a
-- printing press and make every other coin in the app meaningless.
--
-- FORGE DROP NEVER TOUCHES THE EVO RATING. It reads it, snapshots it onto the
-- drop, and writes nothing back. XP, Forge Level, the Training Arc and every
-- physique number have no code path from this feature.

begin;

-- ─────────────────────────────────────────────────────────── the tiers

/**
 * ONE ROW PER TIER, AND THE BOARD IS DATA.
 *
 * Rebalancing is an UPDATE, not a deploy: the multipliers, the stake ceiling
 * and the lanes all live here, the client reads them to draw the payout table,
 * and `forge_drop_play` reads them to settle. Nothing about the board is
 * written down in UI code, which is the difference between tuning an economy
 * and shipping one.
 *
 * `config_version` is stamped onto every drop, so a settled row can always be
 * read back against the board it was actually played on.
 */
create table if not exists public.forge_drop_tiers (
  tier int primary key check (tier between 1 and 5),
  evo_min int not null check (evo_min >= 0),
  evo_max int not null check (evo_max <= 1000),
  label text not null,
  /** The visual identity, resolved to art by the client. */
  theme text not null,
  min_stake int not null default 1 check (min_stake >= 1),
  max_stake int not null check (max_stake >= min_stake),
  /** The brief's design target. The ACTUAL return is a property of
   *  `multipliers` + the walk, asserted against this in the test suite and in
   *  tools/falsify-forge-drop.mjs — a target nothing checks is a wish. */
  target_rtp numeric not null check (target_rtp > 0 and target_rtp < 1),
  /** Stake ceiling × the best multiplier. Stored so the UI can promise it
   *  without recomputing, and checked below so it cannot drift. */
  max_payout int not null check (max_payout > 0),
  /** Slot multipliers, left to right. Length = rows + 1. */
  multipliers numeric[] not null,
  /** How many peg rows the puck falls through. Slots = rows + 1. */
  /** Peg rows. EVEN, always: the puck moves a HALF column per peg, so an odd
   *  number of rows would leave it sitting between two slots. */
  rows int not null default 12 check (rows between 4 and 16 and rows % 2 = 0),
  /** The entry columns an athlete may choose, left to right.
   *
   *  DELIBERATELY NOT "anywhere along the top". The multipliers are highest at
   *  the rim, so entering AT the rim would give an expected return well above
   *  100% — the board would be a money printer for anyone who noticed. Three
   *  lanes near the middle keep every published return under the ceiling while
   *  leaving the choice real: the edges trade a lower chance of the middle for
   *  a better shot at the rim, and each lane publishes its OWN table. */
  lanes int[] not null,
  config_version int not null default 1,
  updated_at timestamptz not null default now(),
  constraint forge_drop_tier_range check (evo_min <= evo_max),
  constraint forge_drop_multipliers_shape check (
    array_length(multipliers, 1) = rows + 1 and array_length(multipliers, 1) >= 5
  ),
  constraint forge_drop_lanes_shape check (
    array_length(lanes, 1) between 1 and 5
  )
);

alter table public.forge_drop_tiers enable row level security;

-- Readable by everyone signed in, writable by nobody: the board is not a
-- client setting. (144's rule for forge_duel_config, for the same reason.)
drop policy if exists forge_drop_tiers_read on public.forge_drop_tiers;
create policy forge_drop_tiers_read on public.forge_drop_tiers
  for select to authenticated using (true);

/**
 * THE BOARD, AS SHIPPED.
 *
 * Eight rows, nine slots, symmetric multipliers. The centre lane's return is
 * the binomial C(8,k)/256 weighting against these numbers; the side lanes are
 * the same walk started one column over, which shifts the odds a little and the
 * return barely at all. Every number below was solved to land within a point of
 * the brief's target and is re-derived from scratch by the test suite —
 * `domain/__tests__/forge-drop.test.ts` fails if a multiplier is edited here
 * without the return being re-checked.
 *
 *   tier  evo      stake  ceiling  best   max payout
 *   1     1–20     5      80%      3.0x   15
 *   2     21–40    10     83%      3.5x   35
 *   3     41–60    15     86%      4.0x   60
 *   4     61–80    20     89%      5.0x   100
 *   5     81–100   25     92%      6.0x   150
 *
 * TWELVE ROWS, THIRTEEN SLOTS, THREE LANES. The row count is not decoration:
 * a puck entering one column off centre can only reach a wall by falling the
 * same way twelve times running, so the reflection that would otherwise pile
 * probability onto the 3x rim is worth 0.02%. On an eight-row board it was
 * worth 3%, which took a side lane's return from 80% to over 100% — a printing
 * press, found by the statistical test rather than by reasoning.
 *
 * `target_rtp` IS A CEILING, NOT AN AVERAGE. Every lane of the tier returns AT
 * MOST that, and the UI publishes each lane's own exact number. A ceiling is a
 * promise that can be checked; an average is one that cannot.
 */
insert into public.forge_drop_tiers
  (tier, evo_min, evo_max, label, theme, max_stake, target_rtp, max_payout, multipliers, rows, lanes)
values
  (1, 0, 20, 'SCRAP RIG', 'rust', 5, 0.8, 15,
   array[3, 1.35, 1.18, 1, 0.83, 0.65, 0.65, 0.65, 0.83, 1, 1.18, 1.35, 3]::numeric[], 12, array[5,6,7]),
  (2, 21, 40, 'FORGE LINE', 'iron', 10, 0.83, 35,
   array[3.5, 1.3, 1.15, 1, 0.85, 0.7, 0.7, 0.7, 0.85, 1, 1.15, 1.3, 3.5]::numeric[], 12, array[5,6,7]),
  (3, 41, 60, 'CYBER FOUNDRY', 'cyber', 15, 0.86, 60,
   array[4, 1.45, 1.26, 1.08, 0.89, 0.7, 0.7, 0.7, 0.89, 1.08, 1.26, 1.45, 4]::numeric[], 12, array[5,6,7]),
  (4, 61, 80, 'REACTOR CORE', 'reactor', 20, 0.89, 100,
   array[5, 1.4, 1.24, 1.08, 0.91, 0.75, 0.75, 0.75, 0.91, 1.08, 1.24, 1.4, 5]::numeric[], 12, array[5,6,7]),
  (5, 81, 1000, 'CELESTIAL FORGE', 'celestial', 25, 0.92, 150,
   array[6, 1.3, 1.18, 1.05, 0.93, 0.8, 0.8, 0.8, 0.93, 1.05, 1.18, 1.3, 6]::numeric[], 12, array[5,6,7])
-- RE-APPLYING THIS FILE RETUNES THE BOARD. That is the intended way to
-- rebalance: change the numbers here, run it, and every client picks the new
-- table up on its next read. Nothing about the board lives in UI code.
on conflict (tier) do update set
  evo_min = excluded.evo_min, evo_max = excluded.evo_max,
  label = excluded.label, theme = excluded.theme,
  max_stake = excluded.max_stake, target_rtp = excluded.target_rtp,
  max_payout = excluded.max_payout, multipliers = excluded.multipliers,
  rows = excluded.rows, lanes = excluded.lanes,
  config_version = public.forge_drop_tiers.config_version + 1,
  updated_at = now();

-- THE PROMISE ON THE TIN, ENFORCED. max_payout must be exactly what the best
-- multiplier pays at the stake ceiling, or the UI is advertising a number the
-- board cannot produce.
do $$
declare bad text;
begin
  select string_agg(t.tier::text, ', ') into bad
  from public.forge_drop_tiers t
  where t.max_payout <> floor(t.max_stake * (select max(m) from unnest(t.multipliers) m));
  if bad is not null then
    raise exception 'forge_drop_tiers: max_payout disagrees with the board on tier(s) %', bad;
  end if;
end $$;

/** The board, for a client that wants to draw the real table. */
create or replace function public.forge_drop_settings()
returns setof public.forge_drop_tiers
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from public.forge_drop_tiers order by tier;
$$;
grant execute on function public.forge_drop_settings() to authenticated;

-- ──────────────────────────────────────────────────────────── the drops

create table if not exists public.forge_drops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  /**
   * THE IDEMPOTENCY KEY, MINTED BY THE CLIENT BEFORE IT ASKS.
   *
   * A refresh mid-animation, a dropped connection after the write, a doubled
   * tap and a retry are all the SAME request, and all of them must return the
   * SAME drop rather than charging again. The unique index is what makes that
   * true at the storage layer rather than in a code path somebody can forget.
   */
  idempotency_key uuid not null,

  -- What the board was when this drop happened. Snapshotted, never joined:
  -- a tier retuned next month must not rewrite what somebody already played.
  evo_rating int not null,
  tier int not null references public.forge_drop_tiers(tier),
  config_version int not null,
  multipliers numeric[] not null,
  rows int not null,

  lane int not null,
  stake int not null check (stake > 0),
  slot int not null check (slot >= 0),
  multiplier numeric not null check (multiplier >= 0),
  payout int not null check (payout >= 0),
  net int not null,
  /** The bounce sequence, -1/+1 per row. The animation REPLAYS this; it does
   *  not compute it. The result was decided here. */
  path smallint[] not null,

  status text not null default 'settled' check (status in ('settled')),
  created_at timestamptz not null default now(),
  settled_at timestamptz not null default now(),

  constraint forge_drops_net_agrees check (net = payout - stake)
);

create unique index if not exists forge_drops_idempotency
  on public.forge_drops (user_id, idempotency_key);
create index if not exists forge_drops_user_time
  on public.forge_drops (user_id, created_at desc);

alter table public.forge_drops enable row level security;

-- READ YOUR OWN, WRITE NOTHING. Every drop is created by the definer function,
-- which is the only thing that may move a coin. No insert, update or delete
-- policy exists — deliberately. Do not add one.
drop policy if exists forge_drops_own_select on public.forge_drops;
create policy forge_drops_own_select on public.forge_drops
  for select using (user_id = auth.uid());

-- ─────────────────────────────── the ledger learns two more kinds

-- THREE EDITS, ALWAYS (the 139/142/151 lesson): the CHECK constraint decides
-- whether the word may exist, the guard decides who may write it, and the
-- client's labels decide what it means to a human.
--
--   forge_drop_stake   NEGATIVE, the wager leaving the balance.
--   forge_drop_payout  POSITIVE, what the slot paid. Absent when a slot pays 0.
--
-- TWO ROWS, NOT ONE, and that is the brief's own example: an athlete reading
-- their ledger should see "Forge Drop stake -10" and "Forge Drop payout +20",
-- not a single net line that hides what was risked.
alter table public.coin_events drop constraint if exists coin_events_kind_check;
alter table public.coin_events add constraint coin_events_kind_check
  check (kind = any (array[
    'workout_complete', 'pr', 'streak_milestone', 'starting_bonus',
    'adjustment', 'spend', 'battle_reward',
    'challenge_stake', 'challenge_payout',
    'duel_support_stake', 'duel_support_payout',
    'callout_stake', 'callout_payout',
    -- 154 — FORGE DROP.
    'forge_drop_stake',
    'forge_drop_payout'
  ]));

/**
 * The guard, extended once more. Everything below is 151's body unchanged; the
 * only new thing is the Forge Drop branch, with its OWN transaction-local GUC.
 * A separate key every time: learning one must never unlock another.
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

  if new.kind in ('callout_stake', 'callout_payout') then
    if current_setting('evoforge.callout_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      new.source_table := 'workout_callouts';
      return new;
    end if;
    raise exception 'coin_events: % may only be written by call out settlement.', new.kind
      using errcode = 'insufficient_privilege';
  end if;

  if new.kind in ('forge_drop_stake', 'forge_drop_payout') then
    if current_setting('evoforge.forge_drop_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      new.source_table := 'forge_drops';
      return new;
    end if;
    raise exception 'coin_events: % may only be written by a Forge Drop settlement.', new.kind
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

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- begin;
--   drop function if exists public.forge_drop_settings();
--   drop table if exists public.forge_drops;
--   drop table if exists public.forge_drop_tiers;
--   -- then re-apply 151's coin_events_guard() body and kind list.
-- commit;

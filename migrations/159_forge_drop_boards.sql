-- EvoForge 159 — FORGE DROP: FIVE BOARDS, CHOSEN RATHER THAN ASSIGNED.
--
-- Until now the Evo Rating PICKED your board and that was the end of it. This
-- makes the five boards a place you travel through: every board you have passed
-- stays available, the ones ahead are visible with their real numbers, and any
-- of them can be opened early for coins plus logged training.
--
-- THREE THINGS CHANGED, AND ONE DELIBERATELY DID NOT.
--
--   1. THE GATES ARE NOW PER BOARD. Every tier used to run the same shape with
--      a different rim. Rustworks is now genuinely forgiving and Mythic is
--      genuinely brutal, and the rim runs 3x -> 5x -> 8x -> 12x -> 20x.
--   2. UNLOCKING BY RATING IS `rating >= evo_min`, NOT "inside the band".
--      Progressing must never take a board away — an athlete who reaches Evo 90
--      keeps Rustworks, because a 5-coin ceiling is sometimes exactly what
--      somebody wants.
--   3. A BOARD CAN BE BOUGHT EARLY, with coins AND logged sets. The coins are
--      the real price (the ledger guard recomputes them); the sets are a pacing
--      requirement, and are counted from `workout_log` — which is the only
--      place a training set exists. A Forge Drop play is a `forge_drops` row and
--      is structurally incapable of counting toward it.
--
--   AND: THE ECONOMIC INVARIANT DID NOT MOVE. Every LANE of every board still
--   returns less than it takes, and this migration now PROVES that in SQL
--   before it commits (see the exact-distribution check at the bottom) rather
--   than trusting a TypeScript test to notice afterwards.
--
-- WHAT THE NEW TABLES COST, HONESTLY: the briefed gate values return more than
-- the old ones did — the entry board goes from 80% to 93%. That is a weaker
-- coin sink, not an unsafe one, and it is a product decision recorded in
-- `target_rtp` where an UPDATE can revisit it without a deploy.

begin;

-- ─────────────────────────────────────────── what a board costs to open early

alter table public.forge_drop_tiers
  add column if not exists unlock_coins int check (unlock_coins is null or unlock_coins > 0),
  add column if not exists unlock_sets  int check (unlock_sets  is null or unlock_sets  > 0);

comment on column public.forge_drop_tiers.unlock_coins is
  'Early-access price in Forge Coins. NULL means the board has no early path — it opens with the rating alone (Rustworks).';
comment on column public.forge_drop_tiers.unlock_sets is
  'Counted training sets required alongside the coins. Read from workout_log only.';

/**
 * THE FIVE BOARDS, RETUNED.
 *
 * THIRTEEN GATES, NOT TWELVE, AND THE REASON IS THE WALK. A peg deflects the
 * puck by HALF a column, so the landing position is tracked in half columns and
 * an EVEN row count is what makes it land on a slot rather than between two.
 * Even rows means an ODD number of slots. Twelve gates would need eleven rows
 * and would leave every puck sitting on a divider — so the innermost value is
 * repeated once at dead centre, which is also the shape a Plinko board actually
 * has: a flat basin in the middle rather than a seam.
 *
 * The centre gate is the most likely slot on the board by a wide margin, so it
 * is the one that decides the return. It is deliberately the LOWEST value on
 * every board.
 *
 *   board                   rim    centre   best lane    ceiling
 *   RUSTWORKS               3x     0.85     93.4%        94%
 *   INDUSTRIAL FORGE        5x     0.80     91.7%        92%
 *   CYBER FOUNDRY           8x     0.78     93.7%        94%
 *   ADVANCED REACTOR       12x     0.70     90.9%        91%
 *   MYTHIC CELESTIAL FORGE 20x     0.60     89.3%        90%
 *
 * CLIMBING BUYS VARIANCE, NOT EDGE — AND THAT COLUMN IS FLAT, NOT MONOTONE.
 * READ IT CAREFULLY, BECAUSE IT IS EASY TO OVERSTATE AND IT WAS OVERSTATED HERE.
 *
 * The mechanism is real: with each step up the rim gets richer (3x -> 20x) and
 * the centre gate gets poorer (0.85 -> 0.60), and since the centre is ~22.6%
 * likely from the middle lane while the rim is about 1 in 341, the return falls
 * as the ceiling climbs. The ENDGAME board is strictly the least generous of the
 * five, which is the property that matters: nobody can unlock their way to the
 * best expected value in the app.
 *
 * BUT THE LADDER IS NOT STRICTLY DECREASING. Cyber Foundry's best lane returns
 * 93.74% against Rustworks' 93.37% — it is, by 0.37 of a point, the best edge of
 * the five. That comes out of the gate values as briefed: its near-rim gates
 * (1.7 / 1.4 / 1.1 / 0.95) are generous enough to outweigh a centre only 0.02
 * below Industrial Forge's. Nudging 0.78 to 0.75 would make the column monotone
 * and is a ONE-LINE CHANGE, but it would quietly retune a number that was
 * specified rather than derived, so the numbers stand and the docs say what is
 * true instead.
 *
 * Nothing here is unsafe: 0.37 of a point is not an arbitrage when every lane
 * still returns under 94% and the early-access price is 7,500 coins plus 250
 * logged sets. What WOULD be unsafe is a rebalance that lets the top board creep
 * above the ones below it, so the check at the bottom of this file pins the true
 * properties — top board strictly lowest, no board beating the entry board by
 * more than half a point, rim rising, centre falling — rather than the tidier
 * claim that is not quite the case.
 */
insert into public.forge_drop_tiers
  (tier, evo_min, evo_max, label, theme, max_stake, target_rtp, max_payout,
   multipliers, rows, lanes, unlock_coins, unlock_sets)
values
  (1, 0, 20, 'RUSTWORKS', 'rust', 5, 0.94, 15,
   array[3, 1.35, 1.15, 1.05, 0.95, 0.85, 0.85, 0.85, 0.95, 1.05, 1.15, 1.35, 3]::numeric[],
   12, array[5,6,7], null, null),
  (2, 21, 40, 'INDUSTRIAL FORGE', 'iron', 10, 0.92, 50,
   array[5, 1.5, 1.25, 1.08, 0.92, 0.8, 0.8, 0.8, 0.92, 1.08, 1.25, 1.5, 5]::numeric[],
   12, array[5,6,7], 2500, 100),
  (3, 41, 60, 'CYBER FOUNDRY', 'cyber', 15, 0.94, 120,
   array[8, 1.7, 1.4, 1.1, 0.95, 0.78, 0.78, 0.78, 0.95, 1.1, 1.4, 1.7, 8]::numeric[],
   12, array[5,6,7], 7500, 250),
  (4, 61, 80, 'ADVANCED REACTOR', 'reactor', 20, 0.91, 240,
   array[12, 2, 1.55, 1.15, 0.88, 0.7, 0.7, 0.7, 0.88, 1.15, 1.55, 2, 12]::numeric[],
   12, array[5,6,7], 25000, 600),
  (5, 81, 1000, 'MYTHIC CELESTIAL FORGE', 'celestial', 25, 0.90, 500,
   array[20, 2.5, 1.8, 1.2, 0.82, 0.6, 0.6, 0.6, 0.82, 1.2, 1.8, 2.5, 20]::numeric[],
   12, array[5,6,7], 75000, 1500)
on conflict (tier) do update set
  evo_min = excluded.evo_min, evo_max = excluded.evo_max,
  label = excluded.label, theme = excluded.theme,
  max_stake = excluded.max_stake, target_rtp = excluded.target_rtp,
  max_payout = excluded.max_payout, multipliers = excluded.multipliers,
  rows = excluded.rows, lanes = excluded.lanes,
  unlock_coins = excluded.unlock_coins, unlock_sets = excluded.unlock_sets,
  -- Bumped, so a drop settled on yesterday's table can still be read back
  -- against the table it was actually played on.
  config_version = public.forge_drop_tiers.config_version + 1,
  updated_at = now();

-- ────────────────────────────────────────────────────── boards bought early

create table if not exists public.forge_drop_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tier int not null references public.forge_drop_tiers(tier),
  /** What was actually charged, and what the athlete had at the time. Kept for
   *  the audit, never read back as an authority — the ledger is the authority. */
  coins_paid numeric(12,2) not null check (coins_paid > 0),
  sets_at_unlock int not null,
  rating_at_unlock int not null,
  created_at timestamptz not null default now(),
  /**
   * DUPLICATE-PURCHASE PREVENTION IS THIS INDEX, not a code path.
   *
   * Rapid taps, a refresh mid-request, an offline retry and two tabs are all
   * the same purchase, and all of them must charge once. A check-then-insert
   * in the function would lose that race; a unique constraint cannot.
   */
  constraint forge_drop_unlocks_once unique (user_id, tier)
);

create index if not exists forge_drop_unlocks_user on public.forge_drop_unlocks (user_id);

alter table public.forge_drop_unlocks enable row level security;

-- READ YOUR OWN, WRITE NOTHING. An unlock is a purchase; only the definer
-- function may make one. No insert, update or delete policy exists —
-- deliberately. Do not add one.
drop policy if exists forge_drop_unlocks_own_select on public.forge_drop_unlocks;
create policy forge_drop_unlocks_own_select on public.forge_drop_unlocks
  for select using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────── the two gates

/**
 * WHAT COUNTS AS A LOGGED TRAINING SET.
 *
 * `workout_log`, `reps > 0`, `weight >= 0` — the app's existing definition of a
 * counted set, the same one `coin_events_guard` uses to decide whether a day
 * earned its coins (and the same one 061 widened for bodyweight work, which is
 * why it is `>= 0` and not `> 0`).
 *
 * FORGE DROP PLAYS CANNOT COUNT. Not because they are filtered out, but because
 * a play is a row in `forge_drops` and this reads `workout_log`. There is no
 * write path from the board to this number.
 *
 * `workout_log` is self-reported, as everything in this app is. That is not a
 * hole here: the coins are the real price and the ledger guard recomputes them,
 * and a board opened early is a board that returns less than it takes. Faking
 * sets buys a faster way to lose coins.
 */
create or replace function public.forge_drop_counted_sets(p_user uuid)
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int
  from public.workout_log
  where user_id = p_user and reps > 0 and weight >= 0;
$$;
revoke execute on function public.forge_drop_counted_sets(uuid) from public, anon;
grant execute on function public.forge_drop_counted_sets(uuid) to authenticated;

/**
 * MAY THIS ATHLETE PLAY THIS BOARD?
 *
 * `rating >= evo_min` — every board you have passed stays yours — OR a purchase
 * row. One definition, used by the play function, the unlock function and the
 * board list, so the screen cannot offer a board settlement would refuse.
 */
create or replace function public.forge_drop_board_unlocked(p_user uuid, p_tier int)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.forge_drop_tiers t
    where t.tier = p_tier
      and (
        greatest(0, least(1000, coalesce(
          (select er.displayed_rating from public.evo_rating_current er where er.user_id = p_user), 0))) >= t.evo_min
        or exists (
          select 1 from public.forge_drop_unlocks u
          where u.user_id = p_user and u.tier = p_tier)
      )
  );
$$;
revoke execute on function public.forge_drop_board_unlocked(uuid, int) from public, anon;
grant execute on function public.forge_drop_board_unlocked(uuid, int) to authenticated;

-- ───────────────────────────────── the ledger learns one more kind (3 edits)

-- THREE EDITS, ALWAYS: the CHECK constraint decides whether the word may exist,
-- the guard decides who may write it, and the client's labels decide what it
-- means to a human. 139 taught the guard and not the constraint, and the first
-- real accept died one layer below the guard that had just approved it.
alter table public.coin_events drop constraint if exists coin_events_kind_check;
alter table public.coin_events add constraint coin_events_kind_check
  check (kind = any (array[
    'workout_complete', 'pr', 'streak_milestone', 'starting_bonus',
    'adjustment', 'spend', 'battle_reward',
    'challenge_stake', 'challenge_payout',
    'duel_support_stake', 'duel_support_payout',
    'callout_stake', 'callout_payout',
    'forge_drop_stake', 'forge_drop_payout',
    -- 159 — a board bought before the rating earned it.
    'forge_drop_unlock'
  ]));

/**
 * The guard, extended once more. Everything below is 154's body unchanged; the
 * only new thing is the board-purchase branch, with its OWN transaction-local
 * GUC. A separate key every time: authorising a drop must never authorise a
 * purchase.
 *
 * AND THE PRICE IS RECOMPUTED, NOT ACCEPTED. The amount is read back from
 * `forge_drop_tiers` through the unlock row, exactly as the XP guard reprices a
 * claimed award. Even a bug in the unlock function cannot charge the wrong
 * number.
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
  price numeric;
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

  if new.kind = 'forge_drop_unlock' then
    if current_setting('evoforge.forge_drop_unlock_authorized', true) is not distinct from new.source_id
       and new.source_id is not null then
      -- THE PRICE COMES FROM THE BOARD, not from the caller.
      select t.unlock_coins into price
      from public.forge_drop_unlocks u
      join public.forge_drop_tiers t on t.tier = u.tier
      where u.id = new.source_id::uuid and u.user_id = new.user_id;
      if price is null then
        raise exception 'coin_events: no board purchase matches %.', new.source_id
          using errcode = 'check_violation';
      end if;
      new.amount := -price;
      new.source_table := 'forge_drop_unlocks';
      return new;
    end if;
    raise exception 'coin_events: forge_drop_unlock may only be written by a board purchase.'
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

-- ────────────────────────────────────────────────────────── buying a board

/**
 * OPEN A BOARD EARLY.
 *
 * Idempotent by construction: the unique constraint decides, and a second call
 * — from a doubled tap, a refresh, a retry or another tab — returns
 * `{already: true}` and charges nothing. The advisory lock is the SAME key
 * `forge_drop_play` takes, so a purchase and a drop can never both spend the
 * last coins.
 *
 * The insert lands BEFORE the ledger row on purpose: the coin write is guarded
 * by a trigger that reads the unlock row back to price it, and if that guard
 * refuses, the whole transaction — unlock included — is gone.
 */
create or replace function public.forge_drop_unlock(p_tier int)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  t public.forge_drop_tiers;
  r int;
  sets int;
  bal numeric;
  new_id uuid := gen_random_uuid();
begin
  if me is null then
    raise exception 'forge_drop_unlock: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('evoforge.coin_spend:' || me::text, 0));

  select * into t from public.forge_drop_tiers where tier = p_tier;
  if not found then
    raise exception 'forge_drop_unlock: board % does not exist.', p_tier using errcode = 'no_data_found';
  end if;

  select greatest(0, least(1000, coalesce(displayed_rating, 0))) into r
  from public.evo_rating_current where user_id = me;
  r := coalesce(r, 0);

  -- Already yours, either way. Never charged twice, and never charged for
  -- something the rating already gave away.
  if r >= t.evo_min then
    return jsonb_build_object('already', true, 'tier', t.tier, 'label', t.label,
      'unlocked_by', 'rating', 'coins_paid', 0, 'balance', public.coin_total_exact());
  end if;
  if exists (select 1 from public.forge_drop_unlocks u where u.user_id = me and u.tier = p_tier) then
    return jsonb_build_object('already', true, 'tier', t.tier, 'label', t.label,
      'unlocked_by', 'purchase', 'coins_paid', 0, 'balance', public.coin_total_exact());
  end if;

  if t.unlock_coins is null or t.unlock_sets is null then
    raise exception 'forge_drop_unlock: % has no early path — it opens with your Evo Rating.', t.label
      using errcode = 'check_violation';
  end if;

  -- BOTH requirements, and the message says which one is short. A disabled
  -- button that does not say what is missing is a broken button.
  sets := public.forge_drop_counted_sets(me);
  if sets < t.unlock_sets then
    raise exception 'forge_drop_unlock: % needs % logged training sets — you have %.',
      t.label, t.unlock_sets, sets using errcode = 'check_violation';
  end if;
  bal := public.coin_total_exact();
  if bal < t.unlock_coins then
    raise exception 'forge_drop_unlock: % costs % coins — you have %.',
      t.label, t.unlock_coins, bal using errcode = 'check_violation';
  end if;

  insert into public.forge_drop_unlocks (id, user_id, tier, coins_paid, sets_at_unlock, rating_at_unlock)
  values (new_id, me, p_tier, t.unlock_coins, sets, r)
  on conflict (user_id, tier) do nothing;
  if not found then
    -- Somebody else's copy of this tap won the race. It paid; this one does not.
    return jsonb_build_object('already', true, 'tier', t.tier, 'label', t.label,
      'unlocked_by', 'purchase', 'coins_paid', 0, 'balance', public.coin_total_exact());
  end if;

  perform set_config('evoforge.forge_drop_unlock_authorized', new_id::text, true);
  insert into public.coin_events (user_id, kind, amount, source_id, source_table)
  values (me, 'forge_drop_unlock', -t.unlock_coins, new_id::text, 'forge_drop_unlocks');
  perform set_config('evoforge.forge_drop_unlock_authorized', '', true);

  return jsonb_build_object(
    'already', false, 'tier', t.tier, 'label', t.label, 'unlocked_by', 'purchase',
    'coins_paid', t.unlock_coins, 'sets_at_unlock', sets,
    'balance', public.coin_total_exact());
end;
$$;
revoke execute on function public.forge_drop_unlock(int) from public, anon;
grant execute on function public.forge_drop_unlock(int) to authenticated;

/**
 * EVERY BOARD, AND WHERE THIS ATHLETE STANDS AGAINST IT.
 *
 * One round trip for the whole carousel: the five boards with their real gate
 * tables, whether each is open and how, and the three numbers the locked cards
 * count against — rating, coins and counted sets. The client never assembles
 * this from separate reads, because a rating from one moment and a balance from
 * another is how a card offers a purchase the server then refuses.
 */
create or replace function public.my_forge_drop_boards()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  r int;
begin
  if me is null then
    raise exception 'my_forge_drop_boards: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  select greatest(0, least(1000, coalesce(displayed_rating, 0))) into r
  from public.evo_rating_current where user_id = me;

  return jsonb_build_object(
    'rating', r,                                   -- null when no review has run
    'sets', public.forge_drop_counted_sets(me),
    'balance', public.coin_total_exact(),
    'default_tier', (public.forge_drop_tier_for(me)).tier,
    'boards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tier', t.tier, 'label', t.label, 'theme', t.theme,
        'evo_min', t.evo_min, 'evo_max', t.evo_max,
        'min_stake', t.min_stake, 'max_stake', t.max_stake,
        'target_rtp', t.target_rtp, 'max_payout', t.max_payout,
        'multipliers', to_jsonb(t.multipliers), 'rows', t.rows, 'lanes', to_jsonb(t.lanes),
        'config_version', t.config_version,
        'unlock_coins', t.unlock_coins, 'unlock_sets', t.unlock_sets,
        'by_rating', coalesce(r, 0) >= t.evo_min,
        'purchased', u.tier is not null,
        'unlocked', coalesce(r, 0) >= t.evo_min or u.tier is not null,
        'purchased_at', u.created_at
      ) order by t.tier)
      from public.forge_drop_tiers t
      left join public.forge_drop_unlocks u on u.user_id = me and u.tier = t.tier
    ), '[]'::jsonb));
end;
$$;
revoke execute on function public.my_forge_drop_boards() from public, anon;
grant execute on function public.my_forge_drop_boards() to authenticated;

-- ──────────────────────────────────────── the drop lands on the CHOSEN board

/**
 * 155's body, with one new argument and one new refusal.
 *
 * `p_tier` NULL keeps the old behaviour exactly — the rating's own board — so a
 * client running the previous bundle is unaffected. A tier that IS given must
 * be one this athlete may play, checked here rather than trusted from the
 * screen: the selector is presentation, the entitlement is settlement.
 */
create or replace function public.forge_drop_play(
  p_key uuid,
  p_stake numeric,
  p_lane int,
  p_tier int default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  t public.forge_drop_tiers;
  existing public.forge_drops;
  bal numeric;
  col int;
  walk smallint[] := '{}';
  mult numeric;
  pay numeric;
  stake numeric;
  rating int;
  new_id uuid;
  reward jsonb := '{}'::jsonb;
begin
  if me is null then
    raise exception 'forge_drop_play: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if p_key is null then
    raise exception 'forge_drop_play: an idempotency key is required.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('evoforge.coin_spend:' || me::text, 0));

  select * into existing from public.forge_drops
  where user_id = me and idempotency_key = p_key;
  if found then
    return jsonb_build_object(
      'drop_id', existing.id, 'replayed', true,
      'tier', existing.tier, 'evo_rating', existing.evo_rating,
      'lane', existing.lane, 'stake', existing.stake, 'slot', existing.slot,
      'multiplier', existing.multiplier, 'payout', existing.payout, 'net', existing.net,
      'path', to_jsonb(existing.path), 'config_version', existing.config_version,
      'balance', public.coin_total_exact(),
      'xp', coalesce((select amount from public.xp_events
                      where user_id = me and source_table = 'forge_drops'
                        and source_id = existing.id), 0),
      'milestone', null, 'milestone_xp', 0,
      'drops_total', (select count(*)::int from public.forge_drops where user_id = me));
  end if;

  if p_tier is null then
    t := public.forge_drop_tier_for(me);
  else
    select * into t from public.forge_drop_tiers where tier = p_tier;
    if not found then
      raise exception 'forge_drop_play: board % does not exist.', p_tier using errcode = 'no_data_found';
    end if;
    if not public.forge_drop_board_unlocked(me, p_tier) then
      raise exception 'forge_drop_play: % is still locked.', t.label
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if t.tier is null then
    raise exception 'forge_drop_play: no board is configured.' using errcode = 'no_data_found';
  end if;
  select coalesce(displayed_rating, 0) into rating from public.evo_rating_current where user_id = me;
  rating := coalesce(rating, 0);

  -- Stakes stay whole coins. Cents are something the BOARD pays out, not
  -- something the athlete has to count out — a chip is a chip.
  stake := round(coalesce(p_stake, 0), 0);
  if stake < t.min_stake or stake > t.max_stake then
    raise exception 'forge_drop_play: stake must be between % and % on this board.',
      t.min_stake, t.max_stake using errcode = 'check_violation';
  end if;
  if p_lane is null or not (p_lane = any (t.lanes)) then
    raise exception 'forge_drop_play: lane % is not on this board.', p_lane
      using errcode = 'check_violation';
  end if;

  bal := public.coin_total_exact();
  if bal < stake then
    raise exception 'forge_drop_play: you have % coins, not %.', bal, stake
      using errcode = 'check_violation';
  end if;

  walk := public.forge_drop_walk(t.rows, p_lane);
  col := public.forge_drop_slot(p_lane, walk);
  mult := t.multipliers[col + 1];

  -- EXACT, TO THE CENT (158). Each board's published return is true by
  -- construction rather than in expectation.
  pay := round(stake * mult, 2);

  new_id := gen_random_uuid();

  insert into public.forge_drops (
    id, user_id, idempotency_key, evo_rating, tier, config_version,
    multipliers, rows, lane, stake, slot, multiplier, payout, net, path
  ) values (
    new_id, me, p_key, rating, t.tier, t.config_version,
    t.multipliers, t.rows, p_lane, stake, col, mult, pay, pay - stake, walk
  );

  perform set_config('evoforge.forge_drop_authorized', new_id::text, true);

  insert into public.coin_events (user_id, kind, amount, source_id, source_table)
  values (me, 'forge_drop_stake', -stake, new_id::text, 'forge_drops');

  if pay > 0 then
    insert into public.coin_events (user_id, kind, amount, source_id, source_table)
    values (me, 'forge_drop_payout', pay, new_id::text, 'forge_drops');
  end if;

  perform set_config('evoforge.forge_drop_authorized', '', true);

  begin
    reward := public.forge_drop_award_xp(me, new_id);
  exception when others then
    reward := jsonb_build_object('xp', 0, 'milestone', null, 'milestone_xp', 0);
  end;

  return jsonb_build_object(
    'drop_id', new_id, 'replayed', false,
    'tier', t.tier, 'evo_rating', rating,
    'lane', p_lane, 'stake', stake, 'slot', col,
    'multiplier', mult, 'payout', pay, 'net', pay - stake,
    'path', to_jsonb(walk), 'config_version', t.config_version,
    'balance', public.coin_total_exact())
    || reward;
end;
$$;

-- The three-argument signature must not linger beside the four-argument one:
-- `p_tier` defaults, so a client that sends three keys still resolves here, and
-- two overloads would make which one PostgREST picks a coin toss.
drop function if exists public.forge_drop_play(uuid, numeric, int);

revoke execute on function public.forge_drop_play(uuid, numeric, int, int) from public, anon;
grant execute on function public.forge_drop_play(uuid, numeric, int, int) to authenticated;

-- ───────────────────────────────────────── THE INVARIANT, PROVEN NOT ASSUMED

-- The promise on the tin: max_payout is exactly what the best multiplier pays
-- at the stake ceiling, or the UI advertises a number the board cannot produce.
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

/**
 * EVERY LANE OF EVERY BOARD RETURNS LESS THAN IT TAKES — CHECKED HERE.
 *
 * The exact distribution, by enumerating the walk rather than sampling it: 2^12
 * routes per lane, reflecting at the walls exactly as `forge_drop_walk` does,
 * summed into the slot each one ends in. Sampling would need a hundred thousand
 * drops to distinguish 94% from 101% with any confidence; this is arithmetic
 * and it is exact.
 *
 * Re-applying this file after editing a multiplier therefore cannot ship a
 * board that pays out more than it takes — the migration refuses to commit. A
 * guard that only lives in a TypeScript test is a guard that a SQL rebalance
 * walks straight past, and rebalancing in SQL is the whole point of the config
 * table.
 */
do $$
declare bad text;
begin
  with recursive
  seed as (
    select t.tier, t.label, t.rows, t.multipliers, t.target_rtp, l as lane,
           0 as step, 2 * l as h, 1.0::numeric as p
    from public.forge_drop_tiers t, unnest(t.lanes) l
  ),
  walk as (
    select * from seed
    union all
    select w.tier, w.label, w.rows, w.multipliers, w.target_rtp, w.lane,
           w.step + 1,
           case when w.h + d.s < 0 or w.h + d.s > 2 * w.rows then w.h - d.s else w.h + d.s end,
           w.p / 2
    from walk w cross join (values (-1), (1)) as d(s)
    where w.step < w.rows
  ),
  rtps as (
    select tier, label, lane, target_rtp,
           sum(p * multipliers[h / 2 + 1]) as rtp
    from walk where step = rows
    group by tier, label, lane, target_rtp
  )
  select string_agg(format('%s lane %s returns %s%%', label, lane, round(rtp * 100, 2)), '; ')
    into bad
  from rtps
  where rtp >= 1 or rtp >= 0.95 or rtp > target_rtp + 0.01;

  if bad is not null then
    raise exception 'forge_drop_tiers: a board returns too much — %', bad;
  end if;
end $$;

/**
 * CLIMBING MUST NOT BUY EDGE — THE FIVE BOARDS CHECKED AGAINST EACH OTHER.
 *
 * The check above asks each board about its own promises, which is why it has
 * nothing to say about the one risk that only exists BETWEEN boards: a rebalance
 * that leaves the top of the ladder returning more than the bottom, turning the
 * unlock price into the entry fee for the best expected value in the app.
 *
 * FOUR PROPERTIES, AND THEY ARE THE TRUE ONES RATHER THAN THE TIDY ONES. The
 * returns are FLAT, not monotone — Cyber Foundry is 0.37 of a point above
 * Rustworks on the briefed gate values (see the note at the top). Asserting
 * strict monotonicity here would fail on the numbers as specified, so the
 * tolerance is what is actually promised:
 *
 *   1. the ENDGAME board returns strictly less than every board below it
 *   2. no board beats the ENTRY board by more than half a point
 *   3. the rim rises at every step        — otherwise there is no reason to climb
 *   4. the centre gate falls at every step — the mechanism that pays for the rim
 *
 * 3 and 4 are the shape, and they are checked because a table that satisfies the
 * return bounds by accident while inverting the shape is a board where the top
 * tier is simply better — the same arbitrage arriving through another door.
 */
do $$
declare bad text;
begin
  with recursive
  seed as (
    select t.tier, t.label, t.rows, t.multipliers, l as lane,
           0 as step, 2 * l as h, 1.0::numeric as p
    from public.forge_drop_tiers t, unnest(t.lanes) l
  ),
  walk as (
    select * from seed
    union all
    select w.tier, w.label, w.rows, w.multipliers, w.lane, w.step + 1,
           case when w.h + d.s < 0 or w.h + d.s > 2 * w.rows then w.h - d.s else w.h + d.s end,
           w.p / 2
    from walk w cross join (values (-1), (1)) as d(s)
    where w.step < w.rows
  ),
  best as (
    select tier, label,
           max(rtp) as rtp,
           -- the rim and the dead-centre gate, straight off the table
           max(multipliers[1]) as rim,
           max(multipliers[array_length(multipliers, 1) / 2 + 1]) as centre
    from (
      select tier, label, lane, multipliers, sum(p * multipliers[h / 2 + 1]) as rtp
      from walk where step = rows
      group by tier, label, lane, multipliers
    ) per_lane
    group by tier, label
  ),
  ends as (
    select
      (select rtp   from best order by tier asc  limit 1) as entry_rtp,
      (select label from best order by tier asc  limit 1) as entry_label,
      (select rtp   from best order by tier desc limit 1) as top_rtp,
      (select label from best order by tier desc limit 1) as top_label,
      (select max(tier) from best) as top_tier
  ),
  steps as (
    select b.label, b.rim, b.centre,
           lag(b.label)  over (order by b.tier) as below_label,
           lag(b.rim)    over (order by b.tier) as below_rim,
           lag(b.centre) over (order by b.tier) as below_centre
    from best b
  )
  select string_agg(msg, '; ') into bad from (
    -- 1. the endgame board is strictly the least generous
    select format('%s (the endgame board) returns %s%% but %s returns %s%% — the top board must be strictly the least generous',
                  e.top_label, round(e.top_rtp * 100, 2), b.label, round(b.rtp * 100, 2)) as msg
    from best b cross join ends e
    where b.tier < e.top_tier and b.rtp <= e.top_rtp
    union all
    -- 2. nothing beats the entry board by more than half a point
    select format('%s returns %s%%, more than half a point above the entry board %s at %s%%',
                  b.label, round(b.rtp * 100, 2), e.entry_label, round(e.entry_rtp * 100, 2))
    from best b cross join ends e
    where b.rtp > e.entry_rtp + 0.005
    union all
    -- 3. and 4. the shape behind it
    select format('%s rim %s is not above %s rim %s', label, rim, below_label, below_rim)
    from steps where below_rim is not null and rim <= below_rim
    union all
    select format('%s centre %s is not below %s centre %s', label, centre, below_label, below_centre)
    from steps where below_centre is not null and centre >= below_centre
  ) problems;

  if bad is not null then
    raise exception 'forge_drop_tiers: the progression is backwards — %', bad;
  end if;
end $$;

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- begin;
--   drop function if exists public.forge_drop_unlock(int);
--   drop function if exists public.my_forge_drop_boards();
--   drop function if exists public.forge_drop_board_unlocked(uuid, int);
--   drop function if exists public.forge_drop_counted_sets(uuid);
--   drop table if exists public.forge_drop_unlocks;
--   alter table public.forge_drop_tiers drop column unlock_coins, drop column unlock_sets;
--   -- then re-apply 154's tier rows + kind list and 158's forge_drop_play.
-- commit;

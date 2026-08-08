-- EvoForge 155 — FORGE DROP: one function, one transaction, one settlement.
--
-- `forge_drop_play` validates, debits, resolves, credits and records in a
-- SINGLE statement's transaction. There is no half-played drop to recover from,
-- because there is no moment at which one exists: either the row, both ledger
-- entries and the result are all there, or none of them are.
--
-- THE FOUR THINGS THAT MAKE IT TRUSTWORTHY:
--
--   1. THE RESULT IS DECIDED HERE. The client sends a stake and a lane and
--      receives an outcome. It never proposes a slot, and the path it animates
--      is a REPLAY of a walk this function already took.
--   2. IDEMPOTENCE IS A UNIQUE INDEX, not a code path. The client mints a key
--      before it asks; a retry, a refresh, a doubled tap and a reconnect all
--      return the original drop and charge nothing.
--   3. THE BALANCE IS THE LEDGER. `coin_total()` is sum(amount), so a debit is
--      a negative row and a coin cannot be staked twice from two tabs.
--   4. THE BOARD IS SNAPSHOTTED ONTO THE DROP. Retuning a tier tomorrow cannot
--      rewrite what somebody played today.

begin;

/**
 * WHICH BOARD IS THIS ATHLETE ON?
 *
 * The Evo Rating is computed CLIENT-side and written to `evo_rating_current`
 * (the review's trust boundary, recorded in HANDOVER: "a user can only mis-rate
 * THEMSELVES"). Forge Drop reads it anyway, and that is a considered decision
 * rather than an oversight:
 *
 *   EVERY TIER RETURNS LESS THAN IT TAKES. A faked rating unlocks a bigger
 *   stake and a slightly better table — both still below 100% — so the whole
 *   prize for cheating is a faster way to lose coins. There is no configuration
 *   of this board on which self-reporting pays.
 *
 * The rating is stamped onto every drop, so an audit can see exactly what was
 * claimed; and the day the Evo Rating is recomputed server-side, Forge Drop
 * inherits it for nothing, because it reads the same column.
 *
 * No row yet (no review has ever run) is not an error — it is tier 1.
 */
create or replace function public.forge_drop_tier_for(p_user uuid)
returns public.forge_drop_tiers
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  r int;
  t public.forge_drop_tiers;
begin
  select greatest(0, least(1000, coalesce(displayed_rating, 0)))
    into r
  from public.evo_rating_current where user_id = p_user;
  r := coalesce(r, 0);
  select * into t from public.forge_drop_tiers
  where r between evo_min and evo_max
  order by tier limit 1;
  if not found then
    -- Ratings outside every band still get a board: the lowest one.
    select * into t from public.forge_drop_tiers order by tier limit 1;
  end if;
  return t;
end;
$$;
revoke execute on function public.forge_drop_tier_for(uuid) from public, anon;
grant execute on function public.forge_drop_tier_for(uuid) to authenticated;

/**
 * THE WALK — extracted, so it can be SAMPLED without moving a coin.
 *
 * `forge_drop_play` calls this and nothing else decides a slot. Pulling it out
 * is what lets tools/falsify-forge-drop.mjs run a hundred thousand drops
 * through the REAL resolver and check the board pays what it advertises —
 * verifying a re-implementation would only ever prove the re-implementation.
 *
 * A PEG DEFLECTS BY HALF A COLUMN, so the position is tracked in half columns:
 * `h` runs 0 … 2*rows and the landing slot is h/2. Whole-column steps would
 * leave only every OTHER slot reachable and dump the walk against the rim,
 * where the biggest multiplier lives.
 *
 * REFLECTING at the walls, never clamping: clamping parks probability on the
 * rim, which is the difference between an 80% board and one that pays out more
 * than it takes.
 */
create or replace function public.forge_drop_walk(p_rows int, p_lane int)
returns smallint[]
language plpgsql
volatile
as $$
declare
  h int := 2 * p_lane;
  step int;
  i int;
  walk smallint[] := '{}';
begin
  for i in 1..p_rows loop
    step := case when random() < 0.5 then -1 else 1 end;
    if h + step < 0 or h + step > 2 * p_rows then
      step := -step;   -- reflect, never clamp
    end if;
    h := h + step;
    walk := walk || step::smallint;
  end loop;
  return walk;
end;
$$;
grant execute on function public.forge_drop_walk(int, int) to authenticated;

/** Where a path ends up. Pure, so a stored drop can always be re-checked
 *  against the route it recorded. */
create or replace function public.forge_drop_slot(p_lane int, p_path smallint[])
returns int
language sql
immutable
as $$
  select (2 * p_lane + coalesce((select sum(s) from unnest(p_path) s), 0)) / 2;
$$;
grant execute on function public.forge_drop_slot(int, smallint[]) to authenticated;

/**
 * PLAY ONE DROP.
 *
 * `p_key` is the client's idempotency key, minted BEFORE the request. Send the
 * same key twice and you get the same drop back, uncharged — which is what
 * makes a refresh mid-animation, a flaky tunnel and an impatient double tap all
 * safe by construction.
 */
create or replace function public.forge_drop_play(
  p_key uuid,
  p_stake int,
  p_lane int
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
  bal int;
  col int;
  walk smallint[] := '{}';
  mult numeric;
  pay int;
  rating int;
  new_id uuid;
begin
  if me is null then
    raise exception 'forge_drop_play: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if p_key is null then
    raise exception 'forge_drop_play: an idempotency key is required.' using errcode = 'check_violation';
  end if;

  -- ── 1. THE SAME REQUEST TWICE IS THE SAME DROP ──────────────────────────
  -- Checked FIRST and re-checked by the unique index below, so two tabs racing
  -- the same key cannot both settle.
  select * into existing from public.forge_drops
  where user_id = me and idempotency_key = p_key;
  if found then
    return jsonb_build_object(
      'drop_id', existing.id, 'replayed', true,
      'tier', existing.tier, 'evo_rating', existing.evo_rating,
      'lane', existing.lane, 'stake', existing.stake, 'slot', existing.slot,
      'multiplier', existing.multiplier, 'payout', existing.payout, 'net', existing.net,
      'path', to_jsonb(existing.path), 'config_version', existing.config_version,
      'balance', public.coin_total());
  end if;

  -- ── 2. THE BOARD, AND WHETHER THIS WAGER IS ALLOWED ON IT ───────────────
  t := public.forge_drop_tier_for(me);
  if t.tier is null then
    raise exception 'forge_drop_play: no board is configured.' using errcode = 'no_data_found';
  end if;
  select coalesce(displayed_rating, 0) into rating from public.evo_rating_current where user_id = me;
  rating := coalesce(rating, 0);

  if p_stake is null or p_stake < t.min_stake or p_stake > t.max_stake then
    raise exception 'forge_drop_play: stake must be between % and % on this board.',
      t.min_stake, t.max_stake using errcode = 'check_violation';
  end if;
  if p_lane is null or not (p_lane = any (t.lanes)) then
    raise exception 'forge_drop_play: lane % is not on this board.', p_lane
      using errcode = 'check_violation';
  end if;

  bal := public.coin_total();
  if bal < p_stake then
    raise exception 'forge_drop_play: you have % coins, not %.', bal, p_stake
      using errcode = 'check_violation';
  end if;

  -- ── 3. THE WALK. This is the result; everything after it is bookkeeping ──
  --
  -- `random()` is Postgres's, on the server. No part of it is derived from
  -- anything the client sent, and none of it is returned before it is spent.
  -- The walk itself lives in `forge_drop_walk` so the harness can sample the
  -- REAL resolver a hundred thousand times without moving a coin.
  walk := public.forge_drop_walk(t.rows, p_lane);
  col := public.forge_drop_slot(p_lane, walk);

  mult := t.multipliers[col + 1];

  -- THE FRACTION IS PAID AS A PROBABILITY, NOT DISCARDED.
  --
  -- A payout has to be whole coins. Flooring it is the obvious rule and it is
  -- WRONG: it loses up to a coin on every drop regardless of stake, so a
  -- 1-coin stake on a board advertised at 86% actually returned 15%, and no
  -- stake on any tier ever reached its published figure. The number on the
  -- screen was for a continuous game nobody was playing.
  --
  -- So 10.5 coins is 10 coins and a coin-flip for the eleventh. E[payout] is
  -- exactly `stake * multiplier`, which makes each tier's target RTP true at
  -- EVERY stake instead of only in the limit — and strictly better for the
  -- athlete than flooring, at every stake, on every board.
  --
  -- It cannot overpay the published ceiling: every tier's top multiplier times
  -- its max stake is already a whole number (3x5, 3.5x10, 4x15, 5x20, 6x25),
  -- so the biggest advertised payout has no fraction left to round up.
  pay := floor(p_stake * mult)::int
       + case when random() < (p_stake * mult) - floor(p_stake * mult) then 1 else 0 end;

  -- ── 4. DEBIT AND CREDIT, IN THIS TRANSACTION ────────────────────────────
  new_id := gen_random_uuid();

  insert into public.forge_drops (
    id, user_id, idempotency_key, evo_rating, tier, config_version,
    multipliers, rows, lane, stake, slot, multiplier, payout, net, path
  ) values (
    new_id, me, p_key, rating, t.tier, t.config_version,
    t.multipliers, t.rows, p_lane, p_stake, col, mult, pay, pay - p_stake, walk
  );

  perform set_config('evoforge.forge_drop_authorized', new_id::text, true);
  insert into public.coin_events (user_id, kind, amount, source_id)
  values (me, 'forge_drop_stake', -p_stake, new_id::text);
  if pay > 0 then
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (me, 'forge_drop_payout', pay, new_id::text);
  end if;

  -- ── 5. THE AUTHORITATIVE ANSWER, AND THE BALANCE THAT PROVES IT ─────────
  return jsonb_build_object(
    'drop_id', new_id, 'replayed', false,
    'tier', t.tier, 'evo_rating', rating,
    'lane', p_lane, 'stake', p_stake, 'slot', col,
    'multiplier', mult, 'payout', pay, 'net', pay - p_stake,
    'path', to_jsonb(walk), 'config_version', t.config_version,
    'balance', public.coin_total());
exception
  when unique_violation then
    -- TWO TABS, ONE KEY, ONE DROP. The index refused the second insert; return
    -- what the first one settled rather than an error the athlete cannot act on.
    select * into existing from public.forge_drops
    where user_id = me and idempotency_key = p_key;
    if found then
      return jsonb_build_object(
        'drop_id', existing.id, 'replayed', true,
        'tier', existing.tier, 'evo_rating', existing.evo_rating,
        'lane', existing.lane, 'stake', existing.stake, 'slot', existing.slot,
        'multiplier', existing.multiplier, 'payout', existing.payout, 'net', existing.net,
        'path', to_jsonb(existing.path), 'config_version', existing.config_version,
        'balance', public.coin_total());
    end if;
    raise;
end;
$$;
grant execute on function public.forge_drop_play(uuid, int, int) to authenticated;

/**
 * FETCH A DROP BY ITS KEY.
 *
 * The recovery path: when a client cannot tell whether its request landed —
 * the tunnel died between the write and the reply — it ASKS rather than
 * wagering again. Returns null when the key was never played, which is the
 * signal that it is safe to send it.
 */
create or replace function public.forge_drop_fetch(p_key uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  d public.forge_drops;
begin
  if me is null then
    raise exception 'forge_drop_fetch: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  select * into d from public.forge_drops where user_id = me and idempotency_key = p_key;
  if not found then return null; end if;
  return jsonb_build_object(
    'drop_id', d.id, 'replayed', true,
    'tier', d.tier, 'evo_rating', d.evo_rating,
    'lane', d.lane, 'stake', d.stake, 'slot', d.slot,
    'multiplier', d.multiplier, 'payout', d.payout, 'net', d.net,
    'path', to_jsonb(d.path), 'config_version', d.config_version,
    'balance', public.coin_total());
end;
$$;
grant execute on function public.forge_drop_fetch(uuid) to authenticated;

/** The athlete's own recent drops. Owner-only by RLS; this exists so the
 *  history reads in one round trip with the multiplier already resolved. */
create or replace function public.my_forge_drops(p_limit int default 20)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
  from (
    select id, tier, lane, stake, slot, multiplier, payout, net, created_at
    from public.forge_drops
    where user_id = auth.uid()
    order by created_at desc
    limit greatest(1, least(100, coalesce(p_limit, 20)))
  ) x;
$$;
grant execute on function public.my_forge_drops(int) to authenticated;

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- begin;
--   drop function if exists public.my_forge_drops(int);
--   drop function if exists public.forge_drop_fetch(uuid);
--   drop function if exists public.forge_drop_play(uuid, int, int);
--   drop function if exists public.forge_drop_tier_for(uuid);
-- commit;

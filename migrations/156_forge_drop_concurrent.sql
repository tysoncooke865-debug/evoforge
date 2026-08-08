-- 156 · FORGE DROP, CONCURRENTLY
--
-- Forge Drop was built to be played one drop at a time, and one drop at a time
-- it was correct. The redesign lets an athlete flick a second chip while the
-- first is still falling, and that turns a latent bug into a live one:
--
--   `forge_drop_play` read the balance with `bal := public.coin_total()` and
--   compared it to the stake WITHOUT A LOCK. Two transactions read the same
--   balance, both decide they can afford it, and both debit.
--
-- Measured before this migration, against production: six concurrent drops of
-- five coins each, fired at a TEN coin balance, were ALL SIX accepted. Thirty
-- coins staked out of ten. Nothing was refused, and the ledger went on to
-- record every one of them, because append-only ledgers do not notice.
--
-- The fix is a transaction-scoped advisory lock, per user, taken before the
-- balance is read and released when the transaction ends:
--
--   * It serialises only this athlete's coin spending. Two different athletes
--     never contend.
--   * The transaction is short — a walk, two inserts — so the queue behind it
--     is measured in milliseconds, not in anything a thumb can feel.
--   * It is transaction-scoped (`_xact_`), so a failed statement, a raised
--     exception or a dropped connection releases it. There is no lock to leak
--     and no unlock to forget.
--
-- The key is namespaced `evoforge.coin_spend:<user>` rather than
-- `forge_drop:<user>` DELIBERATELY. The same race exists in principle between
-- ANY two coin spenders — a duel accept and a drop, a callout stake and a
-- cosmetic purchase. Naming the lock after the resource instead of the feature
-- means the next spender to adopt it is protected against the ones already
-- here, rather than protected only against itself.
--
-- Also adds `forge_drop_fetch_many`, because restoring after a refresh now
-- means asking about several in-flight drops at once, and N round trips to
-- answer "did any of these land?" is N chances to be interrupted again.

-- ── forge_drop_play, with the lock ──────────────────────────────────────────
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

  -- ── 0. ONE SPENDER AT A TIME, FOR THIS ATHLETE ──────────────────────────
  --
  -- Everything below reads a balance and then decides. Without this line two
  -- concurrent drops both read the balance BEFORE either has written, both
  -- conclude they can afford it, and the athlete spends the same coins twice.
  -- That is not theoretical: six concurrent five-coin drops against a ten-coin
  -- balance were all six accepted.
  --
  -- Taken before the replay check as well, so a key arriving twice at once
  -- queues rather than racing the insert that is about to make it a duplicate.
  perform pg_advisory_xact_lock(hashtextextended('evoforge.coin_spend:' || me::text, 0));

  -- ── 1. THE SAME REQUEST TWICE IS THE SAME DROP ──────────────────────────
  -- Checked here and re-checked by the unique index below, so two tabs racing
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

  -- Read under the lock. This is the line the lock exists for.
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
  -- stake on any tier ever reached its published figure.
  --
  -- So 10.5 coins is 10 coins and a coin-flip for the eleventh. E[payout] is
  -- exactly `stake * multiplier`, which makes each tier's target RTP true at
  -- EVERY stake instead of only in the limit.
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

  insert into public.coin_events (user_id, kind, amount, source_id, source_table)
  values (me, 'forge_drop_stake', -p_stake, new_id::text, 'forge_drops');

  if pay > 0 then
    insert into public.coin_events (user_id, kind, amount, source_id, source_table)
    values (me, 'forge_drop_payout', pay, new_id::text, 'forge_drops');
  end if;

  perform set_config('evoforge.forge_drop_authorized', '', true);

  return jsonb_build_object(
    'drop_id', new_id, 'replayed', false,
    'tier', t.tier, 'evo_rating', rating,
    'lane', p_lane, 'stake', p_stake, 'slot', col,
    'multiplier', mult, 'payout', pay, 'net', pay - p_stake,
    'path', to_jsonb(walk), 'config_version', t.config_version,
    'balance', public.coin_total());
end;
$$;

revoke execute on function public.forge_drop_play(uuid, int, int) from public, anon;
grant execute on function public.forge_drop_play(uuid, int, int) to authenticated;

-- ── RESTORING SEVERAL DROPS AT ONCE ─────────────────────────────────────────
--
-- With concurrent drops there can be up to five keys on disk when a tab is
-- closed. Asking about them one at a time is five round trips on a connection
-- that has already proven itself unreliable — that is how a recovery path
-- becomes the thing that needs recovering.
--
-- Returns one row per key that actually settled. A key that never played is
-- simply absent, which is the signal that no coins were taken and it can be
-- discarded. Owner-scoped by `auth.uid()`, so this cannot be used to read
-- anybody else's drops even with a stolen key.
create or replace function public.forge_drop_fetch_many(p_keys uuid[])
returns jsonb
language sql
security definer
set search_path to 'public'
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'drop_id', d.id, 'replayed', true, 'idempotency_key', d.idempotency_key,
           'tier', d.tier, 'evo_rating', d.evo_rating,
           'lane', d.lane, 'stake', d.stake, 'slot', d.slot,
           'multiplier', d.multiplier, 'payout', d.payout, 'net', d.net,
           'path', to_jsonb(d.path), 'config_version', d.config_version,
           'created_at', d.created_at
         ) order by d.created_at), '[]'::jsonb)
  from public.forge_drops d
  where d.user_id = auth.uid()
    and d.idempotency_key = any (coalesce(p_keys, '{}'::uuid[]));
$$;

revoke execute on function public.forge_drop_fetch_many(uuid[]) from public, anon;
grant execute on function public.forge_drop_fetch_many(uuid[]) to authenticated;

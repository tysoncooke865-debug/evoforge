-- 158 · FORGE COINS TO TWO DECIMAL PLACES
--
-- A 1-coin chip landing on x0.89 should return 0.89 and cost 11 cents. It
-- could not: `coin_events.amount` was an integer, so every payout had to be a
-- whole coin.
--
-- That integer is also why 155 pays the fraction as a PROBABILITY — 10.5 coins
-- became 10 coins and a coin-flip for the eleventh, because there was no way to
-- pay half a coin. With two decimal places that machinery is obsolete: the
-- payout is simply exact, which is both simpler and more honest. The RTP it was
-- protecting is now true by construction rather than in expectation.
--
-- THE DANGEROUS PART IS NOT FORGE DROP, IT IS EVERYTHING ELSE.
--
-- Twenty-two functions read this ledger — duels, call-outs, challenges,
-- cosmetics, battle rewards. Most hold a balance in a plpgsql `int` variable,
-- and assigning a numeric to an int in plpgsql ROUNDS: an athlete with 10.60
-- coins would read as 11 and could accept an 11-coin duel, ending at -0.40.
--
-- So `coin_total()` KEEPS RETURNING AN INTEGER, and it now returns the FLOOR
-- of the exact balance. Every existing spend gate therefore becomes strictly
-- conservative — it can under-report a balance by up to 99 cents but can never
-- over-report it, and an under-report refuses a spend rather than allowing a
-- bad one. Nineteen functions are left completely untouched, which is the
-- whole point: a ledger migration that rewrites every caller is a ledger
-- migration that breaks one of them.
--
-- `coin_total_exact()` is the new numeric reading, used by Forge Drop and by
-- the wallet display, where the cents actually matter.

begin;

-- ── the ledger itself ───────────────────────────────────────────────────────
-- Existing whole-coin rows become x.00. No value changes; only the type widens.
alter table public.coin_events
  alter column amount type numeric(12,2) using amount::numeric(12,2);

-- The guard's own arithmetic follows the column, and `amount <> 0` still holds.

-- ── Forge Drop's own columns ────────────────────────────────────────────────
alter table public.forge_drops
  alter column stake  type numeric(12,2) using stake::numeric(12,2),
  alter column payout type numeric(12,2) using payout::numeric(12,2),
  alter column net    type numeric(12,2) using net::numeric(12,2);

-- ── the two readings ────────────────────────────────────────────────────────

/**
 * THE CONSERVATIVE READING — unchanged signature, unchanged callers.
 *
 * Floored on purpose. Nineteen functions gate a spend on this through an `int`
 * variable, and plpgsql ROUNDS on assignment; flooring here means the worst a
 * legacy caller can do is refuse a spend somebody could just afford, never
 * allow one they cannot.
 */
create or replace function public.coin_total()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select floor(coalesce(sum(amount), 0))::int
  from public.coin_events
  where user_id = auth.uid();
$$;

/** THE EXACT READING. Cents included — the wallet and Forge Drop use this. */
create or replace function public.coin_total_exact()
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select round(coalesce(sum(amount), 0), 2)
  from public.coin_events
  where user_id = auth.uid();
$$;

revoke execute on function public.coin_total_exact() from public, anon;
grant execute on function public.coin_total_exact() to authenticated;

-- ── the drop pays exactly what the board says ───────────────────────────────
create or replace function public.forge_drop_play(
  p_key uuid,
  p_stake numeric,
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

  t := public.forge_drop_tier_for(me);
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

  -- EXACT, TO THE CENT. The probabilistic rounding 155 introduced existed only
  -- because a payout had to be a whole coin; there is nothing left to round.
  -- Each tier's published RTP is now true by construction rather than in
  -- expectation, which is a strictly stronger promise.
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

-- The old integer signature must not linger: two overloads would make which
-- one PostgREST picks a coin toss.
drop function if exists public.forge_drop_play(uuid, int, int);

revoke execute on function public.forge_drop_play(uuid, numeric, int) from public, anon;
grant execute on function public.forge_drop_play(uuid, numeric, int) to authenticated;

-- XP is priced from the stake, which is now numeric.
create or replace function public.forge_drop_xp_for(p_stake numeric, p_multiplier numeric, p_top numeric)
returns int
language sql
immutable
as $$
  select greatest(1,
    1 + floor(coalesce(p_stake, 0) / 3.0)::int
      + case
          when p_top is not null and p_multiplier >= p_top - 1e-9 then 6
          when p_multiplier >= 1.4 then 2
          else 0
        end
  );
$$;

drop function if exists public.forge_drop_xp_for(int, numeric, numeric);

-- `forge_drop_fetch` and `my_forge_drops` return the row's own columns, which
-- have widened with the table — nothing there needs re-issuing.

commit;

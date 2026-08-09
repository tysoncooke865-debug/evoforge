-- 157 · FORGE XP AND MILESTONES FOR FORGE DROP
--
-- Coins alone make a x0.7 feel like nothing happened. This adds a second,
-- smaller reward that every completed drop earns — and it is built so that it
-- cannot be farmed, cannot be duplicated, and cannot be inflated by anything
-- the client says.
--
-- THE THREE PROPERTIES, AND WHERE EACH ONE IS ENFORCED:
--
--   EXACTLY ONCE PER DROP — `xp_events_source_uidx`, the existing unique index
--   on (user_id, source_table, source_id). A drop's XP row is keyed to the
--   drop's own id, so a replayed idempotency key (which returns the existing
--   drop without inserting a new one) cannot produce a second XP row, and
--   neither can a refresh, a double tap, or two tabs.
--
--   THE AMOUNT IS NOT THE CALLER'S TO CHOOSE — `xp_events_guard()` recomputes
--   it from the `forge_drops` row itself, exactly as it already does for sets,
--   cardio and battles. `forge_drop_play` inserts a placeholder and the guard
--   overwrites it. Even a compromised definer body could not over-award.
--
--   IT CANNOT BE FARMED — XP scales with the STAKE, so 1-coin chips are worth
--   almost nothing, and a daily ceiling bounds the whole surface. Training
--   stays the way you level: a maximum drop is worth less than two sets.
--
-- Milestones are a real table rather than an encoded id, because the guard has
-- to VERIFY a milestone was reached before it will price it, and it cannot
-- verify a number hidden inside a uuid.

begin;

-- ── the milestones an athlete has actually reached ──────────────────────────
create table if not exists public.forge_drop_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  /** 10, 25, 50, 100 — the drop count that earned it. */
  threshold int not null check (threshold in (10, 25, 50, 100)),
  /** How many drops the athlete had when it was awarded. Kept for auditing:
   *  it should equal `threshold`, and a mismatch is worth knowing about. */
  drops_at_award int not null,
  created_at timestamptz not null default now()
);

-- ONCE EACH, FOREVER. This index is the whole anti-double-claim story; nothing
-- in application code is trusted to remember.
create unique index if not exists forge_drop_milestones_once
  on public.forge_drop_milestones (user_id, threshold);

alter table public.forge_drop_milestones enable row level security;

do $$ begin
  create policy forge_drop_milestones_own_select on public.forge_drop_milestones
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- No INSERT, UPDATE or DELETE policy anywhere: milestones are awarded by
-- `forge_drop_play` and by nothing else.

grant select on public.forge_drop_milestones to authenticated;

-- ── how much a drop is worth ────────────────────────────────────────────────
--
-- Deliberately modest and stake-weighted. A 1-coin chip earns 1 XP whatever it
-- lands on, so grinding the minimum stake is not a strategy; a 25-coin chip on
-- the board's ceiling earns 15, which is less than two workout sets (10 each).
create or replace function public.forge_drop_xp_for(p_stake int, p_multiplier numeric, p_top numeric)
returns int
language sql
immutable
as $$
  select greatest(1,
    1 + floor(coalesce(p_stake, 0) / 3.0)::int
      + case
          -- The board's own ceiling, whatever that tier's ceiling happens to be.
          when p_top is not null and p_multiplier >= p_top - 1e-9 then 6
          when p_multiplier >= 1.4 then 2
          else 0
        end
  );
$$;

/** XP from Forge Drop is capped per day. Milestones are exempt — there are
 *  four of them in a lifetime, so they cannot be farmed by definition. */
create or replace function public.forge_drop_xp_today(p_user uuid)
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(amount), 0)::int
  from public.xp_events
  where user_id = p_user
    and kind = 'forge_drop'
    and created_at >= date_trunc('day', now());
$$;

-- ── the guard prices it, not the caller ─────────────────────────────────────
create or replace function public.xp_events_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  ok   boolean;
  mins numeric;
  battle_xp integer;
  d public.forge_drops;
  ms public.forge_drop_milestones;
  top numeric;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.kind = 'set' then
    select exists (
      select 1 from public.workout_log w
      where w.id = new.source_id
        and w.user_id = auth.uid()
        and w.weight >= 0 and w.reps > 0
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

  elsif new.kind = 'forge_drop' then
    -- PRICED FROM THE DROP ROW. The caller's `amount` is discarded, so a drop
    -- is worth what its own stake and multiplier say it is worth and nothing
    -- else. The row must belong to the athlete claiming it.
    select * into d from public.forge_drops
    where id = new.source_id and user_id = auth.uid();
    if not found then
      raise exception 'xp_events: no matching forge_drops row (%).', new.source_id
        using errcode = 'check_violation';
    end if;
    select max(m) into top from unnest(d.multipliers) m;
    new.amount := public.forge_drop_xp_for(d.stake, d.multiplier, top);
    new.source_table := 'forge_drops';
    return new;

  elsif new.kind = 'forge_drop_milestone' then
    -- Priced from the milestone that was actually reached and recorded. The
    -- unique index on (user_id, threshold) means it can only exist once, and
    -- the unique index on xp_events means it can only be paid once.
    select * into ms from public.forge_drop_milestones
    where id = new.source_id and user_id = auth.uid();
    if not found then
      raise exception 'xp_events: no matching forge drop milestone (%).', new.source_id
        using errcode = 'check_violation';
    end if;
    new.amount := case ms.threshold
      when 10 then 15
      when 25 then 30
      when 50 then 60
      when 100 then 120
      else 10
    end;
    new.source_table := 'forge_drop_milestones';
    return new;

  else
    raise exception 'xp_events: kind % may only be written by the server.', new.kind
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- ── awarding, inside the settlement transaction ─────────────────────────────
--
-- Returns what was awarded so the client can show it, and swallows nothing it
-- should not: an XP failure must never cost somebody their coins, so the whole
-- award is wrapped. A drop that pays out but silently misses its XP is a bug
-- worth finding; a drop that refuses to pay out because of an XP bug is a
-- disaster.
create or replace function public.forge_drop_award_xp(p_user uuid, p_drop uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  drops_total int;
  awarded int := 0;
  ms_id uuid;
  ms_threshold int;
  ms_xp int := 0;
  cap constant int := 150;   -- a day's ceiling: about fifteen sets' worth
begin
  -- The drop's own XP, unless the day's ceiling is already reached. Skipped
  -- whole rather than clamped: `xp_events` refuses a zero amount, and the
  -- guard would recompute a clamped one back to full anyway.
  if public.forge_drop_xp_today(p_user) < cap then
    begin
      insert into public.xp_events (user_id, kind, amount, source_id)
      values (p_user, 'forge_drop', 1, p_drop);
      select amount into awarded from public.xp_events
      where user_id = p_user and source_table = 'forge_drops' and source_id = p_drop;
    exception when unique_violation then
      -- Already paid for this drop. That is the index doing its job on a
      -- replay, not an error.
      select amount into awarded from public.xp_events
      where user_id = p_user and source_table = 'forge_drops' and source_id = p_drop;
    end;
  end if;

  select count(*)::int into drops_total from public.forge_drops where user_id = p_user;

  -- The highest milestone this drop has just reached, if any.
  select t into ms_threshold
  from (values (100), (50), (25), (10)) v(t)
  where drops_total >= t
    and not exists (
      select 1 from public.forge_drop_milestones m
      where m.user_id = p_user and m.threshold = v.t)
  order by t desc
  limit 1;

  if ms_threshold is not null then
    begin
      insert into public.forge_drop_milestones (user_id, threshold, drops_at_award)
      values (p_user, ms_threshold, drops_total)
      returning id into ms_id;

      insert into public.xp_events (user_id, kind, amount, source_id)
      values (p_user, 'forge_drop_milestone', 1, ms_id);

      select amount into ms_xp from public.xp_events
      where user_id = p_user and source_table = 'forge_drop_milestones' and source_id = ms_id;
    exception when unique_violation then
      ms_threshold := null;   -- somebody else's transaction got there first
      ms_xp := 0;
    end;
  end if;

  return jsonb_build_object(
    'xp', coalesce(awarded, 0),
    'drops_total', drops_total,
    'milestone', ms_threshold,
    'milestone_xp', coalesce(ms_xp, 0),
    'capped', public.forge_drop_xp_today(p_user) >= cap
  );
end;
$$;

revoke execute on function public.forge_drop_award_xp(uuid, uuid) from public, anon, authenticated;

-- ── the drop hands out its own XP as it settles ─────────────────────────────
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
  reward jsonb := '{}'::jsonb;
begin
  if me is null then
    raise exception 'forge_drop_play: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if p_key is null then
    raise exception 'forge_drop_play: an idempotency key is required.' using errcode = 'check_violation';
  end if;

  -- ── 0. ONE SPENDER AT A TIME, FOR THIS ATHLETE ──────────────────────────
  perform pg_advisory_xact_lock(hashtextextended('evoforge.coin_spend:' || me::text, 0));

  -- ── 1. THE SAME REQUEST TWICE IS THE SAME DROP ──────────────────────────
  select * into existing from public.forge_drops
  where user_id = me and idempotency_key = p_key;
  if found then
    -- A REPLAY PAYS NOTHING AGAIN, including XP. The reward block is read
    -- back rather than re-awarded: the unique index would refuse a second
    -- write anyway, and reporting the original is what the client needs.
    return jsonb_build_object(
      'drop_id', existing.id, 'replayed', true,
      'tier', existing.tier, 'evo_rating', existing.evo_rating,
      'lane', existing.lane, 'stake', existing.stake, 'slot', existing.slot,
      'multiplier', existing.multiplier, 'payout', existing.payout, 'net', existing.net,
      'path', to_jsonb(existing.path), 'config_version', existing.config_version,
      'balance', public.coin_total(),
      'xp', coalesce((select amount from public.xp_events
                      where user_id = me and source_table = 'forge_drops'
                        and source_id = existing.id), 0),
      'milestone', null, 'milestone_xp', 0,
      'drops_total', (select count(*)::int from public.forge_drops where user_id = me));
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

  -- ── 3. THE WALK ─────────────────────────────────────────────────────────
  walk := public.forge_drop_walk(t.rows, p_lane);
  col := public.forge_drop_slot(p_lane, walk);
  mult := t.multipliers[col + 1];

  -- The fraction is paid as a probability, not discarded — see 155.
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

  -- ── 5. THE SECOND REWARD ────────────────────────────────────────────────
  --
  -- XP NEVER COSTS SOMEBODY THEIR COINS. If anything in the reward path
  -- fails, the wager still settles exactly as it would have. A drop that pays
  -- out but misses its XP is a bug to find; a drop that refuses to pay out
  -- because of an XP bug is a disaster.
  begin
    reward := public.forge_drop_award_xp(me, new_id);
  exception when others then
    reward := jsonb_build_object('xp', 0, 'milestone', null, 'milestone_xp', 0);
  end;

  return jsonb_build_object(
    'drop_id', new_id, 'replayed', false,
    'tier', t.tier, 'evo_rating', rating,
    'lane', p_lane, 'stake', p_stake, 'slot', col,
    'multiplier', mult, 'payout', pay, 'net', pay - p_stake,
    'path', to_jsonb(walk), 'config_version', t.config_version,
    'balance', public.coin_total())
    || reward;
end;
$$;

revoke execute on function public.forge_drop_play(uuid, int, int) from public, anon;
grant execute on function public.forge_drop_play(uuid, int, int) to authenticated;

/** Everything the board needs to show progression: lifetime drops, which
 *  milestones are claimed, and today's XP against the ceiling. */
create or replace function public.my_forge_drop_progress()
returns jsonb
language sql
security definer
set search_path to 'public'
stable
as $$
  select jsonb_build_object(
    'drops_total', (select count(*)::int from public.forge_drops where user_id = auth.uid()),
    'milestones', coalesce((select jsonb_agg(threshold order by threshold)
                            from public.forge_drop_milestones where user_id = auth.uid()), '[]'::jsonb),
    'xp_today', public.forge_drop_xp_today(auth.uid())
  );
$$;

revoke execute on function public.my_forge_drop_progress() from public, anon;
grant execute on function public.my_forge_drop_progress() to authenticated;

commit;

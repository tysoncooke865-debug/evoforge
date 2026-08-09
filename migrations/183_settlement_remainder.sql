-- EvoForge 183 - THE SETTLEMENT REMAINDER COLLIDED WITH ITSELF.
--
-- 182 paid each winner their proportional share, then inserted the rounding
-- remainder as a SECOND `callout_payout` row for the same person. `coin_events`
-- carries a unique index on (user_id, kind, source_id), so that insert fails:
--
--     duplicate key value violates unique constraint "coin_events_source_uidx"
--     Key (user_id, kind, source_id)=(..., callout_payout, ...) already exists
--
-- Integer division leaves a remainder on most real pools, so this was not an edge
-- case - it was most settlements. The transaction rolls back, so nobody was ever
-- mispaid; the pool simply could not be settled at all.
--
-- FOUND BY THE HARNESS, ON THE FIRST RUN, which is the entire reason settlement
-- gets driven with real balances instead of being read back out of the function's
-- own return value. 182's embedded checks all passed - they assert the SHAPE of the
-- function (conservation is asserted, the verifier rule is present, no rake), and
-- every one of those was still true of code that could not run.
--
-- THE FIX: compute every payout into a temporary table, fold the remainder into
-- the top winner's amount there, and only then write one row per winner. Same
-- arithmetic, same remainder rule, one row each.
--
-- No pot was reachable from any client when this shipped, so there is no exposure
-- to repair - only the function.

begin;

create or replace function public.callout_verify(p_callout uuid, p_verdict text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.workout_callouts%rowtype;
  cfg public.workout_callout_config;
  me uuid := auth.uid();
  win_side text;
  winners int := 0;
  losers int := 0;
  total_escrow int := 0;
  paid int := 0;
  remainder int;
  top_user uuid;
  independent boolean;
  r record;
begin
  if me is null then
    raise exception 'callout_verify: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if p_verdict not in ('verify', 'dispute') then
    raise exception 'callout_verify: % is not a verdict.', p_verdict using errcode = 'check_violation';
  end if;

  select * into c from public.workout_callouts where id = p_callout for update;
  if not found then
    raise exception 'callout_verify: no such call out.' using errcode = 'no_data_found';
  end if;
  select * into cfg from public.workout_callout_config where id;

  -- EVERY COIN HELD AGAINST THIS CALL OUT, whoever holds it. This is the pool,
  -- and it is what decides whether an independent verifier is required.
  select coalesce(-sum(amount), 0)::int into total_escrow
  from public.coin_events
  where source_id = c.id::text and kind in ('callout_stake', 'callout_payout');

  independent := public.callout_independent_verifier(p_callout, me);

  -- WHO MAY SPEAK. A big pot needs somebody with nothing riding on it (§5).
  if c.mode = 'pot' and total_escrow >= cfg.independent_verifier_at then
    if not independent then
      raise exception
        'callout_verify: % coins is too big for a participant to call. Someone invited who did not take a side has to say whether it counted.',
        total_escrow using errcode = 'insufficient_privilege';
    end if;
  elsif c.opponent_id <> me and not independent then
    raise exception 'callout_verify: only the athlete who doubted may verify.'
      using errcode = 'insufficient_privilege';
  end if;

  if c.status <> 'awaiting_verification' then
    return jsonb_build_object('status', c.status, 'already', true, 'callout_id', c.id);
  end if;

  if p_verdict = 'dispute' then
    update public.workout_callouts
    set status = 'disputed',
        dispute_reason = coalesce(nullif(btrim(p_reason), ''), 'Did not see it'),
        expires_at = now() + make_interval(hours => cfg.dispute_hours)
    where id = c.id;
    perform public.forge_duel_notify(c.athlete_id, me, 'callout_verified',
      jsonb_build_object('callout_id', c.id, 'outcome', 'disputed', 'amount', c.stake));
    return jsonb_build_object('status', 'disputed', 'already', false, 'callout_id', c.id);
  end if;

  if c.result is null then
    raise exception 'callout_verify: nothing to verify yet.' using errcode = 'check_violation';
  end if;

  -- The athlete is always BACK; they said they would do it.
  win_side := case when c.result = 'hit' then 'back' else 'push' end;

  -- ── EVERY POSITION, PRINCIPALS AND JOINERS ALIKE, with the escrow the ledger
  --    actually holds. A side is decided here once and read everywhere below.
  create temporary table _pool_positions on commit drop as
  select p.user_id, p.side,
         coalesce((select -sum(ce.amount)::int from public.coin_events ce
                   where ce.source_id = c.id::text
                     and ce.kind in ('callout_stake', 'callout_payout')
                     and ce.user_id = p.user_id), 0) as held
  from (
    select c.athlete_id  as user_id, 'back'::text as side
    union all
    select c.opponent_id, 'push'
    union all
    select e.user_id, e.side from public.workout_callout_entries e where e.callout_id = c.id
  ) p;

  select coalesce(sum(held), 0)::int into winners from _pool_positions where side = win_side;
  select coalesce(sum(held), 0)::int into losers  from _pool_positions where side <> win_side;

  if winners <= 0 then
    -- Nobody on the winning side actually paid in. Nothing to divide and nobody
    -- to divide it; give everyone their own coins back rather than invent a rule.
    perform public.callout_refund_both(c.id);
    update public.workout_callouts
    set status = 'settled', verified_at = now(), verified_by = me, settled_at = now()
    where id = c.id;
    return jsonb_build_object('status', 'settled', 'already', false, 'callout_id', c.id,
                              'result', c.result, 'refunded', true);
  end if;

  perform set_config('evoforge.callout_authorized', c.id::text, true);

  -- ── WORK OUT EVERY PAYOUT FIRST, THEN WRITE ONE ROW EACH.
  --
  -- `coin_events` carries a unique index on (user_id, kind, source_id), so a
  -- winner gets exactly ONE `callout_payout` row per call out. 182 paid the
  -- proportional share and then inserted the rounding remainder as a second row,
  -- which collided with the first the moment a remainder existed - i.e. on most
  -- real pools. The remainder is now folded into the same row before anything is
  -- written.
  create temporary table _pool_payouts on commit drop as
  select user_id, held, (held + (held::bigint * losers / winners)::int)::int as amount
  from _pool_positions
  where side = win_side and held > 0;

  -- THE REMAINDER goes to the largest single position on the winning side, the
  -- athlete first on a tie. A rule, not an accident, and never a burn.
  select (winners + losers) - coalesce(sum(amount), 0)::int into remainder from _pool_payouts;
  if remainder <> 0 then
    select user_id into top_user from _pool_payouts
     order by held desc, (user_id = c.athlete_id) desc, user_id limit 1;
    update _pool_payouts set amount = amount + remainder where user_id = top_user;
  end if;

  for r in select user_id, amount from _pool_payouts loop
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (r.user_id, 'callout_payout', r.amount, c.id::text);
    paid := paid + r.amount;
  end loop;

  -- ── CONSERVATION, CHECKED. Every coin in comes out to a participant, and no
  --    coin is created. If this ever fires the transaction rolls back and nobody
  --    is paid, which is the correct failure.
  if paid <> winners + losers then
    raise exception 'callout_verify: pool does not balance — held %, paid %', winners + losers, paid;
  end if;

  update public.workout_callouts
  set status = 'settled', verified_at = now(), verified_by = me, settled_at = now()
  where id = c.id;
  update public.workout_callout_entries e
  set settled_at = now(),
      payout = coalesce((select p.amount from _pool_payouts p where p.user_id = e.user_id), 0)
  where e.callout_id = c.id;

  perform public.forge_duel_notify(
    c.athlete_id, me, 'callout_settled',
    jsonb_build_object('callout_id', c.id, 'outcome', c.result,
                       'won', c.result = 'hit', 'amount', winners + losers,
                       'exercise', c.exercise, 'target', c.target_label));

  return jsonb_build_object('status', 'settled', 'already', false, 'callout_id', c.id,
                            'result', c.result, 'winning_side', win_side,
                            'winners', winners, 'losers', losers, 'paid', paid);
end;
$function$;

revoke execute on function public.callout_verify(uuid, text, text) from public, anon;
grant execute on function public.callout_verify(uuid, text, text) to authenticated;

do $$
declare d text := pg_get_functiondef('public.callout_verify(uuid,text,text)'::regprocedure);
begin
  -- Exactly one INSERT of a payout row, in one loop over the computed table.
  if (length(d) - length(replace(d, 'insert into public.coin_events', ''))) /
     length('insert into public.coin_events') <> 1 then
    raise exception 'settlement writes payout rows from more than one place again';
  end if;
  if d not like '%_pool_payouts%' then
    raise exception 'the payouts are not computed before being written';
  end if;
  -- And the guarantees 182 added must survive this rewrite.
  if d not like '%does not balance%' then
    raise exception 'settlement no longer asserts conservation';
  end if;
  if d not like '%independent_verifier_at%' then
    raise exception 'the independent verifier rule is gone';
  end if;
  if d ilike '%rake%' or d ilike '%commission%' then
    raise exception 'settlement takes a cut';
  end if;
end $$;

commit;

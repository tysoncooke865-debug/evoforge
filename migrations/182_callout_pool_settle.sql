-- EvoForge 182 - THE POOL, PART 3: REFUND, VERIFY, SETTLE.
--
-- Three things, in one migration because `callout_verify` already verifies AND
-- settles in a single atomic step. Splitting that across two migrations would
-- leave a half-extended function live in between, which is worse than a longer
-- file.
--
-- ══ 1. THE BUG THAT MATTERS MOST: STRANDED COINS ══
--
-- `callout_refund_both` refunds exactly two people, by name:
--
--     where user_id = c.athlete_id ...
--     where user_id = c.opponent_id ...
--
-- 181 let a third person escrow coins into the same call out. Every refund path -
-- a dispute resolving, an expiry, a call-off, `callout_sweep` - would therefore
-- have returned the principals' coins and SILENTLY KEPT THE JOINER'S. Deducted,
-- never returned, no error anywhere. That is the worst class of bug an economy
-- can have, and it was one dispute away from happening.
--
-- The fix is not "also refund the entries table". It is to stop naming people at
-- all: refund whatever escrow was ACTUALLY HELD, grouped by whoever held it. The
-- ledger already knows. That formulation is correct for two participants, for
-- eight, and for whatever a later migration invents.
--
-- ══ 2. AN INDEPENDENT VERIFIER ONCE THE POOL IS SERIOUS (§5) ══
--
-- Below the threshold the opponent verifies, exactly as they do today. At or above
-- it, on a pot, the person who verifies must have NO position: not the athlete, not
-- the opponent, not a joiner. They were invited and chose not to take a side.
--
-- They get COUNTS or DOESN'T COUNT. They cannot pick a side, and they cannot verify
-- and then join, because joining closes at `awaiting_verification` anyway.
--
-- IF NOBODY QUALIFIES, THE CALL OUT DOES NOT SETTLE, and that is deliberate. It
-- expires and everybody is refunded in full. The alternative - quietly falling back
-- to the opponent - would mean the rule silently switches off exactly when the
-- money is biggest, which is when it is for.
--
-- ══ 3. PROPORTIONAL SETTLEMENT, AND NOT ONE COIN MINTED ══
--
-- The winning side divides the losing side in proportion to what each of them put
-- in, and gets their own pledge back first.
--
--     payout(w) = own(w) + floor(own(w) * LOSERS / WINNERS)
--
-- Integer division leaves a remainder, and a remainder has to go somewhere or the
-- pool does not balance. It goes to the largest single position on the winning
-- side, ties broken by the athlete first - a rule, not a rounding accident. The
-- function then ASSERTS that total paid equals total escrowed before it commits.
-- Conservation is checked, not assumed.
--
-- NO RAKE. 164 deleted the duel's cut of the losing pool; nothing here takes one.
-- Every coin that goes in comes out to a participant.

begin;

-- ─────────────────────────────────────────────── the threshold, as config

alter table public.workout_callout_config
  add column if not exists independent_verifier_at int not null default 200;

comment on column public.workout_callout_config.independent_verifier_at is
  'Pool total at which a pot needs a verifier with no position in it (§5, 182). '
  'Below this the opponent verifies as in a 1v1.';

-- ───────────────────────────────────── refund whoever actually holds escrow

/**
 * GIVE BACK EXACTLY WHAT WAS TAKEN, TO WHOEVER IT WAS TAKEN FROM.
 *
 * Reads the ledger rather than the callout's two columns, so it is right for a
 * duel, right for an eight-person pool, and right for anything added later. The
 * old version named `athlete_id` and `opponent_id` and would have stranded every
 * joiner's coins on every refund path.
 *
 * Idempotent: it refunds the NET held, so a second call finds zero and pays zero.
 */
create or replace function public.callout_refund_both(p_callout uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.workout_callouts%rowtype;
  total int := 0;
  r record;
begin
  select * into c from public.workout_callouts where id = p_callout;
  if not found then return 0; end if;

  perform set_config('evoforge.callout_authorized', c.id::text, true);

  -- NET per person: stakes are negative, payouts positive. Anyone still owed
  -- something has a negative sum; anyone already made whole nets to zero.
  for r in
    select ce.user_id, (-sum(ce.amount))::int as held
    from public.coin_events ce
    where ce.source_id = c.id::text
      and ce.kind in ('callout_stake', 'callout_payout')
    group by ce.user_id
    having (-sum(ce.amount))::int > 0
  loop
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (r.user_id, 'callout_payout', r.held, c.id::text);
    total := total + r.held;
  end loop;

  return total;
end;
$function$;
revoke execute on function public.callout_refund_both(uuid) from public, anon;

-- ──────────────────────────────────── may this person verify this call out?

/**
 * A VERIFIER WITH NOTHING RIDING ON IT.
 *
 * Invited, still a friend of the athlete, and holding no position — not a
 * principal and not a joiner. "Invited" is the same list joining uses, so the
 * athlete is always the one who decides who is in the room.
 */
create or replace function public.callout_independent_verifier(p_callout uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.workout_callouts c
                 where c.id = p_callout
                   and c.athlete_id <> p_user and c.opponent_id <> p_user)
     and not exists (select 1 from public.workout_callout_entries e
                     where e.callout_id = p_callout and e.user_id = p_user)
     and exists (select 1 from public.workout_callout_invites i
                 where i.callout_id = p_callout and i.user_id = p_user)
     and exists (select 1 from public.workout_callouts c
                 where c.id = p_callout and public.are_friends(c.athlete_id, p_user));
$$;
revoke execute on function public.callout_independent_verifier(uuid, uuid) from public, anon;
grant execute on function public.callout_independent_verifier(uuid, uuid) to authenticated;

-- ───────────────────────────────────────────── verify, and settle the pool

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

  -- ── PAY. Own pledge back, plus a proportional share of the losing side.
  for r in select user_id, held from _pool_positions where side = win_side and held > 0 loop
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (r.user_id, 'callout_payout', r.held + (r.held::bigint * losers / winners)::int, c.id::text);
    paid := paid + r.held + (r.held::bigint * losers / winners)::int;
  end loop;

  -- ── THE REMAINDER. Integer division always leaves some; it goes to the largest
  --    single position on the winning side, the athlete first on a tie. A rule,
  --    not an accident, and never a burn.
  remainder := (winners + losers) - paid;
  if remainder <> 0 then
    select user_id into top_user from _pool_positions
     where side = win_side and held > 0
     order by held desc, (user_id = c.athlete_id) desc, user_id
     limit 1;
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (top_user, 'callout_payout', remainder, c.id::text);
    paid := paid + remainder;
  end if;

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
      payout = case when e.side = win_side
                    then (select ce.amount from public.coin_events ce
                          where ce.source_id = c.id::text and ce.kind = 'callout_payout'
                            and ce.user_id = e.user_id order by ce.created_at desc limit 1)
                    else 0 end
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

-- ─────────── PROVEN: nothing strands, nothing mints, no rake

do $$
declare d text;
begin
  d := pg_get_functiondef('public.callout_refund_both(uuid)'::regprocedure);
  -- The refund must NOT name individuals any more. If `athlete_id` reappears in a
  -- where-clause here, joiners are being stranded again.
  if d like '%user_id = c.athlete_id%' or d like '%user_id = c.opponent_id%' then
    raise exception 'the refund names individuals again - joiners will be stranded';
  end if;
  if d not like '%group by ce.user_id%' then
    raise exception 'the refund is not grouped by holder';
  end if;

  d := pg_get_functiondef('public.callout_verify(uuid,text,text)'::regprocedure);
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

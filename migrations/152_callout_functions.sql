-- EvoForge 152 — every call out transition, and nothing a client can drive.
--
-- The shape of every function here is the one 139/140 proved and 145 repeated:
--
--     select … for update            take the row
--     re-check the status you move FROM
--     do the work
--
-- That pair is the whole of idempotence. A doubled tap, a retry after a timeout
-- and a flaky network all land on the second check and return `already: true`
-- instead of escrowing twice or paying twice. The ledger's unique index on
-- (user_id, kind, source_id) is the backstop underneath it — if a body ever
-- forgets, storage refuses.
--
-- WHAT IS DELIBERATELY REUSED, NOT REBUILT:
--   forge_can_challenge(opponent)   the friendship gate — self-scoped, so it can
--                                   only ever ask about auth.uid() (141's lesson:
--                                   never grant a two-arg lookup to satisfy a
--                                   one-arg question)
--   forge_duel_balance(user)        the live ledger balance
--   forge_duel_notify(...)          the inbox seam, revoked from authenticated
--                                   and reachable only from a definer body
--
-- `expires_at` IS THE DEADLINE FOR THE CURRENT STATE, not for the callout. It
-- is re-armed on every transition — offer_minutes while offered, attempt_hours
-- once accepted, verify_hours once the set is logged, dispute_hours once
-- disputed — so the sweep needs one column and one comparison rather than four.
--
-- AND THE RULE THAT DECIDES THE WHOLE ECONOMY: no timeout ever pays anybody.
-- Silence from the opponent must not hand the athlete a pot (that would be
-- trivially farmable), and silence from the athlete must not hand the opponent
-- one either (a gym closes, a back tweaks, a phone dies). Every timeout refunds
-- both sides and the card says NOT ATTEMPTED. The social cost is the deterrent;
-- that is the correct deterrent among friends playing for fictional coins.

begin;

-- ──────────────────────────────────────────────────────── internal helpers

/**
 * PAY BACK WHAT WAS ACTUALLY TAKEN.
 *
 * Not `stake` — the record of what left the wallet. There are no raises in V1
 * so the two are equal today, and reading the ledger is still the right habit:
 * the duel's payout reads `escrowed` for exactly this reason, and paying
 * anything else would mint or burn.
 *
 * Idempotent by storage: a second call collides on (user_id, kind, source_id).
 */
create or replace function public.callout_refund_both(p_callout uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.workout_callouts%rowtype;
  esc_a int;
  esc_b int;
begin
  select * into c from public.workout_callouts where id = p_callout;
  if not found then return 0; end if;

  select coalesce(-sum(amount), 0)::int into esc_a
  from public.coin_events
  where user_id = c.athlete_id and kind = 'callout_stake' and source_id = c.id::text;
  select coalesce(-sum(amount), 0)::int into esc_b
  from public.coin_events
  where user_id = c.opponent_id and kind = 'callout_stake' and source_id = c.id::text;

  if esc_a = 0 and esc_b = 0 then return 0; end if;

  perform set_config('evoforge.callout_authorized', c.id::text, true);
  if esc_a > 0 then
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (c.athlete_id, 'callout_payout', esc_a, c.id::text);
  end if;
  if esc_b > 0 then
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (c.opponent_id, 'callout_payout', esc_b, c.id::text);
  end if;
  return esc_a + esc_b;
end;
$$;
revoke execute on function public.callout_refund_both(uuid) from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────── create

/**
 * CALL THIS SET.
 *
 * The athlete stakes on themselves. Nothing moves — an offer is a sentence, and
 * a sentence that empties a wallet before anybody answers is why §15 asks for
 * reservation semantics. The coins wait for the doubt.
 *
 * Every argument except the stake and the opponent comes from the logger, which
 * is the entire point: the athlete types no exercise, no weight, no reps, no
 * condition and no duration. The proposition is the set they were already about
 * to do.
 */
create or replace function public.callout_create(
  p_opponent uuid,
  p_workout_date date,
  p_workout text,
  p_exercise text,
  p_set_no int,
  p_target_reps int,
  p_target_load_mode text,
  p_target_weight_kg numeric,
  p_target_label text,
  p_stake int,
  p_hit_probability numeric,
  p_odds_model text,
  p_odds_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  cfg public.workout_callout_config;
  bal int;
  utc_today date := (now() at time zone 'UTC')::date;
  p numeric;
  new_id uuid;
  exp timestamptz;
begin
  if me is null then
    raise exception 'callout_create: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if not public.forge_can_challenge(p_opponent) then
    raise exception 'callout_create: you can only call out a friend.' using errcode = 'insufficient_privilege';
  end if;

  select * into cfg from public.workout_callout_config where id;

  -- BOTH SIDES MUST BE IN. Mine because the affordance should not exist if I
  -- turned it off; theirs because an offer nobody can answer is an escrow
  -- waiting to time out.
  if not coalesce((select pr.callouts_enabled from public.profile pr
                   where pr.user_id = me order by pr.created_at desc limit 1), true) then
    raise exception 'callout_create: your call outs are switched off.' using errcode = 'check_violation';
  end if;
  if not coalesce((select pr.callouts_enabled from public.profile pr
                   where pr.user_id = p_opponent order by pr.created_at desc limit 1), true) then
    raise exception 'callout_create: they have call outs switched off.' using errcode = 'check_violation';
  end if;

  if p_stake < cfg.min_stake or p_stake > cfg.max_stake then
    raise exception 'callout_create: stake must be between % and %.', cfg.min_stake, cfg.max_stake
      using errcode = 'check_violation';
  end if;

  bal := public.forge_duel_balance(me);
  if bal < p_stake then
    raise exception 'callout_create: you have % coins, not %.', bal, p_stake using errcode = 'check_violation';
  end if;

  if coalesce(p_target_reps, 0) <= 0 then
    raise exception 'callout_create: a call needs a rep target.' using errcode = 'check_violation';
  end if;
  if p_set_no is null or p_set_no < 1 or p_set_no > 8 then
    raise exception 'callout_create: set % is not a working set.', p_set_no using errcode = 'check_violation';
  end if;
  -- Duration and distance sets have no rep proposition, so they have no call.
  if p_target_load_mode not in ('external', 'bodyweight', 'weighted_bodyweight',
                                'assisted_bodyweight', 'repetition_only') then
    raise exception 'callout_create: % sets cannot be called.', p_target_load_mode
      using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_exercise), '') = '' or coalesce(btrim(p_workout), '') = '' then
    raise exception 'callout_create: the set has no exercise.' using errcode = 'check_violation';
  end if;

  -- 143's lesson, one level down: this app writes the athlete's LOCAL calendar
  -- day. Any real timezone is within a day of UTC; a wider gap is an attempt to
  -- attach a call to a day that already happened.
  if abs(p_workout_date - utc_today) > 1 then
    raise exception 'callout_create: % is not today.', p_workout_date using errcode = 'check_violation';
  end if;

  -- YOU CANNOT CALL A SET YOU HAVE ALREADY DONE. Without this, the whole
  -- feature is a way to bet on the past.
  if exists (
    select 1 from public.workout_log wl
    where wl.user_id = me and wl.date = p_workout_date and wl.workout = p_workout
      and wl.exercise = p_exercise and wl."set" = p_set_no and wl.reps > 0
  ) then
    raise exception 'callout_create: that set is already logged.' using errcode = 'check_violation';
  end if;

  -- ONE LIVE CALL (§2). The partial unique index is the real rule; this is here
  -- so the athlete gets a sentence instead of a constraint name.
  if exists (
    select 1 from public.workout_callouts wc
    where wc.athlete_id = me and wc.status in ('offered', 'accepted', 'awaiting_verification')
  ) then
    raise exception 'callout_create: you already have a call out running.' using errcode = 'check_violation';
  end if;

  -- The odds are the client's estimate and the clamp is the server's. Ten to
  -- ninety, because a gym set is not a coin with a known bias and "99.8%"
  -- deserves to be disbelieved.
  p := least(0.90, greatest(0.10, coalesce(p_hit_probability, 0.5)));
  exp := now() + make_interval(mins => cfg.offer_minutes);

  insert into public.workout_callouts (
    athlete_id, opponent_id, initiated_by,
    workout_date, workout_name, exercise, set_no,
    target_reps, target_load_mode, target_weight_kg, target_label,
    stake, hit_probability, odds_model_version, odds_evidence,
    status, expires_at
  ) values (
    me, p_opponent, me,
    p_workout_date, p_workout, p_exercise, p_set_no,
    p_target_reps, p_target_load_mode, p_target_weight_kg, left(btrim(p_target_label), 60),
    p_stake, p, coalesce(p_odds_model, 'unknown'), coalesce(p_odds_evidence, '{}'::jsonb),
    'offered', exp
  )
  returning id into new_id;

  perform public.forge_duel_notify(
    p_opponent, me, 'callout_offered',
    jsonb_build_object('callout_id', new_id, 'amount', p_stake, 'pot', p_stake * 2,
                       'exercise', p_exercise, 'target', p_target_label));

  return jsonb_build_object('callout_id', new_id, 'status', 'offered', 'expires_at', exp);
end;
$$;
grant execute on function public.callout_create(
  uuid, date, text, text, int, int, text, numeric, text, int, numeric, text, jsonb) to authenticated;

-- ───────────────────────────────────────────────────────────── respond

/**
 * DOUBT IT, or don't.
 *
 * Accepting is the ONLY place a call out's coins move. Both balances are
 * re-checked live first: the athlete had the coins when they called, and a
 * wallet can fall in between — half an escrow is not an escrow.
 */
create or replace function public.callout_respond(p_callout uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.workout_callouts%rowtype;
  cfg public.workout_callout_config;
  me uuid := auth.uid();
  bal_a int;
  bal_b int;
  deadline timestamptz;
begin
  if me is null then
    raise exception 'callout_respond: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  select * into c from public.workout_callouts where id = p_callout for update;
  if not found then
    raise exception 'callout_respond: no such call out.' using errcode = 'no_data_found';
  end if;
  if c.opponent_id <> me then
    raise exception 'callout_respond: only the athlete you called may answer.'
      using errcode = 'insufficient_privilege';
  end if;
  if c.status <> 'offered' then
    return jsonb_build_object('status', c.status, 'already', true, 'callout_id', c.id);
  end if;
  if c.expires_at <= now() then
    update public.workout_callouts set status = 'expired' where id = c.id;
    return jsonb_build_object('status', 'expired', 'already', false, 'callout_id', c.id);
  end if;

  if not p_accept then
    update public.workout_callouts set status = 'declined' where id = c.id;
    perform public.forge_duel_notify(
      c.athlete_id, me, 'callout_declined',
      jsonb_build_object('callout_id', c.id, 'amount', c.stake, 'exercise', c.exercise));
    return jsonb_build_object('status', 'declined', 'already', false, 'callout_id', c.id);
  end if;

  if not public.are_friends(c.athlete_id, c.opponent_id) then
    raise exception 'callout_respond: you are no longer friends.' using errcode = 'check_violation';
  end if;

  bal_a := public.forge_duel_balance(c.athlete_id);
  bal_b := public.forge_duel_balance(c.opponent_id);
  if bal_a < c.stake then
    raise exception 'callout_respond: they no longer have % coins.', c.stake using errcode = 'check_violation';
  end if;
  if bal_b < c.stake then
    raise exception 'callout_respond: you need % coins to doubt this (you have %).', c.stake, bal_b
      using errcode = 'check_violation';
  end if;

  -- ESCROW. Negative rows: coin_total() is sum(amount), so these coins genuinely
  -- leave both balances and cannot be staked anywhere else.
  perform set_config('evoforge.callout_authorized', c.id::text, true);
  insert into public.coin_events (user_id, kind, amount, source_id)
  values (c.athlete_id,  'callout_stake', -c.stake, c.id::text),
         (c.opponent_id, 'callout_stake', -c.stake, c.id::text);

  select * into cfg from public.workout_callout_config where id;
  deadline := now() + make_interval(hours => cfg.attempt_hours);

  update public.workout_callouts
  set status = 'accepted', accepted_at = now(), expires_at = deadline
  where id = c.id;

  perform public.forge_duel_notify(
    c.athlete_id, me, 'callout_accepted',
    jsonb_build_object('callout_id', c.id, 'amount', c.stake, 'pot', c.stake * 2,
                       'exercise', c.exercise, 'target', c.target_label));

  return jsonb_build_object('status', 'accepted', 'already', false, 'callout_id', c.id,
                            'pot', c.stake * 2, 'expires_at', deadline);
end;
$$;
grant execute on function public.callout_respond(uuid, boolean) to authenticated;

-- ────────────────────────────────────────────────────────────── cancel

/** WITHDRAW AN UNANSWERED CALL. Nothing moved, so nothing is refunded — the
 *  slot is simply free again. Only while it is still an offer: after that see
 *  callout_call_off, which needs both signatures. */
create or replace function public.callout_cancel(p_callout uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.workout_callouts%rowtype;
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'callout_cancel: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.workout_callouts where id = p_callout for update;
  if not found then
    raise exception 'callout_cancel: no such call out.' using errcode = 'no_data_found';
  end if;
  if c.athlete_id <> me then
    raise exception 'callout_cancel: only the athlete who called may withdraw it.'
      using errcode = 'insufficient_privilege';
  end if;
  if c.status <> 'offered' then
    return jsonb_build_object('status', c.status, 'already', true, 'callout_id', c.id);
  end if;
  update public.workout_callouts set status = 'cancelled' where id = c.id;
  return jsonb_build_object('status', 'cancelled', 'already', false, 'callout_id', c.id);
end;
$$;
grant execute on function public.callout_cancel(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────── call off

/**
 * CALL IT OFF — WITH BOTH SIGNATURES.
 *
 * One side asking is a request; both asking is a refund. A unilateral escape
 * after acceptance would make every miss free: an athlete who senses the set
 * slipping would simply cancel, and a wager you can always walk out of is not a
 * wager. So this records a request, tells the other side, and only moves coins
 * when the second request arrives.
 *
 * This is also the honest answer to "I have to change the plan": §34 asks for a
 * prompt to cancel before altering wager-defining fields, and this is the thing
 * that prompt calls.
 */
create or replace function public.callout_call_off(p_callout uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.workout_callouts%rowtype;
  me uuid := auth.uid();
  mine text;
  -- NOT `both`: that is a reserved word (trim(both …)) and plpgsql refuses it
  -- as a variable name with a bare syntax error on the assignment line.
  both_asked boolean;
  returned int;
begin
  if me is null then
    raise exception 'callout_call_off: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.workout_callouts where id = p_callout for update;
  if not found then
    raise exception 'callout_call_off: no such call out.' using errcode = 'no_data_found';
  end if;
  if me not in (c.athlete_id, c.opponent_id) then
    raise exception 'callout_call_off: not your call out.' using errcode = 'insufficient_privilege';
  end if;
  if c.status not in ('accepted', 'awaiting_verification', 'disputed') then
    return jsonb_build_object('status', c.status, 'already', true, 'callout_id', c.id);
  end if;

  mine := case when me = c.athlete_id then 'athlete' else 'opponent' end;
  if mine = 'athlete' then
    if c.athlete_calloff_at is null then
      update public.workout_callouts set athlete_calloff_at = now() where id = c.id;
      c.athlete_calloff_at := now();
    end if;
  else
    if c.opponent_calloff_at is null then
      update public.workout_callouts set opponent_calloff_at = now() where id = c.id;
      c.opponent_calloff_at := now();
    end if;
  end if;

  both_asked := c.athlete_calloff_at is not null and c.opponent_calloff_at is not null;
  if not both_asked then
    return jsonb_build_object('status', c.status, 'already', false, 'callout_id', c.id,
                              'awaiting_other_side', true);
  end if;

  returned := public.callout_refund_both(c.id);
  update public.workout_callouts
  set status = 'cancelled', settled_at = now()
  where id = c.id;

  perform public.forge_duel_notify(c.athlete_id, me, 'callout_settled',
    jsonb_build_object('callout_id', c.id, 'outcome', 'called_off', 'amount', c.stake));
  perform public.forge_duel_notify(c.opponent_id, me, 'callout_settled',
    jsonb_build_object('callout_id', c.id, 'outcome', 'called_off', 'amount', c.stake));

  return jsonb_build_object('status', 'cancelled', 'already', false, 'callout_id', c.id,
                            'refunded', returned);
end;
$$;
grant execute on function public.callout_call_off(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────── verify

/**
 * "YES, THAT HAPPENED."
 *
 * The opponent is never asked for a number — the athlete's logger already wrote
 * one, and 153 read it off the row. All this asks is whether they saw it.
 *
 * THE ONE RULE THIS FILE EXISTS FOR: nothing pays without this call. An athlete
 * cannot certify their own winning result, and there is no timeout anywhere that
 * turns silence into a payout.
 *
 * DISPUTE freezes the pot and pays NOBODY. No appeals court, no moderation
 * tribunal, no proof system — just a frozen escrow, a mutual call-off, and a
 * clock that eventually refunds both.
 */
create or replace function public.callout_verify(p_callout uuid, p_verdict text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.workout_callouts%rowtype;
  cfg public.workout_callout_config;
  me uuid := auth.uid();
  winner uuid;
  esc_a int;
  esc_b int;
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
  if c.opponent_id <> me then
    raise exception 'callout_verify: only the athlete who doubted may verify.'
      using errcode = 'insufficient_privilege';
  end if;
  if c.status <> 'awaiting_verification' then
    return jsonb_build_object('status', c.status, 'already', true, 'callout_id', c.id);
  end if;

  if p_verdict = 'dispute' then
    select * into cfg from public.workout_callout_config where id;
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

  winner := case when c.result = 'hit' then c.athlete_id else c.opponent_id end;

  -- Pay the escrow that was ACTUALLY held. -s -s +2s = 0, on every path.
  select coalesce(-sum(amount), 0)::int into esc_a
  from public.coin_events
  where user_id = c.athlete_id and kind = 'callout_stake' and source_id = c.id::text;
  select coalesce(-sum(amount), 0)::int into esc_b
  from public.coin_events
  where user_id = c.opponent_id and kind = 'callout_stake' and source_id = c.id::text;

  if esc_a + esc_b > 0 then
    perform set_config('evoforge.callout_authorized', c.id::text, true);
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (winner, 'callout_payout', esc_a + esc_b, c.id::text);
  end if;

  update public.workout_callouts
  set status = 'settled', verified_at = now(), verified_by = me, settled_at = now()
  where id = c.id;

  perform public.forge_duel_notify(
    c.athlete_id, me, 'callout_settled',
    jsonb_build_object('callout_id', c.id, 'outcome', c.result,
                       'won', c.result = 'hit', 'amount', esc_a + esc_b,
                       'exercise', c.exercise, 'target', c.target_label));

  return jsonb_build_object('status', 'settled', 'already', false, 'callout_id', c.id,
                            'result', c.result, 'winner_id', winner, 'pot', esc_a + esc_b);
end;
$$;
grant execute on function public.callout_verify(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────── sweep

/**
 * THE CLOCK, run by whoever opens the app.
 *
 * There is still no scheduler in this product, so the trigger is somebody
 * arriving — which is also the only moment anything here could be acted on.
 * Scoped to auth.uid()'s own call outs, each step in its own exception block so
 * one stuck row can never stop the others.
 *
 * Every timeout REFUNDS BOTH. None of them pays.
 */
create or replace function public.callout_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  r record;
  n_expired int := 0;
  n_refunded int := 0;
  n_repaired int := 0;
  ids uuid[] := '{}';
begin
  if me is null then
    raise exception 'callout_sweep: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  -- Offers nobody answered. Nothing moved, so nothing returns.
  for r in
    select id from public.workout_callouts
    where (athlete_id = me or opponent_id = me) and status = 'offered' and expires_at <= now()
    limit 20
  loop
    begin
      update public.workout_callouts set status = 'expired' where id = r.id and status = 'offered';
      n_expired := n_expired + 1;
      ids := ids || r.id;
    exception when others then null;
    end;
  end loop;

  -- Accepted but never attempted · logged but never verified · disputed and
  -- left there. Three different silences, one honest answer.
  for r in
    select id from public.workout_callouts
    where (athlete_id = me or opponent_id = me)
      and status in ('accepted', 'awaiting_verification', 'disputed')
      and expires_at <= now()
    limit 20
  loop
    begin
      perform public.callout_refund_both(r.id);
      update public.workout_callouts
      set status = 'expired', settled_at = now()
      where id = r.id and status in ('accepted', 'awaiting_verification', 'disputed');
      n_refunded := n_refunded + 1;
      ids := ids || r.id;
    exception when others then null;
    end;
  end loop;

  -- ORPHANED ESCROW (148's pattern). A deleted account cascades the call out
  -- away and strands the survivor's coins pointing at nothing. Filed under
  -- '<id>:orphan' so the repair groups with the stake it repays and the unique
  -- index makes running it twice impossible.
  -- The aggregate has to be CLOSED before the existence test can ask about the
  -- group's key: a `not exists` in HAVING that mentions the raw column is an
  -- ungrouped-column error, and it took the harness's first sweep to say so.
  -- The uuid pattern guard keeps the cast total — a malformed source_id would
  -- otherwise raise inside the FOR query itself, which is outside the
  -- per-iteration exception block below.
  for r in
    select g.base, g.net
    from (
      select split_part(ce.source_id, ':', 1) as base, coalesce(sum(ce.amount), 0)::int as net
      from public.coin_events ce
      where ce.user_id = me and ce.kind in ('callout_stake', 'callout_payout')
      group by 1
    ) g
    where g.net < 0
      and g.base ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and not exists (select 1 from public.workout_callouts wc where wc.id = g.base::uuid)
    limit 20
  loop
    begin
      perform set_config('evoforge.callout_authorized', r.base || ':orphan', true);
      insert into public.coin_events (user_id, kind, amount, source_id)
      values (me, 'callout_payout', -r.net, r.base || ':orphan');
      n_repaired := n_repaired + 1;
    exception when others then null;
    end;
  end loop;

  return jsonb_build_object('expired', n_expired, 'refunded', n_refunded,
                            'repaired', n_repaired, 'touched_ids', to_jsonb(ids));
end;
$$;
grant execute on function public.callout_sweep() to authenticated;

-- ─────────────────────────────────────────────────────────── my list

/**
 * MY CALL OUTS — everything I am in, either side, with the other athlete's
 * public display name and NOTHING ELSE about them.
 *
 * Definer because it reads the other side's public_profile row. It returns the
 * proposition, the money and the odds the athlete's own client computed; no
 * measurement, no physique data and no workout row ever crosses. The odds
 * EVIDENCE crosses because the athlete chose to publish it by making the call.
 */
create or replace function public.my_workout_callouts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'my_workout_callouts: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select
        c.id, c.athlete_id, c.opponent_id, c.initiated_by,
        c.workout_date, c.workout_name, c.exercise, c.set_no,
        c.target_reps, c.target_load_mode, c.target_weight_kg, c.target_label,
        c.stake, c.stake * 2 as pot,
        c.hit_probability, c.odds_model_version, c.odds_evidence,
        c.status, c.result, c.actual_reps, c.actual_weight_kg, c.actual_load_mode,
        c.dispute_reason,
        c.athlete_calloff_at, c.opponent_calloff_at,
        c.created_at, c.expires_at, c.accepted_at, c.set_logged_at,
        c.verified_at, c.settled_at,
        (c.athlete_id = me) as i_am_athlete,
        coalesce(ppa.display_name, 'Athlete') as athlete_name,
        coalesce(ppo.display_name, 'Athlete') as opponent_name
      from public.workout_callouts c
      left join public.public_profile ppa on ppa.user_id = c.athlete_id
      left join public.public_profile ppo on ppo.user_id = c.opponent_id
      where (c.athlete_id = me or c.opponent_id = me)
        -- Enough history for the hub to show what just happened, and not so much
        -- that a year of settled calls rides down the wire on every poll.
        and (c.status in ('offered', 'accepted', 'awaiting_verification', 'disputed')
             or c.created_at > now() - interval '2 days')
    ) x
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.my_workout_callouts() to authenticated;

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- begin;
--   drop function if exists public.my_workout_callouts();
--   drop function if exists public.callout_sweep();
--   drop function if exists public.callout_verify(uuid, text, text);
--   drop function if exists public.callout_call_off(uuid);
--   drop function if exists public.callout_cancel(uuid);
--   drop function if exists public.callout_respond(uuid, boolean);
--   drop function if exists public.callout_create(uuid, date, text, text, int, int,
--     text, numeric, text, int, numeric, text, jsonb);
--   drop function if exists public.callout_refund_both(uuid);
-- commit;

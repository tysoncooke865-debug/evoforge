-- EvoForge 140 — FORGE CHALLENGES: the server side.
--
-- Everything that decides money lives here. The client calls these and reads
-- the result; it never computes a score, names a winner, or writes a coin.
--
-- THE TWO PROPERTIES EVERY FUNCTION BELOW HOLDS
--
--   IDEMPOTENT. Each transition locks its row (`for update`) and re-checks the
--   status it is moving FROM. A second accept finds `status <> 'pending'` and
--   returns the same answer without escrowing again; a second settle finds
--   `settled_at` set and returns the recorded outcome. Retrying is a no-op,
--   which is what makes a flaky network safe.
--
--   ATOMIC. Escrow is two coin rows and a status change in ONE transaction. If
--   the second athlete cannot cover the stake, the first athlete's coins were
--   never taken — the whole statement rolls back.
--
-- WINDOWS. `workout_log.date` and `cardio_log.date` are the athlete's LOCAL
-- calendar day (domain/today.ts's rule). The challenge window is compared on
-- those dates, so a session counts on the day the athlete says they trained.
-- e1RM baselines use `timestamp` because "before the challenge started" is a
-- moment, not a day.

begin;

-- ───────────────────────────────────────────────── the scoring, server-side

/**
 * ONE athlete's number for ONE challenge type over a date window.
 *
 * Returns { value, detail } — `value` is what the winner is decided on, and
 * `detail` is what the UI shows so the athlete can see WHY. Never reads
 * anything private: only sets, cardio minutes and finish markers.
 *
 * e1RM is Epley — `weight * (1 + reps/30)` — the same formula domain/
 * workouts.ts and the 013 coin guard use. There is one 1RM estimate in this
 * product and this is it.
 */
create or replace function public.forge_challenge_metric(
  p_user uuid,
  p_type text,
  p_metric_key text,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v numeric;
  n int;
  target int;
begin
  if p_type = 'most_improved_lift' then
    -- The best estimated 1RM for this lift inside the window. 0 kg sets can
    -- never be a PR (the app's own rule), so weight > 0 here.
    select max(w.weight * (1 + w.reps / 30.0)) into v
    from public.workout_log w
    where w.user_id = p_user
      and w.exercise = p_metric_key
      and w.weight > 0 and w.reps > 0
      and w.date >= p_from and w.date <= p_to;
    return jsonb_build_object('value', coalesce(round(v, 1), 0), 'unit', 'kg',
                              'measured', v is not null);

  elsif p_type = 'training_consistency' then
    -- COMPLETED TRAINING DAYS — the canonical definition (client mirror:
    -- domain/session-stats.ts): a distinct date carrying a counted set, a
    -- cardio session, or an explicit finish marker. An abandoned workout has
    -- none of the three and never counts.
    select count(distinct d) into n from (
      select w.date as d from public.workout_log w
        where w.user_id = p_user and w.weight >= 0 and w.reps > 0
          and w.date >= p_from and w.date <= p_to
      union
      select c.date from public.cardio_log c
        where c.user_id = p_user and c.date >= p_from and c.date <= p_to
      union
      select s.date from public.workout_sessions s
        where s.user_id = p_user and s.date >= p_from and s.date <= p_to
    ) x;
    -- The scheduled count, for CONTEXT only — never for scoring. Two athletes
    -- with different schedules must be judged on the same scale, so the winner
    -- is whoever trained on more days.
    select count(*) into target from (
      select gs::date as d from generate_series(p_from, p_to, interval '1 day') gs
    ) days
    where public.forge_scheduled_on(p_user, days.d);
    return jsonb_build_object('value', n, 'unit', 'days', 'scheduled', target, 'measured', true);

  elsif p_type = 'cardio_minutes' then
    select coalesce(sum(c.minutes), 0) into v
    from public.cardio_log c
    where c.user_id = p_user and c.date >= p_from and c.date <= p_to
      and c.minutes > 0;
    return jsonb_build_object('value', round(coalesce(v, 0)), 'unit', 'min', 'measured', true);
  end if;

  raise exception 'forge_challenge_metric: unknown type %', p_type using errcode = 'check_violation';
end;
$$;

/** Was this athlete scheduled to train on this date? Context for the
 *  consistency card; never an input to the winner. */
create or replace function public.forge_scheduled_on(p_user uuid, p_date date)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  slot jsonb;
begin
  select (s.plan -> extract(dow from p_date)::int::text) into slot
  from public.workout_schedule s
  where s.user_id = p_user and s.effective_from <= p_date
  order by s.effective_from desc
  limit 1;
  if slot is null then return false; end if;
  -- 065: a slot may be a bare name or [primary, ...extras]; 'Rest' is not a
  -- training day, but 'Rest' + an extra is.
  if jsonb_typeof(slot) = 'array' then
    return exists (
      select 1 from jsonb_array_elements_text(slot) e
      where e <> 'Rest' and e <> ''
    );
  end if;
  return slot #>> '{}' not in ('Rest', '');
end;
$$;

-- ─────────────────────────────────────────────────────────────── accept

/**
 * ACCEPT — the only place coins enter escrow.
 *
 * Locks the challenge, verifies BOTH balances against the live ledger, takes
 * both stakes, snapshots both baselines, and starts the clock. All of it in
 * one transaction: a second athlete who cannot pay means the first athlete
 * was never charged.
 *
 * Idempotent by status: a repeat call on an already-active challenge returns
 * its state and escrows nothing.
 */
create or replace function public.forge_challenge_accept(p_challenge uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.forge_challenges%rowtype;
  me uuid := auth.uid();
  bal_a int;
  bal_b int;
  t_start date;
  t_end date;
  base_a jsonb;
  base_b jsonb;
begin
  if me is null then
    raise exception 'forge_challenge_accept: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  -- THE LOCK is what makes a doubled tap safe: the second call waits here,
  -- then sees the status the first one wrote.
  select * into c from public.forge_challenges where id = p_challenge for update;
  if not found then
    raise exception 'forge_challenge_accept: no such challenge.' using errcode = 'no_data_found';
  end if;
  if c.opponent_id <> me then
    raise exception 'forge_challenge_accept: only the invited athlete may accept.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ALREADY DONE = SUCCESS. Not an error: the athlete's intent is satisfied.
  if c.status <> 'pending' then
    return jsonb_build_object('status', c.status, 'already', true, 'challenge_id', c.id);
  end if;
  if c.expires_at <= now() then
    update public.forge_challenges set status = 'expired' where id = c.id;
    return jsonb_build_object('status', 'expired', 'already', false, 'challenge_id', c.id);
  end if;
  if not public.are_friends(c.challenger_id, c.opponent_id) then
    raise exception 'forge_challenge_accept: you are no longer friends.' using errcode = 'check_violation';
  end if;

  -- BOTH balances, from the ledger itself — never from anything the client sent.
  select coalesce(sum(amount), 0)::int into bal_a from public.coin_events where user_id = c.challenger_id;
  select coalesce(sum(amount), 0)::int into bal_b from public.coin_events where user_id = c.opponent_id;
  if bal_a < c.stake then
    raise exception 'forge_challenge_accept: the challenger no longer has % coins.', c.stake
      using errcode = 'check_violation';
  end if;
  if bal_b < c.stake then
    raise exception 'forge_challenge_accept: you need % coins to accept (you have %).', c.stake, bal_b
      using errcode = 'check_violation';
  end if;

  t_start := (now() at time zone 'UTC')::date;
  t_end := t_start + (c.duration_days - 1);

  -- THE BASELINE SNAPSHOT. For a lift it is the best e1RM BEFORE today — what
  -- the athlete is improving on. For the counting challenges there is nothing
  -- to improve on, so the baseline is zero and the window is the whole score.
  if c.challenge_type = 'most_improved_lift' then
    base_a := public.forge_challenge_metric(c.challenger_id, c.challenge_type, c.metric_key,
                                            '1900-01-01'::date, t_start - 1);
    base_b := public.forge_challenge_metric(c.opponent_id, c.challenge_type, c.metric_key,
                                            '1900-01-01'::date, t_start - 1);
  else
    base_a := jsonb_build_object('value', 0, 'measured', true);
    base_b := base_a;
  end if;

  -- ESCROW. Negative rows: coin_total() is sum(amount), so these coins leave
  -- the balance and cannot be staked again elsewhere.
  perform set_config('evoforge.challenge_authorized', c.id::text, true);
  insert into public.coin_events (user_id, kind, amount, source_id)
  values (c.challenger_id, 'challenge_stake', -c.stake, c.id::text),
         (c.opponent_id,   'challenge_stake', -c.stake, c.id::text);

  insert into public.forge_challenge_participants (challenge_id, user_id, baseline, baseline_detail, escrowed)
  values (c.id, c.challenger_id, (base_a ->> 'value')::numeric, base_a, c.stake),
         (c.id, c.opponent_id,   (base_b ->> 'value')::numeric, base_b, c.stake)
  on conflict (challenge_id, user_id) do update
    set baseline = excluded.baseline, baseline_detail = excluded.baseline_detail,
        escrowed = excluded.escrowed;

  update public.forge_challenges
  set status = 'active', accepted_at = now(),
      starts_at = t_start::timestamptz, ends_at = (t_end + 1)::timestamptz - interval '1 second'
  where id = c.id;

  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (c.id, me, 'accepted',
          jsonb_build_object('stake', c.stake, 'escrow', c.stake * 2,
                             'start', t_start, 'end', t_end,
                             'baseline_challenger', base_a, 'baseline_opponent', base_b));

  return jsonb_build_object('status', 'active', 'already', false, 'challenge_id', c.id,
                            'escrow', c.stake * 2, 'start', t_start, 'end', t_end);
end;
$$;

-- ────────────────────────────────────────────────────────────── settle

/**
 * SETTLE — compute both finals from the athletes' own rows, decide, pay.
 *
 * Callable by either participant (and by a scheduler) once the window has
 * closed. It refuses while a dispute is open: coins do not move while the
 * result is contested.
 *
 * Idempotent: `settled_at` is the gate, and the 139 lock trigger refuses to
 * rewrite a settled row even if this function were somehow re-entered.
 */
create or replace function public.forge_challenge_settle(p_challenge uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.forge_challenges%rowtype;
  me uuid := auth.uid();
  t_start date;
  t_end date;
  fin_a jsonb;
  fin_b jsonb;
  score_a numeric;
  score_b numeric;
  base_a numeric;
  base_b numeric;
  v_winner uuid;
  v_outcome text;
  v_note text;
begin
  select * into c from public.forge_challenges where id = p_challenge for update;
  if not found then
    raise exception 'forge_challenge_settle: no such challenge.' using errcode = 'no_data_found';
  end if;
  if me is not null and c.challenger_id <> me and c.opponent_id <> me then
    raise exception 'forge_challenge_settle: not your challenge.' using errcode = 'insufficient_privilege';
  end if;

  if c.status = 'settled' then
    return jsonb_build_object('status', 'settled', 'already', true, 'challenge_id', c.id,
                              'winner_id', c.winner_id, 'outcome', c.outcome);
  end if;
  if c.status = 'disputed' then
    return jsonb_build_object('status', 'disputed', 'already', true, 'challenge_id', c.id,
                              'note', 'Settlement is paused while the dispute is open.');
  end if;
  if c.status <> 'active' and c.status <> 'awaiting_settlement' then
    raise exception 'forge_challenge_settle: challenge is %.', c.status using errcode = 'check_violation';
  end if;
  if now() < c.ends_at then
    raise exception 'forge_challenge_settle: the challenge has not finished yet.'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.forge_challenge_disputes d
             where d.challenge_id = c.id and d.status = 'open') then
    update public.forge_challenges set status = 'disputed' where id = c.id;
    return jsonb_build_object('status', 'disputed', 'already', false, 'challenge_id', c.id);
  end if;

  t_start := (c.starts_at at time zone 'UTC')::date;
  t_end := (c.ends_at at time zone 'UTC')::date;

  fin_a := public.forge_challenge_metric(c.challenger_id, c.challenge_type, c.metric_key, t_start, t_end);
  fin_b := public.forge_challenge_metric(c.opponent_id,   c.challenge_type, c.metric_key, t_start, t_end);

  select p.baseline into base_a from public.forge_challenge_participants p
    where p.challenge_id = c.id and p.user_id = c.challenger_id;
  select p.baseline into base_b from public.forge_challenge_participants p
    where p.challenge_id = c.id and p.user_id = c.opponent_id;

  if c.challenge_type = 'most_improved_lift' then
    -- PERCENTAGE improvement is the comparison, so a lighter athlete is not
    -- punished for having less absolute weight to add. No baseline means
    -- nothing to improve on: that athlete scores 0 rather than infinity.
    score_a := case when coalesce(base_a, 0) > 0
                    then ((fin_a ->> 'value')::numeric - base_a) / base_a * 100 else 0 end;
    score_b := case when coalesce(base_b, 0) > 0
                    then ((fin_b ->> 'value')::numeric - base_b) / base_b * 100 else 0 end;
    score_a := round(score_a, 2);
    score_b := round(score_b, 2);
  else
    score_a := (fin_a ->> 'value')::numeric;
    score_b := (fin_b ->> 'value')::numeric;
  end if;

  if score_a > score_b then
    v_winner := c.challenger_id; v_outcome := 'winner';
  elsif score_b > score_a then
    v_winner := c.opponent_id; v_outcome := 'winner';
  else
    v_winner := null; v_outcome := 'draw';
  end if;
  v_note := format('%s vs %s', score_a, score_b);

  -- PAY OUT. A win takes the whole escrow; a draw returns each stake exactly.
  perform set_config('evoforge.challenge_authorized', c.id::text, true);
  if v_outcome = 'winner' then
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (v_winner, 'challenge_payout', c.stake * 2, c.id::text);
  else
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (c.challenger_id, 'challenge_payout', c.stake, c.id::text),
           (c.opponent_id,   'challenge_payout', c.stake, c.id::text);
  end if;

  update public.forge_challenge_participants
  set final_value = case when user_id = c.challenger_id then score_a else score_b end,
      final_detail = case when user_id = c.challenger_id then fin_a else fin_b end
  where challenge_id = c.id;

  update public.forge_challenges
  set status = 'settled', settled_at = now(), winner_id = v_winner,
      outcome = v_outcome, result_note = v_note
  where id = c.id;

  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (c.id, me, 'settled',
          jsonb_build_object('outcome', v_outcome, 'winner_id', v_winner,
                             'score_challenger', score_a, 'score_opponent', score_b,
                             'final_challenger', fin_a, 'final_opponent', fin_b,
                             'escrow', c.stake * 2));

  return jsonb_build_object('status', 'settled', 'already', false, 'challenge_id', c.id,
                            'winner_id', v_winner, 'outcome', v_outcome,
                            'score_challenger', score_a, 'score_opponent', score_b);
end;
$$;

-- ──────────────────────────────────────────── decline / cancel / dispute

/** DECLINE — the invited athlete says no. Nothing was escrowed, so nothing
 *  is refunded; the row keeps its history. */
create or replace function public.forge_challenge_decline(p_challenge uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare c public.forge_challenges%rowtype; me uuid := auth.uid();
begin
  select * into c from public.forge_challenges where id = p_challenge for update;
  if not found then raise exception 'no such challenge.' using errcode = 'no_data_found'; end if;
  if c.opponent_id <> me then
    raise exception 'only the invited athlete may decline.' using errcode = 'insufficient_privilege';
  end if;
  if c.status <> 'pending' then
    return jsonb_build_object('status', c.status, 'already', true);
  end if;
  update public.forge_challenges set status = 'declined' where id = c.id;
  insert into public.forge_challenge_events (challenge_id, actor_id, kind) values (c.id, me, 'declined');
  return jsonb_build_object('status', 'declined', 'already', false);
end;
$$;

/**
 * CANCEL — withdraw. Before acceptance either side may; AFTER acceptance this
 * refunds BOTH stakes, because a contest nobody completed must not take
 * anybody's coins.
 */
create or replace function public.forge_challenge_cancel(p_challenge uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare c public.forge_challenges%rowtype; me uuid := auth.uid();
begin
  select * into c from public.forge_challenges where id = p_challenge for update;
  if not found then raise exception 'no such challenge.' using errcode = 'no_data_found'; end if;
  if c.challenger_id <> me and c.opponent_id <> me then
    raise exception 'not your challenge.' using errcode = 'insufficient_privilege';
  end if;
  if c.status in ('cancelled', 'declined', 'expired', 'settled') then
    return jsonb_build_object('status', c.status, 'already', true);
  end if;
  if c.status = 'active' or c.status = 'awaiting_settlement' then
    -- REFUND, once. The status guard above is what stops a second call paying
    -- a second time.
    perform set_config('evoforge.challenge_authorized', c.id::text, true);
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (c.challenger_id, 'challenge_payout', c.stake, c.id::text),
           (c.opponent_id,   'challenge_payout', c.stake, c.id::text);
  end if;
  update public.forge_challenges
  set status = 'cancelled', outcome = 'refund', settled_at = now() where id = c.id;
  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (c.id, me, 'cancelled', jsonb_build_object('refunded', c.stake));
  return jsonb_build_object('status', 'cancelled', 'already', false, 'refunded', c.stake);
end;
$$;

/** DISPUTE — pause settlement. Coins stay in escrow until a human resolves
 *  it; nobody can award themselves anything by raising one. */
create or replace function public.forge_challenge_dispute(p_challenge uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare c public.forge_challenges%rowtype; me uuid := auth.uid();
begin
  select * into c from public.forge_challenges where id = p_challenge for update;
  if not found then raise exception 'no such challenge.' using errcode = 'no_data_found'; end if;
  if c.challenger_id <> me and c.opponent_id <> me then
    raise exception 'not your challenge.' using errcode = 'insufficient_privilege';
  end if;
  if c.status not in ('active', 'awaiting_settlement', 'disputed', 'settled') then
    raise exception 'nothing to dispute yet.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.forge_challenge_disputes d
             where d.challenge_id = c.id and d.raised_by = me and d.status = 'open') then
    return jsonb_build_object('status', 'disputed', 'already', true);
  end if;
  insert into public.forge_challenge_disputes (challenge_id, raised_by, reason)
  values (c.id, me, p_reason);
  -- A SETTLED challenge stays settled: the coins have moved and unwinding
  -- them automatically would be a second, unreviewed transfer. The dispute is
  -- recorded against it for a human to act on.
  if c.status <> 'settled' then
    update public.forge_challenges set status = 'disputed' where id = c.id;
  end if;
  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (c.id, me, 'disputed', jsonb_build_object('reason', p_reason));
  return jsonb_build_object('status', 'disputed', 'already', false);
end;
$$;

-- ───────────────────────────────────────────────────────────── the read

/**
 * MY CHALLENGES — everything the athlete participates in, with BOTH sides'
 * live numbers.
 *
 * Definer because it reads the opponent's rows to score them; it returns only
 * the challenge metric and a display name. No measurements, no physique data,
 * no workout rows ever cross.
 */
create or replace function public.my_forge_challenges()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'my_forge_challenges: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select
        c.id, c.challenge_type, c.metric_key, c.duration_days, c.stake, c.status,
        c.created_at, c.expires_at, c.accepted_at, c.starts_at, c.ends_at,
        c.settled_at, c.winner_id, c.outcome, c.result_note, c.rematch_of,
        c.challenger_id, c.opponent_id,
        (c.challenger_id = me) as i_am_challenger,
        coalesce(ppc.display_name, 'Athlete') as challenger_name,
        coalesce(ppo.display_name, 'Athlete') as opponent_name,
        pc.baseline as challenger_baseline,
        po.baseline as opponent_baseline,
        -- LIVE values while active; the recorded finals once settled, so a
        -- finished challenge never silently re-scores.
        case when c.status = 'settled' then pc.final_detail
             when c.starts_at is null then null
             else public.forge_challenge_metric(c.challenger_id, c.challenge_type, c.metric_key,
                    (c.starts_at at time zone 'UTC')::date,
                    least((now() at time zone 'UTC')::date, (c.ends_at at time zone 'UTC')::date))
        end as challenger_current,
        case when c.status = 'settled' then po.final_detail
             when c.starts_at is null then null
             else public.forge_challenge_metric(c.opponent_id, c.challenge_type, c.metric_key,
                    (c.starts_at at time zone 'UTC')::date,
                    least((now() at time zone 'UTC')::date, (c.ends_at at time zone 'UTC')::date))
        end as opponent_current,
        exists (select 1 from public.forge_challenge_disputes d
                where d.challenge_id = c.id and d.status = 'open') as disputed
      from public.forge_challenges c
      left join public.forge_challenge_participants pc on pc.challenge_id = c.id and pc.user_id = c.challenger_id
      left join public.forge_challenge_participants po on po.challenge_id = c.id and po.user_id = c.opponent_id
      left join public.public_profile ppc on ppc.user_id = c.challenger_id
      left join public.public_profile ppo on ppo.user_id = c.opponent_id
      where c.challenger_id = me or c.opponent_id = me
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Only the signed-in athlete may call these; the bodies enforce who.
revoke all on function public.forge_challenge_metric(uuid, text, text, date, date) from public, anon;
revoke all on function public.forge_scheduled_on(uuid, date) from public, anon;
grant execute on function public.forge_challenge_accept(uuid) to authenticated;
grant execute on function public.forge_challenge_settle(uuid) to authenticated;
grant execute on function public.forge_challenge_decline(uuid) to authenticated;
grant execute on function public.forge_challenge_cancel(uuid) to authenticated;
grant execute on function public.forge_challenge_dispute(uuid, text) to authenticated;
grant execute on function public.my_forge_challenges() to authenticated;

commit;

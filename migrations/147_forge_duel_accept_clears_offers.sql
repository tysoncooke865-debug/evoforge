-- EvoForge 147 — accepting a duel answers every offer on it.
--
-- THE BUG, caught by the four-account browser tour and by nothing else:
--
--   ALPHA invites BRAVO at 25. BRAVO counters at 50. Before ALPHA answers,
--   BRAVO changes their mind and simply ACCEPTS at 25 — which they are entitled
--   to do; countering does not surrender the right to take the original terms.
--   The duel goes active at 25, and BRAVO's counter_stake offer is still
--   `pending`.
--
-- Two consequences, both visible:
--
--   1. The duel screen hides RAISE THE STAKES while any offer is live, so the
--      whole raise mechanic was unreachable for the rest of the contest.
--   2. ALPHA could still tap ACCEPT on that dead counter, and got a Postgres
--      refusal ("this duel has already started") for pressing a button the app
--      had drawn for them.
--
-- The rule this encodes: THE INVITE'S TERMS ARE SETTLED BY ACCEPTANCE. Any
-- proposal about those terms is answered the moment the duel starts, whichever
-- way it was answered. `superseded` rather than `expired` because the offer was
-- not abandoned — it was overtaken by a decision.
--
-- Everything else in this function is 145's body, verbatim.

begin;

create or replace function public.forge_challenge_accept(
  p_challenge uuid,
  p_local_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.forge_challenges%rowtype;
  cfg public.forge_duel_config;
  me uuid := auth.uid();
  bal_a int;
  bal_b int;
  t_start date;
  t_end date;
  base_a jsonb;
  base_b jsonb;
  utc_today date := (now() at time zone 'UTC')::date;
  window_end timestamptz;
  close_at timestamptz;
begin
  if me is null then
    raise exception 'forge_challenge_accept: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  select * into c from public.forge_challenges where id = p_challenge for update;
  if not found then
    raise exception 'forge_challenge_accept: no such challenge.' using errcode = 'no_data_found';
  end if;
  if c.opponent_id <> me then
    raise exception 'forge_challenge_accept: only the invited athlete may accept.'
      using errcode = 'insufficient_privilege';
  end if;

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

  bal_a := public.forge_duel_balance(c.challenger_id);
  bal_b := public.forge_duel_balance(c.opponent_id);
  if bal_a < c.stake then
    raise exception 'forge_challenge_accept: the challenger no longer has % coins.', c.stake
      using errcode = 'check_violation';
  end if;
  if bal_b < c.stake then
    raise exception 'forge_challenge_accept: you need % coins to accept (you have %).', c.stake, bal_b
      using errcode = 'check_violation';
  end if;

  -- 147: ACCEPTANCE ANSWERS EVERY OPEN PROPOSAL ABOUT THE TERMS. Taking the
  -- original stake is a decision about the counter, so the counter cannot
  -- outlive it — and the duel starts with its one pending-offer slot free for
  -- the raise mechanic.
  update public.forge_duel_offers
  set status = 'superseded', responded_by = me, responded_at = now()
  where challenge_id = c.id and status = 'pending';

  -- 143: the window runs on the ACCEPTING athlete's calendar, validated.
  t_start := coalesce(p_local_date, utc_today);
  if abs(t_start - utc_today) > 1 then
    t_start := utc_today;
  end if;
  t_end := t_start + (c.duration_days - 1);
  window_end := (t_end + 1)::timestamptz - interval '1 second';

  select * into cfg from public.forge_duel_config where id;
  close_at := now() + ((window_end - now()) * cfg.support_close_pct / 100.0);

  if c.challenge_type = 'most_improved_lift' then
    base_a := public.forge_challenge_metric(c.challenger_id, c.challenge_type, c.metric_key,
                                            '1900-01-01'::date, t_start - 1);
    base_b := public.forge_challenge_metric(c.opponent_id, c.challenge_type, c.metric_key,
                                            '1900-01-01'::date, t_start - 1);
  else
    base_a := jsonb_build_object('value', 0, 'measured', true);
    base_b := base_a;
  end if;

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
      starts_at = t_start::timestamptz, ends_at = window_end,
      current_stake = c.stake,
      support_closes_at = close_at
  where id = c.id;

  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (c.id, me, 'accepted',
          jsonb_build_object('stake', c.stake, 'pot', c.stake * 2,
                             'start', t_start, 'end', t_end));

  perform public.forge_duel_notify(
    c.challenger_id, me, 'duel_accepted',
    jsonb_build_object('challenge_id', c.id, 'stake', c.stake, 'pot', c.stake * 2));

  return jsonb_build_object('status', 'active', 'already', false, 'challenge_id', c.id,
                            'escrow', c.stake * 2, 'pot', c.stake * 2,
                            'start', t_start, 'end', t_end,
                            'support_closes_at', close_at);
end;
$$;

grant execute on function public.forge_challenge_accept(uuid, date) to authenticated;

commit;

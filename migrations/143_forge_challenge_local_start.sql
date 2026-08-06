-- EvoForge 143 — a challenge starts on the athlete's LOCAL day.
--
-- THE BUG, caught in the two-user E2E: a challenge accepted at 00:30 in
-- Australia rendered "DAY 2 OF 7" on its first day. `forge_challenge_accept`
-- anchored the window to `(now() at time zone 'UTC')::date` — still yesterday
-- for anyone east of Greenwich in the small hours — while the client counts
-- days from its own local date. One off-by-one, permanently visible, on the
-- number that tells the athlete how long they have left.
--
-- It also mattered for SCORING, not just the caption: the window is compared
-- against `workout_log.date` and `cardio_log.date`, which this app writes as
-- the athlete's LOCAL calendar day (domain/today.ts's rule, followed by
-- migrations 134 and 138). A UTC window judging local dates is a day out at
-- both ends.
--
-- So the accepter sends their local date and the server anchors to it. One
-- statable rule: THE CHALLENGE RUNS ON THE ACCEPTING ATHLETE'S CALENDAR, and
-- both athletes see the same window. The parameter is optional and falls back
-- to the UTC date, so an older client cannot break.
--
-- It is validated, not trusted: a date more than a day from the server's own
-- is rejected, so nobody can back-date a window to capture training that has
-- already happened.

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
  me uuid := auth.uid();
  bal_a int;
  bal_b int;
  t_start date;
  t_end date;
  base_a jsonb;
  base_b jsonb;
  utc_today date := (now() at time zone 'UTC')::date;
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

  -- THE LOCAL DAY, VALIDATED. Any real timezone is within one day of UTC, so a
  -- wider gap is not a timezone — it is an attempt to move the window onto
  -- training that already happened (or has not yet). Fall back to UTC.
  t_start := coalesce(p_local_date, utc_today);
  if abs(t_start - utc_today) > 1 then
    t_start := utc_today;
  end if;
  t_end := t_start + (c.duration_days - 1);

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

grant execute on function public.forge_challenge_accept(uuid, date) to authenticated;

commit;
